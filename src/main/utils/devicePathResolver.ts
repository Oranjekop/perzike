import { execFileSync } from 'child_process'
import path from 'path'

type DosDeviceMapping = {
  drive: string
  devicePath: string
}

let cachedMappings: DosDeviceMapping[] | null = null

function loadMappings(): DosDeviceMapping[] {
  if (process.platform !== 'win32') {
    return []
  }

  if (cachedMappings) {
    return cachedMappings
  }

  const script = [
    'Add-Type -TypeDefinition @\'',
    'using System;',
    'using System.Runtime.InteropServices;',
    'using System.Text;',
    'public static class Win32 {',
    '  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]',
    '  public static extern uint QueryDosDevice(string lpDeviceName, StringBuilder lpTargetPath, int ucchMax);',
    '}',
    '\'@;',
    '$items = [System.IO.DriveInfo]::GetDrives() | ForEach-Object {',
    '  $drive = $_.Name.Substring(0, 2);',
    '  $buffer = New-Object System.Text.StringBuilder 4096;',
    '  [void][Win32]::QueryDosDevice($drive, $buffer, $buffer.Capacity);',
    '  [PSCustomObject]@{ drive = $drive; devicePath = $buffer.ToString().Split([char]0)[0] }',
    '};',
    '$items | ConvertTo-Json -Compress'
  ].join(' ')

  try {
    const raw = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { encoding: 'utf8', windowsHide: true }
    ).trim()

    if (!raw) {
      cachedMappings = []
      return cachedMappings
    }

    const parsed = JSON.parse(raw) as DosDeviceMapping | DosDeviceMapping[]
    cachedMappings = Array.isArray(parsed) ? parsed : [parsed]
    return cachedMappings
  } catch {
    cachedMappings = []
    return cachedMappings
  }
}

export function resolveWithDosDeviceMappings(targetPath: string): string | null {
  if (process.platform !== 'win32') {
    return null
  }

  const normalizedInput = path.win32.normalize(targetPath)
  for (const { drive, devicePath } of loadMappings()) {
    const normalizedDevicePath = path.win32.normalize(devicePath)
    if (normalizedInput === normalizedDevicePath) {
      return `${drive}\\`
    }
    if (normalizedInput.startsWith(`${normalizedDevicePath}\\`)) {
      const rest = normalizedInput.slice(normalizedDevicePath.length).replace(/^\\+/, '')
      return path.win32.normalize(`${drive}\\${rest}`)
    }
  }

  return null
}
