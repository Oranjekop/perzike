import axios, { AxiosRequestConfig, CancelTokenSource } from 'axios'
import { parseYaml } from '../utils/yaml'
import { app, shell } from 'electron'
import { getAppConfig, getControledMihomoConfig } from '../config'
import { dataDir, exeDir, exePath, isPortable, resourcesFilesDir } from '../utils/dirs'
import { copyFile, rm, writeFile, readFile } from 'fs/promises'
import path from 'path'
import { existsSync } from 'fs'
import { exec, execFile, spawn } from 'child_process'
import { promisify } from 'util'
import { createHash } from 'crypto'
import { setNotQuitDialog, mainWindow } from '..'
import { disableSysProxy } from '../sys/sysproxy'
import { serviceStatus, stopService } from '../service/manager'
import { appendAppLog } from '../utils/log'

let downloadCancelToken: CancelTokenSource | null = null

interface GithubReleaseAsset {
  name: string
  digest?: string
  browser_download_url: string
}

interface GithubRelease {
  tag_name: string
  draft: boolean
  prerelease: boolean
  assets: GithubReleaseAsset[]
}

function quotePowerShellString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function quoteWindowsArgument(value: string): string {
  if (value === '') return '""'
  if (!/[ \t"]/.test(value)) return value

  return `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1')}"`
}

async function launchWindowsInstaller(installerPath: string, args: string[]): Promise<void> {
  const execFilePromise = promisify(execFile)
  const argumentList = args.map(quoteWindowsArgument).join(' ')
  const command = [
    "$ErrorActionPreference = 'Stop'",
    `Start-Process -FilePath ${quotePowerShellString(installerPath)} -ArgumentList ${quotePowerShellString(argumentList)} -Verb RunAs -WindowStyle Hidden`
  ].join('; ')

  await execFilePromise(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
    { timeout: 120000 }
  )
}

async function stopServiceForPortableUpdate(): Promise<void> {
  const status = await serviceStatus().catch(async (error) => {
    await appendAppLog(`[Updater]: query service status failed before portable update, ${error}\n`)
    return 'unknown' as const
  })

  if (status === 'not-installed' || status === 'stopped') {
    return
  }

  await appendAppLog(`[Updater]: stop service before portable update, status: ${status}\n`)
  await stopService()
}

function createAxiosConfig(
  mixedPort: number,
  cancelToken?: CancelTokenSource['token']
): AxiosRequestConfig {
  return {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Perzike-Updater'
    },
    ...(mixedPort != 0 && {
      proxy: {
        protocol: 'http',
        host: '127.0.0.1',
        port: mixedPort
      }
    }),
    ...(cancelToken && { cancelToken })
  }
}

async function fetchReleaseByTag(
  tag: string,
  mixedPort: number
): Promise<GithubRelease | undefined> {
  try {
    const res = await axios.get<GithubRelease>(
      `https://api.github.com/repos/Oranjekop/perzike/releases/tags/${tag}`,
      createAxiosConfig(mixedPort)
    )
    return res.data
  } catch (e) {
    if (axios.isAxiosError(e) && e.response?.status === 404) {
      return undefined
    }
    throw e
  }
}

async function fetchReleases(mixedPort: number): Promise<GithubRelease[]> {
  const res = await axios.get<GithubRelease[]>(
    'https://api.github.com/repos/Oranjekop/perzike/releases?per_page=20',
    createAxiosConfig(mixedPort)
  )
  return res.data
}

function getLatestYmlAsset(release: GithubRelease): GithubReleaseAsset | undefined {
  return release.assets.find((asset) => asset.name === 'latest.yml')
}

async function resolveReleaseForChannel(
  updateChannel: AppConfig['updateChannel'],
  mixedPort: number
): Promise<GithubRelease | undefined> {
  if (updateChannel === 'beta') {
    const betaRelease = await fetchReleaseByTag('pre-release', mixedPort)
    if (betaRelease && !betaRelease.draft) {
      return betaRelease
    }
  }

  const releases = await fetchReleases(mixedPort)
  return releases.find((release) => {
    if (release.draft) return false
    if (updateChannel === 'stable' && release.prerelease) return false
    if (updateChannel === 'beta' && !release.prerelease) return false
    return Boolean(getLatestYmlAsset(release))
  })
}

async function resolveReleaseForVersion(
  version: string,
  mixedPort: number
): Promise<GithubRelease | undefined> {
  if (version.includes('beta')) {
    return await resolveReleaseForChannel('beta', mixedPort)
  }

  const releases = await fetchReleases(mixedPort)
  return releases.find((release) => {
    if (release.draft || release.prerelease) return false
    return release.tag_name === version || release.tag_name === `v${version}`
  })
}

export async function checkUpdate(): Promise<AppVersion | undefined> {
  const { 'mixed-port': mixedPort = 7890 } = await getControledMihomoConfig()
  const { updateChannel = 'stable' } = await getAppConfig()
  const release = await resolveReleaseForChannel(updateChannel, mixedPort)
  if (!release) {
    return undefined
  }

  const latestYmlAsset = getLatestYmlAsset(release)
  if (!latestYmlAsset) {
    return undefined
  }

  const res = await axios.get(latestYmlAsset.browser_download_url, {
    ...createAxiosConfig(mixedPort),
    responseType: 'text'
  })
  const latest = parseYaml<AppVersion>(res.data)
  const currentVersion = app.getVersion()
  if (latest.version !== currentVersion) {
    return latest
  } else {
    return undefined
  }
}

export async function downloadAndInstallUpdate(version: string): Promise<void> {
  const { 'mixed-port': mixedPort = 7890 } = await getControledMihomoConfig()
  const fileMap = {
    'win32-x64': `perzike-windows-${version}-x64-setup.exe`,
    'win32-arm64': `perzike-windows-${version}-arm64-setup.exe`,
    'darwin-x64': `perzike-macos-${version}-x64.pkg`,
    'darwin-arm64': `perzike-macos-${version}-arm64.pkg`
  }
  let file = fileMap[`${process.platform}-${process.arch}`]
  if (!file) {
    throw new Error('不支持自动更新，请手动下载更新')
  }
  if (isPortable()) {
    file = file.replace('-setup.exe', '-portable.7z')
  }
  downloadCancelToken = axios.CancelToken.source()

  try {
    mainWindow?.webContents.send('update-status', {
      downloading: true,
      progress: 0
    })

    const release = await resolveReleaseForVersion(version, mixedPort)
    if (!release) {
      throw new Error(`未找到版本 ${version} 对应的发布信息`)
    }

    const assets = release.assets || []
    const matchedAsset = assets.find((a) => a.name === file)
    if (!matchedAsset || !matchedAsset.digest) {
      throw new Error(`无法从 GitHub Release 中找到 "${file}" 对应的 SHA-256 信息`)
    }
    const expectedHash = matchedAsset.digest.split(':')[1].toLowerCase()

    if (!existsSync(path.join(dataDir(), file))) {
      const res = await axios.get(matchedAsset.browser_download_url, {
        responseType: 'arraybuffer',
        ...createAxiosConfig(mixedPort, downloadCancelToken.token),
        headers: {
          'Content-Type': 'application/octet-stream'
        },
        onDownloadProgress: (progressEvent) => {
          const percentCompleted = Math.round(
            (progressEvent.loaded * 100) / (progressEvent.total || 1)
          )
          mainWindow?.webContents.send('update-status', {
            downloading: true,
            progress: percentCompleted
          })
        }
      })
      await writeFile(path.join(dataDir(), file), res.data)
    }

    const fileBuffer = await readFile(path.join(dataDir(), file))
    const hashSum = createHash('sha256')
    hashSum.update(fileBuffer)
    const localHash = hashSum.digest('hex').toLowerCase()
    if (localHash !== expectedHash) {
      await rm(path.join(dataDir(), file), { force: true })
      throw new Error(`SHA-256 校验失败：本地哈希 ${localHash} 与预期 ${expectedHash} 不符`)
    }

    mainWindow?.webContents.send('update-status', {
      downloading: false,
      progress: 100
    })

    await disableSysProxy(false).catch(() => undefined)
    if (file.endsWith('.exe')) {
      await launchWindowsInstaller(path.join(dataDir(), file), ['/S', '--force-run'])
      setNotQuitDialog()
      app.quit()
    }
    if (file.endsWith('.7z')) {
      await stopServiceForPortableUpdate()
      await copyFile(path.join(resourcesFilesDir(), '7za.exe'), path.join(dataDir(), '7za.exe'))
      spawn(
        'cmd',
        [
          '/C',
          `"timeout /t 2 /nobreak >nul && "${path.join(dataDir(), '7za.exe')}" x -o"${exeDir()}" -y "${path.join(dataDir(), file)}" & start "" "${exePath()}""`
        ],
        {
          shell: true,
          detached: true
        }
      ).unref()
      setNotQuitDialog()
      app.quit()
    }
    if (file.endsWith('.pkg')) {
      try {
        const execPromise = promisify(exec)
        const shell = `installer -pkg ${path.join(dataDir(), file).replace(' ', '\\\\ ')} -target /`
        const command = `do shell script "${shell}" with administrator privileges`
        await execPromise(`osascript -e '${command}'`)
        app.relaunch()
        setNotQuitDialog()
        app.quit()
      } catch {
        shell.openPath(path.join(dataDir(), file))
      }
    }
  } catch (e) {
    await rm(path.join(dataDir(), file), { force: true })
    if (axios.isCancel(e)) {
      mainWindow?.webContents.send('update-status', {
        downloading: false,
        progress: 0,
        error: '下载已取消'
      })
      return
    } else {
      mainWindow?.webContents.send('update-status', {
        downloading: false,
        progress: 0,
        error: e instanceof Error ? e.message : '下载失败'
      })
    }
    throw e
  } finally {
    downloadCancelToken = null
  }
}

export async function cancelUpdate(): Promise<void> {
  if (downloadCancelToken) {
    downloadCancelToken.cancel('用户取消下载')
    downloadCancelToken = null
  }
}
