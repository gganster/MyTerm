/**
 * Claude usage quota: shape and the pure logic around it.
 *
 * Two windows are surfaced, the two the user actually watches: the rolling
 * 5-hour session and the rolling 7-day week. Everything here is pure so the
 * main process (which parses the API response) and the renderer (which renders
 * it) agree on a single set of rules, and so both are testable without Electron.
 */

/** One rate-limit window as the status bar needs it. */
export interface QuotaWindow {
  /** Percentage consumed, 0-100. `null` means "unknown", never "zero". */
  utilization: number | null
  /** Epoch ms at which the window rolls over, or `null` if the API omitted it. */
  resetsAt: number | null
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
export function normaliseWindow(utilizationRaw: unknown, resetsAtRaw: unknown): QuotaWindow {
  const resetsAt = toEpochMs(resetsAtRaw)
  // An allowlist, not a null check. `Number` coerces `true`, `[]` and `''` to a
  // number without complaining, and every one of them would land on 0 — a
  // full-quota bar drawn for a field the API left blank, which is the one lie
  // this type exists to prevent.
  const isNumeric = typeof utilizationRaw === 'number' || typeof utilizationRaw === 'string'
  if (!isNumeric || (typeof utilizationRaw === 'string' && utilizationRaw.trim() === '')) {
    return { utilization: null, resetsAt }
  }
  const numeric = Number(utilizationRaw)
  if (!Number.isFinite(numeric)) return { utilization: null, resetsAt }
  return { utilization: Math.max(0, Math.min(100, Math.round(numeric))), resetsAt }
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
