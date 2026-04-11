import { app, BrowserWindow } from 'electron'

export const is = {
  dev: !app.isPackaged
}

export const electronApp = {
  setAppUserModelId(id: string): void {
    if (process.platform === 'win32') {
      app.setAppUserModelId(is.dev ? process.execPath : id)
    }
  }
}

export const optimizer = {
  watchWindowShortcuts(
    window: BrowserWindow | null,
    shortcutOptions?: { escToCloseWindow?: boolean; zoom?: boolean }
  ): void {
    if (!window) return
    const { webContents } = window
    const { escToCloseWindow = false, zoom = false } = shortcutOptions || {}

    webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return

      if (!is.dev) {
        if (input.code === 'KeyR' && (input.control || input.meta)) {
          event.preventDefault()
        }
        if (input.code === 'KeyI' && ((input.alt && input.meta) || (input.control && input.shift))) {
          event.preventDefault()
        }
      } else if (input.code === 'F12') {
        if (webContents.isDevToolsOpened()) {
          webContents.closeDevTools()
        } else {
          webContents.openDevTools({ mode: 'undocked' })
        }
      }

      if (escToCloseWindow && input.code === 'Escape' && input.key !== 'Process') {
        window.close()
        event.preventDefault()
      }

      if (!zoom) {
        if (input.code === 'Minus' && (input.control || input.meta)) {
          event.preventDefault()
        }
        if (input.code === 'Equal' && input.shift && (input.control || input.meta)) {
          event.preventDefault()
        }
      }
    })
  }
}
