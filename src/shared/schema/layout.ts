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

export const LAYOUT_VERSION = 1
export const MAX_COLS = 6
export const MAX_ROWS = 4

export const PaneSchema = z.object({
  id: z.string().min(1),
  title: z.string().default(''),
  col: z.number().int().min(0),
  row: z.number().int().min(0),
  /** Relative to the project root. Resolved and bounds-checked by resolveCwd(). */
  cwd: z.string().default('.'),
  shell: z.enum(SHELLS).optional(),
  /** Absent means a bare shell, waiting. Nothing is auto-executed. */
  command: z.string().optional(),
})

export const GridSchema = z.object({
  cols: z.number().int().min(1).max(MAX_COLS),
  rows: z.number().int().min(1).max(MAX_ROWS),
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
    grid: GridSchema,
    defaults: DefaultsSchema.default({ shell: 'pwsh', cwd: '.' }),
    panes: z.array(PaneSchema),
  })
  .superRefine((layout, ctx) => {
    const seenIds = new Set<string>()
    const seenCells = new Map<string, string>()

    layout.panes.forEach((pane, index) => {
      if (seenIds.has(pane.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['panes', index, 'id'],
          message: `identifiant dupliqué : « ${pane.id} » est déjà utilisé par un autre pane`,
        })
      }
      seenIds.add(pane.id)

      if (pane.col >= layout.grid.cols) {
        ctx.addIssue({
          code: 'custom',
          path: ['panes', index, 'col'],
          message: `doit être inférieur à grid.cols (${layout.grid.cols}), reçu ${pane.col}`,
        })
      }
      if (pane.row >= layout.grid.rows) {
        ctx.addIssue({
          code: 'custom',
          path: ['panes', index, 'row'],
          message: `doit être inférieur à grid.rows (${layout.grid.rows}), reçu ${pane.row}`,
        })
      }

      const cell = `${pane.col},${pane.row}`
      const occupant = seenCells.get(cell)
      if (occupant) {
        ctx.addIssue({
          code: 'custom',
          path: ['panes', index],
          message: `la cellule (${pane.col}, ${pane.row}) est déjà occupée par « ${occupant} »`,
        })
      }
      seenCells.set(cell, pane.id)
    })
  })

export type Pane = z.infer<typeof PaneSchema>
export type Grid = z.infer<typeof GridSchema>
export type Layout = z.infer<typeof LayoutSchema>
export type Shell = (typeof SHELLS)[number]
export type ThemeMode = (typeof THEME_MODES)[number]

/** Layout used when a project has no `.myterm.json`. Never written to disk on its own. */
export function defaultLayout(name?: string): Layout {
  return {
    version: LAYOUT_VERSION,
    ...(name ? { name } : {}),
    theme: 'system',
    grid: { cols: 1, rows: 1 },
    defaults: { shell: 'pwsh', cwd: '.' },
    panes: [{ id: 'pane-1', title: '', col: 0, row: 0, cwd: '.' }],
  }
}

/** Effective shell for a pane, applying the layout-level default. */
export function paneShell(layout: Layout, pane: Pane): Shell {
  return pane.shell ?? layout.defaults.shell
}
