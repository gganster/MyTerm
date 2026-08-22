import { describe, expect, it } from 'vitest'
import { nextPollDelayMs } from '../../src/main/services/usage'

/**
 * The usage endpoint is shared with Claude Code's own statusline and with any
 * usage overlay the user runs. Polling it too hard earns a 429 for all of them,
 * which is exactly how this backoff came to exist (observed during runtime
 * proof). These are the numbers that keep MyTerm a polite client.
 */
describe('nextPollDelayMs', () => {
  const MINUTE = 60_000

  it('polls on the base interval while everything works', () => {
    expect(nextPollDelayMs(0)).toBe(2 * MINUTE)
  })

  it('does not punish a single blip', () => {
    expect(nextPollDelayMs(1, 'network')).toBe(2 * MINUTE)
  })

  it('doubles on each further consecutive failure', () => {
    expect(nextPollDelayMs(2, 'network')).toBe(4 * MINUTE)
    expect(nextPollDelayMs(3, 'network')).toBe(8 * MINUTE)
  })

  // A rate limit is not a blip: it means we are already asking too often.
  it('backs off hard from the very first rate limit', () => {
    expect(nextPollDelayMs(1, 'http-429')).toBe(5 * MINUTE)
    expect(nextPollDelayMs(2, 'http-429')).toBe(10 * MINUTE)
  })

  it('caps the backoff so the bar still recovers on its own', () => {
    expect(nextPollDelayMs(20, 'network')).toBe(15 * MINUTE)
    expect(nextPollDelayMs(20, 'http-429')).toBe(15 * MINUTE)
  })

  it('never returns a delay that would busy-loop the poller', () => {
    for (let failures = 0; failures <= 30; failures += 1) {
      expect(nextPollDelayMs(failures, 'unknown')).toBeGreaterThanOrEqual(MINUTE)
    }
  })
})
