import { existsSync, statSync } from 'node:fs'
import { relative, sep } from 'node:path'
import { app, dialog, ipcMain, nativeTheme } from 'electron'
import { IPC } from '@shared/ipc-contract'
import type {
  PaneSpawnRequest,
  PaneSpawnResult,
  ResolvedTheme,
  ThemeMode,
} from '@shared/ipc-contract'
import type {
  ExternalEditorId,
  ExternalEditorInfo,
  OpenInEditorResult,
  OpenWorkspaceResult,
  SaveLayoutResult,
  TrustDecision,
  UsageByProvider,
} from '@shared/ipc-contract'
import type { SystemLoad } from '@shared/system-load'
import { DisplayPreferencesSchema } from '@shared/schema/preferences'
import type { Preferences } from '@shared/schema/preferences'
import {
  closeWorkspace,
  decideTrust,
  openWorkspace,
  reloadWorkspace,
  revokeTrust,
  saveWorkspace,
  setDiskChangeListener,
} from '../services/open-workspace'
import {
  forgetProject,
  getPreferences,
  getPreferencesForRenderer,
  updatePreferences,
} from '../services/preferences'
import { OutputBatcher } from '../services/output-batcher'
import { PaneStatusTracker } from '../services/pane-status-machine'
import { PtyManager } from '../services/pty-manager'
import { disposeLoadMonitor, getSystemLoad, initLoadMonitor } from '../services/load-monitor'
import { disposeUpdater, initUpdater, installUpdate } from '../services/updater'
import { disposeUsagePolling, getUsage, initUsagePolling } from '../services/usage'
import { listEditors, openInEditor } from '../services/external-editor'
import { workspaceState } from '../services/workspace-state'
import { isInsideRoot } from '../util/resolve-cwd'
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
    // A pane we closed ourselves — a PaneView unmounting, a workspace being
    // replaced, the app quitting. Nothing is pushed to the renderer, but the
    // buffered output and the status state have to go, or the idle tick keeps
    // reporting on a pane that no longer exists.
    onClosed: (paneId) => {
      batcher?.remove(paneId)
      statusTracker?.remove(paneId)
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

  // The batcher and the status tracker are cleaned up by `onClosed`, which
  // every kill goes through — including the ones that do not come from here.
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

  ipcMain.handle(
    IPC.workspaceSave,
    (_event, layout: unknown): Promise<SaveLayoutResult> => saveWorkspace(layout),
  )

  ipcMain.handle(IPC.workspaceReload, (): Promise<OpenWorkspaceResult> => reloadWorkspace())

  // Folder picker for a pane cwd. Returns a path *relative* to the project
  // root: an absolute one would not survive the file being cloned elsewhere.
  ipcMain.handle(IPC.workspacePickPaneCwd, async (): Promise<string | null> => {
    const projectRoot = workspaceState.projectRoot
    if (!projectRoot) return null
    const window = getMainWindow()
    const options: Electron.OpenDialogOptions = {
      properties: ['openDirectory'],
      defaultPath: projectRoot,
    }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    const picked = result.filePaths[0]
    if (result.canceled || !picked) return null
    if (!isInsideRoot(projectRoot, picked)) return null
    const relativePath = relative(projectRoot, picked)
    return relativePath === '' ? '.' : relativePath.split(sep).join('/')
  })

  ipcMain.handle(IPC.workspaceClose, () => {
    getPtyManager().killAll()
    closeWorkspace()
  })

  // The watcher lives in the main process; the renderer is only told that
  // something changed and decides what to do about it.
  setDiskChangeListener(() => push(IPC.workspaceChangedOnDisk, undefined))

  // ---- updates -------------------------------------------------------------

  const hasLivePanes = (): boolean => (ptyManager?.activeCount ?? 0) > 0

  initUpdater({
    onUpdateReady: (info) => push(IPC.appUpdateReady, info),
    hasLivePanes,
  })

  ipcMain.handle(IPC.appInstallUpdate, (_event, force: boolean): Promise<boolean> =>
    installUpdate({ force, hasLivePanes }),
  )

  // ---- status bar ----------------------------------------------------------

  // Both are push streams with a pull companion: the renderer mounts long after
  // the main process starts, and a push emitted before its listener attached
  // would leave the bar stuck on "—" until the next tick.
  initUsagePolling((usage) => push(IPC.statusUsage, usage))
  initLoadMonitor((load) => push(IPC.statusLoad, load))

  ipcMain.handle(IPC.statusUsageGet, (): UsageByProvider => getUsage())
  ipcMain.handle(IPC.statusLoadGet, (): SystemLoad => getSystemLoad())

  // ---- external editors ----------------------------------------------------

  ipcMain.handle(IPC.editorList, (): ExternalEditorInfo[] => listEditors())

  // The renderer passes an editor id and nothing else: the folder handed to the
  // IDE is the project root the main process itself opened.
  ipcMain.handle(
    IPC.editorOpen,
    (_event, id: ExternalEditorId): Promise<OpenInEditorResult> =>
      openInEditor(id, workspaceState.projectRoot),
  )

  // ---- preferences ---------------------------------------------------------

  ipcMain.handle(IPC.prefsGet, (): Preferences => getPreferencesForRenderer())

  // Narrowed to the two display preferences, and validated on the way in.
  //
  // Forwarding the patch whole let a renderer write `trustedProjects` and
  // approve any project it liked — the one thing deciding trust in main exists
  // to prevent (ADR-004). Approvals and recent projects have their own handlers.
  //
  // Validated because this is where untrusted input enters: an unchecked theme
  // or window object would be written out verbatim, and the next start would
  // fail to parse the file and fall back to defaults — a renderer able to erase
  // someone's preferences. The schema is the same one that guards the file.
  ipcMain.handle(IPC.prefsSet, (_event, patch: unknown): Preferences => {
    const result = DisplayPreferencesSchema.safeParse(patch)
    if (!result.success) return getPreferencesForRenderer()
    return updatePreferences(result.data)
  })

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
  disposeUpdater()
  disposeUsagePolling()
  disposeLoadMonitor()
  if (idleTimer) clearInterval(idleTimer)
  idleTimer = null
  batcher?.dispose()
  ptyManager?.killAll()
}
