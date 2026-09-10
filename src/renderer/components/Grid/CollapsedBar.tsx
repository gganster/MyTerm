import type { Pane } from '@shared/schema/layout'
import { focusPane } from '../../pane-focus'
import {
  selectCollapsedPaneIds,
  selectLastCommand,
  selectPaneStatus,
  useStore,
} from '../../store'
import { paneBorderColor } from '../../theme/palette'
import { STATUS_DOT, STATUS_LABELS } from './PaneBadge'

/**
 * The folded panes, as a strip along the bottom of the pane area.
 *
 * The thing being solved: a pane that has to *run* but does not have to be
 * *watched*. A Cloudflare tunnel, a queue worker, a file watcher — each one
 * takes a full grid cell for output nobody reads, and closing it is not an
 * option because the process is the point. Folding gives up the cell and keeps
 * the shell: the pane is parked off screen at a fixed size, so its pty is
 * still attached, still sized, still producing scrollback (see PaneView).
 *
 * Two rules shape the bar.
 *
 * **It only exists when something is folded.** An always-present empty strip
 * would tax every workspace that never uses the feature with a row of pixels.
 *
 * **`exited` is emphasised here, and only here.** The grid's rule is that only
 * `attention` shouts, because six loud panes say nothing. A folded pane is the
 * exception: it is the one pane whose death nobody can see, and a tunnel that
 * quit an hour ago while its chip sat there looking ordinary is exactly the
 * failure this feature would otherwise introduce.
 */
export function CollapsedBar(): React.JSX.Element | null {
  const collapsedPaneIds = useStore(selectCollapsedPaneIds)
  const panes = useStore((state) => state.layout.panes)

  if (collapsedPaneIds.length === 0) return null

  // Driven off the layout so the chips keep the pane order, and so a folded id
  // that no longer names a pane simply drops out.
  const folded = panes.filter((pane) => collapsedPaneIds.includes(pane.id))
  if (folded.length === 0) return null

  return (
    // No `overflow`, on purpose: the hover card opens upward out of this box,
    // and a scroll container would clip it. The chips wrap onto a second line
    // instead, which at 24 panes maximum is a row or two.
    <div
      data-collapsed-bar
      className="relative z-40 flex shrink-0 flex-wrap items-center gap-1 border-t border-border bg-surface-raised px-1.5 py-1"
    >
      <span className="px-1 text-[10px] text-text-muted" aria-hidden>
        réduits
      </span>
      {folded.map((pane) => (
        <CollapsedChip key={pane.id} pane={pane} />
      ))}
    </div>
  )
}

function CollapsedChip({ pane }: { pane: Pane }): React.JSX.Element {
  const status = useStore(selectPaneStatus(pane.id))
  const lastCommand = useStore(selectLastCommand(pane.id))
  const resolvedTheme = useStore((state) => state.resolvedTheme)

  const title = pane.title || pane.id
  const accent = paneBorderColor(resolvedTheme, pane.color)
  const commandLabel = lastCommand ?? 'shell en attente'

  return (
    <div className="group relative">
      <button
        type="button"
        data-collapsed-chip={pane.id}
        data-status={status}
        onClick={() => focusPane(pane.id)}
        // The card below is decoration: everything it shows is in here, so a
        // screen reader gets the command without a hover it cannot perform.
        aria-label={`Restaurer ${title} — ${STATUS_LABELS[status]} — dernière commande : ${commandLabel}`}
        className={[
          'flex max-w-56 items-center gap-1.5 rounded border px-2 py-0.5 text-xs',
          'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
          status === 'exited'
            ? 'border-status-exited/40 bg-status-exited/8 text-status-exited'
            : status === 'attention'
              ? 'border-status-attention/40 bg-status-attention/10 text-status-attention'
              : 'border-border text-text-muted hover:bg-surface-sunken hover:text-text',
        ].join(' ')}
      >
        {/* The pane's colour, kept as a bar rather than a dot: the status dot
            is right next to it and two dots of different meaning side by side
            read as one indicator with two halves. */}
        <span
          data-chip-color={pane.color ?? undefined}
          aria-hidden
          className="h-3 w-0.5 shrink-0 rounded-full"
          style={{ backgroundColor: accent ?? 'var(--color-border-strong)' }}
        />
        <span
          aria-hidden
          className={[
            'h-1.5 w-1.5 shrink-0 rounded-full',
            STATUS_DOT[status],
            status === 'attention' ? 'animate-pulse' : '',
          ].join(' ')}
        />
        <span className="truncate">{title}</span>
      </button>

      {/* Hover card. Delayed on the way in and instant on the way out, so
          sweeping the pointer across a row of chips does not flash six cards —
          the delay lives on the hovered state, which is the state being
          transitioned *to*. */}
      <div
        data-collapsed-card={pane.id}
        aria-hidden
        className="pointer-events-none absolute bottom-full left-0 z-50 mb-1.5 w-max max-w-80 rounded-md border border-border bg-surface p-2 opacity-0 shadow-lg transition-opacity duration-75 group-hover:opacity-100 group-hover:delay-300 group-focus-within:opacity-100"
      >
        <p className="truncate text-xs font-medium text-text">{title}</p>
        <p
          className={[
            'mt-0.5 font-mono text-[11px] break-all',
            lastCommand ? 'text-text-muted' : 'text-text-muted/70 italic',
          ].join(' ')}
        >
          {commandLabel}
        </p>
      </div>
    </div>
  )
}
