import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'
import { IPC } from '@shared/ipc-contract'
import { parseCliArgs } from './cli-args'
import { disposeIpc, getPtyManager, registerIpcHandlers } from './ipc/handlers'
import {
  HEARTBEAT_MS,
  disposeInstanceRegistry,
  getInstanceRegistry,
  initInstanceRegistry,
} from './services/instances'
import { flushPreferences, loadPreferences } from './services/preferences'
import { createWindow } from './window'

/**
 * Several instances, on purpose.
 *
 * MyTerm used to claim `app.requestSingleInstanceLock()` and hand a second
 * `myterm .` to the running window. That made the CLI unable to do the one
 * thing a project-scoped terminal is for: having two projects open side by
 * side. The lock is gone, and each invocation is now its own process with its
 * own window and its own shells.
 *
 * What the lock was also silently buying is *not* free, and is paid for
 * elsewhere rather than assumed away:
 *
 * - `preferences.json` is shared. Writing a cached copy of it would erase what
 *   the other instances changed, so a save now re-reads the file, replays this
 *   process's own changes onto it and writes that, under a lock
 *   (@shared/schema/preferences-merge, util/atomic-write).
 * - `atomicWrite` no longer uses a fixed temp name, which two processes saving
 *   the same file would have written into at once.
 * - Update checks and update installs belong to one instance, and an install
 *   closes *every* window. Both are handled through the instance registry
 *   (services/instances, services/updater).
 */

let heartbeatTimer: NodeJS.Timeout | null = null

void app.whenReady().then(async () => {
  // Registered before anything reads it: `createWindow` cascades on the number
  // of live instances, and the updater asks whether this one is the elected.
  initInstanceRegistry(join(app.getPath('userData'), 'instances'))
  heartbeatTimer = setInterval(() => getInstanceRegistry()?.heartbeat(), HEARTBEAT_MS)
  // A timer must not be the reason an otherwise idle app stays awake.
  heartbeatTimer.unref?.()

  // Before the window: saved geometry and theme are needed at creation time.
  await loadPreferences()
  registerIpcHandlers()

  const startup = parseCliArgs(process.argv, process.cwd(), app.isPackaged)
  if (startup.error) console.warn(`[myterm] ${startup.error}`)

  const window = createWindow()
  // Sent on first load rather than immediately: the renderer subscribes to this
  // channel when it mounts, and a message sent before that is simply lost.
  // There is no queue any more — the only sender left is this line, and the
  // `second-instance` path that needed one is gone with the lock.
  window.webContents.once('did-finish-load', () => {
    if (startup.projectPath) window.webContents.send(IPC.appOpenProject, startup.projectPath)
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
  if (heartbeatTimer) clearInterval(heartbeatTimer)
  heartbeatTimer = null
  // First: an instance that is on its way out must not keep counting as a
  // reason to refuse an update, nor hold the updater election it is leaving.
  disposeInstanceRegistry()
  disposeIpc()
  void flushPreferences()
})

app.on('window-all-closed', () => {
  app.quit()
})
