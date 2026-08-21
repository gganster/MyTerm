import type { PaneStatus } from './pane-status'

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
  paneSpawn: 'pane:spawn',
  paneWrite: 'pane:write',
  paneResize: 'pane:resize',
  paneKill: 'pane:kill',
  prefsGet: 'prefs:get',
  prefsSet: 'prefs:set',
  themeResolve: 'theme:resolve',
  themeSet: 'theme:set',

  // main -> renderer (send, pushed streams)
  paneData: 'pane:data',
  paneStatus: 'pane:status',
  paneExit: 'pane:exit',
  workspaceChangedOnDisk: 'workspace:changed-on-disk',
  workspaceTrustRequest: 'workspace:trust-request',
  themeSystemChanged: 'theme:system-changed',
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
