import {
  appConfigPath,
  controledMihomoConfigPath,
  dataDir,
  logDir,
  mihomoTestDir,
  mihomoCoreDir,
  mihomoUserCoreDir,
  mihomoWorkDir,
  overrideConfigPath,
  overrideDir,
  profileConfigPath,
  profilePath,
  profilesDir,
  resourcesFilesDir,
  subStoreDir
} from './dirs'
import {
  defaultConfig,
  defaultControledMihomoConfig,
  defaultOverrideConfig,
  defaultProfile,
  defaultProfileConfig
} from './template'
import { stringifyYaml } from './yaml'
import { mkdir, writeFile, cp, rm, readdir, copyFile, chmod, stat } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import {
  startPacServer,
  startSubStoreBackendServer,
  startSubStoreFrontendServer
} from '../resolve/server'
import { triggerSysProxy } from '../sys/sysproxy'
import {
  getAppConfig,
  getControledMihomoConfig,
  patchAppConfig,
  patchControledMihomoConfig
} from '../config'
import { app } from 'electron'
import { startSSIDCheck } from '../sys/ssid'
import { startNetworkDetection } from '../core/manager'
import { initKeyManager } from '../service/manager'

async function initDirs(): Promise<void> {
  if (!existsSync(dataDir())) {
    await mkdir(dataDir())
  }
  const dirs = [
    profilesDir(),
    overrideDir(),
    mihomoWorkDir(),
    logDir(),
    mihomoTestDir(),
    subStoreDir()
  ]
  await Promise.all(
    dirs.map(async (dir) => {
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true })
      }
    })
  )
}

async function initConfig(): Promise<void> {
  const configTasks: Promise<void>[] = []

  if (!existsSync(appConfigPath())) {
    configTasks.push(writeFile(appConfigPath(), stringifyYaml(defaultConfig)))
  }
  if (!existsSync(profileConfigPath())) {
    configTasks.push(writeFile(profileConfigPath(), stringifyYaml(defaultProfileConfig)))
  }
  if (!existsSync(overrideConfigPath())) {
    configTasks.push(writeFile(overrideConfigPath(), stringifyYaml(defaultOverrideConfig)))
  }
  if (!existsSync(profilePath('default'))) {
    configTasks.push(writeFile(profilePath('default'), stringifyYaml(defaultProfile)))
  }
  if (!existsSync(controledMihomoConfigPath())) {
    configTasks.push(
      writeFile(controledMihomoConfigPath(), stringifyYaml(defaultControledMihomoConfig))
    )
  }

  if (configTasks.length > 0) {
    await Promise.all(configTasks)
  }
}

async function initFiles(): Promise<void> {
  const copy = async (file: string): Promise<void> => {
    const targetPath = path.join(mihomoWorkDir(), file)
    const testTargetPath = path.join(mihomoTestDir(), file)
    const sourcePath = path.join(resourcesFilesDir(), file)
    if (!existsSync(targetPath) && existsSync(sourcePath)) {
      await cp(sourcePath, targetPath, { recursive: true })
    }
    if (!existsSync(testTargetPath) && existsSync(sourcePath)) {
      await cp(sourcePath, testTargetPath, { recursive: true })
    }
  }
  await Promise.all([
    copy('country.mmdb'),
    copy('geoip.metadb'),
    copy('geoip.dat'),
    copy('geosite.dat'),
    copy('ASN.mmdb'),
    copy('sub-store.bundle.js'),
    copy('sub-store-frontend')
  ])
}

async function initCoreFiles(): Promise<void> {
  const sourceDir = mihomoCoreDir()
  const targetDir = mihomoUserCoreDir()
  if (sourceDir === targetDir) {
    return
  }

  await mkdir(targetDir, { recursive: true })

  const isWin = process.platform === 'win32'
  const coreFiles = [`mihomo${isWin ? '.exe' : ''}`, `mihomo-alpha${isWin ? '.exe' : ''}`]

  await Promise.all(
    coreFiles.map(async (file) => {
      const sourcePath = path.join(sourceDir, file)
      const targetPath = path.join(targetDir, file)
      if (!existsSync(sourcePath)) {
        return
      }

      try {
        const [sourceStat, targetStat] = await Promise.all([
          stat(sourcePath),
          stat(targetPath).catch(() => undefined)
        ])
        if (
          targetStat &&
          targetStat.size === sourceStat.size &&
          targetStat.mtimeMs >= sourceStat.mtimeMs
        ) {
          return
        }

        await copyFile(sourcePath, targetPath)
        if (!isWin) {
          await chmod(targetPath, 0o755)
        }
      } catch {
        // keep the bundled path fallback when resources are not readable
      }
    })
  )
}

async function cleanup(): Promise<void> {
  // update cache
  const files = await readdir(dataDir())
  for (const file of files) {
    if (file.endsWith('.exe') || file.endsWith('.pkg') || file.endsWith('.7z')) {
      try {
        await rm(path.join(dataDir(), file))
      } catch {
        // ignore
      }
    }
  }
  // logs
  const { maxLogDays = 7 } = await getAppConfig()
  const logs = await readdir(logDir())
  for (const log of logs) {
    const dateStr = log.match(/(\d{4}-\d{1,2}-\d{1,2})(?=\.log$)/)?.[1]
    if (!dateStr) continue

    const date = new Date(dateStr)
    if (Number.isNaN(date.getTime())) continue

    const diff = Date.now() - date.getTime()
    if (diff > maxLogDays * 24 * 60 * 60 * 1000) {
      try {
        await rm(path.join(logDir(), log))
      } catch {
        // ignore
      }
    }
  }
}

async function migration(): Promise<void> {
  const appConfig = await getAppConfig()
  const mihomoConfig = await getControledMihomoConfig()

  const mihomoConfigPatch: Partial<MihomoConfig> = {}

  for (const key in defaultControledMihomoConfig) {
    if (
      !(key in mihomoConfig) &&
      defaultControledMihomoConfig[key as keyof MihomoConfig] !== undefined
    ) {
      ;(mihomoConfigPatch as Record<string, unknown>)[key] =
        defaultControledMihomoConfig[key as keyof MihomoConfig]
    }
  }

  if (mihomoConfig['external-controller-pipe' as keyof MihomoConfig]) {
    mihomoConfigPatch['external-controller-pipe' as keyof MihomoConfig] = undefined as never
  }
  if (mihomoConfig['external-controller-unix' as keyof MihomoConfig]) {
    mihomoConfigPatch['external-controller-unix' as keyof MihomoConfig] = undefined as never
  }

  if (mihomoConfig['external-controller'] === undefined) {
    mihomoConfigPatch['external-controller'] = ''
  }
  if (mihomoConfig['global-client-fingerprint'] !== undefined) {
    mihomoConfigPatch['global-client-fingerprint'] = undefined as never
  }

  if (Object.keys(mihomoConfigPatch).length > 0) {
    await patchControledMihomoConfig(mihomoConfigPatch)
  }

  const appConfigPatch: Partial<AppConfig> = {}

  for (const key in defaultConfig) {
    if (!(key in appConfig) && defaultConfig[key as keyof AppConfig] !== undefined) {
      ;(appConfigPatch as Record<string, unknown>)[key] = defaultConfig[key as keyof AppConfig]
    }
  }

  if (appConfig.core === 'system') {
    appConfigPatch.core = 'mihomo'
  }

  if (appConfig.coreStartupMode === 'post-up') {
    appConfigPatch.coreStartupMode = 'log'
  }

  if (Object.keys(appConfigPatch).length > 0) {
    await patchAppConfig(appConfigPatch)
  }
}

function initDeeplink(): void {
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient('clash', process.execPath, [path.resolve(process.argv[1])])
      app.setAsDefaultProtocolClient('mihomo', process.execPath, [path.resolve(process.argv[1])])
      app.setAsDefaultProtocolClient('perzike', process.execPath, [path.resolve(process.argv[1])])
    }
  } else {
    app.setAsDefaultProtocolClient('clash')
    app.setAsDefaultProtocolClient('mihomo')
    app.setAsDefaultProtocolClient('perzike')
  }
}

export async function init(): Promise<void> {
  await initDirs()
  await Promise.all([initConfig(), initFiles(), initCoreFiles()])
  await migration()

  const [appConfig] = await Promise.all([
    getAppConfig(),
    initKeyManager(),
    cleanup().catch(() => {
      // ignore
    })
  ])

  const { sysProxy, onlyActiveDevice = false, networkDetection = false } = appConfig

  const initTasks: Promise<void>[] = [
    startSubStoreFrontendServer(),
    startSubStoreBackendServer(),
    startSSIDCheck()
  ]

  if (networkDetection) {
    initTasks.push(startNetworkDetection())
  }

  initTasks.push(
    (async (): Promise<void> => {
      try {
        if (sysProxy.enable) {
          await startPacServer()
        }
        await triggerSysProxy(sysProxy.enable, onlyActiveDevice)
      } catch {
        // ignore
      }
    })()
  )

  await Promise.all(initTasks)

  initDeeplink()
}
