import { useStore } from '../../store'
import { PaneBadge } from './PaneBadge'

interface PaneHeaderProps {
  paneId: string
  title: string
}

export function PaneHeader({ paneId, title }: PaneHeaderProps): React.JSX.Element {
  const toggleZoom = useStore((state) => state.toggleZoom)
  const isZoomed = useStore((state) => state.zoomedPaneId === paneId)

  return (
    <header className="flex h-7 shrink-0 items-center gap-2 border-b border-border bg-surface-raised px-2">
      <PaneBadge paneId={paneId} />
      <span className="truncate text-xs text-text" title={title}>
        {title}
      </span>
      <button
        type="button"
        onClick={() => toggleZoom(paneId)}
        title={isZoomed ? 'Réduire (Ctrl+Shift+Z)' : 'Agrandir (Ctrl+Shift+Z)'}
        aria-label={isZoomed ? 'Réduire le pane' : 'Agrandir le pane'}
        className="ml-auto rounded px-1 text-xs text-text-muted hover:bg-surface-sunken hover:text-text"
      >
        {isZoomed ? '⤡' : '⤢'}
      </button>
    </header>
  )
}
