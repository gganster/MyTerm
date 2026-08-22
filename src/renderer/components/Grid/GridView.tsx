import { useEffect, useLayoutEffect, useRef } from 'react'
import { columnsForWidth, MIN_PANE_HEIGHT } from '@shared/responsive-grid'
import { refreshTerminals } from '../../terminal/registry'
import { selectColumns, selectGeneration, selectPanes, useStore } from '../../store'
import { PaneView } from './PaneView'

/**
 * The pane area: a CSS Grid whose column count comes from its own width, not
 * from the file (ADR-003).
 *
 * Two details carry the behaviour. `minmax(0, 1fr)` rather than `1fr` on the
 * columns: without it a terminal's intrinsic width would stop cells from
 * shrinking and the grid would overflow the window. And `minmax(MIN, 1fr)` on
 * the implicit rows: panes wrap onto as many lines as the width allows, rows
 * share the height while they fit, and past that they keep a usable height and
 * the area scrolls instead of crushing every terminal into a sliver.
 *
 * The width is read from the border box, which an inner scrollbar does not
 * change — measuring the content box would let a scrollbar appearing at a
 * breakpoint drop a column, which would remove the scrollbar, which would add
 * the column back.
 */
export function GridView(): React.JSX.Element {
  const panes = useStore(selectPanes)
  const columns = useStore(selectColumns)
  const generation = useStore(selectGeneration)
  const paneEpochs = useStore((state) => state.paneEpochs)
  const zoomedPaneId = useStore((state) => state.zoomedPaneId)
  const setColumns = useStore((state) => state.setColumns)

  const containerRef = useRef<HTMLDivElement>(null)
  const paneCount = panes.length
  const zoomed = zoomedPaneId !== null

  // A layout effect, not a passive one: it runs before paint and before the
  // panes' own effects, so a pane never spawns its pty measured against a
  // column count left over from the previous workspace — or against the
  // single-column default on the very first frame.
  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return

    const measure = (width: number): void => {
      if (width > 0) setColumns(columnsForWidth(width, paneCount))
    }

    const observer = new ResizeObserver(([entry]) => {
      const box = entry?.borderBoxSize?.[0]
      measure(box ? box.inlineSize : container.getBoundingClientRect().width)
    })
    observer.observe(container)
    measure(container.getBoundingClientRect().width)

    return () => observer.disconnect()
  }, [paneCount, setColumns])

  // Reordering moves live DOM nodes, which blanks their canvas until something
  // else repaints them. Keyed on the order itself so an edit that only renames
  // a pane costs nothing.
  const order = panes.map((pane) => pane.id).join(',')
  useEffect(() => {
    refreshTerminals()
  }, [order])

  // Leaving zoom restores a scroll container that was collapsed to a single
  // cell, so the browser clamped its offset to 0. Without this the pane you
  // were just looking at can be several screens up.
  const previousZoom = useRef<string | null>(null)
  useEffect(() => {
    const previous = previousZoom.current
    previousZoom.current = zoomedPaneId
    if (zoomedPaneId !== null || previous === null) return
    containerRef.current
      ?.querySelector(`[data-pane="${CSS.escape(previous)}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [zoomedPaneId])

  return (
    <div
      ref={containerRef}
      data-grid-columns={zoomed ? 1 : columns}
      className="grid h-full min-h-0 w-full min-w-0 gap-1.5 bg-surface-sunken p-1.5"
      style={
        // Zoom collapses the grid to a single full-height cell: the hidden
        // siblings are `display: none`, so they create no track.
        zoomed
          ? { gridTemplateColumns: 'minmax(0, 1fr)', gridAutoRows: 'minmax(0, 1fr)', overflow: 'hidden' }
          : {
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
              gridAutoRows: `minmax(${MIN_PANE_HEIGHT}px, 1fr)`,
              overflowY: 'auto',
              overflowX: 'hidden',
              // A terminal swallows the wheel while it has scrollback of its
              // own, so the scrollbar is the one dependable way to move this
              // area. Reserving its gutter keeps it in the same place whether
              // or not the panes currently overflow.
              scrollbarGutter: 'stable',
            }
      }
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
