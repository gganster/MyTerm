import { z } from 'zod'

/**
 * The `.myterm.json` contract. This schema *is* the data layer: there is no
 * database, so every guarantee about a layout comes from here (ADR-001).
 *
 * Types are derived with z.infer so the schema and the TypeScript types cannot
 * drift apart.
 */

export const SHELLS = ['pwsh', 'powershell', 'cmd', 'bash'] as const
export const THEME_MODES = ['light', 'dark', 'system'] as const

/**
 * The pane border palette, as *names* rather than values.
 *
 * A closed list, and deliberately not a free hex field. The point of the colour
 * is to tell the halves of a monorepo apart at a glance, and that only works if
 * every colour stays legible and mutually distinguishable in both themes — a
 * guarantee no user-supplied `#rrggbb` can carry. The names are the contract;
 * the two sets of values live in `src/renderer/theme/palette.ts` with the rest
 * of the colour (ARCHI § Thème).
 *
 * Eight is what fits: the hues are ~20° apart at the tightest, and adding a
 * ninth would have to squeeze between two that are already close.
 */
export const PANE_COLORS = [
  'red',
  'orange',
  'yellow',
  'green',
  'cyan',
  'blue',
  'purple',
  'pink',
] as const

/**
 * v2 dropped `grid` and the per-pane `{col, row}`: panes are now an ordered
 * list laid out responsively (ADR-003). v1 files are migrated on read by
 * `migrateLayout`, so bumping this does not orphan anyone's file.
 */
export const LAYOUT_VERSION = 2

/**
 * Kept at the old grid's cell count (6 x 4): a v1 file could not declare more
 * panes than it had cells, so no valid v1 file hits this bound. It is a sanity
 * limit, not a target — past a dozen panes each terminal is a few lines tall
 * and the view scrolls.
 */
export const MAX_PANES = 24

export const PaneSchema = z.object({
  id: z.string().min(1),
  title: z.string().default(''),
  /** Relative to the project root. Resolved and bounds-checked by resolveCwd(). */
  cwd: z.string().default('.'),
  shell: z.enum(SHELLS).optional(),
  /** Absent means a bare shell, waiting. Nothing is auto-executed. */
  command: z.string().optional(),
  /**
   * Border colour. Absent means the theme's own border — the default, and the
   * only value that follows light/dark instead of standing out from it.
   */
  color: z.enum(PANE_COLORS).optional(),
})

export const DefaultsSchema = z.object({
  shell: z.enum(SHELLS).default('pwsh'),
  cwd: z.string().default('.'),
})

export const LayoutSchema = z
  .object({
    // A literal, not a number: a file written by a newer MyTerm is rejected
    // with a clear message instead of being half-interpreted.
    version: z.literal(LAYOUT_VERSION),
    name: z.string().optional(),
    theme: z.enum(THEME_MODES).default('system'),
    defaults: DefaultsSchema.default({ shell: 'pwsh', cwd: '.' }),
    // Order is the layout: panes flow left to right, wrapping onto as many
    // rows as the window width allows.
    // `.min(1)` is stricter than v1, which tolerated an empty array and showed
    // an empty window. An empty workspace is a state nothing else in the app
    // can produce — removePane refuses it — so it is an error, not a view.
    panes: z
      .array(PaneSchema)
      .min(1, 'un workspace doit déclarer au moins un pane')
      .max(MAX_PANES, `un workspace ne peut pas dépasser ${MAX_PANES} panes`),
  })
  .superRefine((layout, ctx) => {
    const seenIds = new Set<string>()

    layout.panes.forEach((pane, index) => {
      if (seenIds.has(pane.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['panes', index, 'id'],
          message: `identifiant dupliqué : « ${pane.id} » est déjà utilisé par un autre pane`,
        })
      }
      seenIds.add(pane.id)
    })
  })

export type Pane = z.infer<typeof PaneSchema>
export type Layout = z.infer<typeof LayoutSchema>
export type Shell = (typeof SHELLS)[number]
export type ThemeMode = (typeof THEME_MODES)[number]
export type PaneColor = (typeof PANE_COLORS)[number]

/** Layout used when a project has no `.myterm.json`. Never written to disk on its own. */
export function defaultLayout(name?: string): Layout {
  return {
    version: LAYOUT_VERSION,
    ...(name ? { name } : {}),
    theme: 'system',
    defaults: { shell: 'pwsh', cwd: '.' },
    panes: [{ id: 'pane-1', title: '', cwd: '.' }],
  }
}

/** Effective shell for a pane, applying the layout-level default. */
export function paneShell(layout: Layout, pane: Pane): Shell {
  return pane.shell ?? layout.defaults.shell
}
