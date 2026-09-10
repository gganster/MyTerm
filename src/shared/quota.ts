/**
 * Agent usage quota: shape and the pure logic around it.
 *
 * Two windows are surfaced per provider, the two anyone actually watches: a
 * short rolling session and a long rolling week. Everything here is pure so the
 * main process (which parses the API response) and the renderer (which renders
 * it) agree on a single set of rules, and so both are testable without Electron.
 */

/**
 * The coding agents whose quota the status bar tracks.
 *
 * A closed list, and the key of every per-provider record in the app: adding a
 * third agent then fails to compile everywhere one is missing, which is the
 * only way a palette entry, a poller and a bar stay in step.
 */
export const QUOTA_PROVIDERS = ['claude', 'codex'] as const
export type QuotaProvider = (typeof QUOTA_PROVIDERS)[number]

/** One rate-limit window as the status bar needs it. */
export interface QuotaWindow {
  /** Percentage consumed, 0-100. `null` means "unknown", never "zero". */
  utilization: number | null
  /** Epoch ms at which the window rolls over, or `null` if the API omitted it. */
  resetsAt: number | null
  /**
   * Length of the window in seconds, when the provider says so.
   *
   * The label above each gauge is derived from this rather than hard-coded:
   * Anthropic's two windows are always 5 h and 7 d, but a Codex plan declares
   * its own — this account has a single 7-day window and no session window at
   * all. A bar labelled "session" over a weekly figure would be a lie the user
   * has no way to catch.
   */
  windowSeconds?: number
}

export type QuotaTone = 'unknown' | 'ok' | 'warn' | 'critical'

/** Accepts the API's ISO strings and, defensively, epoch seconds or ms. */
export function toEpochMs(value: unknown): number | null {
  if (value == null) return null
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    // Anything below ~2001 in ms is really a seconds-precision timestamp.
    return value < 1e12 ? value * 1000 : value
  }
  if (typeof value !== 'string') return null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

/**
 * Normalises one window of the API payload.
 *
 * A missing or unparsable utilisation yields `null`, never `0`: a bar sitting
 * at zero reads as "quota intact", which is the opposite of "we have no idea"
 * and is exactly the wrong thing to tell someone about to start a long run.
 */
export function normaliseWindow(
  utilizationRaw: unknown,
  resetsAtRaw: unknown,
  windowSecondsRaw?: unknown,
): QuotaWindow {
  const resetsAt = toEpochMs(resetsAtRaw)
  const windowSeconds =
    typeof windowSecondsRaw === 'number' && Number.isFinite(windowSecondsRaw) && windowSecondsRaw > 0
      ? { windowSeconds: windowSecondsRaw }
      : {}
  // An allowlist, not a null check. `Number` coerces `true`, `[]` and `''` to a
  // number without complaining, and every one of them would land on 0 — a
  // full-quota bar drawn for a field the API left blank, which is the one lie
  // this type exists to prevent.
  const isNumeric = typeof utilizationRaw === 'number' || typeof utilizationRaw === 'string'
  if (!isNumeric || (typeof utilizationRaw === 'string' && utilizationRaw.trim() === '')) {
    return { utilization: null, resetsAt, ...windowSeconds }
  }
  const numeric = Number(utilizationRaw)
  if (!Number.isFinite(numeric)) return { utilization: null, resetsAt, ...windowSeconds }
  return {
    utilization: Math.max(0, Math.min(100, Math.round(numeric))),
    resetsAt,
    ...windowSeconds,
  }
}

/**
 * Time left before the window rolls over, in the shortest readable form.
 *
 * `now` is a parameter rather than a `Date.now()` call so the caller's clock is
 * the only clock and the function stays testable.
 */
export function formatCountdown(resetsAt: number | null, now: number): string {
  if (resetsAt === null) return '—'
  const remaining = resetsAt - now
  if (remaining <= 0) return 'réinit.'
  const minutes = Math.floor(remaining / 60_000)
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  if (days > 0) return `${days} j ${hours} h`
  if (hours > 0) return `${hours} h ${String(minutes % 60).padStart(2, '0')}`
  return `${minutes} min`
}

/**
 * Severity of a consumption level.
 *
 * Thresholds are deliberately late: the bar is ambient, and colouring it at 50 %
 * would make it noise the user learns to ignore, which is worse than no bar.
 */
export function quotaTone(utilization: number | null): QuotaTone {
  if (utilization === null) return 'unknown'
  if (utilization >= 90) return 'critical'
  if (utilization >= 75) return 'warn'
  return 'ok'
}

export function formatUtilization(utilization: number | null): string {
  return utilization === null ? '—' : `${utilization} %`
}

/** How long ago a reading was taken, for the tooltip on a stale snapshot. */
export function formatAge(fetchedAt: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - fetchedAt) / 1000))
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} h`
}

/**
 * Short name for a window, from its own length.
 *
 * Deliberately the *duration* and not a role name. "session" and "semaine"
 * were fine while one provider declared exactly two fixed windows; with a
 * second provider that picks its own, the only label that cannot go stale is
 * the one the provider hands us. Falls back to the position-free "—" rather
 * than guessing.
 */
export function formatWindowLabel(windowSeconds: number | undefined): string {
  if (!windowSeconds || !Number.isFinite(windowSeconds) || windowSeconds <= 0) return '—'
  const hours = Math.round(windowSeconds / 3600)
  if (hours < 48) return `${hours} h`
  return `${Math.round(hours / 24)} j`
}
