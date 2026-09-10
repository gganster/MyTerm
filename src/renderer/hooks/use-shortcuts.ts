import { useEffect } from 'react'
import { neighbourIndex } from '@shared/responsive-grid'
import { focusPane } from '../pane-focus'
import { useStore, visiblePanes } from '../store'
import { isCopyChord } from '../terminal/key-chords'
import { getTerminal } from '../terminal/registry'

/**
 * Application shortcuts, and the rule that keeps them from stealing the shell's
 * keys.
 *
 * A terminal claims almost every keystroke, so app bindings all sit behind
 * Ctrl+Shift, which no shell uses. Ctrl+C, Ctrl+D, Ctrl+L, Ctrl+R and friends
 * are never intercepted — they belong to whatever is running in the pane.
 *
 *   Ctrl+Shift+C        copy the focused pane's selection
 *   Ctrl+Shift+Z        zoom / unzoom the focused pane
 *   Ctrl+Shift+M        fold the focused pane into the bottom bar, or unfold it
 *   Ctrl+Shift+arrows   move focus through the panes as they are laid out
 *   Ctrl+Shift+1..9     focus the nth pane, unfolding it if it was folded
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
    if (isCopyChord(event)) return true
    if (event.key.toLowerCase() === 'z') return true
    if (event.key.toLowerCase() === 'm') return true
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

/**
 * Copies the focused pane's selection to the system clipboard.
 *
 * A terminal's selection is not a DOM selection — with the WebGL renderer the
 * text is painted to a canvas and is not in the document at all — so the
 * browser's own copy command has nothing to act on. That is why copying from a
 * pane did not work by any means: the selection has to be read out of xterm and
 * handed over explicitly.
 *
 * An empty selection is left alone rather than written: clearing the clipboard
 * because a chord was pressed with nothing selected would destroy something the
 * user still wanted.
 *
 * `navigator.clipboard` is reachable from this renderer despite the sandbox —
 * verified at runtime, not assumed — and a write needs no permission prompt
 * because it happens inside a keystroke.
 */
async function copySelection(paneId: string | null): Promise<void> {
  const handle = paneId ? getTerminal(paneId) : undefined
  const selection = handle?.terminal.getSelection() ?? ''
  if (!selection) return

  try {
    await navigator.clipboard.writeText(selection)
  } catch (error) {
    console.warn('[myterm] copie dans le presse-papier refusée', error)
  }
}

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

      if (isCopyChord(event)) {
        void copySelection(state.focusedPaneId)
        return
      }

      if (event.key.toLowerCase() === 'z') {
        state.toggleZoom()
        return
      }

      if (event.key.toLowerCase() === 'm') {
        state.toggleCollapse()
        return
      }

      // Indexed on the file's list, not on what is currently on the grid: the
      // nth pane is the nth pane whether or not it is folded, and asking for
      // one by number brings it back (focusPane unfolds).
      if (/^[1-9]$/.test(event.key)) {
        const target = panes[Number(event.key) - 1]
        if (target) focusPane(target.id)
        return
      }

      if (ARROWS.has(event.key)) {
        // The arrows walk the *grid*, so they walk the panes that are on it:
        // neighbourIndex reasons in rows of `columns` cells, and a folded pane
        // holds no cell. Handing it the full list would make "the pane to my
        // right" name something in the bottom bar.
        const visible = visiblePanes(state)
        const from = visible.findIndex((pane) => pane.id === state.focusedPaneId)
        const current = from === -1 ? 0 : from
        if (!visible[current]) return
        const target = neighbourIndex(current, visible.length, state.columns, event.key)
        if (target !== null) focusPane(visible[target]!.id)
      }
    }

    // Capture phase: xterm's textarea would otherwise consume the event first.
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  // Nothing is focused on first paint, so the first keystroke would be lost.
  // The first pane *on the grid*, since a workspace may declare its first one
  // folded — the ring has to land somewhere the user can see it.
  const firstPaneId = useStore(
    (state) =>
      state.layout.panes.find((pane) => !state.collapsedPaneIds.includes(pane.id))?.id ??
      state.layout.panes[0]?.id ??
      null,
  )
  const focusedPaneId = useStore((state) => state.focusedPaneId)
  useEffect(() => {
    if (focusedPaneId || !firstPaneId) return
    useStore.getState().setFocusedPane(firstPaneId)
  }, [focusedPaneId, firstPaneId])
}
