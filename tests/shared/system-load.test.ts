import { describe, expect, it } from 'vitest'
import { cpuBusyPercent, formatGiB, memoryPercent } from '@shared/system-load'
import type { CpuTimes } from '@shared/system-load'

function core(user: number, idle: number, sys = 0): CpuTimes {
  return { user, nice: 0, sys, idle, irq: 0 }
}

describe('cpuBusyPercent', () => {
  it('is the busy share of the interval, not of the cumulative counters', () => {
    // Counters started long ago (mostly idle), but this interval was 100 % busy.
    const previous = [core(1000, 9000)]
    const current = [core(1100, 9000)]
    expect(cpuBusyPercent(previous, current)).toBe(100)
  })

  it('splits busy and idle time across the interval', () => {
    expect(cpuBusyPercent([core(0, 0)], [core(25, 75)])).toBe(25)
    expect(cpuBusyPercent([core(0, 0)], [core(10, 70, 20)])).toBe(30)
  })

  // `core()` zeroes nice and irq, so nothing above would notice either being
  // dropped from the total — and Windows does populate irq.
  it('counts every field of the tick counter, not just user and sys', () => {
    const zero = { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 }
    expect(cpuBusyPercent([zero], [{ user: 10, nice: 10, sys: 10, idle: 60, irq: 10 }])).toBe(40)
    // Idle is the only field that is not busy: 90 of 100 ticks were work.
    expect(cpuBusyPercent([zero], [{ user: 30, nice: 20, sys: 30, idle: 10, irq: 10 }])).toBe(90)
  })

  it('averages over every core weighted by its own elapsed ticks', () => {
    const previous = [core(0, 0), core(0, 0)]
    const current = [core(100, 0), core(0, 100)]
    expect(cpuBusyPercent(previous, current)).toBe(50)
  })

  // Cumulative counters mean the first tick has nothing to subtract from.
  it('returns null until a second sample exists', () => {
    expect(cpuBusyPercent(null, [core(10, 90)])).toBeNull()
    expect(cpuBusyPercent([], [core(10, 90)])).toBeNull()
  })

  it('returns null when the interval carries no ticks at all', () => {
    const sample = [core(10, 90)]
    expect(cpuBusyPercent(sample, sample)).toBeNull()
  })

  it('returns null when the core count changed, making the samples incomparable', () => {
    expect(cpuBusyPercent([core(0, 0)], [core(10, 90), core(10, 90)])).toBeNull()
    // The dangerous direction: without the length check this one silently
    // reports the first core's load as the whole machine's.
    expect(cpuBusyPercent([core(0, 0), core(0, 0)], [core(10, 90)])).toBeNull()
  })

  it('ignores a core whose counters went backwards instead of reporting a negative load', () => {
    const previous = [core(1000, 1000), core(0, 0)]
    const current = [core(0, 0), core(30, 70)]
    expect(cpuBusyPercent(previous, current)).toBe(30)
  })

  // An idle counter that rewound on its own would compute above 100 %.
  it('clamps to 100 rather than reporting an impossible load', () => {
    expect(cpuBusyPercent([core(0, 50)], [core(100, 20)])).toBe(100)
  })
})

describe('memoryPercent', () => {
  it('rounds the used share', () => {
    expect(memoryPercent(8 * 1024 ** 3, 16 * 1024 ** 3)).toBe(50)
    expect(memoryPercent(1, 3)).toBe(33)
  })

  it('refuses to divide by an absent total', () => {
    expect(memoryPercent(1000, 0)).toBeNull()
    expect(memoryPercent(1000, Number.NaN)).toBeNull()
  })

  it('clamps rather than reporting more than the machine has', () => {
    expect(memoryPercent(20, 10)).toBe(100)
  })
})

describe('formatGiB', () => {
  it('uses the unit Windows itself reports', () => {
    expect(formatGiB(16 * 1024 ** 3)).toBe('16.0 Gio')
    expect(formatGiB(1_500_000_000)).toBe('1.4 Gio')
  })

  it('has a placeholder for a value it cannot render', () => {
    expect(formatGiB(Number.NaN)).toBe('—')
    expect(formatGiB(-1)).toBe('—')
  })
})
