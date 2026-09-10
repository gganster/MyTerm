import { describe, expect, it } from 'vitest'
import { isTokenExpired, parseClaudePayload } from '../../src/main/services/usage-parse'

/**
 * The two decisions that turn a raw HTTP answer into "we know the quota" or
 * "we do not". Both used to live inside the fetch, where nothing could reach
 * them without a network; both are the kind of failure that is silent when
 * wrong, which is exactly the kind ARCHI § Tests says to cover.
 */

const NOW = Date.parse('2026-08-22T04:00:00Z')

describe('parseClaudePayload', () => {
  it('reads the payload the endpoint actually returns', () => {
    const windows = parseClaudePayload({
      five_hour: { utilization: 40.0, resets_at: '2026-08-22T05:30:00.451745+00:00' },
      seven_day: { utilization: 59.0, resets_at: '2026-08-23T13:00:00.451766+00:00' },
      seven_day_opus: null,
    })
    expect(windows).not.toBeNull()
    expect(windows!.session.utilization).toBe(40)
    expect(windows!.week.utilization).toBe(59)
    expect(windows!.session.resetsAt).toBe(Date.parse('2026-08-22T05:30:00.451Z'))
  })

  // The bug this guard exists for: a 200 that parses as JSON but says nothing
  // we understand must be a failure, not a quota that happens to be blank.
  it('returns null when neither window can be read', () => {
    expect(parseClaudePayload({})).toBeNull()
    expect(parseClaudePayload(null)).toBeNull()
    expect(parseClaudePayload('ok')).toBeNull()
    expect(parseClaudePayload({ session: { utilization: 40 } })).toBeNull()
    expect(parseClaudePayload({ five_hour: {}, seven_day: {} })).toBeNull()
  })

  // An account without a weekly window is a real answer, not a broken one.
  it('accepts a payload where only one window carries a value', () => {
    const windows = parseClaudePayload({ five_hour: { utilization: 12 }, seven_day: null })
    expect(windows).not.toBeNull()
    expect(windows!.session.utilization).toBe(12)
    expect(windows!.week.utilization).toBeNull()
  })

  it('treats a zero quota as a real reading, not as an absent one', () => {
    const windows = parseClaudePayload({ five_hour: { utilization: 0 }, seven_day: null })
    expect(windows?.session.utilization).toBe(0)
  })
})

describe('isTokenExpired', () => {
  it('recognises a past expiry in milliseconds', () => {
    expect(isTokenExpired(NOW - 1, NOW)).toBe(true)
    expect(isTokenExpired(NOW + 60_000, NOW)).toBe(false)
  })

  // Compared raw, a seconds-precision value reads as 1970 and pins the bar to
  // "session expirée" on a perfectly valid token.
  it('normalises a seconds-precision expiry instead of reading it as 1970', () => {
    expect(isTokenExpired(Math.floor((NOW + 3_600_000) / 1000), NOW)).toBe(false)
    expect(isTokenExpired(Math.floor((NOW - 3_600_000) / 1000), NOW)).toBe(true)
  })

  it('does not call an absent or unreadable expiry an expiry', () => {
    expect(isTokenExpired(undefined, NOW)).toBe(false)
    expect(isTokenExpired(null, NOW)).toBe(false)
    expect(isTokenExpired('jamais', NOW)).toBe(false)
    expect(isTokenExpired({}, NOW)).toBe(false)
  })
})
