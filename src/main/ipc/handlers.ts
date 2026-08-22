import { existsSync, statSync } from 'node:fs'
import { app, dialog, ipcMain, nativeTheme } from 'electron'
import { IPC } from '@shared/ipc-contract'
import type {
  PaneSpawnRequest,
  PaneSpawnResult,
  ResolvedTheme,
  ThemeMode,
} from '@shared/ipc-contract'
import type { OpenWorkspaceResult, TrustDecision } from '@shared/ipc-contract'
import type { Preferences } from '@shared/schema/preferences'
import { decideTrust, openWorkspace, revokeTrust } from '../services/open-workspace'
import {
  forgetProject,
  getPreferences,
  getPreferencesForRenderer,
  updatePreferences,
} from '../services/preferences'
import { OutputBatcher } from '../services/output-batcher'
import { PaneStatusTracker } from '../services/pane-status-machine'
import { PtyManager } from '../services/pty-manager'
import { workspaceState } from '../services/workspace-state'
import { getMainWindow } from '../window'

let ptyManager: PtyManager | null = null
let batcher: OutputBatcher | null = null
let statusTracker: PaneStatusTracker | null = null
let idleTimer: NodeJS.Timeout | null = null
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
  // a development hot-restart cannot take the app down.
  if (registered) return
  registered = true

  batcher = new OutputBatcher({
    emit: (paneId, chunk) => push(IPC.paneData, { paneId, chunk }),
  })

  statusTracker = new PaneStatusTracker((paneId, status, exitCode) => {
    push(IPC.paneStatus, { paneId, status, exitCode })
  })

  ptyManager = new PtyManager({
    onData: (paneId, chunk) => {
      // Status is read from the raw stream here, before batching, so the BEL is
      // seen even for a pane the user is not looking at.
      statusTracker?.output(paneId, chunk, Date.now())
      batcher?.push(paneId, chunk)
    },
    onExit: (paneId, exitCode) => {
      // Flush first: the last output of a dying process must not be dropped.
      batcher?.flush()
      batcher?.remove(paneId)
      statusTracker?.exit(paneId, exitCode, Date.now())
      push(IPC.paneExit, { paneId, exitCode })
    },
  })

  // Single low-frequency tick for the weak "silence means idle" signal. 400 ms
  // is plenty: the badge is read by a human, not sampled.
  idleTimer = setInterval(() => statusTracker?.tick(Date.now()), 400)

  // ---- panes -------------------------------------------------------------

  ipcMain.handle(IPC.paneSpawn, (_event, request: PaneSpawnRequest): PaneSpawnResult => {
    const pane = workspaceState.resolve(request.paneId)
    // A cwd that vanished must not take the workspace down.
    const cwd = existsSync(pane.cwd) ? pane.cwd : app.getPath('home')

    const { pid } = getPtyManager().spawn({
      paneId: request.paneId,
      shell: pane.shell,
      cwd,
      cols: request.cols,
      rows: request.rows,
    })

    statusTracker?.start(request.paneId, Date.now())

    if (pane.command) {
      // Written as if the user typed it, rather than exec'ing a composed
      // string: the shell stays interactive afterwards and the command lands in
      // history (ARCHI § Sécurité, point 2).
      getPtyManager().write(request.paneId, `${pane.command}\r`)
    }

    return { pid, shell: pane.shell, cwd }
  })

  ipcMain.handle(IPC.paneWrite, (_event, paneId: string, data: string) => {
    // Typing into a pane is the acknowledgement that clears `attention`.
    statusTracker?.input(paneId, Date.now())
    getPtyManager().write(paneId, data)
  })

  ipcMain.handle(IPC.paneResize, (_event, paneId: string, cols: number, rows: number) => {
    getPtyManager().resize(paneId, cols, rows)
  })

  ipcMain.handle(IPC.paneKill, (_event, paneId: string) => {
    getPtyManager().kill(paneId)
    batcher?.remove(paneId)
    statusTracker?.remove(paneId)
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

  ipcMain.handle(
    IPC.workspaceOpen,
    async (_event, projectPath: string): Promise<OpenWorkspaceResult> => {
      // Switching projects must not leave the previous one's shells running.
      getPtyManager().killAll()
      workspaceState.clear()
      return openWorkspace(projectPath)
    },
  )

  ipcMain.handle(
    IPC.workspaceTrustDecide,
    (_event, decision: TrustDecision): OpenWorkspaceResult | null => decideTrust(decision),
  )

  ipcMain.handle(IPC.workspaceRevokeTrust, (_event, projectPath: string) => {
    revokeTrust(projectPath)
    return getPreferencesForRenderer()
  })

  ipcMain.handle(IPC.workspaceForget, (_event, projectPath: string): Preferences => {
    forgetProject(projectPath)
    return getPreferencesForRenderer()
  })

  ipcMain.handle(IPC.workspaceSave, (_event, _layout: unknown) => undefined)
  ipcMain.handle(IPC.workspaceClose, () => {
    getPtyManager().killAll()
    workspaceState.clear()
  })

  // ---- preferences ---------------------------------------------------------

  ipcMain.handle(IPC.prefsGet, (): Preferences => getPreferencesForRenderer())
  ipcMain.handle(IPC.prefsSet, (_event, patch: Partial<Preferences>): Preferences =>
    updatePreferences(patch),
  )

  // ---- theme ---------------------------------------------------------------

  ipcMain.handle(
    IPC.themeResolve,
    (): ResolvedTheme => (nativeTheme.shouldUseDarkColors ? 'dark' : 'light'),
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
  if (idleTimer) clearInterval(idleTimer)
  idleTimer = null
  batcher?.dispose()
  ptyManager?.killAll()
}
