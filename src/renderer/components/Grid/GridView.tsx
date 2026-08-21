import { selectGrid, selectPanes, useStore } from '../../store'
import { PaneView } from './PaneView'

/**
 * The grid itself: a plain CSS Grid, one cell per pane (ADR-003).
 *
 * A rigid cols × rows grid is what makes `{col, row}` serialisable and the JSON
 * hand-editable. `minmax(0, 1fr)` rather than `1fr` matters: without it a
 * terminal's intrinsic width would stop cells from shrinking and the grid would
 * overflow the window.
 */
export function GridView(): React.JSX.Element {
  const grid = useStore(selectGrid)
  const panes = useStore(selectPanes)

  return (
    <div
      data-grid={`${grid.cols}x${grid.rows}`}
      className="grid h-full min-h-0 w-full min-w-0 gap-1.5 bg-surface-sunken p-1.5"
      style={{
        gridTemplateColumns: `repeat(${grid.cols}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${grid.rows}, minmax(0, 1fr))`,
      }}
    >
      {panes.map((pane) => (
        // Key is the pane id, never the index: reordering must not tear down
        // and recreate the terminals.
        <PaneView key={pane.id} pane={pane} />
      ))}
    </div>
  )
}
