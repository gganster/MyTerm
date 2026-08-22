/**
 * How many panes fit on one line, and how short a line may get.
 *
 * The rule is the whole layout system (ADR-003): a `.myterm.json` says *which*
 * panes exist and in what order, never where they sit. Position is a function
 * of the width available at that instant, so the same file is usable on a
 * fullscreen 4K window and on a half-screen one without being re-edited.
 *
 * Measured against the *pane area*, not the window: opening the layout editor
 * takes 320 px away, and the panes should reflow for it exactly as they would
 * for a narrower window.
 */

export interface ColumnBreakpoint {
  /** Applies above this width, strictly. */
  minWidth: number
  columns: number
}

export const COLUMN_BREAKPOINTS: readonly ColumnBreakpoint[] = [
  { minWidth: 1600, columns: 3 },
  { minWidth: 1200, columns: 2 },
]

/**
 * Below this, a terminal shows too few lines to be worth looking at. Rows never
 * shrink past it — the pane area scrolls instead, which is the "forced wrap"
 * half of the rule: panes past the visible capacity go to a new line rather
 * than squeezing the ones above them into slivers.
 */
export const MIN_PANE_HEIGHT = 200

/**
 * Columns for a given pane-area width.
 *
 * Never more columns than there are panes: two panes on a 4K screen take half
 * the width each rather than two thirds with a hole on the right.
 */
export function columnsForWidth(width: number, paneCount: number): number {
  if (!Number.isFinite(width) || paneCount <= 0) return 1

  const byWidth = COLUMN_BREAKPOINTS.find((breakpoint) => width > breakpoint.minWidth)?.columns ?? 1
  return Math.min(byWidth, paneCount)
}

/**
 * Index of the visual neighbour in the flow, or null at the edge — no
 * wrap-around, which disorients.
 *
 * Panes have no stored coordinates any more: what the user sees is the flow
 * order cut into lines of `columns`, so that is what the arrow keys walk. Left
 * at the start of a line is an edge, not the end of the line above.
 */
export function neighbourIndex(
  index: number,
  count: number,
  columns: number,
  key: string,
): number | null {
  const width = Math.max(1, columns)
  const column = index % width

  const target =
    key === 'ArrowLeft'
      ? column > 0
        ? index - 1
        : -1
      : key === 'ArrowRight'
        ? column < width - 1
          ? index + 1
          : -1
        : key === 'ArrowUp'
          ? index - width
          : index + width

  return target >= 0 && target < count ? target : null
}
