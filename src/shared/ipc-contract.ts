import type { PaneStatus } from './pane-status'
import type { QuotaWindow } from './quota'
import type { SystemLoad } from './system-load'

/**
 * The single declaration of the process boundary. Both sides import from here,
 * so renaming a channel or changing a payload breaks compilation in the main
 * process *and* the renderer instead of failing silently at runtime.
 *
 * Channel names are constants, never string literals scattered through the code.
 */
export const IPC = {
  // renderer -> main (invoke, request/response)
  workspaceOpen: 'workspace:open',
  workspaceSave: 'workspace:save',
  workspacePick: 'workspace:pick',
  workspaceClose: 'workspace:close',
  workspaceTrustDecide: 'workspace:trust-decide',
  workspaceForget: 'workspace:forget',
  workspaceRevokeTrust: 'workspace:revoke-trust',
  workspaceReload: 'workspace:reload',
  workspacePickPaneCwd: 'workspace:pick-pane-cwd',
  paneSpawn: 'pane:spawn',
  paneWrite: 'pane:write',
  paneResize: 'pane:resize',
  paneKill: 'pane:kill',
  prefsGet: 'prefs:get',
  prefsSet: 'prefs:set',
  themeResolve: 'theme:resolve',
  themeSet: 'theme:set',
  statusUsageGet: 'status:usage-get',
  statusLoadGet: 'status:load-get',

  // main -> renderer (send, pushed streams)
  paneData: 'pane:data',
  paneStatus: 'pane:status',
  paneExit: 'pane:exit',
  workspaceChangedOnDisk: 'workspace:changed-on-disk',
  workspaceTrustRequest: 'workspace:trust-request',
  themeSystemChanged: 'theme:system-changed',
  /** CLI or second instance asked for a project to be opened. */
  appOpenProject: 'app:open-project',
  appUpdateReady: 'app:update-ready',
  appInstallUpdate: 'app:install-update',
  statusUsage: 'status:usage',
  statusLoad: 'status:load',
} as const

export type ThemeMode = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

/**
 * Spawn request. Deliberately carries no `cwd`, `shell` or `command`.
 *
 * The renderer is sandboxed but it is still the least trusted process in the
 * app; letting it name a command to execute would hand a compromised renderer
 * arbitrary code execution and make the trust prompt (ADR-004) pointless. It
 * names a pane, and the main process resolves what that pane runs from the
 * layout it loaded and the user approved.
 */
export interface PaneSpawnRequest {
  paneId: string
  cols: number
  rows: number
}

export interface PaneSpawnResult {
  pid: number
  /** Echoed back so the renderer can label a pane before the layout arrives. */
  shell: string
  cwd: string
}

export interface PaneDataEvent {
  paneId: string
  chunk: string
}

export interface PaneStatusEvent {
  paneId: string
  status: PaneStatus
  exitCode?: number
}

export interface PaneExitEvent {
  paneId: string
  exitCode: number
}

/** One autolaunch command, shown verbatim in the trust dialog (ADR-004). */
export interface TrustSubject {
  paneId: string
  title: string
  cwd: string
  shell: string
  command: string
}

/**
 * Result of opening a project. `needs-trust` is not an error: the layout was
 * read and is valid, but nothing has been spawned and nothing will be until the
 * user answers.
 */
export type OpenWorkspaceResult =
  | {
      status: 'ok'
      projectPath: string
      projectName: string
      layout: unknown
      warnings: { paneId: string; message: string }[]
      /** No .myterm.json was found; this layout is in memory only. */
      generated: boolean
    }
  | {
      status: 'needs-trust'
      projectPath: string
      projectName: string
      layout: unknown
      commands: TrustSubject[]
    }
  | { status: 'error'; projectPath: string; message: string }

export type TrustDecision = 'approve' | 'open-without-executing' | 'cancel'

/**
 * Claude quota as pushed to the status bar.
 *
 * Note what is *not* here: no token, no account identifier, no file path. The
 * OAuth credential is read in the main process and never leaves it; a failure
 * is reduced to the coarse `error` code below, because this payload reaches the
 * renderer and, through it, anything the renderer logs.
 */
export interface UsageSnapshot {
  ok: boolean
  /**
   * The reading is real but the last poll failed, so it is older than
   * `fetchedAt` suggests it should be. `ok` stays true: showing a slightly old
   * quota beats blanking the bar on one dropped request.
   */
  stale: boolean
  /** When the values it carries were actually measured. */
  fetchedAt: number
  fiveHour: QuotaWindow
  sevenDay: QuotaWindow
  /**
   * Coarse reason for the last failure — `no-credentials`, `token-expired`,
   * `http-401`, `http-429`, `network`, `parse`… Never a message built from file
   * content. Present alongside `ok: true` when the snapshot is stale.
   */
  error?: string
}

/** Payload of `status:load`. Declared in `./system-load` next to the arithmetic that produces it. */
export type { SystemLoad }

export type SaveLayoutResult =
  | { ok: true; warnings: { paneId: string; message: string }[] }
  | { ok: false; problems: string[] }
