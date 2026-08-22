import { selectGeneration, selectGrid, selectPanes, useStore } from '../../store'
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
  const generation = useStore(selectGeneration)
  const paneEpochs = useStore((state) => state.paneEpochs)

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
        // Never the index — reordering must not recreate terminals. The
        // generation prefix forces a remount when a *new* workspace is loaded,
        // whose ptys were just killed in the main process; within one workspace
        // the key is stable and panes survive edits untouched.
        <PaneView key={`${generation}:${pane.id}:${paneEpochs[pane.id] ?? 0}`} pane={pane} />
      ))}
    </div>
  )
}
