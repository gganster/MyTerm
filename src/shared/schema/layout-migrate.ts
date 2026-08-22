import { LAYOUT_VERSION } from './layout'

/**
 * Forward migration of a raw `.myterm.json`, run before validation.
 *
 * v1 described a rigid `cols x rows` grid and gave every pane a `{col, row}`.
 * v2 keeps only the pane order and lets the window decide how many fit on a
 * line (ADR-003). Reading order — top to bottom, left to right — is the only
 * honest way to flatten a grid into a list: it is what the user was already
 * looking at.
 *
 * The function is deliberately tolerant. It repairs the *shape* it recognises
 * and hands everything else to Zod, whose messages are the ones a user can act
 * on. It never reports failure itself, and never writes: a migrated layout only
 * reaches the file once the user edits something.
 */
export function migrateLayout(raw: unknown): unknown {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return raw

  const source = raw as Record<string, unknown>
  if (source.version !== 1) return raw

  // `grid` is dropped by omission; the version is bumped even when the rest is
  // malformed, so the user sees the real error instead of "version invalide".
  const { grid: _grid, panes, ...rest } = source
  const migrated: Record<string, unknown> = { ...rest, version: LAYOUT_VERSION }

  if (!Array.isArray(panes)) {
    if (panes !== undefined) migrated.panes = panes
    return migrated
  }

  migrated.panes = panes
    .map((pane, index) => ({ pane, index }))
    .sort((a, b) => {
      const rowDelta = cell(a.pane, 'row') - cell(b.pane, 'row')
      if (rowDelta !== 0) return rowDelta
      const colDelta = cell(a.pane, 'col') - cell(b.pane, 'col')
      if (colDelta !== 0) return colDelta
      // Panes without usable coordinates keep the order the file gave them.
      return a.index - b.index
    })
    .map(({ pane }) => {
      if (pane === null || typeof pane !== 'object' || Array.isArray(pane)) return pane
      const { col: _col, row: _row, ...paneRest } = pane as Record<string, unknown>
      return paneRest
    })

  return migrated
}

function cell(pane: unknown, key: 'col' | 'row'): number {
  if (pane === null || typeof pane !== 'object') return 0
  const value = (pane as Record<string, unknown>)[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/**
 * Coordinates left over from v1 in a file that declares v2.
 *
 * Bumping `"version": 1` to `2` by hand and leaving `grid` / `col` / `row` in
 * place is the obvious move for someone who notices the app now writes 2 — and
 * it silently means something different: the schema drops the leftovers, so the
 * panes render in declaration order rather than the reading order the migration
 * would have produced. Rejecting it costs one message and saves a scrambled
 * layout nobody can explain.
 *
 * Returns the first offending field path, or null.
 */
export function legacyFieldIn(raw: unknown): string | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null

  const source = raw as Record<string, unknown>
  if (source.grid !== undefined) return 'grid'

  if (!Array.isArray(source.panes)) return null
  for (const [index, pane] of source.panes.entries()) {
    if (pane === null || typeof pane !== 'object') continue
    const fields = pane as Record<string, unknown>
    if (fields.col !== undefined) return `panes.${index}.col`
    if (fields.row !== undefined) return `panes.${index}.row`
  }
  return null
}
