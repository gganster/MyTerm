import { existsSync } from 'node:fs'
import { copyFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import { MAX_RECENT_PROJECTS, PreferencesSchema, defaultPreferences } from '@shared/schema/preferences'
import type { Preferences, RecentProject } from '@shared/schema/preferences'
import { atomicWrite, serialiseJson } from '../util/atomic-write'

/**
 * One JSON file, read once, written debounced (ADR-001).
 *
 * No electron-store: the need is a read, a few writes and a validation, which
 * is what this file is. The dependency would only add indirection.
 */

const DEBOUNCE_MS = 500

let cache: Preferences = defaultPreferences()
let loaded = false
let writeTimer: NodeJS.Timeout | null = null

function filePath(): string {
  return join(app.getPath('userData'), 'preferences.json')
}

/** Windows paths compare case-insensitively; normalise before matching. */
export function normaliseProjectPath(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? trimmed.toLowerCase() : trimmed
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

/** Writes are debounced: dragging a window edge must not hammer the disk. */
export function updatePreferences(patch: Partial<Preferences>): Preferences {
  cache = { ...cache, ...patch }
  if (writeTimer) clearTimeout(writeTimer)
  writeTimer = setTimeout(() => {
    writeTimer = null
    void atomicWrite(filePath(), serialiseJson(cache)).catch((error: unknown) =>
      console.warn('[myterm] écriture des préférences échouée', error),
    )
  }, DEBOUNCE_MS)
  return cache
}

export async function flushPreferences(): Promise<void> {
  if (writeTimer) {
    clearTimeout(writeTimer)
    writeTimer = null
  }
  await atomicWrite(filePath(), serialiseJson(cache)).catch(() => undefined)
}

export function rememberProject(projectPath: string, name: string): Preferences {
  const key = normaliseProjectPath(projectPath)
  const entry: RecentProject = { path: projectPath, name, lastOpenedAt: new Date().toISOString() }
  const others = cache.recentProjects.filter((p) => normaliseProjectPath(p.path) !== key)
  return updatePreferences({
    recentProjects: [entry, ...others].slice(0, MAX_RECENT_PROJECTS),
  })
}

export function forgetProject(projectPath: string): Preferences {
  const key = normaliseProjectPath(projectPath)
  return updatePreferences({
    recentProjects: cache.recentProjects.filter((p) => normaliseProjectPath(p.path) !== key),
  })
}
