import { describe, expect, it } from 'vitest'
import {
  formatAge,
  formatCountdown,
  formatUtilization,
  normaliseWindow,
  quotaTone,
  toEpochMs,
} from '@shared/quota'

describe('toEpochMs', () => {
  it('parses the ISO strings the usage endpoint returns', () => {
    expect(toEpochMs('2026-08-22T05:30:00.451745+00:00')).toBe(
      Date.parse('2026-08-22T05:30:00.451Z'),
    )
  })

  it('promotes second-precision timestamps to milliseconds', () => {
    expect(toEpochMs(1_700_000_000)).toBe(1_700_000_000_000)
    expect(toEpochMs(1_700_000_000_000)).toBe(1_700_000_000_000)
  })

  it('returns null for anything unusable rather than an Invalid Date', () => {
    expect(toEpochMs(null)).toBeNull()
    expect(toEpochMs(undefined)).toBeNull()
    expect(toEpochMs('bientôt')).toBeNull()
    expect(toEpochMs(Number.NaN)).toBeNull()
    expect(toEpochMs({})).toBeNull()
  })
})

describe('normaliseWindow', () => {
  it('rounds and keeps the reset instant', () => {
    const window = normaliseWindow(40.4, '2026-08-22T05:30:00Z')
    expect(window.utilization).toBe(40)
    expect(window.resetsAt).toBe(Date.parse('2026-08-22T05:30:00Z'))
  })

  it('clamps out-of-range values from the API', () => {
    expect(normaliseWindow(140, null).utilization).toBe(100)
    expect(normaliseWindow(-5, null).utilization).toBe(0)
  })

  // The whole point of the null: a bar at 0 % reads as "quota intact", which is
  // the opposite of what a missing value means.
  it('yields null, never zero, when the value is missing or nonsense', () => {
    expect(normaliseWindow(undefined, null).utilization).toBeNull()
    expect(normaliseWindow(null, null).utilization).toBeNull()
    expect(normaliseWindow('beaucoup', null).utilization).toBeNull()
    expect(normaliseWindow(true, null).utilization).toBeNull()
    expect(normaliseWindow(Number.NaN, null).utilization).toBeNull()
    // Number('') is 0, which would draw a full-quota bar for a blank field.
    expect(normaliseWindow('', null).utilization).toBeNull()
    expect(normaliseWindow('  ', null).utilization).toBeNull()
    expect(normaliseWindow([], null).utilization).toBeNull()
  })

  it('accepts a numeric string, which JSON payloads do produce', () => {
    expect(normaliseWindow('59', null).utilization).toBe(59)
  })

  it('keeps the reset instant even when the utilisation is unusable', () => {
    const window = normaliseWindow(undefined, '2026-08-23T13:00:00Z')
    expect(window.utilization).toBeNull()
    expect(window.resetsAt).toBe(Date.parse('2026-08-23T13:00:00Z'))
  })
})

describe('formatCountdown', () => {
  const now = Date.parse('2026-08-22T04:00:00Z')
  const inMinutes = (minutes: number): number => now + minutes * 60_000

  it('shows minutes under the hour', () => {
    expect(formatCountdown(inMinutes(42), now)).toBe('42 min')
  })

  it('shows hours and zero-padded minutes under the day', () => {
    expect(formatCountdown(inMinutes(90), now)).toBe('1 h 30')
    expect(formatCountdown(inMinutes(65), now)).toBe('1 h 05')
  })

  it('drops to days and hours past 24 h', () => {
    expect(formatCountdown(inMinutes(1440 + 420), now)).toBe('1 j 7 h')
  })

  it('says the window has rolled over instead of counting backwards', () => {
    expect(formatCountdown(inMinutes(-1), now)).toBe('réinit.')
    expect(formatCountdown(now, now)).toBe('réinit.')
  })

  it('has a placeholder for a missing reset instant', () => {
    expect(formatCountdown(null, now)).toBe('—')
  })
})

describe('quotaTone', () => {
  it('stays neutral until the quota actually matters', () => {
    expect(quotaTone(0)).toBe('ok')
    expect(quotaTone(74)).toBe('ok')
  })

  it('warns from 75 % and escalates at 90 %', () => {
    expect(quotaTone(75)).toBe('warn')
    expect(quotaTone(89)).toBe('warn')
    expect(quotaTone(90)).toBe('critical')
    expect(quotaTone(100)).toBe('critical')
  })

  it('distinguishes unknown from empty', () => {
    expect(quotaTone(null)).toBe('unknown')
  })
})

describe('formatUtilization', () => {
  it('renders a percentage, and a dash when there is nothing to render', () => {
    expect(formatUtilization(40)).toBe('40 %')
    expect(formatUtilization(0)).toBe('0 %')
    expect(formatUtilization(null)).toBe('—')
  })
})

describe('formatAge', () => {
  const now = Date.parse('2026-08-22T04:00:00Z')

  it('reports seconds, then minutes, then hours', () => {
    expect(formatAge(now - 30_000, now)).toBe('30 s')
    expect(formatAge(now - 5 * 60_000, now)).toBe('5 min')
    expect(formatAge(now - 2 * 3_600_000, now)).toBe('2 h')
  })

  it('rounds to the nearest second below the minute', () => {
    expect(formatAge(now - 59_400, now)).toBe('59 s')
    expect(formatAge(now - 60_000, now)).toBe('1 min')
  })

  // A clock that jumped backwards must not produce "-3 min" in a tooltip.
  it('clamps a reading dated in the future to zero', () => {
    expect(formatAge(now + 60_000, now)).toBe('0 s')
  })
})
