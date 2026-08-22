import { cpus, freemem, totalmem } from 'node:os'
import { cpuBusyPercent } from '@shared/system-load'
import type { CpuTimes, SystemLoad } from '@shared/system-load'

/**
 * Machine-wide CPU and memory, sampled in the main process.
 *
 * `os.cpus()` exposes cumulative tick counters, so CPU load only exists as a
 * delta between two samples — which is why this is a stateful sampler and not
 * a function the renderer could call. The renderer has no `os` anyway: it is
 * sandboxed, and pushing two numbers over IPC is cheaper than the alternative.
 *
 * The arithmetic lives in `@shared/system-load` so it can be tested without a
 * machine under load; this file is only the clock and the Node bindings.
 */

const SAMPLE_INTERVAL_MS = 2_000

let previous: CpuTimes[] | null = null
let timer: NodeJS.Timeout | null = null
let latest: SystemLoad = { cpu: null, memoryUsed: 0, memoryTotal: 0 }

function sample(): SystemLoad {
  const current = cpus().map((core) => core.times)
  const cpu = cpuBusyPercent(previous, current)
  previous = current
  const memoryTotal = totalmem()
  return { cpu, memoryUsed: memoryTotal - freemem(), memoryTotal }
}

/** The last sample, for a renderer that mounted between two pushes. */
export function getSystemLoad(): SystemLoad {
  return latest
}

export function initLoadMonitor(onSample: (load: SystemLoad) => void): void {
  if (timer) return
  // Prime the counters so the first *pushed* sample has a delta to work with.
  // This one has none by definition, so `cpu` is null and a window that opens
  // right now shows "—" for CPU until the first tick — two seconds, and the
  // honest answer for a rate nobody has measured yet.
  latest = sample()
  timer = setInterval(() => {
    latest = sample()
    onSample(latest)
  }, SAMPLE_INTERVAL_MS)
}

export function disposeLoadMonitor(): void {
  if (timer) clearInterval(timer)
  timer = null
  previous = null
}
