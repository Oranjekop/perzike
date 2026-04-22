import { getAppConfig } from '../config'
import dayjs from 'dayjs'
import AdmZip from 'adm-zip'
import path from 'path'
import {
  appConfigPath,
  controledMihomoConfigPath,
  dataDir,
  localBackupDir,
  overrideConfigPath,
  overrideDir,
  profileConfigPath,
  profilesDir,
  subStoreDir
} from '../utils/dirs'

function isValidFilename(filename: string): boolean {
  const normalized = path.normalize(filename)
  return (
    !normalized.includes('..') &&
    !path.isAbsolute(normalized) &&
    normalized === filename &&
    !filename.includes('/') &&
    !filename.includes('\\')
  )
}

function isValidWebdavUrl(url: string): boolean {
  if (!url) return false
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export async function webdavBackup(): Promise<boolean> {
  const { createClient } = await import('webdav/dist/node/index.js')
  const {
    webdavUrl = '',
    webdavUsername = '',
    webdavPassword = '',
    webdavDir = 'perzike'
  } = await getAppConfig()
  if (!isValidWebdavUrl(webdavUrl)) {
    throw new Error('Invalid WebDAV URL')
  }
  const zip = new AdmZip()

  zip.addLocalFile(appConfigPath())
  zip.addLocalFile(controledMihomoConfigPath())
  zip.addLocalFile(profileConfigPath())
  zip.addLocalFile(overrideConfigPath())
  zip.addLocalFolder(profilesDir(), 'profiles')
  zip.addLocalFolder(overrideDir(), 'override')
  zip.addLocalFolder(subStoreDir(), 'substore')
  const date = new Date()
  const zipFileName = `${process.platform}_${dayjs(date).format('YYYY-MM-DD_HH-mm-ss')}.zip`

  const client = createClient(webdavUrl, {
    username: webdavUsername,
    password: webdavPassword
  })
  try {
    await client.createDirectory(webdavDir)
  } catch {
    // ignore
  }

  return await client.putFileContents(`${webdavDir}/${zipFileName}`, zip.toBuffer())
}

export async function webdavRestore(filename: string): Promise<void> {
  if (!isValidFilename(filename)) {
    throw new Error('Invalid filename')
  }
  const { createClient } = await import('webdav/dist/node/index.js')
  const {
    webdavUrl = '',
    webdavUsername = '',
    webdavPassword = '',
    webdavDir = 'perzike'
  } = await getAppConfig()
  if (!isValidWebdavUrl(webdavUrl)) {
    throw new Error('Invalid WebDAV URL')
  }

  const client = createClient(webdavUrl, {
    username: webdavUsername,
    password: webdavPassword
  })
  const zipData = await client.getFileContents(`${webdavDir}/${filename}`)
  const zip = new AdmZip(zipData as Buffer)
  for (const entry of zip.getEntries()) {
    const normalized = path.normalize(entry.entryName)
    if (normalized.includes('..') || path.isAbsolute(normalized)) {
      throw new Error(`Invalid path in archive: ${entry.entryName}`)
    }
  }
  zip.extractAllTo(dataDir(), true)
}

export async function listWebdavBackups(): Promise<string[]> {
  const { createClient } = await import('webdav/dist/node/index.js')
  const {
    webdavUrl = '',
    webdavUsername = '',
    webdavPassword = '',
    webdavDir = 'perzike'
  } = await getAppConfig()
  if (!isValidWebdavUrl(webdavUrl)) {
    throw new Error('Invalid WebDAV URL')
  }

  const client = createClient(webdavUrl, {
    username: webdavUsername,
    password: webdavPassword
  })
  const files = (await client.getDirectoryContents(webdavDir, {
    glob: '*.zip'
  })) as Array<{ basename: string }> | { data?: Array<{ basename: string }> }
  const fileList = Array.isArray(files) ? files : (files.data ?? [])
  return fileList.map((file) => file.basename).sort((a, b) => b.localeCompare(a))
}

export async function webdavDelete(filename: string): Promise<void> {
  if (!isValidFilename(filename)) {
    throw new Error('Invalid filename')
  }
  const { createClient } = await import('webdav/dist/node/index.js')
  const {
    webdavUrl = '',
    webdavUsername = '',
    webdavPassword = '',
    webdavDir = 'perzike'
  } = await getAppConfig()
  if (!isValidWebdavUrl(webdavUrl)) {
    throw new Error('Invalid WebDAV URL')
  }

  const client = createClient(webdavUrl, {
    username: webdavUsername,
    password: webdavPassword
  })
  await client.deleteFile(`${webdavDir}/${filename}`)
}

export async function localBackup(targetPath: string): Promise<string> {
  const fs = await import('fs/promises')

  try {
    await fs.access(targetPath, (await import('fs')).constants.W_OK)
    const stat = await fs.stat(targetPath)
    if (!stat.isDirectory()) {
      throw new Error('目标路径必须是目录')
    }
  } catch (error) {
    if (error instanceof Error && error.message === '目标路径必须是目录') {
      throw error
    }
    throw new Error('目标目录不可写或不存在')
  }

  const zip = new AdmZip()
  let hasContent = false

  const filesToAdd = [
    appConfigPath(),
    controledMihomoConfigPath(),
    profileConfigPath(),
    overrideConfigPath()
  ]

  for (const file of filesToAdd) {
    try {
      await fs.access(file)
      zip.addLocalFile(file)
      hasContent = true
    } catch {
      // ignore missing files
    }
  }

  const foldersToAdd = [
    { path: profilesDir(), name: 'profiles' },
    { path: overrideDir(), name: 'override' },
    { path: subStoreDir(), name: 'substore' }
  ]

  for (const folder of foldersToAdd) {
    try {
      const stat = await fs.stat(folder.path)
      if (stat.isDirectory()) {
        zip.addLocalFolder(folder.path, folder.name)
        hasContent = true
      }
    } catch {
      // ignore missing folders
    }
  }

  if (!hasContent) {
    throw new Error('没有可备份的内容')
  }

  const zipFileName = `${process.platform}_${dayjs().format('YYYY-MM-DD_HH-mm-ss')}.zip`
  const fullPath = path.join(targetPath, zipFileName)
  await fs.writeFile(fullPath, zip.toBuffer())
  return fullPath
}

export async function localRestore(zipPath: string): Promise<void> {
  const fs = await import('fs/promises')
  const os = await import('os')
  const { dialog, shell } = await import('electron')

  try {
    await fs.access(zipPath)
  } catch {
    throw new Error('备份文件不存在')
  }

  if (!zipPath.toLowerCase().endsWith('.zip')) {
    throw new Error('只支持 .zip 格式的备份文件')
  }

  const zip = new AdmZip(await fs.readFile(zipPath))
  const targetDir = dataDir()
  const allowedPaths = new Set([
    'config.yaml',
    'mihomo.yaml',
    'profile.yaml',
    'override.yaml',
    'profiles',
    'override',
    'substore'
  ])

  for (const entry of zip.getEntries()) {
    const normalized = path.normalize(entry.entryName)
    if (normalized.includes('..') || path.isAbsolute(normalized)) {
      throw new Error(`备份文件中包含非法路径: ${entry.entryName}`)
    }
    const parts = normalized.split(path.sep).filter(Boolean)
    if (parts.length === 0 || !allowedPaths.has(parts[0])) {
      throw new Error(`备份文件中包含未知文件: ${entry.entryName}`)
    }
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'perzike-restore-'))
  const backupRoot = localBackupDir()
  await fs.mkdir(backupRoot, { recursive: true })
  const backupDir = path.join(backupRoot, `.restore-backup-${Date.now()}`)

  try {
    await fs.mkdir(backupDir, { recursive: true })
    zip.extractAllTo(tempDir, true)

    for (const item of allowedPaths) {
      const sourcePath = path.join(targetDir, item)
      const backupPath = path.join(backupDir, item)
      try {
        const stat = await fs.stat(sourcePath)
        if (stat.isDirectory()) {
          await fs.cp(sourcePath, backupPath, { recursive: true })
        } else {
          await fs.copyFile(sourcePath, backupPath)
        }
      } catch {
        // ignore missing current items
      }
    }

    const tempFiles = await fs.readdir(tempDir)
    for (const file of tempFiles) {
      const sourcePath = path.join(tempDir, file)
      const destPath = path.join(targetDir, file)
      const stat = await fs.stat(sourcePath)

      if (stat.isDirectory()) {
        await fs.rm(destPath, { recursive: true, force: true }).catch(() => {})
        await fs.cp(sourcePath, destPath, { recursive: true })
      } else {
        await fs.copyFile(sourcePath, destPath)
      }
    }

    await fs.rm(backupDir, { recursive: true, force: true }).catch(() => {})
  } catch (error) {
    let rollbackFailed = false
    try {
      for (const item of allowedPaths) {
        const destPath = path.join(targetDir, item)
        await fs.rm(destPath, { recursive: true, force: true }).catch(() => {})
      }

      const backupFiles = await fs.readdir(backupDir)
      for (const file of backupFiles) {
        const backupPath = path.join(backupDir, file)
        const destPath = path.join(targetDir, file)
        const stat = await fs.stat(backupPath)
        if (stat.isDirectory()) {
          await fs.cp(backupPath, destPath, { recursive: true })
        } else {
          await fs.copyFile(backupPath, destPath)
        }
      }
      await fs.rm(backupDir, { recursive: true, force: true }).catch(() => {})
    } catch {
      rollbackFailed = true
    }

    if (rollbackFailed) {
      try {
        const result = await dialog.showMessageBox({
          type: 'error',
          title: '恢复失败',
          message: '配置恢复失败且自动回滚失败',
          detail: `您的原始配置已备份至:\n${backupDir}\n\n点击"打开目录"查看备份文件，您可以手动将其中的文件复制回应用数据目录进行恢复。`,
          buttons: ['打开目录', '关闭']
        })
        if (result.response === 0) {
          await shell.openPath(backupDir)
        }
      } catch {
        // ignore dialog errors
      }
      throw new Error(`恢复失败，请手动从备份目录恢复配置: ${backupDir}`)
    }

    throw error
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
}

export async function listLocalBackups(backupDir: string): Promise<string[]> {
  const fs = await import('fs/promises')
  const backupFilePattern = /^(darwin|win32|linux)_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.zip$/

  try {
    const stat = await fs.stat(backupDir)
    if (!stat.isDirectory()) {
      throw new Error('指定的路径不是目录')
    }
    const files = await fs.readdir(backupDir)
    return files.filter((file) => backupFilePattern.test(file)).sort((a, b) => b.localeCompare(a))
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      throw new Error('备份目录不存在')
    }
    if (error instanceof Error && error.message === '指定的路径不是目录') {
      throw error
    }
    throw new Error('无法读取备份目录')
  }
}

export async function localDelete(backupDir: string, filename: string): Promise<void> {
  if (!isValidFilename(filename)) {
    throw new Error('Invalid filename')
  }

  const fs = await import('fs/promises')
  const fullPath = path.join(backupDir, filename)
  const relativePath = path.relative(backupDir, fullPath)
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error('Invalid file path')
  }
  await fs.unlink(fullPath)
}
