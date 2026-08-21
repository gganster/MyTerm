import { app, BrowserWindow } from 'electron'
import { disposeIpc, registerIpcHandlers } from './ipc/handlers'
import { createWindow } from './window'

void app.whenReady().then(() => {
  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Fires before renderers are torn down, so every pty is killed while we still
// have handles to them.
app.on('before-quit', disposeIpc)

app.on('window-all-closed', () => {
  app.quit()
})
