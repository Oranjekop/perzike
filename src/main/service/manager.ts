import { serviceIpcPath, servicePath } from '../utils/dirs'
import { execWithElevation } from '../utils/elevation'
import { KeyManager, type KeyPair, computeKeyId } from './key'
import { initServiceAPI, getServiceAxios, ping, test, ServiceAPIError } from './api'
import { getAppConfig, patchAppConfig } from '../config/app'
import { execFile } from 'child_process'
import { promisify } from 'util'
import {
  canPersistServiceAuthSecret,
  loadServiceAuthSecret,
  saveServiceAuthSecret,
  type ServiceAuthSecret
} from './auth-store'

let keyManager: KeyManager | null = null
const execFilePromise = promisify(execFile)
const windowsServiceName = 'SparkleService'
const windowsServiceNameCandidates = [windowsServiceName, 'Sparkle Service']
type WindowsServiceState = 'running' | 'stopped' | 'paused' | 'not-installed' | 'unknown'

function parseLegacyServiceAuth(value: string): ServiceAuthSecret | null {
  try {
    const [publicKey, privateKey] = value.split(':')
    if (!publicKey || !privateKey) {
      return null
    }

    return {
      keyId: computeKeyId(publicKey),
      publicKey,
      privateKey
    }
  } catch {
    return null
  }
}

async function clearLegacyServiceAuth(): Promise<void> {
  await patchAppConfig({
    serviceAuthKey: undefined
  })
}

async function loadServiceAuthFromLegacyConfig(): Promise<ServiceAuthSecret | null> {
  const config = await getAppConfig()
  if (!config.serviceAuthKey) {
    return null
  }

  const legacySecret = parseLegacyServiceAuth(config.serviceAuthKey)
  if (!legacySecret) {
    return null
  }

  if (canPersistServiceAuthSecret()) {
    try {
      await saveServiceAuthSecret(legacySecret)
      await clearLegacyServiceAuth()
    } catch {
      // ignore and continue using the legacy value in memory
    }
  }

  return legacySecret
}

async function loadAvailableServiceAuth(): Promise<ServiceAuthSecret | null> {
  try {
    const storedSecret = await loadServiceAuthSecret()
    if (storedSecret) {
      const config = await getAppConfig()
      if (config.serviceAuthKey) {
        await clearLegacyServiceAuth()
      }
      return storedSecret
    }
  } catch {
    // ignore and fall back to the legacy config field
  }

  return await loadServiceAuthFromLegacyConfig()
}

function applyServiceAuthSecret(target: KeyManager, secret: ServiceAuthSecret | null): void {
  target.clear()
  if (secret) {
    target.setKeyPair(secret.publicKey, secret.privateKey, secret.keyId)
  }
}

function currentServiceAuthSecret(target: KeyManager): ServiceAuthSecret {
  return {
    keyId: target.getKeyID(),
    publicKey: target.getPublicKey(),
    privateKey: target.getPrivateKey()
  }
}

async function ensurePersistedServiceAuth(target: KeyManager): Promise<ServiceAuthSecret> {
  if (target.isInitialized()) {
    return currentServiceAuthSecret(target)
  }

  const existingSecret = await loadAvailableServiceAuth()
  if (existingSecret) {
    applyServiceAuthSecret(target, existingSecret)
    return existingSecret
  }

  if (!canPersistServiceAuthSecret()) {
    throw new Error('当前系统安全存储不可用，无法初始化服务鉴权')
  }

  const generatedKeyPair: KeyPair = target.generateKeyPair()
  await saveServiceAuthSecret(generatedKeyPair)
  await clearLegacyServiceAuth()
  return generatedKeyPair
}

export async function initKeyManager(): Promise<KeyManager> {
  if (keyManager) {
    return keyManager
  }

  keyManager = new KeyManager()
  const existingSecret = await loadAvailableServiceAuth()
  applyServiceAuthSecret(keyManager, existingSecret)
  initServiceAPI(keyManager)
  return keyManager
}

export function getKeyManager(): KeyManager {
  if (!keyManager) {
    throw new Error('密钥管理器未初始化，请先调用 initKeyManager')
  }
  return keyManager
}

export function getPublicKey(): string {
  return getKeyManager().getPublicKey()
}

class UserCancelledError extends Error {
  constructor(message = '用户取消操作') {
    super(message)
    this.name = 'UserCancelledError'
  }
}

function isUserCancelledError(error: unknown): boolean {
  if (error instanceof UserCancelledError) {
    return true
  }
  const errorMsg = error instanceof Error ? error.message : String(error)
  return (
    errorMsg.includes('用户已取消') ||
    errorMsg.includes('User canceled') ||
    errorMsg.includes('(-128)') ||
    errorMsg.includes('user cancelled') ||
    errorMsg.includes('dismissed')
  )
}

async function getAuthorizedPrincipalArgs(): Promise<string[]> {
  if (process.platform === 'win32') {
    const { stdout } = await execFilePromise(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        '[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value'
      ],
      { timeout: 5000 }
    )

    const sid = stdout.trim()
    if (!sid.startsWith('S-')) {
      throw new Error('读取当前用户 SID 失败')
    }

    return ['--authorized-sid', sid]
  }

  const uid = process.getuid?.()
  if (uid == null) {
    throw new Error('读取当前用户 UID 失败')
  }

  return ['--authorized-uid', String(uid)]
}

export function exportPublicKey(): string {
  return getPublicKey()
}

export function getAxios() {
  return getServiceAxios()
}

async function waitForServiceReady(timeoutMs = 15000): Promise<void> {
  const startedAt = Date.now()
  let lastError: unknown = null

  while (Date.now() - startedAt < timeoutMs) {
    try {
      await ping()
      await test()
      return
    } catch (error) {
      lastError = error
    }

    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  throw new Error(
    `等待服务就绪超时：${lastError instanceof Error ? lastError.message : String(lastError)}`
  )
}

async function waitForServicePing(timeoutMs = 15000): Promise<void> {
  const startedAt = Date.now()
  let lastError: unknown = null

  while (Date.now() - startedAt < timeoutMs) {
    try {
      await ping()
      return
    } catch (error) {
      lastError = error
    }

    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  throw new Error(
    `等待服务启动超时：${lastError instanceof Error ? lastError.message : String(lastError)}`
  )
}

function serviceCommandArgs(command: string, args: string[] = []): string[] {
  return ['service', command, '--listen', serviceIpcPath(), ...args]
}

async function execServiceCommandWithElevation(
  command: string,
  args: string[] = []
): Promise<void> {
  await execWithElevation(servicePath(), serviceCommandArgs(command, args))
}

async function getWindowsServiceBinPath(): Promise<{ name: string; binPath: string } | null> {
  if (process.platform !== 'win32') {
    return null
  }

  for (const name of windowsServiceNameCandidates) {
    try {
      const { stdout } = await execFilePromise('sc.exe', ['qc', name], {
        timeout: 5000
      })
      const match = stdout.match(/BINARY_PATH_NAME\s*:\s*(.+)/)
      const binPath = match?.[1]?.trim()
      if (binPath) {
        return { name, binPath }
      }
    } catch {
      // Try the next historical service name.
    }
  }

  return null
}

async function getWindowsServiceState(): Promise<WindowsServiceState> {
  if (process.platform !== 'win32') {
    return 'unknown'
  }

  for (const name of windowsServiceNameCandidates) {
    try {
      const { stdout } = await execFilePromise('sc.exe', ['query', name], {
        timeout: 5000
      })
      if (stdout.includes('RUNNING')) {
        return 'running'
      }
      if (stdout.includes('STOPPED')) {
        return 'stopped'
      }
      if (stdout.includes('PAUSED')) {
        return 'paused'
      }
      return 'unknown'
    } catch {
      // Try the next historical service name.
    }
  }

  return 'not-installed'
}

async function ensureWindowsServiceListenConfig(): Promise<boolean> {
  const serviceInfo = await getWindowsServiceBinPath()
  if (!serviceInfo) {
    return false
  }

  if (isWindowsServiceListenConfigCurrent(serviceInfo.binPath)) {
    return false
  }

  await execWithElevation('sc.exe', [
    'config',
    serviceInfo.name,
    'binPath=',
    `"${servicePath()}" service run --listen "${serviceIpcPath()}"`
  ])

  const updatedServiceInfo = await getWindowsServiceBinPath()
  if (
    !updatedServiceInfo ||
    !isWindowsServiceListenConfigCurrent(updatedServiceInfo.binPath)
  ) {
    throw new Error('服务启动参数更新失败，无法切换到 Perzike 服务管道')
  }

  return true
}

function isWindowsServiceListenConfigCurrent(binPath: string): boolean {
  return binPath.includes('service run --listen') && binPath.includes(serviceIpcPath())
}

async function ensureServiceInstalledAfterCommand(): Promise<void> {
  const status = await serviceStatus()
  if (status === 'not-installed') {
    throw new Error(
      '服务安装命令已执行，但系统仍显示未安装。请确认已同意管理员权限弹窗，或以管理员身份运行 Perzike 后重试；如果仍失败，可能是安全软件拦截了服务注册。'
    )
  }
}

export async function initService(): Promise<void> {
  const currentKeyManager = await initKeyManager()
  const secret = await ensurePersistedServiceAuth(currentKeyManager)

  try {
    const serviceConfigChanged = await ensureWindowsServiceListenConfig()
    const principalArgs = await getAuthorizedPrincipalArgs()
    await execServiceCommandWithElevation('init', [
      '--public-key',
      secret.publicKey,
      ...principalArgs
    ])
    await execServiceCommandWithElevation(serviceConfigChanged ? 'restart' : 'start')
  } catch (error) {
    if (isUserCancelledError(error)) {
      throw new UserCancelledError()
    }
    throw new Error(`服务初始化失败：${error instanceof Error ? error.message : String(error)}`)
  }

  await waitForServiceReady()
}

export async function installService(): Promise<void> {
  try {
    await execServiceCommandWithElevation('install')
    await ensureServiceInstalledAfterCommand()
    const serviceConfigChanged = await ensureWindowsServiceListenConfig()
    if (serviceConfigChanged && (await getWindowsServiceState()) === 'running') {
      await execServiceCommandWithElevation('restart')
    }
  } catch (error) {
    if (isUserCancelledError(error)) {
      throw new UserCancelledError()
    }
    throw new Error(`服务安装失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

export async function uninstallService(): Promise<void> {
  try {
    await execServiceCommandWithElevation('uninstall')
  } catch (error) {
    if (isUserCancelledError(error)) {
      throw new UserCancelledError()
    }
    throw new Error(`服务卸载失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

export async function startService(): Promise<void> {
  try {
    const serviceConfigChanged = await ensureWindowsServiceListenConfig()
    const serviceState = await getWindowsServiceState()
    await execServiceCommandWithElevation(
      serviceConfigChanged || serviceState === 'running' ? 'restart' : 'start'
    )
  } catch (error) {
    if (isUserCancelledError(error)) {
      throw new UserCancelledError()
    }
    const errorMsg = error instanceof Error ? error.message : String(error)
    if (!errorMsg.toLowerCase().includes('already')) {
      throw new Error(`服务启动失败：${errorMsg}`)
    }
  }

  await waitForServicePing()
}

export async function stopService(): Promise<void> {
  try {
    await execServiceCommandWithElevation('stop')
  } catch (error) {
    if (isUserCancelledError(error)) {
      throw new UserCancelledError()
    }
    throw new Error(`服务停止失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

export async function restartService(): Promise<void> {
  try {
    await ensureWindowsServiceListenConfig()
    await execServiceCommandWithElevation('restart')
  } catch (error) {
    if (isUserCancelledError(error)) {
      throw new UserCancelledError()
    }
    const errorMsg = error instanceof Error ? error.message : String(error)
    if (!errorMsg.toLowerCase().includes('already')) {
      throw new Error(`服务重启失败：${errorMsg}`)
    }
  }

  await waitForServicePing()
}

export async function serviceStatus(): Promise<
  'running' | 'stopped' | 'not-installed' | 'paused' | 'unknown' | 'need-init'
> {
  const execPath = servicePath()

  try {
    const { stderr } = await execFilePromise(execPath, serviceCommandArgs('status'))
    if (stderr.includes('the service is not installed')) {
      return 'not-installed'
    } else {
      try {
        await ping()
        try {
          await test()
          return 'running'
        } catch (error) {
          if (
            error instanceof ServiceAPIError &&
            error.status !== undefined &&
            [401, 403, 409, 503].includes(error.status)
          ) {
            return 'need-init'
          }
          return 'unknown'
        }
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : String(e)
        if (
          errorMsg.includes('EACCES') ||
          errorMsg.includes('permission denied') ||
          errorMsg.includes('access is denied')
        ) {
          return 'need-init'
        }
        return 'stopped'
      }
    }
  } catch (error) {
    return 'unknown'
  }
}

export async function testServiceConnection(): Promise<boolean> {
  try {
    await test()
    return true
  } catch {
    return false
  }
}
