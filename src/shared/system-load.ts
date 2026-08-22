/**
 * Machine load: shape and the pure arithmetic behind it.
 *
 * Deliberately the two numbers a developer glances at before launching a build
 * — CPU and RAM — and nothing else. No per-process breakdown, no history, no
 * GPU: the status bar is ambient, and a chart there would compete with the
 * terminals for attention (PRD § discrétion).
 */

/** The subset of `os.cpus()[i].times` we need. Shaped like Node's, not imported: this file stays platform-free. */
export interface CpuTimes {
  user: number
  nice: number
  sys: number
  idle: number
  irq: number
}

export interface SystemLoad {
  /** Machine-wide CPU busy percentage, 0-100. `null` until two samples exist. */
  cpu: number | null
  /** Bytes of physical memory in use (total - free). */
  memoryUsed: number
  /** Bytes of physical memory installed. */
  memoryTotal: number
}

function total(times: CpuTimes): number {
  return times.user + times.nice + times.sys + times.idle + times.irq
}

/**
 * CPU busy percentage between two `os.cpus()` samples.
 *
 * Cumulative counters, so a *rate* only exists between two readings — the first
 * tick has nothing to compare against and legitimately returns `null`. Returns
 * `null` too when the samples are unusable: a zero-length interval (two reads
 * inside the same clock tick) would divide by zero, and a changed core count
 * (a VM resizing, a container limit moving) makes the two samples incomparable.
 */
export function cpuBusyPercent(previous: CpuTimes[] | null, current: CpuTimes[]): number | null {
  if (!previous || previous.length === 0 || previous.length !== current.length) return null

  let busyDelta = 0
  let totalDelta = 0
  for (let index = 0; index < current.length; index += 1) {
    const before = previous[index]
    const after = current[index]
    if (!before || !after) return null
    const elapsed = total(after) - total(before)
    // Counters only ever climb; a negative delta means the sample is bogus.
    if (elapsed <= 0) continue
    totalDelta += elapsed
    busyDelta += elapsed - (after.idle - before.idle)
  }

  if (totalDelta <= 0) return null
  const percent = (busyDelta / totalDelta) * 100
  return Math.max(0, Math.min(100, Math.round(percent)))
}

/** Share of physical memory in use, 0-100. */
export function memoryPercent(used: number, total_: number): number | null {
  if (!Number.isFinite(used) || !Number.isFinite(total_) || total_ <= 0) return null
  return Math.max(0, Math.min(100, Math.round((used / total_) * 100)))
}

/** Bytes as gibibytes with one decimal — the unit Windows itself reports. */
export function formatGiB(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  return `${(bytes / 1024 ** 3).toFixed(1)} Gio`
}
