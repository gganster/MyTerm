import { useStore } from '../../store'
import { PaneBadge } from './PaneBadge'

interface PaneHeaderProps {
  paneId: string
  title: string
}

export function PaneHeader({ paneId, title }: PaneHeaderProps): React.JSX.Element {
  const toggleZoom = useStore((state) => state.toggleZoom)
  const setCollapsed = useStore((state) => state.setCollapsed)
  const isZoomed = useStore((state) => state.zoomedPaneId === paneId)

  return (
    <header className="flex h-7 shrink-0 items-center gap-2 border-b border-border bg-surface-raised px-2">
      <PaneBadge paneId={paneId} />
      <span className="truncate text-xs text-text" title={title}>
        {title}
      </span>
      {/* Folding is on the header and restoring is on the bar, because that is
          where each one is: there is no second control here to "unfold", the
          pane is gone from this spot. Same shape as a window manager, and the
          reason the glyph points *down* — this pane is going to the bar at the
          bottom, not disappearing. */}
      <button
        type="button"
        data-action="collapse-pane"
        onClick={() => setCollapsed(paneId, true)}
        title="Réduire dans la barre (Ctrl+Shift+M) — le terminal continue de tourner"
        aria-label="Réduire le pane dans la barre du bas"
        className="ml-auto rounded px-1 text-xs text-text-muted hover:bg-surface-sunken hover:text-text"
      >
        ⤓
      </button>
      <button
        type="button"
        onClick={() => toggleZoom(paneId)}
        title={isZoomed ? 'Réduire (Ctrl+Shift+Z)' : 'Agrandir (Ctrl+Shift+Z)'}
        aria-label={isZoomed ? 'Réduire le pane' : 'Agrandir le pane'}
        className="rounded px-1 text-xs text-text-muted hover:bg-surface-sunken hover:text-text"
      >
        {isZoomed ? '⤡' : '⤢'}
      </button>
    </header>
  )
}
