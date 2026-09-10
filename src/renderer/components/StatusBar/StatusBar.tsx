import { formatAge, formatCountdown, formatUtilization, formatWindowLabel, quotaTone } from '@shared/quota'
import type { QuotaProvider, QuotaTone, QuotaWindow } from '@shared/quota'
import type { UsageSnapshot } from '@shared/ipc-contract'
import { formatGiB, memoryPercent } from '@shared/system-load'
import { useStatus } from '../../hooks/use-status'
import { PROVIDER_FILL, ProviderMark } from './ProviderMark'

/**
 * The permanent footer: the agents' quota on the left, machine load on the right.
 *
 * Present in every view, including the project picker — a quota you only see
 * once a project is open is a quota you discover too late.
 *
 * Three rules shape it.
 *
 * 1. **Colour on a quota bar means *whose*, not *how bad*.** With two agents
 *    and up to four gauges, the question asked most often is which row belongs
 *    to which agent, so the fill carries the identity: Claude orange, Codex
 *    green. Severity keeps two channels of its own — the number's colour and
 *    its weight — and takes the fill back at `critical`, where the track goes
 *    red too: past 90 % it no longer matters whose quota it is, and a tinted
 *    track is a signal that works whatever hue it replaced. CPU and RAM never
 *    escalate on purpose: a terminal multiplexer pegs the CPU at 100 % on every
 *    build, so a load gauge that reddened would be red most of the day and
 *    would drag the quota next to it into the noise.
 * 2. **Each agent is a mark, not a word.** Two names plus four window labels
 *    cost more room than the gauges themselves. See ProviderMark.
 * 3. **Nothing here is clickable.** A control in the footer would take focus
 *    away from the terminal, and getting it back is the user's problem. The
 *    main process polls; the bar only renders.
 */

const FILL_CLASS: Record<QuotaTone, string> = {
  unknown: 'bg-border-strong/40',
  ok: 'bg-status-running',
  warn: 'bg-status-attention',
  critical: 'bg-status-exited',
}

const VALUE_CLASS: Record<QuotaTone, string> = {
  unknown: 'text-text-muted',
  ok: 'text-text-muted',
  // Weight as well as hue: no orange sits far enough from `statusAttention` to
  // be told apart from it, so on a Claude bar the warn step would otherwise
  // rest on two colours a few degrees apart (see palette.ts).
  warn: 'font-semibold text-status-attention',
  critical: 'font-semibold text-status-exited',
}

function Gauge({
  label,
  percent,
  tone,
  value,
  title,
  testId,
  fillClass,
}: {
  label: string
  /** 0-100, or `null` for "unknown" — which draws an empty track, not a full one. */
  percent: number | null
  tone: QuotaTone
  value: string
  title: string
  testId: string
  /** Identity colour for a quota bar. Omitted by CPU and RAM, which have none. */
  fillClass?: string
}): React.JSX.Element {
  // The identity colour holds until `critical`, which takes it back.
  const fill = fillClass && tone !== 'critical' && tone !== 'unknown' ? fillClass : FILL_CLASS[tone]
  return (
    <span className="flex items-center gap-1.5" data-status-gauge={testId} title={title}>
      <span className="text-text-muted">{label}</span>
      <span data-status-value className={`tabular-nums ${VALUE_CLASS[tone]}`}>
        {value}
      </span>
      <span
        className={[
          'h-1 w-10 overflow-hidden rounded-full',
          // A red track is the one escalation signal that does not depend on
          // the fill's hue, which is now the provider's and not ours to spend.
          tone === 'critical' ? 'bg-status-exited/20' : 'bg-surface-sunken',
        ].join(' ')}
        role="progressbar"
        aria-label={title}
        aria-valuenow={percent ?? undefined}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span
          data-status-fill
          className={`block h-full rounded-full transition-[width] duration-500 ${fill}`}
          style={{ width: `${percent ?? 0}%` }}
        />
      </span>
    </span>
  )
}

const PROVIDER_NAMES: Record<QuotaProvider, string> = { claude: 'Claude', codex: 'Codex' }

function QuotaGauge({
  provider,
  window: quota,
  now,
  testId,
}: {
  provider: QuotaProvider
  window: QuotaWindow
  now: number
  testId: string
}): React.JSX.Element {
  const tone = quotaTone(quota.utilization)
  const countdown = formatCountdown(quota.resetsAt, now)
  const label = formatWindowLabel(quota.windowSeconds)
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
        // The provider name lives here now that the label is a mark: this is
        // where someone who does not recognise the logo finds out what it is.
        title={`${PROVIDER_NAMES[provider]} — quota ${label} consommé, réinitialisation dans ${countdown}`}
        testId={testId}
        fillClass={PROVIDER_FILL[provider]}
      />
      <span className="tabular-nums text-text-muted/70" data-status-reset={testId}>
        ↻ {countdown}
      </span>
    </span>
  )
}

/**
 * Human-readable reason, kept in sync with the coarse codes of the two
 * provider readers. The CLI named in the credential messages is the one that
 * would fix it, which is the only actionable half of the sentence.
 */
function usageHint(provider: QuotaProvider, error: string | undefined): string {
  const cli = provider === 'claude' ? 'claude' : 'codex'
  switch (error) {
    case 'pending':
      return 'Lecture du quota…'
    case 'no-credentials':
    case 'no-token':
      return `Aucune session ${PROVIDER_NAMES[provider]} sur cette machine`
    case 'token-expired':
      return `Session ${PROVIDER_NAMES[provider]} expirée — relancez \`${cli}\``
    case 'network':
      return 'Quota injoignable (hors ligne ?)'
    case 'shape':
      return 'Réponse de quota non reconnue (format changé ?)'
    case 'http-403':
      // Une vérification anti-bot du fournisseur, pas un droit manquant : la
      // requête suivante passe. Le dire évite de partir chercher une session
      // cassée qui n'existe pas.
      return 'Quota momentanément refusé — nouvelle tentative en cours'
    case 'http-429':
      return "Quota temporairement limité par l'API"
    default:
      return `Quota indisponible (${error ?? 'inconnu'})`
  }
}

/**
 * One agent: its mark, then the windows it actually has.
 *
 * A window whose utilisation is unknown is dropped rather than drawn as "— %".
 * That is not cosmetic: a Codex plan can declare a weekly window and no session
 * window at all, and an empty gauge next to a real one reads as a quota at zero.
 */
function ProviderQuota({
  provider,
  snapshot,
  now,
}: {
  provider: QuotaProvider
  snapshot: UsageSnapshot | undefined
  now: number
}): React.JSX.Element {
  const windows = snapshot?.ok
    ? ([
        ['session', snapshot.session],
        ['week', snapshot.week],
      ] as const).filter(([, quota]) => quota.utilization !== null)
    : []

  return (
    <span className="flex min-w-0 items-center gap-2" data-status-provider={provider}>
      <span
        className="flex shrink-0 items-center gap-1"
        title={
          snapshot?.stale
            ? `${PROVIDER_NAMES[provider]} — quota mesuré il y a ${formatAge(snapshot.fetchedAt, now)} · ${usageHint(provider, snapshot.error)}`
            : PROVIDER_NAMES[provider]
        }
      >
        <ProviderMark provider={provider} />
        {/* One glyph, not a banner: the reading is still worth trusting, it is
            just older than the poll interval promises. */}
        {snapshot?.stale ? (
          <span data-status-stale={provider} className="text-text-muted/60">
            ⋯
          </span>
        ) : null}
      </span>

      {windows.length > 0 ? (
        windows.map(([key, quota], index) => (
          <span key={key} className="flex items-center gap-2">
            {index > 0 ? (
              <span aria-hidden className="text-border-strong">
                │
              </span>
            ) : null}
            <QuotaGauge
              provider={provider}
              window={quota}
              now={now}
              testId={`${provider}-${key}`}
            />
          </span>
        ))
      ) : (
        <span data-status-usage-error={provider} className="truncate select-text">
          {usageHint(provider, snapshot?.error)}
        </span>
      )}
    </span>
  )
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
      className="flex shrink-0 select-none items-center gap-4 border-t border-border bg-surface px-3 py-1 text-[11px] text-text-muted"
    >
      {/* min-w-0 so the quota half is what gives way on a narrow window: CPU
          and RAM are two short readings and would only wrap awkwardly. */}
      <span className="flex min-w-0 items-center gap-4">
        <ProviderQuota provider="claude" snapshot={usage?.claude} now={now} />
        <ProviderQuota provider="codex" snapshot={usage?.codex} now={now} />
      </span>

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
