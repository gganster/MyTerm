import { LayoutSchema, MAX_COLS, MAX_ROWS } from './layout'
import type { Layout, Pane } from './layout'

/**
 * Pure layout mutations, shared by the editor UI and by the reload diff.
 *
 * Kept out of React so each operation can be reasoned about — and tested —
 * on its own, and so the editor can never push an invalid layout into the
 * store: every mutation is re-validated before it is returned.
 */

export type EditResult = { ok: true; layout: Layout } | { ok: false; message: string }

function validated(layout: Layout): EditResult {
  const result = LayoutSchema.safeParse(layout)
  if (!result.success) {
    const first = result.error.issues[0]
    return { ok: false, message: first ? `${first.path.join('.')} : ${first.message}` : 'layout invalide' }
  }
  return { ok: true, layout: result.data }
}

export function freeCell(layout: Layout): { col: number; row: number } | null {
  for (let row = 0; row < layout.grid.rows; row++) {
    for (let col = 0; col < layout.grid.cols; col++) {
      if (!layout.panes.some((pane) => pane.col === col && pane.row === row)) return { col, row }
    }
  }
  return null
}

function uniqueId(layout: Layout): string {
  let index = layout.panes.length + 1
  while (layout.panes.some((pane) => pane.id === `pane-${index}`)) index++
  return `pane-${index}`
}

export function addPane(layout: Layout): EditResult {
  const cell = freeCell(layout)
  if (!cell) {
    return { ok: false, message: 'la grille est pleine — agrandissez-la avant d’ajouter un pane' }
  }
  return validated({
    ...layout,
    panes: [...layout.panes, { id: uniqueId(layout), title: '', cwd: '.', ...cell }],
  })
}

export function removePane(layout: Layout, paneId: string): EditResult {
  // An empty grid is not a state the app can be in.
  if (layout.panes.length <= 1) {
    return { ok: false, message: 'un workspace doit garder au moins un pane' }
  }
  return validated({ ...layout, panes: layout.panes.filter((pane) => pane.id !== paneId) })
}

export function updatePane(layout: Layout, paneId: string, patch: Partial<Pane>): EditResult {
  return validated({
    ...layout,
    panes: layout.panes.map((pane) => {
      if (pane.id !== paneId) return pane
      const next = { ...pane, ...patch }
      // Optional fields are dropped rather than stored empty: the file stays
      // clean and diffs stay small.
      if (!next.command) delete next.command
      if (!next.shell) delete next.shell
      return next
    }),
  })
}

/** Swap is the only safe move: two panes can never share a cell. */
export function swapPanes(layout: Layout, a: string, b: string): EditResult {
  const first = layout.panes.find((pane) => pane.id === a)
  const second = layout.panes.find((pane) => pane.id === b)
  if (!first || !second) return { ok: false, message: 'pane introuvable' }

  return validated({
    ...layout,
    panes: layout.panes.map((pane) => {
      if (pane.id === a) return { ...pane, col: second.col, row: second.row }
      if (pane.id === b) return { ...pane, col: first.col, row: first.row }
      return pane
    }),
  })
}

export interface ResizeOutcome {
  /** Panes that would fall outside the new grid. Never dropped silently. */
  orphaned: Pane[]
  apply: () => EditResult
}

export function resizeGrid(layout: Layout, cols: number, rows: number): ResizeOutcome {
  const clampedCols = Math.min(Math.max(cols, 1), MAX_COLS)
  const clampedRows = Math.min(Math.max(rows, 1), MAX_ROWS)
  const orphaned = layout.panes.filter((pane) => pane.col >= clampedCols || pane.row >= clampedRows)

  return {
    orphaned,
    apply: () =>
      validated({
        ...layout,
        grid: { cols: clampedCols, rows: clampedRows },
        panes: layout.panes.filter((pane) => !orphaned.includes(pane)),
      }),
  }
}

/**
 * Which panes must restart for a new layout to take effect.
 *
 * Only the three fields that define the process. A renamed pane keeps running:
 * killing a dev server over a typo would be indefensible.
 */
export function panesNeedingRestart(previous: Layout, next: Layout): string[] {
  const before = new Map(previous.panes.map((pane) => [pane.id, pane]))
  const changed: string[] = []

  for (const pane of next.panes) {
    const old = before.get(pane.id)
    if (!old) {
      changed.push(pane.id)
      continue
    }
    if (old.cwd !== pane.cwd || old.shell !== pane.shell || old.command !== pane.command) {
      changed.push(pane.id)
    }
  }
  return changed
}
