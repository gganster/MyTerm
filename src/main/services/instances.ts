import { mkdirSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Who else is running right now.
 *
 * MyTerm allows several instances (ARCHI § Instances multiples), which removed
 * the one thing that used to answer two questions the app still needs answered:
 *
 * 1. **Who checks for updates?** Every instance polling GitHub multiplies the
 *    requests and, worse, has several electron-updater caches downloading the
 *    same file into the same folder. One instance is elected instead.
 * 2. **Is it safe to install one?** `quitAndInstall` runs the NSIS installer,
 *    which closes every running MyTerm — not just the one that asked. The rule
 *    that an update never kills a live pane without consent (ARCHI §
 *    electron-updater) is meaningless if this process can only see its own.
 *
 * A directory of one file per process answers both. Deliberately synchronous
 * and dependency-free: it is read at startup, on a slow timer, and once more
 * during `before-quit`, where an async write is not guaranteed to land.
 *
 * The directory is injected rather than read from `app.getPath`, so the whole
 * thing is testable without Electron (ARCHI § Tests).
 */

export interface InstanceRecord {
  pid: number
  startedAt: number
}

export interface InstanceRegistryOptions {
  dir: string
  pid?: number
  now?: () => number
  /** Injected for tests; production asks the OS whether the pid is still there. */
  isAlive?: (pid: number) => boolean
}

/**
 * How long an entry may go without a heartbeat before it is treated as dead.
 *
 * The pid check alone is not enough. Windows reuses process ids, so an instance
 * killed without running `unregister` can leave a file whose pid now belongs to
 * some unrelated program — an entry that never expires. That is not merely
 * untidy: a stale entry sorted first would elect a process that is not MyTerm as
 * the updater, and nobody would ever check for updates again. Both signals are
 * required, so a reused pid stops mattering one heartbeat interval later.
 */
export const HEARTBEAT_MS = 60_000
const STALE_AFTER_MS = HEARTBEAT_MS * 3

function defaultIsAlive(pid: number): boolean {
  try {
    // Signal 0 performs the permission and existence checks without delivering
    // anything. EPERM means the process exists and is owned by someone else.
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export interface InstanceRegistry {
  register(): void
  heartbeat(): void
  unregister(): void
  /** Live instances, oldest first. */
  live(): InstanceRecord[]
  /**
   * True when this instance is the oldest one alive, and so the one that owns
   * the singleton duties. Re-evaluated on every call: when the elected instance
   * quits, the next one takes over without anything having to hand off.
   */
  isPrimary(): boolean
  /** How many *other* instances are alive. */
  otherCount(): number
}

export function createInstanceRegistry(options: InstanceRegistryOptions): InstanceRegistry {
  const { dir } = options
  const pid = options.pid ?? process.pid
  const now = options.now ?? Date.now
  const isAlive = options.isAlive ?? defaultIsAlive

  const ownPath = join(dir, `${pid}.json`)

  function register(): void {
    try {
      mkdirSync(dir, { recursive: true })
      writeFileSync(ownPath, JSON.stringify({ pid, startedAt: now() }), 'utf8')
      // Stamped from the same clock the staleness check reads, rather than left
      // on whatever the filesystem wrote. Otherwise freshness is measured
      // between two different clocks, and the test that proves a recycled pid
      // eventually expires cannot be written at all.
      const stamp = new Date(now())
      utimesSync(ownPath, stamp, stamp)
    } catch {
      // A registry we cannot write degrades to "this instance is alone", which
      // is the pre-existing behaviour. It must never stop the app from opening.
    }
  }

  function heartbeat(): void {
    try {
      const stamp = new Date(now())
      utimesSync(ownPath, stamp, stamp)
    } catch {
      // Deleted under us — most likely reaped as stale after a long suspend.
      register()
    }
  }

  function unregister(): void {
    try {
      rmSync(ownPath, { force: true })
    } catch {
      /* the stale sweep will get it */
    }
  }

  function live(): InstanceRecord[] {
    let names: string[]
    try {
      names = readdirSync(dir)
    } catch {
      return [{ pid, startedAt: 0 }]
    }

    const records: InstanceRecord[] = []
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      const path = join(dir, name)
      const recordedPid = Number.parseInt(name.slice(0, -'.json'.length), 10)
      if (!Number.isInteger(recordedPid) || recordedPid <= 0) continue

      let startedAt = 0
      let fresh = false
      try {
        const info = statSync(path)
        fresh = now() - info.mtimeMs < STALE_AFTER_MS
        startedAt = info.birthtimeMs || info.mtimeMs
      } catch {
        continue
      }

      // Our own entry is always live, whatever the clock says: a machine that
      // slept through a heartbeat must not make this process invisible to
      // itself and hand its duties to nobody.
      if (recordedPid === pid) {
        records.push({ pid: recordedPid, startedAt })
        continue
      }

      if (!fresh || !isAlive(recordedPid)) {
        // Best effort reap. Losing the race with the owner's own heartbeat only
        // costs it a re-register.
        try {
          rmSync(path, { force: true })
        } catch {
          /* another instance is reaping the same file */
        }
        continue
      }

      records.push({ pid: recordedPid, startedAt })
    }

    if (!records.some((record) => record.pid === pid)) records.push({ pid, startedAt: now() })

    // Oldest first; pid breaks a tie so every instance elects the same one.
    return records.sort((a, b) => a.startedAt - b.startedAt || a.pid - b.pid)
  }

  return {
    register,
    heartbeat,
    unregister,
    live,
    isPrimary: () => live()[0]?.pid === pid,
    otherCount: () => Math.max(0, live().length - 1),
  }
}

/** Set once by the main process at startup; `null` before that and in tests. */
let registry: InstanceRegistry | null = null

export function initInstanceRegistry(dir: string): InstanceRegistry {
  registry = createInstanceRegistry({ dir })
  registry.register()
  return registry
}

export function getInstanceRegistry(): InstanceRegistry | null {
  return registry
}

/** Cheap accessors for callers that must work whether or not the registry exists. */
export function otherInstanceCount(): number {
  return registry?.otherCount() ?? 0
}

export function isPrimaryInstance(): boolean {
  return registry?.isPrimary() ?? true
}

export function disposeInstanceRegistry(): void {
  registry?.unregister()
  registry = null
}
