import { normaliseProjectPath } from '../normalise-path'
import {
  MAX_RECENT_PROJECTS,
  MAX_TRUSTED_PROJECTS,
  PREFERENCES_VERSION,
} from './preferences'
import type { Preferences, RecentProject, TrustedProject } from './preferences'

/**
 * Reconciles this process's preference changes with what is on disk right now.
 *
 * Several MyTerm instances share one `preferences.json`. Each one holds the
 * whole file in memory, so writing that cache back would silently erase every
 * change the other instances made since it was loaded — the exact race the
 * single-instance lock used to prevent, and the reason this function exists.
 *
 * So a write is not "persist my cache". It is "replay my *intents* onto the
 * file as it is now". Two kinds of state, two rules:
 *
 * - **Scalars I touched** (`theme`, `window`) win, because they are the most
 *   recent thing the user did in this window. A key nobody in this process ever
 *   set is taken from disk untouched, so an instance that only moves its window
 *   cannot revert another one's theme.
 * - **The two lists** are rebuilt from the disk copy and then have this
 *   process's additions and removals applied. Starting from disk is what makes
 *   the merge converge; starting from the cache is what loses data.
 *
 * Intents are *pending*, never standing: the caller clears them once the write
 * lands. That distinction is the whole security argument for `revoked`. Kept
 * forever, an instance that trusted a project in the morning would resurrect
 * that trust on its next window move — undoing a revoke made meanwhile in
 * another window, and re-arming autolaunch on a repository the user had just
 * refused (ADR-004). Cleared on write, the revoke stands.
 *
 * Pure and platform-parameterised so it can be tested without Electron or a
 * disk, per ARCHI § Tests.
 */

export interface PreferenceIntents {
  /** Keys this process explicitly patched; everything else comes from disk. */
  dirtyKeys: ReadonlySet<keyof Preferences>
  /** Normalised path → entry, for projects opened here since the last write. */
  remembered: ReadonlyMap<string, RecentProject>
  /** Normalised paths dropped from the recent list here. */
  forgotten: ReadonlySet<string>
  /** Normalised path → approval, for projects trusted here. */
  trusted: ReadonlyMap<string, TrustedProject>
  /** Normalised paths whose approval was withdrawn here. */
  revoked: ReadonlySet<string>
}

export function emptyIntents(): {
  dirtyKeys: Set<keyof Preferences>
  remembered: Map<string, RecentProject>
  forgotten: Set<string>
  trusted: Map<string, TrustedProject>
  revoked: Set<string>
} {
  return {
    dirtyKeys: new Set(),
    remembered: new Map(),
    forgotten: new Set(),
    trusted: new Map(),
    revoked: new Set(),
  }
}

/**
 * `missing` is computed per read from whether the folder exists right now, and
 * must never reach the file: persisting it would freeze a temporarily
 * unplugged drive into the saved state.
 */
function persistableRecent(entry: RecentProject): RecentProject {
  return { path: entry.path, name: entry.name, lastOpenedAt: entry.lastOpenedAt }
}

function mergeRecents(
  disk: readonly RecentProject[],
  intents: PreferenceIntents,
  platform: string,
): RecentProject[] {
  const key = (path: string): string => normaliseProjectPath(path, platform)
  const byPath = new Map<string, RecentProject>()

  for (const entry of disk) {
    const k = key(entry.path)
    if (intents.forgotten.has(k)) continue
    byPath.set(k, persistableRecent(entry))
  }

  for (const [k, entry] of intents.remembered) {
    // A project both opened here and forgotten here: the later intent is the
    // one still in the map, and `forgotten` is cleared when `remembered` is set.
    if (intents.forgotten.has(k)) continue
    byPath.set(k, persistableRecent(entry))
  }

  // Most recently opened first — the order the home screen shows, and the order
  // the cap prunes from the wrong end of if it is not applied.
  return [...byPath.values()]
    .sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt))
    .slice(0, MAX_RECENT_PROJECTS)
}

function mergeTrusted(
  disk: readonly TrustedProject[],
  intents: PreferenceIntents,
  platform: string,
): TrustedProject[] {
  const key = (path: string): string => normaliseProjectPath(path, platform)
  const byPath = new Map<string, TrustedProject>()

  // This process's own approvals go in first, and that order is the point.
  // A Map keeps insertion order, the cap slices from the end, and the disk copy
  // can already hold MAX_TRUSTED_PROJECTS entries — so appending ours would put
  // the approval the user just gave at the far end and drop it. The dialog
  // would then reappear on that same project every single time it is opened,
  // with nothing to explain why.
  for (const [k, entry] of intents.trusted) {
    if (intents.revoked.has(k)) continue
    byPath.set(k, { path: entry.path, commandsHash: entry.commandsHash })
  }

  for (const entry of disk) {
    const k = key(entry.path)
    // A revoke made here beats whatever the file still says. This is the
    // fail-safe direction and the one that must never be lost.
    if (intents.revoked.has(k)) continue
    // Never overwrite our own, fresher, approval with the stale disk hash.
    if (byPath.has(k)) continue
    byPath.set(k, { path: entry.path, commandsHash: entry.commandsHash })
  }

  return [...byPath.values()].slice(0, MAX_TRUSTED_PROJECTS)
}

export function mergePreferences(
  disk: Preferences,
  ours: Preferences,
  intents: PreferenceIntents,
  platform: string = process.platform,
): Preferences {
  return {
    version: PREFERENCES_VERSION,
    theme: intents.dirtyKeys.has('theme') ? ours.theme : disk.theme,
    window: intents.dirtyKeys.has('window') ? ours.window : disk.window,
    recentProjects: mergeRecents(disk.recentProjects, intents, platform),
    trustedProjects: mergeTrusted(disk.trustedProjects, intents, platform),
  }
}
