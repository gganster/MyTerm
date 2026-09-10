import { normaliseWindow, toEpochMs } from '@shared/quota'
import type { QuotaWindow } from '@shared/quota'

/**
 * Everything the two quota readers decide *without* the network.
 *
 * Split out for the same reason `trust-hash` was (ARCHI § Tests): the readers
 * next door reach Electron's network stack and a credentials file, so nothing
 * in them can be exercised without mocking both. What is worth testing is
 * here instead — which window is which, whether a token has expired, and
 * whether a 200 actually said anything — and it is pure.
 */

export interface QuotaWindows {
  session: QuotaWindow
  week: QuotaWindow
}

const EMPTY: QuotaWindow = { utilization: null, resetsAt: null }

/**
 * The two windows Anthropic declares, in seconds.
 *
 * Hard-coded because the payload names them (`five_hour`, `seven_day`) instead
 * of measuring them. The label over each gauge is drawn from these, so both
 * providers are rendered by one code path.
 */
export const FIVE_HOUR_SECONDS = 5 * 3600
export const SEVEN_DAY_SECONDS = 7 * 24 * 3600

/**
 * Longest Codex window still read as "the session one".
 *
 * Codex names its windows `primary` and `secondary`, and the order is not the
 * meaning: the account this was built against declares a 7-day *primary* and
 * no secondary at all. Classifying by declared length is the only mapping that
 * survives that — a day sits comfortably above any session window and
 * comfortably below any weekly one.
 */
const SESSION_MAX_SECONDS = 24 * 3600

/**
 * Whether a Claude credentials `expiresAt` is in the past.
 *
 * Pure so the unit ambiguity is pinned by a test: it goes through `toEpochMs`,
 * because a value written in epoch *seconds* compared raw would read as
 * decades past and pin the bar to "session expirée" on a valid token. An
 * absent or unparsable value is not an expiry — we simply do not know.
 */
export function isTokenExpired(expiresAtRaw: unknown, now: number): boolean {
  const expiresAt = toEpochMs(expiresAtRaw)
  return expiresAt !== null && expiresAt < now
}

/**
 * The two quota windows of an Anthropic usage payload, or `null`.
 *
 * A 200 whose body we cannot parse is a failure, not an empty quota, and that
 * distinction is worth a test that does not need a network: without it a
 * renamed field would give `ok: true` with two blank windows, cache that as
 * the last good reading, never count a failure and never back off.
 */
export function parseClaudePayload(data: unknown): QuotaWindows | null {
  const payload = (data ?? {}) as {
    five_hour?: { utilization?: unknown; resets_at?: unknown }
    seven_day?: { utilization?: unknown; resets_at?: unknown }
  }
  const session = normaliseWindow(
    payload.five_hour?.utilization,
    payload.five_hour?.resets_at,
    FIVE_HOUR_SECONDS,
  )
  const week = normaliseWindow(
    payload.seven_day?.utilization,
    payload.seven_day?.resets_at,
    SEVEN_DAY_SECONDS,
  )
  // Not "one window missing": the endpoint legitimately omits a window the
  // account does not have. Both blank means we did not understand the answer.
  if (session.utilization === null && week.utilization === null) return null
  return { session, week }
}

interface RawCodexWindow {
  used_percent?: unknown
  limit_window_seconds?: unknown
  reset_at?: unknown
}

/**
 * The two quota windows of a Codex usage payload, or `null`.
 *
 * The primary/secondary mapping is the part that is easy to get backwards, and
 * getting it backwards labels a weekly figure as a session one — a number the
 * user would read as five times worse than it is.
 */
export function parseCodexPayload(data: unknown): QuotaWindows | null {
  const limit = (
    (data ?? {}) as {
      rate_limit?: { primary_window?: RawCodexWindow; secondary_window?: RawCodexWindow }
    }
  ).rate_limit
  const raw = [limit?.primary_window, limit?.secondary_window].filter(
    (window): window is RawCodexWindow => Boolean(window),
  )

  let session = EMPTY
  let week = EMPTY

  for (const window of raw) {
    const seconds = window.limit_window_seconds
    const parsed = normaliseWindow(window.used_percent, window.reset_at, seconds)
    if (parsed.utilization === null) continue
    // A window that does not say how long it is keeps the position it arrived
    // in, which is the API's own ordering: short first.
    const isSession =
      typeof seconds === 'number' ? seconds <= SESSION_MAX_SECONDS : session === EMPTY
    if (isSession) session = parsed
    else week = parsed
  }

  if (session.utilization === null && week.utilization === null) return null
  return { session, week }
}

/**
 * Whether a Codex access token has already expired, from its own `exp` claim.
 *
 * `auth.json` records only `last_refresh`, so unlike the Claude credentials
 * there is no expiry field to read: the claim inside the token is the only
 * source. Decoded, never verified — we are reading the user's own token to
 * decide what message to show, not authenticating anything.
 *
 * Conservative on purpose, and this is the whole reason it is a named,
 * tested function: anything it cannot parse is "we do not know", never
 * "expired". Guessing the other way would pin a working account to a
 * permanent "session expirée" and hide a quota that was there all along.
 */
export function isCodexTokenExpired(token: string, now: number): boolean {
  const payload = token.split('.')[1]
  if (!payload) return false
  let claims: unknown
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return false
  }
  const exp = (claims as { exp?: unknown } | null)?.exp
  if (typeof exp !== 'number' || !Number.isFinite(exp)) return false
  // `exp` is epoch *seconds* by spec — compared raw against a millisecond clock
  // it would read as 1970 and call every live token expired.
  return exp * 1000 < now
}
