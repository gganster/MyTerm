import { useEffect } from 'react'
import type { Pane } from '@shared/schema/layout'
import { useStore } from '../store'
import { getTerminal } from '../terminal/registry'

/**
 * Application shortcuts, and the rule that keeps them from stealing the shell's
 * keys.
 *
 * A terminal claims almost every keystroke, so app bindings all sit behind
 * Ctrl+Shift, which no shell uses. Ctrl+C, Ctrl+D, Ctrl+L, Ctrl+R and friends
 * are never intercepted — they belong to whatever is running in the pane.
 *
 *   Ctrl+Shift+Z        zoom / unzoom the focused pane
 *   Ctrl+Shift+arrows   move focus through the grid
 *   Ctrl+Shift+1..9     focus the nth pane
 *   Escape              unzoom, and only when something is zoomed
 */

const ARROWS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'])

export function isAppShortcut(event: Pick<KeyboardEvent, 'ctrlKey' | 'shiftKey' | 'key'>): boolean {
  if (event.ctrlKey && event.shiftKey) {
    if (event.key.toLowerCase() === 'z') return true
    if (ARROWS.has(event.key)) return true
    if (/^[1-9]$/.test(event.key)) return true
    return false
  }
  // Escape only belongs to the app while a pane is zoomed; otherwise it goes to
  // vim, to a git rebase editor, to whatever is running.
  if (event.key === 'Escape') return useStore.getState().zoomedPaneId !== null
  return false
}

// Debug hook, same rationale as __mytermRead: the key-filter predicate decides
// whether the shell or the app owns a keystroke, and that is worth being able
// to interrogate from devtools or an automated check.
declare global {
  interface Window {
    __mytermIsAppShortcut: typeof isAppShortcut
  }
}
window.__mytermIsAppShortcut = isAppShortcut

function focusPane(paneId: string): void {
  useStore.getState().setFocusedPane(paneId)
  getTerminal(paneId)?.terminal.focus()
}

/** Grid neighbour in a direction, or null at the edge — no wrap-around, which disorients. */
function neighbour(panes: Pane[], from: Pane, key: string): Pane | null {
  const [dCol, dRow] =
    key === 'ArrowLeft'
      ? [-1, 0]
      : key === 'ArrowRight'
        ? [1, 0]
        : key === 'ArrowUp'
          ? [0, -1]
          : [0, 1]

  const targetCol = from.col + dCol
  const targetRow = from.row + dRow
  return panes.find((pane) => pane.col === targetCol && pane.row === targetRow) ?? null
}

export function useShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!isAppShortcut(event)) return
      event.preventDefault()
      event.stopPropagation()

      const state = useStore.getState()
      const panes = state.layout.panes

      if (event.key === 'Escape') {
        if (state.zoomedPaneId) state.toggleZoom(state.zoomedPaneId)
        return
      }

      if (event.key.toLowerCase() === 'z') {
        state.toggleZoom()
        return
      }

      if (/^[1-9]$/.test(event.key)) {
        const target = panes[Number(event.key) - 1]
        if (target) focusPane(target.id)
        return
      }

      if (ARROWS.has(event.key)) {
        const current = panes.find((pane) => pane.id === state.focusedPaneId) ?? panes[0]
        if (!current) return
        const target = neighbour(panes, current, event.key)
        if (target) focusPane(target.id)
      }
    }

    // Capture phase: xterm's textarea would otherwise consume the event first.
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  // Nothing is focused on first paint, so the first keystroke would be lost.
  const firstPaneId = useStore((state) => state.layout.panes[0]?.id ?? null)
  const focusedPaneId = useStore((state) => state.focusedPaneId)
  useEffect(() => {
    if (focusedPaneId || !firstPaneId) return
    useStore.getState().setFocusedPane(firstPaneId)
  }, [focusedPaneId, firstPaneId])
}
