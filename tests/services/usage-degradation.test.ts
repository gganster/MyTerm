import { describe, expect, it } from 'vitest'
import { snapshotAfterFailure } from '../../src/main/services/usage-poller'
import type { UsageSnapshot } from '@shared/ipc-contract'

const NOW = Date.parse('2026-08-22T04:00:00Z')

function good(fetchedAt: number): UsageSnapshot {
  return {
    ok: true,
    stale: false,
    fetchedAt,
    session: { utilization: 40, resetsAt: NOW + 3 * 3_600_000 },
    week: { utilization: 59, resetsAt: NOW + 30 * 3_600_000 },
  }
}

describe('snapshotAfterFailure', () => {
  it('reports unavailable when no reading was ever obtained', () => {
    const snapshot = snapshotAfterFailure(null, 'no-credentials', NOW)
    expect(snapshot.ok).toBe(false)
    expect(snapshot.error).toBe('no-credentials')
    expect(snapshot.session.utilization).toBeNull()
    expect(snapshot.week.utilization).toBeNull()
  })

  // A dropped request must not blank a number that is still essentially true.
  it('keeps a recent reading and marks it stale', () => {
    const snapshot = snapshotAfterFailure(good(NOW - 3 * 60_000), 'network', NOW)
    expect(snapshot.ok).toBe(true)
    expect(snapshot.stale).toBe(true)
    expect(snapshot.error).toBe('network')
    expect(snapshot.session.utilization).toBe(40)
    expect(snapshot.week.utilization).toBe(59)
  })

  it('keeps the instant the values were measured, not the instant of the failure', () => {
    const measuredAt = NOW - 3 * 60_000
    expect(snapshotAfterFailure(good(measuredAt), 'network', NOW).fetchedAt).toBe(measuredAt)
  })

  it('gives up once the reading is older than the tolerance', () => {
    expect(snapshotAfterFailure(good(NOW - 14 * 60_000), 'http-429', NOW).ok).toBe(true)
    const expired = snapshotAfterFailure(good(NOW - 15 * 60_000), 'http-429', NOW)
    expect(expired.ok).toBe(false)
    expect(expired.stale).toBe(false)
    expect(expired.session.utilization).toBeNull()
  })

  it('does not mistake an already-stale reading for a fresh baseline', () => {
    const stale = snapshotAfterFailure(good(NOW - 3 * 60_000), 'network', NOW)
    // Ten minutes later the same underlying reading is 13 min old: still inside
    // tolerance, and still dated from when it was actually measured.
    const later = snapshotAfterFailure(stale, 'network', NOW + 10 * 60_000)
    expect(later.ok).toBe(true)
    expect(later.fetchedAt).toBe(stale.fetchedAt)
    // Five minutes further on it is past tolerance and must go.
    expect(snapshotAfterFailure(stale, 'network', NOW + 15 * 60_000).ok).toBe(false)
  })
})
