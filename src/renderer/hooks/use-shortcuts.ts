import { useEffect } from 'react'
import { neighbourIndex } from '@shared/responsive-grid'
import { focusPane } from '../pane-focus'
import { useStore } from '../store'

/**
 * Application shortcuts, and the rule that keeps them from stealing the shell's
 * keys.
 *
 * A terminal claims almost every keystroke, so app bindings all sit behind
 * Ctrl+Shift, which no shell uses. Ctrl+C, Ctrl+D, Ctrl+L, Ctrl+R and friends
 * are never intercepted — they belong to whatever is running in the pane.
 *
 *   Ctrl+Shift+Z        zoom / unzoom the focused pane
 *   Ctrl+Shift+arrows   move focus through the panes as they are laid out
 *   Ctrl+Shift+1..9     focus the nth pane
 *   Escape              unzoom, and only when something is zoomed
 *
 * They are also given up entirely while the caret is in a form field: in the
 * layout editor, Ctrl+Shift+arrows means "extend the selection by word" and
 * Ctrl+Shift+Z means undo. Stealing those would move the focus into a live
 * shell mid-sentence.
 */

const ARROWS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'])

/**
 * Whether the keystroke belongs to something the user is typing into.
 *
 * xterm's own helper textarea is excluded: it is not a form field, it *is* the
 * terminal, and the shortcuts exist precisely to work while it has focus.
 */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.closest('.xterm')) return false
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  )
}

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

export function useShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isTextEntry(event.target)) return
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
        const from = panes.findIndex((pane) => pane.id === state.focusedPaneId)
        const current = from === -1 ? 0 : from
        if (!panes[current]) return
        const target = neighbourIndex(current, panes.length, state.columns, event.key)
        if (target !== null) focusPane(panes[target]!.id)
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
