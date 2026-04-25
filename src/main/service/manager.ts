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
  return ['--listen', serviceIpcPath(), 'service', command, ...args]
}

async function execServiceCommandWithElevation(
  command: string,
  args: string[] = []
): Promise<void> {
  await execWithElevation(servicePath(), serviceCommandArgs(command, args))
}

async function getWindowsServiceBinPath(): Promise<string | null> {
  if (process.platform !== 'win32') {
    return null
  }

  try {
    const { stdout } = await execFilePromise('sc.exe', ['qc', windowsServiceName], {
      timeout: 5000
    })
    const match = stdout.match(/BINARY_PATH_NAME\s*:\s*(.+)/)
    return match?.[1]?.trim() || null
  } catch {
    return null
  }
}

async function ensureWindowsServiceListenConfig(): Promise<boolean> {
  const binPath = await getWindowsServiceBinPath()
  if (!binPath) {
    return false
  }

  if (binPath.includes('--listen') && binPath.includes(serviceIpcPath())) {
    return false
  }

  await execWithElevation('sc.exe', [
    'config',
    windowsServiceName,
    'binPath=',
    `"${servicePath()}" --listen "${serviceIpcPath()}" service run`
  ])
  return true
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
    await ensureWindowsServiceListenConfig()
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
    await execServiceCommandWithElevation(serviceConfigChanged ? 'restart' : 'start')
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
