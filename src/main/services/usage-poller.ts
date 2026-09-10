import type { QuotaWindow } from '@shared/quota'
import type { UsageSnapshot } from '@shared/ipc-contract'

/**
 * The polling machinery behind every quota bar, with no provider in it.
 *
 * Two agents are tracked and a third is plausible, so what varies — the
 * credentials file, the endpoint, the payload shape — lives in one small
 * module per provider, and everything that is hard to get right lives here
 * once: how fast to poll a shared endpoint, how far to back off after a
 * failure, and how long a good reading may stay on screen after one.
 *
 * Instances, not module state. The previous version kept `latest`, `failures`
 * and the timer at module scope, which was fine for one provider and would
 * have become two interleaved chains sharing one backoff counter — a Codex
 * outage would have slowed the Claude bar down with it.
 */

/** Thrown with a coarse code as its message; never an exception text. */
export class UsageError extends Error {}

/**
 * Base poll interval.
 *
 * Two minutes, not one. These endpoints are shared: each vendor's own CLI and
 * any usage overlay the user runs hit them from the same account, and Anthropic
 * answers 429 when they add up — observed during this feature's runtime proof.
 * A quota percentage moves by single digits over two minutes; a rate-limited
 * bar is worth far less than a slightly older reading.
 */
const POLL_INTERVAL_MS = 120_000
/** The endpoints answer in well under a second; a first read at 2 s just fills the bar. */
const FIRST_POLL_DELAY_MS = 2_000
const MAX_BACKOFF_MS = 15 * 60_000
/** A rate limit is about pressure, not breakage: back off hard on the first one. */
const RATE_LIMIT_BACKOFF_MS = 5 * 60_000

/**
 * Retry delay after one failure that is known to pass on its own.
 *
 * The Codex endpoint sits behind a bot-mitigation layer that challenges a
 * request now and then — `403` with an HTML body where the same call returned
 * JSON a second earlier, observed repeatedly while building this. Left on the
 * standard two-minute interval, one challenged request at launch means two
 * minutes of "Quota indisponible" on a bar that could have filled in seconds.
 * A dropped connection is the same story.
 *
 * Only the *first* failure gets this; a second means it was not a blip, and
 * the normal backoff takes over from there.
 */
const TRANSIENT_RETRY_MS = 20_000

/** Failures worth one quick retry: nothing here says the account is wrong. */
function isTransient(code: string | undefined): boolean {
  if (code === 'network' || code === 'http-403' || code === 'http-408') return true
  return /^http-5\d\d$/.test(code ?? '')
}

/**
 * How long a successful reading stays on screen once polling starts failing.
 *
 * Beyond this the bar admits it does not know. Within it, showing the last
 * reading marked stale beats blanking the bar over one dropped request: the
 * quota it reported has not moved much, and a bar that flickers to
 * "indisponible" every time a Wi-Fi hiccup lands is a bar people stop reading.
 */
const STALE_TOLERANCE_MS = 15 * 60_000

/**
 * Delay before the next attempt.
 *
 * Exported for its own test: this is the part that decides how hard the app
 * leans on a shared endpoint, and getting it wrong is invisible until someone
 * is rate-limited.
 */
export function nextPollDelayMs(consecutiveFailures: number, lastError?: string): number {
  if (consecutiveFailures === 0) return POLL_INTERVAL_MS
  if (consecutiveFailures === 1 && isTransient(lastError)) return TRANSIENT_RETRY_MS
  const base = lastError === 'http-429' ? RATE_LIMIT_BACKOFF_MS : POLL_INTERVAL_MS
  // 1 failure keeps `base`, then doubles: the first miss is usually a blip.
  const backoff = base * 2 ** (consecutiveFailures - 1)
  return Math.min(backoff, MAX_BACKOFF_MS)
}

export function unavailable(error: string, now: number): UsageSnapshot {
  return {
    ok: false,
    stale: false,
    fetchedAt: now,
    session: { utilization: null, resetsAt: null },
    week: { utilization: null, resetsAt: null },
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

/** What a provider module has to supply: the two windows, or a `UsageError`. */
export type WindowsFetcher = () => Promise<{ session: QuotaWindow; week: QuotaWindow }>

export interface UsagePoller {
  /** `onUpdate` fires after every completed poll, success or not. */
  start: (onUpdate: () => void) => void
  stop: () => void
  latest: () => UsageSnapshot
}

export function createUsagePoller(fetchWindows: WindowsFetcher): UsagePoller {
  let latest: UsageSnapshot = unavailable('pending', Date.now())
  let lastGood: UsageSnapshot | null = null
  let failures = 0
  let timer: NodeJS.Timeout | null = null
  let running = false
  /** Incremented on every start(); a poll from an older generation must not reschedule. */
  let epoch = 0

  return {
    latest: () => latest,

    /**
     * A self-rescheduling timeout rather than an interval: the delay depends on
     * the previous outcome, and an interval cannot slow down.
     */
    start: (onUpdate) => {
      if (running) return
      running = true
      failures = 0

      // A poll already awaiting a response survives stop(); if start() runs
      // before it lands, `running` is true again and it would schedule a
      // *second* chain that stop() can no longer reach — two chains polling a
      // rate-limited endpoint. The generation stamp makes an orphan retire.
      const generation = (epoch += 1)

      const poll = async (): Promise<void> => {
        try {
          latest = { ok: true, stale: false, fetchedAt: Date.now(), ...(await fetchWindows()) }
          lastGood = latest
          failures = 0
        } catch (error) {
          failures += 1
          const code = error instanceof UsageError ? error.message : 'unknown'
          latest = snapshotAfterFailure(lastGood, code, Date.now())
        }

        if (generation !== epoch) return
        onUpdate()
        if (!running) return
        timer = setTimeout(() => void poll(), nextPollDelayMs(failures, latest.error))
      }

      timer = setTimeout(() => void poll(), FIRST_POLL_DELAY_MS)
    },

    stop: () => {
      running = false
      // Retires any poll still awaiting a response, so it cannot reschedule.
      epoch += 1
      if (timer) clearTimeout(timer)
      timer = null
    },
  }
}
