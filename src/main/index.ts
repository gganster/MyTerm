import { app, BrowserWindow } from 'electron'
import { IPC } from '@shared/ipc-contract'
import { parseCliArgs } from './cli-args'
import { disposeIpc, getPtyManager, registerIpcHandlers } from './ipc/handlers'
import { flushPreferences, loadPreferences } from './services/preferences'
import { createWindow, focusMainWindow, getMainWindow } from './window'

/**
 * Single instance, claimed before anything else runs.
 *
 * A second `myterm .` must not start a second Electron — two processes writing
 * preferences.json would race, and the user asked to see a project, not a new
 * window. Claiming the lock first means a losing instance exits before it has
 * touched any state.
 */
if (!app.requestSingleInstanceLock()) {
  // exit(), not quit(): before `ready` there are no windows to close and
  // app.quit() does not reliably terminate the process. The losing instance
  // must be gone immediately — it has already handed its argv to the winner.
  app.exit(0)
} else {
  /** Requests that arrive before the renderer is ready wait here. */
  let queuedProjectPath: string | null = null

  function requestOpenProject(projectPath: string): void {
    const window = getMainWindow()
    if (!window || window.webContents.isDestroyed()) {
      queuedProjectPath = projectPath
      return
    }
    window.webContents.send(IPC.appOpenProject, projectPath)
  }

  app.on('second-instance', (_event, argv, workingDirectory) => {
    // The path is resolved against the *caller's* cwd, not ours.
    const request = parseCliArgs(argv, workingDirectory, app.isPackaged)
    focusMainWindow()
    if (request.error) {
      console.warn(`[myterm] ${request.error}`)
      return
    }
    if (request.projectPath) requestOpenProject(request.projectPath)
  })

  void app.whenReady().then(async () => {
    // Before the window: saved geometry and theme are needed at creation time.
    await loadPreferences()
    registerIpcHandlers()

    const startup = parseCliArgs(process.argv, process.cwd(), app.isPackaged)
    if (startup.error) console.warn(`[myterm] ${startup.error}`)

    const window = createWindow()
    window.webContents.once('did-finish-load', () => {
      const pending = startup.projectPath ?? queuedProjectPath
      queuedProjectPath = null
      if (pending) requestOpenProject(pending)
    })

    // A renderer reload (Ctrl+R, a dev full reload, a crash) throws away every
    // PaneView without running its cleanup, and the fresh renderer starts on
    // the project picker. Without this the previous shells stay alive with
    // nothing able to reach or close them — an invisible leak until quit.
    let loadCount = 0
    window.webContents.on('did-finish-load', () => {
      loadCount += 1
      if (loadCount > 1) getPtyManager().killAll()
    })
    window.webContents.on('render-process-gone', () => getPtyManager().killAll())

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
}
