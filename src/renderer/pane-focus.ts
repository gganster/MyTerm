import { useStore } from './store'
import { getTerminal } from './terminal/registry'

/**
 * Making a pane "the current one" — in one place, because there are three ways
 * to do it and they must agree.
 *
 * Clicking a terminal, walking the panes with Ctrl+Shift+arrows and picking a
 * row in the layout editor all move the same pointer. Doing it by hand in each
 * caller is how the focus ring ends up on a pane the zoom has hidden, and how
 * Ctrl+Shift+Z ends up zooming somewhere else instead of unzooming.
 *
 * `selectPane` moves the pointer; `focusPane` additionally hands the keyboard
 * to that terminal. The editor deliberately uses the first: a click in the
 * sidebar must not send the next keystroke into a live shell.
 */

/** Returns true when the zoom had to move with the selection. */
export function selectPane(paneId: string): boolean {
  const state = useStore.getState()
  state.setFocusedPane(paneId)

  // Selecting a hidden pane while zoomed would put the ring somewhere invisible
  // and leave the keyboard on the pane still on screen. The zoom follows.
  const movesZoom = state.zoomedPaneId !== null && state.zoomedPaneId !== paneId
  if (movesZoom) state.toggleZoom(paneId)

  // Panes past the visible capacity live below the fold (ADR-003), so the
  // target may be off screen. `nearest` leaves an already-visible pane exactly
  // where it is — no scrolling on every selection change.
  document
    .querySelector(`[data-pane="${CSS.escape(paneId)}"]`)
    ?.scrollIntoView({ block: 'nearest' })

  return movesZoom
}

export function focusPane(paneId: string): void {
  if (selectPane(paneId)) {
    // The pane React is about to reveal cannot take focus yet: a textarea
    // inside a `display: none` subtree ignores focus() silently.
    requestAnimationFrame(() => getTerminal(paneId)?.terminal.focus())
    return
  }
  getTerminal(paneId)?.terminal.focus()
}
