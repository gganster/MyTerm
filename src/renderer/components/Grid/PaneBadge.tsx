import { selectPaneStatus, useStore } from '../../store'
import type { PaneStatus } from '@shared/pane-status'

/** Exported: the collapsed bar names and colours the same four states. */
export const STATUS_LABELS: Record<PaneStatus, string> = {
  running: 'en cours',
  attention: 'attend une réponse',
  idle: 'inactif',
  exited: 'terminé',
}

export const STATUS_DOT: Record<PaneStatus, string> = {
  running: 'bg-status-running',
  attention: 'bg-status-attention',
  idle: 'bg-status-idle',
  exited: 'bg-status-exited',
}

/**
 * Activity indicator (PRD feature 4).
 *
 * Subscribes to one pane's status only, so a tick on a sibling does not
 * re-render this badge. Only `attention` is emphasised — if every state were
 * loud the grid would read as noise and the badge would say nothing.
 */
export function PaneBadge({ paneId }: { paneId: string }): React.JSX.Element {
  const status = useStore(selectPaneStatus(paneId))
  const attention = status === 'attention'

  return (
    <span
      data-status={status}
      title={STATUS_LABELS[status]}
      aria-label={STATUS_LABELS[status]}
      className={[
        'inline-flex items-center gap-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
        attention ? 'bg-status-attention/12 text-status-attention' : 'text-text-muted',
      ].join(' ')}
    >
      <span
        className={[
          'inline-block h-1.5 w-1.5 rounded-full',
          STATUS_DOT[status],
          attention ? 'animate-pulse' : '',
        ].join(' ')}
      />
      {attention ? STATUS_LABELS[status] : null}
    </span>
  )
}
