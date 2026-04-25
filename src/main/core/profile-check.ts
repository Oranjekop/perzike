import { execFile } from 'child_process'
import path from 'path'
import { promisify } from 'util'
import { getAppConfig, getProfileConfig } from '../config'
import { mihomoCorePath, mihomoTestDir, mihomoWorkConfigPath } from '../utils/dirs'

type ProfileCheckError = Error & {
  stdout?: string | Buffer
  stderr?: string | Buffer
}

function outputText(value: unknown): string {
  if (Buffer.isBuffer(value)) {
    return value.toString('utf8')
  }
  return typeof value === 'string' ? value : ''
}

function profileCheckDetail(output: string, fallback: string): string {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const errorLines = lines
    .filter((line) => line.includes('level=error'))
    .map((line) => line.split('level=error')[1]?.trim() || line)
  const detailLines = errorLines.length > 0 ? errorLines : lines
  return detailLines.join('\n') || fallback || 'mihomo 配置校验失败'
}

export async function checkProfile(): Promise<void> {
  const { core = 'mihomo', diffWorkDir = false, safePaths = [] } = await getAppConfig()
  const { current } = await getProfileConfig()
  const corePath = mihomoCorePath(core)
  const execFilePromise = promisify(execFile)
  const env = {
    ...process.env,
    SAFE_PATHS: safePaths.join(path.delimiter)
  }
  try {
    await execFilePromise(
      corePath,
      [
        '-t',
        '-f',
        diffWorkDir ? mihomoWorkConfigPath(current) : mihomoWorkConfigPath('work'),
        '-d',
        mihomoTestDir()
      ],
      { env }
    )
  } catch (error) {
    if (error instanceof Error) {
      const profileError = error as ProfileCheckError
      const output = [outputText(profileError.stdout), outputText(profileError.stderr)]
        .filter(Boolean)
        .join('\n')
      throw new Error(`Profile Check Failed:\n${profileCheckDetail(output, error.message)}`)
    }
    throw error
  }
}
