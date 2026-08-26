import { z } from 'zod'
import { THEME_MODES } from './layout'

/**
 * Global preferences. The only other durable state besides `.myterm.json`
 * (ADR-001): one JSON file in userData, validated exactly like a layout.
 */

export const PREFERENCES_VERSION = 1
export const MAX_RECENT_PROJECTS = 15
export const MAX_TRUSTED_PROJECTS = 200

export const RecentProjectSchema = z.object({
  path: z.string().min(1),
  name: z.string(),
  lastOpenedAt: z.string(),
  /**
   * Computed at read time, never persisted: the folder is gone right now. An
   * unplugged network drive greys the entry out instead of deleting it.
   */
  missing: z.boolean().optional(),
})

export const TrustedProjectSchema = z.object({
  path: z.string().min(1),
  /** Hash of the pane commands that were approved (ADR-004). */
  commandsHash: z.string(),
})

export const WindowStateSchema = z.object({
  width: z.number().int().min(480).default(1600),
  height: z.number().int().min(320).default(1000),
  x: z.number().int().optional(),
  y: z.number().int().optional(),
  maximized: z.boolean().default(false),
})

export const PreferencesSchema = z.object({
  version: z.literal(PREFERENCES_VERSION),
  theme: z.enum(THEME_MODES).default('system'),
  recentProjects: z.array(RecentProjectSchema).default([]),
  trustedProjects: z.array(TrustedProjectSchema).default([]),
  window: WindowStateSchema.default({ width: 1600, height: 1000, maximized: false }),
})

/**
 * The subset a renderer is allowed to set through `prefs:set`.
 *
 * Derived from the schema above rather than restated, so a field added there
 * cannot silently become writable from the renderer: it has to be listed here
 * on purpose. `recentProjects` and `trustedProjects` are excluded by design —
 * approving a project is a main-process decision (ADR-004).
 */
export const DisplayPreferencesSchema = PreferencesSchema.pick({
  theme: true,
  window: true,
}).partial()

export type DisplayPreferences = z.infer<typeof DisplayPreferencesSchema>
export type RecentProject = z.infer<typeof RecentProjectSchema>
export type TrustedProject = z.infer<typeof TrustedProjectSchema>
export type WindowState = z.infer<typeof WindowStateSchema>
export type Preferences = z.infer<typeof PreferencesSchema>

export function defaultPreferences(): Preferences {
  return {
    version: PREFERENCES_VERSION,
    theme: 'system',
    recentProjects: [],
    trustedProjects: [],
    window: { width: 1600, height: 1000, maximized: false },
  }
}
