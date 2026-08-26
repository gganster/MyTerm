import { open, rename, stat, unlink, writeFile } from 'node:fs/promises'

/**
 * Distinguishes concurrent writes *within* this process.
 *
 * The pid alone is not enough, and the difference is not theoretical: two
 * overlapping calls in one process produce the identical temp name, both write
 * into it, and the second `rename` then fails with ENOENT because the first has
 * already moved the file away. Caught by the test that runs two writes at once,
 * which passed or failed depending on timing until this counter existed.
 */
let writeSequence = 0

/**
 * Writes a file without ever leaving a truncated one behind.
 *
 * `.myterm.json` lives in the user's repository. A crash or a power cut halfway
 * through a save must not corrupt a committed file, so the content goes to a
 * sibling temp file first and is then renamed — atomic on NTFS within a volume.
 *
 * The temp name has to be unique along both axes. Across processes, because
 * MyTerm now runs several instances at once (ARCHI § Instances multiples) and a
 * fixed `.tmp` would have two of them writing into one file and renaming it
 * twice — the survivor being a byte-level interleaving of both, which is
 * exactly the corruption this function exists to prevent. And within a process,
 * for the ENOENT above.
 */
export async function atomicWrite(path: string, content: string): Promise<void> {
  const temporary = `${path}.${process.pid}.${(writeSequence += 1)}.tmp`
  try {
    await writeFile(temporary, content, 'utf8')
    await renameWithRetry(temporary, path)
  } catch (error) {
    // Best effort: a leftover .tmp is untidy, a lost original is not acceptable.
    await unlink(temporary).catch(() => undefined)
    throw error
  }
}

/** Windows error codes for "someone else is holding the destination right now". */
const TRANSIENT_RENAME_ERRORS = new Set(['EPERM', 'EACCES', 'EBUSY'])
const RENAME_ATTEMPTS = 5
const RENAME_BACKOFF_MS = 20

/**
 * `rename` over an existing file, retried on the Windows codes that mean
 * "try again in a moment".
 *
 * On NTFS, replacing a file is atomic but not uncontended: while one rename is
 * swapping the destination, a second rename onto that same destination fails
 * with EPERM — not EEXIST, and nothing about the message suggests it is
 * temporary. An indexer or an antivirus holding the file briefly produces the
 * same thing.
 *
 * It stops being a curiosity once several instances share a file: two windows
 * saving `preferences.json`, or the same project open twice, collide here in
 * the ordinary case rather than the rare one. Measured, not assumed — the
 * concurrent-write test failed this way roughly one run in three before the
 * retry, which is exactly the kind of odds that reaches users and never
 * reproduces for the person told about it.
 */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await rename(from, to)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? ''
      if (attempt >= RENAME_ATTEMPTS || !TRANSIENT_RENAME_ERRORS.has(code)) throw error
      await new Promise((resolve) => setTimeout(resolve, attempt * RENAME_BACKOFF_MS))
    }
  }
}

/** JSON as it should land in git: 2-space indent, trailing newline, LF. */
export function serialiseJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

/** How long a lock may be held before it is assumed to belong to a dead process. */
const LOCK_STALE_MS = 10_000
const LOCK_RETRY_MS = 25
const LOCK_TIMEOUT_MS = 2_000

/**
 * Serialises a read-modify-write across processes.
 *
 * `atomicWrite` guarantees the file is never *torn*; it does nothing about two
 * instances reading the same preferences, each merging its own change into what
 * it read, and both writing — where the second write is complete, valid, and
 * silently missing the first one's change. For a window position that is
 * cosmetic. For a withdrawn approval it is not: losing a revoke leaves a
 * repository trusted that the user just untrusted (ADR-004).
 *
 * `wx` is the primitive — an exclusive create is atomic on NTFS, so exactly one
 * caller can own the lock file at a time.
 *
 * Two deliberate escape hatches, because a preferences save must never be the
 * thing that hangs a quit:
 *
 * - a lock older than `LOCK_STALE_MS` is stolen, so an instance killed mid-write
 *   cannot wedge every future one;
 * - after `LOCK_TIMEOUT_MS` the work runs anyway, unlocked. That reopens the
 *   race for one write rather than dropping the user's data on the floor.
 */
export async function withFileLock<T>(path: string, work: () => Promise<T>): Promise<T> {
  const lockPath = `${path}.lock`
  const deadline = Date.now() + LOCK_TIMEOUT_MS
  let held = false

  while (Date.now() < deadline) {
    try {
      const handle = await open(lockPath, 'wx')
      await handle.close()
      held = true
      break
    } catch {
      // Held by someone — or by nobody, if that someone died holding it.
      const age = await stat(lockPath)
        .then((info) => Date.now() - info.mtimeMs)
        .catch(() => 0)
      if (age > LOCK_STALE_MS) {
        await unlink(lockPath).catch(() => undefined)
        continue
      }
      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS))
    }
  }

  try {
    return await work()
  } finally {
    if (held) await unlink(lockPath).catch(() => undefined)
  }
}
