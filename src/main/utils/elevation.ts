import { execFile } from 'child_process'
import { promisify } from 'util'

const execFilePromise = promisify(execFile)

let isAdminCached: boolean | null = null

export async function isRunningAsAdmin(): Promise<boolean> {
  if (isAdminCached !== null) {
    return isAdminCached
  }

  try {
    await execFilePromise('net', ['session'], { timeout: 2000 })
    isAdminCached = true
    return true
  } catch {
    isAdminCached = false
    return false
  }
}

export async function startProcessWithElevation(command: string, args: string[]): Promise<number> {
  if (process.platform !== 'win32') {
    throw new Error('startProcessWithElevation is only supported on Windows')
  }

  try {
    const escapedCommand = command.replace(/'/g, "''")
    const escapedArgs = windowsArgumentList(args).replace(/'/g, "''")
    const { stdout } = await execFilePromise(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `& { $p = Start-Process -FilePath '${escapedCommand}' -ArgumentList '${escapedArgs}' -Verb RunAs -WindowStyle Hidden -PassThru; if ($null -eq $p) { exit 1 }; [Console]::Out.Write($p.Id) }`
      ],
      { timeout: 30000 }
    )
    const pid = Number.parseInt(stdout.trim(), 10)
    if (!Number.isFinite(pid)) {
      throw new Error(`提权进程 PID 无效：${stdout}`)
    }
    return pid
  } catch (error) {
    throw new Error(
      `Windows 提权启动失败：${error instanceof Error ? error.message : String(error)}`
    )
  }
}

export async function stopProcessWithElevation(pid: number): Promise<void> {
  if (process.platform !== 'win32') {
    process.kill(pid, 'SIGINT')
    return
  }

  await execWithElevation(pathJoinSystem32('taskkill.exe'), [
    '/PID',
    String(pid),
    '/T',
    '/F'
  ])
}

function pathJoinSystem32(fileName: string): string {
  return `${process.env.SystemRoot || 'C:\\Windows'}\\System32\\${fileName}`
}

function shellQuote(arg: string): string {
  return `'${arg.replace(/'/g, `'\\''`)}'`
}

function appleScriptQuote(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function windowsArgQuote(arg: string): string {
  if (arg.length === 0) {
    return '""'
  }

  return `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1')}"`
}

function windowsArgumentList(args: string[]): string {
  return args.map(windowsArgQuote).join(' ')
}

export async function execWithElevation(command: string, args: string[]): Promise<void> {
  if (process.platform === 'win32') {
    try {
      if (await isRunningAsAdmin()) {
        await execFilePromise(command, args, { timeout: 30000 })
      } else {
        const escapedCommand = command.replace(/'/g, "''")
        const escapedArgs = windowsArgumentList(args).replace(/'/g, "''")
        await execFilePromise(
          'powershell.exe',
          [
            '-NoProfile',
            '-ExecutionPolicy',
            'Bypass',
            '-Command',
            `& { $p = Start-Process -FilePath '${escapedCommand}' -ArgumentList '${escapedArgs}' -Verb RunAs -WindowStyle Hidden -PassThru -Wait; exit $p.ExitCode }`
          ],
          { timeout: 30000 }
        )
      }
    } catch (error) {
      throw new Error(
        `Windows 提权执行失败：${error instanceof Error ? error.message : String(error)}`
      )
    }
  } else if (process.platform === 'linux') {
    try {
      await execFilePromise('pkexec', [command, ...args])
    } catch (error) {
      throw new Error(
        `Linux 提权执行失败：${error instanceof Error ? error.message : String(error)}`
      )
    }
  } else if (process.platform === 'darwin') {
    const cmd = [command, ...args].map(shellQuote).join(' ')
    try {
      await execFilePromise('osascript', [
        '-e',
        `do shell script "${appleScriptQuote(cmd)}" with administrator privileges`
      ])
    } catch (error) {
      throw new Error(
        `macOS 提权执行失败：${error instanceof Error ? error.message : String(error)}`
      )
    }
  }
}
