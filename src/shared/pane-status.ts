/**
 * Lifecycle of a single pane, as observed from the main process.
 *
 * Ordered by how much the user needs to look at the pane. Only `attention` is
 * rendered saliently: if every state shouted, the grid would be a Christmas
 * tree and the badge would carry no information (PRD feature 4).
 */
export const PANE_STATUS = {
  /** Producing output right now. */
  running: 'running',
  /** Waiting for the user — the strong signal, see PaneStatusMachine. */
  attention: 'attention',
  /** Alive but quiet, most likely sitting at a prompt. */
  idle: 'idle',
  /** Process is gone. */
  exited: 'exited',
} as const

export type PaneStatus = (typeof PANE_STATUS)[keyof typeof PANE_STATUS]

export interface PaneRuntime {
  status: PaneStatus
  pid?: number
  exitCode?: number
  /**
   * Last line the pane was asked to run — the layout's autolaunch command to
   * begin with, then whatever the user submits.
   *
   * Renderer-side only: nothing in the main process produces it, and it exists
   * so a pane folded into the bottom bar can still say what it is doing
   * without being unfolded.
   */
  lastCommand?: string
}
