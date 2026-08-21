import { PANE_STATUS } from '@shared/pane-status'
import type { PaneStatus } from '@shared/pane-status'

/**
 * Decides what a pane's activity badge should say (PRD feature 4).
 *
 * The PRD left "how do we know a pane is waiting for input" open. A purely
 * temporal rule — "no output for N ms, therefore waiting" — fires every time an
 * agent pauses to think, which is exactly when it is *not* waiting. So the
 * signals are ranked and the weakest one only ever produces `idle`:
 *
 *   BEL (\x07)          -> attention   strong. Claude Code rings the terminal
 *                                      bell when it wants an answer, provided
 *                                      preferredNotifChannel is terminal_bell.
 *   OSC 133 ; B | ; D   -> idle        strong, when the shell emits it at all.
 *   silence > 800 ms    -> idle        weak, last resort.
 *   pty exit            -> exited      certain.
 *
 * `attention` is sticky: it survives further output and is only cleared when
 * the user actually types into that pane. A badge that cleared itself while the
 * prompt was still waiting would be worse than no badge.
 *
 * Pure by design (no Electron, no timers of its own) so task 17 can test it.
 */

export const BEL = '\x07'
const OSC_133 = '\x1b]133;'
/** Longest prefix of an OSC 133 marker that can straddle a chunk boundary. */
const CARRY = OSC_133.length + 2

export interface PaneStatusState {
  status: PaneStatus
  lastOutputAt: number
  exitCode?: number
  /** Tail of the previous chunk, so a split escape sequence is still matched. */
  carry: string
}

export type PaneStatusEvent =
  | { type: 'output'; chunk: string; at: number }
  | { type: 'input'; at: number }
  | { type: 'exit'; code: number; at: number }
  | { type: 'tick'; at: number }

export interface PaneStatusConfig {
  idleAfterMs?: number
}

export function initialPaneStatus(at: number): PaneStatusState {
  return { status: PANE_STATUS.idle, lastOutputAt: at, carry: '' }
}

export function reducePaneStatus(
  state: PaneStatusState,
  event: PaneStatusEvent,
  config: PaneStatusConfig = {},
): PaneStatusState {
  const idleAfterMs = config.idleAfterMs ?? 800

  switch (event.type) {
    case 'exit':
      return { ...state, status: PANE_STATUS.exited, exitCode: event.code, carry: '' }

    case 'input':
      // The user answered, so whatever was being asked is answered.
      if (state.status === PANE_STATUS.exited) return state
      return { ...state, status: PANE_STATUS.running, lastOutputAt: event.at }

    case 'output': {
      if (state.status === PANE_STATUS.exited) return state

      const scanned = state.carry + event.chunk
      const carry = event.chunk.slice(-CARRY)

      if (scanned.includes(BEL)) {
        return { ...state, status: PANE_STATUS.attention, lastOutputAt: event.at, carry }
      }

      // OSC 133;B marks the end of a prompt, ;D the end of a command: both mean
      // the shell handed control back. Only used when shell integration emits it.
      if (scanned.includes(`${OSC_133}B`) || scanned.includes(`${OSC_133}D`)) {
        return { ...state, status: PANE_STATUS.idle, lastOutputAt: event.at, carry }
      }

      // Output alone never clears attention: the prompt may still be waiting
      // while the agent redraws its spinner.
      if (state.status === PANE_STATUS.attention) {
        return { ...state, lastOutputAt: event.at, carry }
      }

      return { ...state, status: PANE_STATUS.running, lastOutputAt: event.at, carry }
    }

    case 'tick': {
      if (state.status !== PANE_STATUS.running) return state
      if (event.at - state.lastOutputAt < idleAfterMs) return state
      return { ...state, status: PANE_STATUS.idle }
    }

    default:
      return state
  }
}

/**
 * Tracks every pane and reports only genuine transitions — emitting the current
 * status on every chunk would push sixty identical messages a second.
 */
export class PaneStatusTracker {
  private readonly states = new Map<string, PaneStatusState>()

  constructor(
    private readonly onChange: (paneId: string, status: PaneStatus, exitCode?: number) => void,
    private readonly config: PaneStatusConfig = {},
  ) {}

  private apply(paneId: string, event: PaneStatusEvent): void {
    const previous = this.states.get(paneId) ?? initialPaneStatus(event.at)
    const next = reducePaneStatus(previous, event, this.config)
    this.states.set(paneId, next)
    if (next.status !== previous.status) this.onChange(paneId, next.status, next.exitCode)
  }

  start(paneId: string, at: number): void {
    this.states.set(paneId, { ...initialPaneStatus(at), status: PANE_STATUS.running })
    this.onChange(paneId, PANE_STATUS.running)
  }

  output(paneId: string, chunk: string, at: number): void {
    this.apply(paneId, { type: 'output', chunk, at })
  }

  input(paneId: string, at: number): void {
    if (!this.states.has(paneId)) return
    this.apply(paneId, { type: 'input', at })
  }

  exit(paneId: string, code: number, at: number): void {
    this.apply(paneId, { type: 'exit', code, at })
  }

  tick(at: number): void {
    for (const paneId of this.states.keys()) this.apply(paneId, { type: 'tick', at })
  }

  remove(paneId: string): void {
    this.states.delete(paneId)
  }

  statusOf(paneId: string): PaneStatus | undefined {
    return this.states.get(paneId)?.status
  }
}
