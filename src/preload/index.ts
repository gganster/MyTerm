/**
 * The entire process boundary as seen by the renderer.
 *
 * Runs sandboxed: only `contextBridge` and `ipcRenderer` are available, and no
 * Node module may be imported. Nothing but plain serialisable data crosses the
 * bridge — no functions, no handles, no pty objects (ARCHI § Sécurité).
 *
 * Every `on*` returns its own unsubscribe function. PaneView mounts and
 * unmounts constantly; without this, listeners would pile up on every remount
 * and write into disposed terminals.
 */
import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { IPC } from '@shared/ipc-contract'
import type {
  ExternalEditorId,
  ExternalEditorInfo,
  OpenInEditorResult,
  PaneDataEvent,
  PaneExitEvent,
  PaneSpawnRequest,
  PaneSpawnResult,
  PaneStatusEvent,
  OpenWorkspaceResult,
  ResolvedTheme,
  SaveLayoutResult,
  ThemeMode,
  TrustDecision,
  UsageByProvider,
} from '@shared/ipc-contract'
import type { SystemLoad } from '@shared/system-load'

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T): void => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api = {
  workspace: {
    open: (projectPath: string): Promise<OpenWorkspaceResult> =>
      ipcRenderer.invoke(IPC.workspaceOpen, projectPath),
    save: (layout: unknown): Promise<SaveLayoutResult> =>
      ipcRenderer.invoke(IPC.workspaceSave, layout),
    reload: (): Promise<OpenWorkspaceResult> => ipcRenderer.invoke(IPC.workspaceReload),
    pickPaneCwd: (): Promise<string | null> => ipcRenderer.invoke(IPC.workspacePickPaneCwd),
    pick: (): Promise<string | null> => ipcRenderer.invoke(IPC.workspacePick),
    close: (): Promise<void> => ipcRenderer.invoke(IPC.workspaceClose),
    trustDecide: (decision: TrustDecision): Promise<OpenWorkspaceResult | null> =>
      ipcRenderer.invoke(IPC.workspaceTrustDecide, decision),
    revokeTrust: (projectPath: string): Promise<unknown> =>
      ipcRenderer.invoke(IPC.workspaceRevokeTrust, projectPath),
    forget: (projectPath: string): Promise<unknown> =>
      ipcRenderer.invoke(IPC.workspaceForget, projectPath),
    onChangedOnDisk: (listener: () => void): (() => void) =>
      subscribe<void>(IPC.workspaceChangedOnDisk, listener),
  },

  pane: {
    spawn: (request: PaneSpawnRequest): Promise<PaneSpawnResult> =>
      ipcRenderer.invoke(IPC.paneSpawn, request),
    write: (paneId: string, data: string): Promise<void> =>
      ipcRenderer.invoke(IPC.paneWrite, paneId, data),
    resize: (paneId: string, cols: number, rows: number): Promise<void> =>
      ipcRenderer.invoke(IPC.paneResize, paneId, cols, rows),
    kill: (paneId: string): Promise<void> => ipcRenderer.invoke(IPC.paneKill, paneId),
    onData: (listener: (event: PaneDataEvent) => void): (() => void) =>
      subscribe<PaneDataEvent>(IPC.paneData, listener),
    onStatus: (listener: (event: PaneStatusEvent) => void): (() => void) =>
      subscribe<PaneStatusEvent>(IPC.paneStatus, listener),
    onExit: (listener: (event: PaneExitEvent) => void): (() => void) =>
      subscribe<PaneExitEvent>(IPC.paneExit, listener),
  },

  prefs: {
    get: (): Promise<unknown> => ipcRenderer.invoke(IPC.prefsGet),
    set: (patch: unknown): Promise<unknown> => ipcRenderer.invoke(IPC.prefsSet, patch),
  },

  app: {
    onOpenProjectRequest: (listener: (projectPath: string) => void): (() => void) =>
      subscribe<string>(IPC.appOpenProject, listener),
    onUpdateReady: (listener: (info: { version: string }) => void): (() => void) =>
      subscribe<{ version: string }>(IPC.appUpdateReady, listener),
    installUpdate: (force: boolean): Promise<boolean> =>
      ipcRenderer.invoke(IPC.appInstallUpdate, force),
  },

  /** Status bar. Read-only: nothing here lets the renderer ask for an action. */
  status: {
    getUsage: (): Promise<UsageByProvider> => ipcRenderer.invoke(IPC.statusUsageGet),
    onUsage: (listener: (usage: UsageByProvider) => void): (() => void) =>
      subscribe<UsageByProvider>(IPC.statusUsage, listener),
    getLoad: (): Promise<SystemLoad> => ipcRenderer.invoke(IPC.statusLoadGet),
    onLoad: (listener: (load: SystemLoad) => void): (() => void) =>
      subscribe<SystemLoad>(IPC.statusLoad, listener),
  },

  /** External IDEs. The renderer names an id; the main process owns the rest. */
  editor: {
    list: (): Promise<ExternalEditorInfo[]> => ipcRenderer.invoke(IPC.editorList),
    open: (id: ExternalEditorId): Promise<OpenInEditorResult> =>
      ipcRenderer.invoke(IPC.editorOpen, id),
  },

  theme: {
    resolve: (): Promise<ResolvedTheme> => ipcRenderer.invoke(IPC.themeResolve),
    set: (mode: ThemeMode): Promise<ResolvedTheme> => ipcRenderer.invoke(IPC.themeSet, mode),
    onSystemChanged: (listener: (resolved: ResolvedTheme) => void): (() => void) =>
      subscribe<ResolvedTheme>(IPC.themeSystemChanged, listener),
  },
} as const

export type MyTermApi = typeof api

contextBridge.exposeInMainWorld('myterm', api)
