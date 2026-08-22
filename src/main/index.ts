import { app, BrowserWindow } from 'electron'
import { disposeIpc, registerIpcHandlers } from './ipc/handlers'
import { flushPreferences, loadPreferences } from './services/preferences'
import { createWindow } from './window'

void app.whenReady().then(async () => {
  // Before the window: the saved geometry and theme are needed at creation time.
  await loadPreferences()
  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Fires before renderers are torn down, so every pty is killed while we still
// have handles to them.
app.on('before-quit', () => {
  disposeIpc()
  void flushPreferences()
})

app.on('window-all-closed', () => {
  app.quit()
})
