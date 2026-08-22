import type { Terminal } from '@xterm/xterm'
import type { FitAddon } from '@xterm/addon-fit'

export interface TerminalHandle {
  terminal: Terminal
  fit: FitAddon
  /** Set once a WebGL context is lost and the pane falls back to DOM rendering. */
  renderer: 'webgl' | 'dom'
  dispose: () => void
}

/**
 * ADR-006 — xterm instances live here, at module level, never in React state.
 *
 * A Terminal owns a scrollback buffer and a WebGL context. Putting one in
 * useState or in the Zustand store would recreate it on re-render, losing the
 * scrollback and leaking the GL context. React renders only the container div;
 * this map owns the lifetime.
 */
const terminals = new Map<string, TerminalHandle>()

export function registerTerminal(paneId: string, handle: TerminalHandle): void {
  // Defensive: a double mount (React StrictMode in dev) must not orphan the
  // first instance and its GL context.
  disposeTerminal(paneId)
  terminals.set(paneId, handle)
}

export function getTerminal(paneId: string): TerminalHandle | undefined {
  return terminals.get(paneId)
}

export function disposeTerminal(paneId: string): void {
  const handle = terminals.get(paneId)
  if (!handle) return
  terminals.delete(paneId)
  handle.dispose()
}

export function allTerminals(): TerminalHandle[] {
  return [...terminals.values()]
}

export function terminalCount(): number {
  return terminals.size
}

/**
 * Repaint every terminal.
 *
 * Reordering panes moves live <section> nodes, and React reconciles that as a
 * remove + insert: the WebGL canvas is detached and re-attached, and since it
 * is created with `preserveDrawingBuffer: false` its contents are gone. Nothing
 * else would repaint it until the next byte of output or the next resize, and a
 * pane sitting idle at a prompt produces neither.
 */
export function refreshTerminals(): void {
  for (const handle of terminals.values()) {
    handle.terminal.refresh(0, handle.terminal.rows - 1)
  }
}

/**
 * Debug hook. With the WebGL renderer the terminal contents are painted to a
 * canvas and are absent from the DOM, so there is no other way to assert on
 * what a pane actually shows — from devtools or from an automated check.
 *
 * This exposes renderer-internal state to renderer code, which already has it:
 * it crosses no process or sandbox boundary.
 */
declare global {
  interface Window {
    __mytermTerminals: Map<string, TerminalHandle>
    __mytermRead: (paneId: string) => string
  }
}

window.__mytermTerminals = terminals
window.__mytermRead = (paneId: string): string => {
  const handle = terminals.get(paneId)
  if (!handle) return ''
  const buffer = handle.terminal.buffer.active
  const lines: string[] = []
  for (let i = 0; i < buffer.length; i++) {
    lines.push(buffer.getLine(i)?.translateToString(true) ?? '')
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}
