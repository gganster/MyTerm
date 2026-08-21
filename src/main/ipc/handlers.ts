import { existsSync, statSync } from 'node:fs'
import { app, dialog, ipcMain, nativeTheme } from 'electron'
import { IPC } from '@shared/ipc-contract'
import type {
  PaneSpawnRequest,
  PaneSpawnResult,
  ResolvedTheme,
  ThemeMode,
} from '@shared/ipc-contract'
import { PANE_STATUS } from '@shared/pane-status'
import { PtyManager } from '../services/pty-manager'
import { workspaceState } from '../services/workspace-state'
import { getMainWindow } from '../window'

let ptyManager: PtyManager | null = null
let registered = false

/** Every push to the renderer goes through here: a destroyed window would crash the main process. */
function push(channel: string, payload: unknown): void {
  const window = getMainWindow()
  if (!window || window.webContents.isDestroyed()) return
  window.webContents.send(channel, payload)
}

export function getPtyManager(): PtyManager {
  if (!ptyManager) throw new Error('PtyManager utilisé avant registerIpcHandlers()')
  return ptyManager
}

export function registerIpcHandlers(): void {
  // ipcMain.handle throws on a duplicate channel; guard so a second call during
  // development hot-restart cannot take the app down.
  if (registered) return
  registered = true

  ptyManager = new PtyManager({
    onData: (paneId, chunk) => push(IPC.paneData, { paneId, chunk }),
    onExit: (paneId, exitCode) => {
      push(IPC.paneExit, { paneId, exitCode })
      push(IPC.paneStatus, { paneId, status: PANE_STATUS.exited, exitCode })
    },
  })

  // ---- panes -------------------------------------------------------------

  ipcMain.handle(IPC.paneSpawn, (_event, request: PaneSpawnRequest): PaneSpawnResult => {
    const pane = workspaceState.resolve(request.paneId)
    // A cwd that no longer exists must not take the whole workspace down: fall
    // back to the project root and let the pane report it (task 11).
    const cwd = existsSync(pane.cwd) ? pane.cwd : app.getPath('home')

    const { pid } = getPtyManager().spawn({
      paneId: request.paneId,
      shell: pane.shell,
      cwd,
      cols: request.cols,
      rows: request.rows,
    })

    push(IPC.paneStatus, { paneId: request.paneId, status: PANE_STATUS.running })

    if (pane.command) {
      // Written as if the user typed it, rather than exec'ing a composed string:
      // the shell stays interactive after the command ends and the command shows
      // up in history (ARCHI § Sécurité, point 2).
      getPtyManager().write(request.paneId, `${pane.command}\r`)
    }

    return { pid, shell: pane.shell, cwd }
  })

  ipcMain.handle(IPC.paneWrite, (_event, paneId: string, data: string) => {
    getPtyManager().write(paneId, data)
  })

  ipcMain.handle(IPC.paneResize, (_event, paneId: string, cols: number, rows: number) => {
    getPtyManager().resize(paneId, cols, rows)
  })

  ipcMain.handle(IPC.paneKill, (_event, paneId: string) => {
    getPtyManager().kill(paneId)
  })

  // ---- workspace (filled in by tasks 10-16) --------------------------------

  ipcMain.handle(IPC.workspacePick, async (): Promise<string | null> => {
    const window = getMainWindow()
    const result = window
      ? await dialog.showOpenDialog(window, { properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] })
    const picked = result.filePaths[0]
    if (result.canceled || !picked) return null
    return statSync(picked).isDirectory() ? picked : null
  })

  ipcMain.handle(IPC.workspaceOpen, (_event, _projectPath: string) => null)
  ipcMain.handle(IPC.workspaceSave, (_event, _layout: unknown) => undefined)
  ipcMain.handle(IPC.workspaceClose, () => {
    getPtyManager().killAll()
    workspaceState.clear()
  })

  // ---- preferences (task 13) ----------------------------------------------

  ipcMain.handle(IPC.prefsGet, () => ({}))
  ipcMain.handle(IPC.prefsSet, (_event, patch: unknown) => patch)

  // ---- theme (task 05) -----------------------------------------------------

  ipcMain.handle(IPC.themeResolve, (): ResolvedTheme =>
    nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
  )

  ipcMain.handle(IPC.themeSet, (_event, mode: ThemeMode): ResolvedTheme => {
    nativeTheme.themeSource = mode
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  })

  nativeTheme.on('updated', () => {
    push(IPC.themeSystemChanged, nativeTheme.shouldUseDarkColors ? 'dark' : 'light')
  })
}

/** A leaked pty leaves an orphan shell behind after the window is gone. */
export function disposeIpc(): void {
  ptyManager?.killAll()
}
