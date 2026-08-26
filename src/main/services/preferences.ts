import { existsSync } from 'node:fs'
import { copyFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import { MAX_RECENT_PROJECTS, PreferencesSchema, defaultPreferences } from '@shared/schema/preferences'
import type { Preferences, RecentProject } from '@shared/schema/preferences'
import { emptyIntents, mergePreferences } from '@shared/schema/preferences-merge'
import { normaliseProjectPath } from '@shared/normalise-path'
import { atomicWrite, serialiseJson, withFileLock } from '../util/atomic-write'

/**
 * One JSON file, read once, written debounced (ADR-001).
 *
 * No electron-store: the need is a read, a few writes and a validation, which
 * is what this file is. The dependency would only add indirection.
 *
 * The cache is the read path, never the write path. Several instances share
 * this file (ARCHI § Instances multiples), so a write re-reads what is on disk,
 * replays the changes *this* process made onto it, and stores the result — see
 * @shared/schema/preferences-merge for why, and why the intents are cleared
 * afterwards rather than kept.
 */

const DEBOUNCE_MS = 500

let cache: Preferences = defaultPreferences()
let loaded = false
let writeTimer: NodeJS.Timeout | null = null
let intents = emptyIntents()
/** Chains writes so a flush during a debounced save cannot overlap it. */
let writeChain: Promise<void> = Promise.resolve()

function filePath(): string {
  return join(app.getPath('userData'), 'preferences.json')
}

/**
 * Reads and validates the file. Unlike `loadPreferences` this never falls back
 * to defaults: a merge must not treat an unreadable file as an empty one, which
 * would erase every other instance's projects and approvals in one write.
 */
async function readFromDisk(): Promise<Preferences | null> {
  const path = filePath()
  if (!existsSync(path)) return defaultPreferences()
  try {
    const result = PreferencesSchema.safeParse(JSON.parse(await readFile(path, 'utf8')))
    return result.success ? result.data : null
  } catch {
    return null
  }
}

export async function loadPreferences(): Promise<Preferences> {
  if (loaded) return cache
  loaded = true

  const path = filePath()
  if (!existsSync(path)) return cache

  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
    const result = PreferencesSchema.safeParse(parsed)
    if (result.success) {
      cache = result.data
      return cache
    }
    // Keep the damaged file: losing someone's whole recent-projects list
    // silently is worse than starting from defaults for this session.
    await copyFile(path, `${path}.bak`).catch(() => undefined)
    console.warn('[myterm] preferences.json invalide, valeurs par défaut ; ancien fichier en .bak')
  } catch (error) {
    await copyFile(path, `${path}.bak`).catch(() => undefined)
    console.warn('[myterm] preferences.json illisible, valeurs par défaut', error)
  }

  cache = defaultPreferences()
  return cache
}

export function getPreferences(): Preferences {
  return cache
}

/**
 * Preferences as the renderer should see them: recent projects annotated with
 * whether their folder currently exists. Not persisted — a disconnected drive
 * is a temporary condition, not a reason to drop someone's project.
 */
export function getPreferencesForRenderer(): Preferences {
  return {
    ...cache,
    recentProjects: cache.recentProjects.map((project) => ({
      ...project,
      missing: !existsSync(project.path),
    })),
  }
}

function noPendingIntents(): boolean {
  return (
    intents.dirtyKeys.size === 0 &&
    intents.remembered.size === 0 &&
    intents.forgotten.size === 0 &&
    intents.trusted.size === 0 &&
    intents.revoked.size === 0
  )
}

/**
 * Read, merge, write — under a cross-process lock, so a concurrent instance
 * cannot slip a write between our read and our rename.
 *
 * Intents are taken before the lock and cleared only once the file is on disk.
 * A failed write puts them back, so the next save retries the same changes
 * instead of dropping them.
 */
async function persist(): Promise<void> {
  if (noPendingIntents()) return

  const pending = intents
  intents = emptyIntents()

  const path = filePath()
  try {
    await withFileLock(path, async () => {
      const disk = await readFromDisk()
      // An unreadable or invalid file is not evidence that the other instances'
      // state is gone. Merging onto our own cache keeps this process's view and
      // leaves the damaged file to `loadPreferences`, which archives it to .bak.
      const merged = mergePreferences(disk ?? cache, cache, pending)
      await atomicWrite(path, serialiseJson(merged))
      // The write is awaited, so a project can have been opened or approved
      // while it was in flight. Those changes are in `intents`, not in
      // `pending`, so they are not in `merged` — assigning it raw would drop
      // them from the cache the renderer reads until the next save. Replaying
      // whatever accumulated since puts them back; with nothing pending this is
      // just `merged`.
      cache = mergePreferences(merged, cache, intents)
    })
  } catch (error) {
    // Put the changes back at the front of the queue for the next save. A newer
    // intent for the same project already recorded since wins, so a retry can
    // never resurrect a decision the user has meanwhile reversed.
    for (const key of pending.dirtyKeys) intents.dirtyKeys.add(key)
    for (const [key, value] of pending.remembered) {
      if (!intents.remembered.has(key) && !intents.forgotten.has(key)) {
        intents.remembered.set(key, value)
      }
    }
    for (const key of pending.forgotten) {
      if (!intents.remembered.has(key)) intents.forgotten.add(key)
    }
    for (const [key, value] of pending.trusted) {
      if (!intents.trusted.has(key) && !intents.revoked.has(key)) {
        intents.trusted.set(key, value)
      }
    }
    for (const key of pending.revoked) {
      if (!intents.trusted.has(key)) intents.revoked.add(key)
    }
    console.warn('[myterm] écriture des préférences échouée', error)
  }
}

function schedulePersist(): void {
  if (writeTimer) clearTimeout(writeTimer)
  writeTimer = setTimeout(() => {
    writeTimer = null
    writeChain = writeChain.then(persist)
  }, DEBOUNCE_MS)
}

/**
 * The only preferences a generic patch may set.
 *
 * `recentProjects` and `trustedProjects` are deliberately not here, and the
 * narrowing is doing two jobs.
 *
 * It closes a hole. This function is reachable from the renderer through the
 * `prefs:set` channel, so a patch carrying `trustedProjects` was a way to
 * approve any project from the renderer — exactly what ADR-004 says must be
 * impossible, since the whole point of deciding trust in main is that
 * compromising the renderer is not enough to get past the gate.
 *
 * And it removes a trap. The merge reads those two lists from *intents*, not
 * from the patched cache, so a wholesale list assignment would have updated
 * memory and then quietly failed to survive the next save. A type error is a
 * better outcome than a value that disappears on restart.
 */
export type PreferencesPatch = Partial<Pick<Preferences, 'theme' | 'window'>>

/** Writes are debounced: dragging a window edge must not hammer the disk. */
export function updatePreferences(patch: PreferencesPatch): Preferences {
  cache = { ...cache, ...patch }
  for (const key of Object.keys(patch) as (keyof PreferencesPatch)[]) intents.dirtyKeys.add(key)
  schedulePersist()
  return cache
}

export async function flushPreferences(): Promise<void> {
  if (writeTimer) {
    clearTimeout(writeTimer)
    writeTimer = null
  }
  writeChain = writeChain.then(persist)
  await writeChain
}

export function rememberProject(projectPath: string, name: string): Preferences {
  const key = normaliseProjectPath(projectPath)
  const entry: RecentProject = { path: projectPath, name, lastOpenedAt: new Date().toISOString() }
  const others = cache.recentProjects.filter((p) => normaliseProjectPath(p.path) !== key)

  intents.remembered.set(key, entry)
  intents.forgotten.delete(key)

  cache = { ...cache, recentProjects: [entry, ...others].slice(0, MAX_RECENT_PROJECTS) }
  schedulePersist()
  return cache
}

export function forgetProject(projectPath: string): Preferences {
  const key = normaliseProjectPath(projectPath)

  intents.forgotten.add(key)
  intents.remembered.delete(key)

  cache = {
    ...cache,
    recentProjects: cache.recentProjects.filter((p) => normaliseProjectPath(p.path) !== key),
  }
  schedulePersist()
  return cache
}

/**
 * Trust changes are routed through these two rather than through
 * `updatePreferences` so the merge sees an approval or a withdrawal, not an
 * opaque new array. A withdrawal expressed as "here is my whole list" is
 * indistinguishable from a stale cache, and another instance saving its own
 * cache a moment later would silently put the approval back (ADR-004).
 */
export function recordTrust(projectPath: string, commandsHash: string): Preferences {
  const key = normaliseProjectPath(projectPath)

  intents.trusted.set(key, { path: projectPath, commandsHash })
  intents.revoked.delete(key)

  const others = cache.trustedProjects.filter((entry) => normaliseProjectPath(entry.path) !== key)
  cache = { ...cache, trustedProjects: [{ path: projectPath, commandsHash }, ...others] }
  schedulePersist()
  return cache
}

export function recordRevoke(projectPath: string): Preferences {
  const key = normaliseProjectPath(projectPath)

  intents.revoked.add(key)
  intents.trusted.delete(key)

  cache = {
    ...cache,
    trustedProjects: cache.trustedProjects.filter(
      (entry) => normaliseProjectPath(entry.path) !== key,
    ),
  }
  schedulePersist()
  return cache
}
