import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { normaliseWindow, toEpochMs } from '@shared/quota'
import type { QuotaWindow } from '@shared/quota'
import type { UsageSnapshot } from '@shared/ipc-contract'

/**
 * Claude usage quota, read from the same OAuth endpoint that `/usage` shows.
 *
 * Three rules, and they are the whole design:
 *
 * 1. **The token never leaves this file.** It is read from the Claude Code
 *    credentials file, put in one `Authorization` header, and dropped. Nothing
 *    derived from the file — not its content, not its absolute path — is ever
 *    logged or returned, because the returned snapshot crosses the IPC boundary
 *    into the renderer (ARCHI § Sécurité).
 * 2. **Failures are coarse codes**, never exception messages. Node puts the
 *    full path in an `ENOENT` message, and a rejected `fetch` can quote a URL
 *    with query parameters. Both would end up in the renderer.
 * 3. **Failures are silent and non-fatal.** No credentials, no network, an
 *    expired token: the status bar shows "—" and the app carries on. This is an
 *    ambient indicator, not a feature anyone is blocked on.
 *
 * Only the live endpoint is consulted. `claude-usage-overlay` additionally
 * falls back to that user's personal statusline cache files; those paths exist
 * on exactly one machine, so here they would be dead code for every other user.
 */

const CREDENTIALS_FILE = join(homedir(), '.claude', '.credentials.json')
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'

/**
 * The header Claude Code sends; the endpoint is version-gated on it.
 *
 * A silent expiry date on this feature: the day the gate moves past this
 * string, the bar becomes a permanent `http-4xx` with nothing pointing at the
 * cause. If the status bar starts reporting a 4xx that outlives a token
 * refresh, suspect this constant before anything else.
 */
const CLIENT_VERSION = '2.1.201'
const FETCH_TIMEOUT_MS = 10_000

/**
 * Base poll interval.
 *
 * Two minutes, not one. This endpoint is shared: Claude Code's own statusline
 * and any usage overlay the user runs hit it from the same account, and it
 * answers 429 when they add up — observed during this feature's runtime proof.
 * A quota percentage moves by single digits over two minutes; a rate-limited
 * bar is worth far less than a slightly older reading.
 */
const POLL_INTERVAL_MS = 120_000
/** The endpoint answers in well under a second; a first read at 2 s just fills the bar. */
const FIRST_POLL_DELAY_MS = 2_000
const MAX_BACKOFF_MS = 15 * 60_000
/** A rate limit is about pressure, not breakage: back off hard on the first one. */
const RATE_LIMIT_BACKOFF_MS = 5 * 60_000

/**
 * How long a successful reading stays on screen once polling starts failing.
 *
 * Beyond this the bar admits it does not know. Within it, showing the last
 * reading marked stale beats blanking the bar over one dropped request: the
 * quota it reported has not moved much, and a bar that flickers to
 * "indisponible" every time a Wi-Fi hiccup lands is a bar people stop reading.
 */
const STALE_TOLERANCE_MS = 15 * 60_000

interface OAuthCredentials {
  accessToken?: unknown
  expiresAt?: unknown
}

/** Thrown with a coarse code as its message; see rule 2 above. */
class UsageError extends Error {}

/**
 * Delay before the next attempt.
 *
 * Exported for its own test: this is the part that decides how hard the app
 * leans on a shared endpoint, and getting it wrong is invisible until someone
 * is rate-limited.
 */
export function nextPollDelayMs(consecutiveFailures: number, lastError?: string): number {
  if (consecutiveFailures === 0) return POLL_INTERVAL_MS
  const base = lastError === 'http-429' ? RATE_LIMIT_BACKOFF_MS : POLL_INTERVAL_MS
  // 1 failure keeps `base`, then doubles: the first miss is usually a blip.
  const backoff = base * 2 ** (consecutiveFailures - 1)
  return Math.min(backoff, MAX_BACKOFF_MS)
}

function unavailable(error: string, now: number): UsageSnapshot {
  return {
    ok: false,
    stale: false,
    fetchedAt: now,
    fiveHour: { utilization: null, resetsAt: null },
    sevenDay: { utilization: null, resetsAt: null },
    error,
  }
}

/**
 * What to show once a poll has failed.
 *
 * Pure, and exported for its own test: this is the rule that decides whether
 * the user keeps seeing a number or watches the bar go blank, and it has no
 * business being reachable only through a network call.
 */
export function snapshotAfterFailure(
  lastGood: UsageSnapshot | null,
  code: string,
  now: number,
): UsageSnapshot {
  if (!lastGood || now - lastGood.fetchedAt >= STALE_TOLERANCE_MS) return unavailable(code, now)
  // fetchedAt deliberately kept: it is when these numbers were true, and the
  // tooltip needs that, not the time we last failed to refresh them.
  return { ...lastGood, stale: true, error: code }
}

/**
 * Whether a credentials `expiresAt` is in the past.
 *
 * Pure and exported so the unit ambiguity is pinned by a test: it goes through
 * `toEpochMs`, because a value written in epoch *seconds* compared raw would
 * read as decades past and pin the bar to "session expirée" on a valid token.
 * An absent or unparsable value is not an expiry — we simply do not know.
 */
export function isTokenExpired(expiresAtRaw: unknown, now: number): boolean {
  const expiresAt = toEpochMs(expiresAtRaw)
  return expiresAt !== null && expiresAt < now
}

/**
 * The two quota windows of a usage payload, or `null` if neither can be read.
 *
 * Pure and exported for the same reason: a 200 whose body we cannot parse is a
 * failure, not an empty quota, and that distinction is worth a test that does
 * not need a network.
 */
export function parseUsagePayload(data: unknown): { fiveHour: QuotaWindow; sevenDay: QuotaWindow } | null {
  const payload = (data ?? {}) as {
    five_hour?: { utilization?: unknown; resets_at?: unknown }
    seven_day?: { utilization?: unknown; resets_at?: unknown }
  }
  const fiveHour = normaliseWindow(payload.five_hour?.utilization, payload.five_hour?.resets_at)
  const sevenDay = normaliseWindow(payload.seven_day?.utilization, payload.seven_day?.resets_at)
  // Not "one window missing": the endpoint legitimately omits a window the
  // account does not have. Both blank means we did not understand the answer.
  if (fiveHour.utilization === null && sevenDay.utilization === null) return null
  return { fiveHour, sevenDay }
}

async function readAccessToken(): Promise<string> {
  let raw: string
  try {
    raw = await readFile(CREDENTIALS_FILE, 'utf8')
  } catch {
    // Deliberately not `error.code`: ENOENT and EACCES are the same story for
    // the user ("no Claude Code session here") and the message carries the path.
    throw new UsageError('no-credentials')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new UsageError('credentials-parse')
  }

  const oauth = (parsed as { claudeAiOauth?: OAuthCredentials } | null)?.claudeAiOauth
  const token = oauth?.accessToken
  if (typeof token !== 'string' || token.length === 0) throw new UsageError('no-token')
  // Claude Code refreshes the token on its next run; nothing for us to do but say so.
  if (isTokenExpired(oauth?.expiresAt, Date.now())) throw new UsageError('token-expired')
  return token
}

async function fetchSnapshot(): Promise<UsageSnapshot> {
  const token = await readAccessToken()

  let response: Response
  try {
    response = await fetch(USAGE_URL, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${token}`,
        'anthropic-beta': 'oauth-2025-04-20',
        Accept: 'application/json',
        'User-Agent': `claude-code/${CLIENT_VERSION}`,
      },
    })
  } catch {
    // Offline, DNS, proxy, timeout — all one story, and the raw message would
    // quote the URL back into the renderer.
    throw new UsageError('network')
  }

  if (!response.ok) throw new UsageError(`http-${response.status}`)

  let data: unknown
  try {
    data = await response.json()
  } catch {
    throw new UsageError('parse')
  }

  // A 200 whose body we cannot read is a failure, not an empty quota. Without
  // this, a renamed field would give `ok: true` with two blank windows: the bar
  // would show "— / —" with no explanation, cache it as the last good reading,
  // never count a failure, and never back off. Silent, and indistinguishable
  // from a real answer — exactly what rules 2 and 3 above exist to prevent.
  const windows = parseUsagePayload(data)
  if (!windows) throw new UsageError('shape')

  return { ok: true, stale: false, fetchedAt: Date.now(), ...windows }
}

let latest: UsageSnapshot = unavailable('pending', Date.now())
let lastGood: UsageSnapshot | null = null
let failures = 0
let timer: NodeJS.Timeout | null = null
let running = false
/** Incremented on every init(); a poll from an older generation must not reschedule. */
let epoch = 0

/** The last snapshot, for a renderer that mounted between two pushes. */
export function getUsage(): UsageSnapshot {
  return latest
}

/**
 * Starts polling. `onUpdate` is called on every completed poll, success or not,
 * so the bar can move to "indisponible" when the credentials go away.
 *
 * A self-rescheduling timeout rather than an interval: the delay depends on the
 * previous outcome, and an interval cannot slow down.
 */
export function initUsagePolling(onUpdate: (snapshot: UsageSnapshot) => void): void {
  if (running) return
  running = true
  failures = 0

  // A poll already awaiting a response survives dispose(); if init() runs before
  // it lands, `running` is true again and it would schedule a *second* chain
  // that dispose() can no longer reach — two chains polling a rate-limited
  // endpoint. The generation stamp makes an orphaned poll retire itself.
  const generation = (epoch += 1)

  const poll = async (): Promise<void> => {
    try {
      latest = await fetchSnapshot()
      lastGood = latest
      failures = 0
    } catch (error) {
      failures += 1
      const code = error instanceof UsageError ? error.message : 'unknown'
      latest = snapshotAfterFailure(lastGood, code, Date.now())
    }

    if (generation !== epoch) return
    onUpdate(latest)
    if (!running) return
    timer = setTimeout(() => void poll(), nextPollDelayMs(failures, latest.error))
  }

  timer = setTimeout(() => void poll(), FIRST_POLL_DELAY_MS)
}

export function disposeUsagePolling(): void {
  running = false
  // Retires any poll still awaiting a response, so it cannot reschedule itself.
  epoch += 1
  if (timer) clearTimeout(timer)
  timer = null
}
