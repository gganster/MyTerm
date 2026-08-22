import { formatAge, formatCountdown, formatUtilization, quotaTone } from '@shared/quota'
import type { QuotaTone, QuotaWindow } from '@shared/quota'
import { formatGiB, memoryPercent } from '@shared/system-load'
import { useStatus } from '../../hooks/use-status'

/**
 * The permanent footer: Claude quota on the left, machine load on the right.
 *
 * Present in every view, including the project picker — a quota you only see
 * once a project is open is a quota you discover too late.
 *
 * Discretion is the design constraint, and it is enforced by two rules:
 *
 * 1. **Colour means "look at me", and only the quota earns it.** A quota gauge
 *    under 75 % is drawn in the neutral border colour; only warn and critical
 *    borrow the status palette. A footer that is permanently green trains the
 *    eye to skip it, which would make the red one invisible too. CPU and RAM
 *    stay neutral at every value on purpose: a terminal multiplexer pegs the
 *    CPU at 100 % on every build, so a load gauge that reddened would be red
 *    most of the day and would drag the quota next to it into the noise.
 * 2. **Nothing here is clickable.** A control in the footer would take focus
 *    away from the terminal, and getting it back is the user's problem. The
 *    main process polls; the bar only renders.
 */

const FILL_CLASS: Record<QuotaTone, string> = {
  unknown: 'bg-border-strong/40',
  ok: 'bg-border-strong',
  warn: 'bg-status-attention',
  critical: 'bg-status-exited',
}

const VALUE_CLASS: Record<QuotaTone, string> = {
  unknown: 'text-text-muted',
  ok: 'text-text-muted',
  warn: 'text-status-attention',
  critical: 'text-status-exited',
}

function Gauge({
  label,
  percent,
  tone,
  value,
  title,
  testId,
}: {
  label: string
  /** 0-100, or `null` for "unknown" — which draws an empty track, not a full one. */
  percent: number | null
  tone: QuotaTone
  value: string
  title: string
  testId: string
}): React.JSX.Element {
  return (
    <span className="flex items-center gap-1.5" data-status-gauge={testId} title={title}>
      <span className="text-text-muted">{label}</span>
      <span data-status-value className={`tabular-nums ${VALUE_CLASS[tone]}`}>
        {value}
      </span>
      <span
        className="h-1 w-10 overflow-hidden rounded-full bg-surface-sunken"
        role="progressbar"
        aria-label={title}
        aria-valuenow={percent ?? undefined}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span
          data-status-fill
          className={`block h-full rounded-full transition-[width] duration-500 ${FILL_CLASS[tone]}`}
          style={{ width: `${percent ?? 0}%` }}
        />
      </span>
    </span>
  )
}

function QuotaGauge({
  label,
  window: quota,
  now,
  testId,
}: {
  label: string
  window: QuotaWindow
  now: number
  testId: string
}): React.JSX.Element {
  const tone = quotaTone(quota.utilization)
  const countdown = formatCountdown(quota.resetsAt, now)
  // A group of its own with a tighter gap: at the footer's own spacing the
  // countdown would sit as far from its gauge as the two quotas sit from each
  // other, and it would be unclear which window it belongs to.
  return (
    <span className="flex items-center gap-1.5">
      <Gauge
        label={label}
        percent={quota.utilization}
        tone={tone}
        value={formatUtilization(quota.utilization)}
        title={`Quota ${label} consommé — réinitialisation dans ${countdown}`}
        testId={testId}
      />
      <span className="tabular-nums text-text-muted/70" data-status-reset={testId}>
        ↻ {countdown}
      </span>
    </span>
  )
}

/** Human-readable reason, kept in sync with the coarse codes of services/usage.ts. */
function usageHint(error: string | undefined): string {
  switch (error) {
    case 'pending':
      return 'Lecture du quota…'
    case 'no-credentials':
    case 'no-token':
      return 'Aucune session Claude Code trouvée sur cette machine'
    case 'token-expired':
      return 'Session Claude Code expirée — relancez `claude` pour la renouveler'
    case 'network':
      return 'Quota injoignable (hors ligne ?)'
    case 'shape':
      return 'Réponse de quota non reconnue (format changé ?)'
    case 'http-429':
      return "Quota temporairement limité par l'API"
    default:
      return `Quota indisponible (${error ?? 'inconnu'})`
  }
}

export function StatusBar(): React.JSX.Element {
  const { usage, load, now } = useStatus()

  const memory = load ? memoryPercent(load.memoryUsed, load.memoryTotal) : null
  const memoryTitle = load
    ? `Mémoire vive : ${formatGiB(load.memoryUsed)} sur ${formatGiB(load.memoryTotal)}`
    : 'Mémoire vive'

  return (
    <footer
      data-status-bar
      className="flex shrink-0 select-none items-center gap-3 border-t border-border bg-surface px-3 py-1 text-[11px] text-text-muted"
    >
      <span
        className="shrink-0 font-medium"
        title={
          usage?.stale
            ? `Quota mesuré il y a ${formatAge(usage.fetchedAt, now)} — ${usageHint(usage.error)}`
            : undefined
        }
      >
        Claude
        {/* One glyph, not a banner: the reading is still worth trusting, it is
            just older than the poll interval promises. */}
        {usage?.stale ? (
          <span data-status-stale className="text-text-muted/60">
            {' '}
            ⋯
          </span>
        ) : null}
      </span>

      {usage?.ok ? (
        <>
          <QuotaGauge label="session" window={usage.fiveHour} now={now} testId="five-hour" />
          <span aria-hidden className="text-border-strong">
            │
          </span>
          <QuotaGauge label="semaine" window={usage.sevenDay} now={now} testId="seven-day" />
        </>
      ) : (
        <span data-status-usage-error className="truncate select-text">
          {usageHint(usage?.error)}
        </span>
      )}

      <span className="ml-auto flex shrink-0 items-center gap-3">
        <Gauge
          label="CPU"
          percent={load?.cpu ?? null}
          tone={load?.cpu === null || load === null ? 'unknown' : 'ok'}
          value={load?.cpu === null || load === null ? '—' : `${load.cpu} %`}
          title="Charge processeur de la machine"
          testId="cpu"
        />
        <Gauge
          label="RAM"
          percent={memory}
          tone={memory === null ? 'unknown' : 'ok'}
          value={memory === null ? '—' : `${memory} %`}
          title={memoryTitle}
          testId="memory"
        />
      </span>
    </footer>
  )
}
