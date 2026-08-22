import { describe, expect, it } from 'vitest'
import { LayoutSchema, defaultLayout, paneShell } from '@shared/schema/layout'
import { formatZodError } from '@shared/schema/format-error'

/** The PRD's own example, used as the canonical valid layout. */
const validLayout = {
  version: 1,
  name: 'demo',
  grid: { cols: 3, rows: 2 },
  panes: [
    { id: 'claude-1', title: 'Claude · feature', col: 0, row: 0 },
    { id: 'web', title: 'frontend', col: 0, row: 1, cwd: 'frontend', command: 'npm run dev' },
    { id: 'free', col: 2, row: 1 },
  ],
}

function problemsOf(input: unknown): string[] {
  const result = LayoutSchema.safeParse(input)
  if (result.success) throw new Error('attendu invalide, mais la validation a réussi')
  return formatZodError(result.error)
}

describe('LayoutSchema', () => {
  it('accepte le layout exemple du PRD', () => {
    const result = LayoutSchema.safeParse(validLayout)
    expect(result.success).toBe(true)
  })

  it('applique les valeurs par défaut', () => {
    const parsed = LayoutSchema.parse(validLayout)
    expect(parsed.theme).toBe('system')
    expect(parsed.defaults).toEqual({ shell: 'pwsh', cwd: '.' })
    // A pane declaring neither title nor cwd still comes out fully formed.
    expect(parsed.panes[2]).toMatchObject({ title: '', cwd: '.' })
  })

  it('refuse deux panes portant le même identifiant, en nommant le coupable', () => {
    const problems = problemsOf({
      ...validLayout,
      panes: [
        { id: 'dup', col: 0, row: 0 },
        { id: 'dup', col: 1, row: 0 },
      ],
    })
    expect(problems.join('\n')).toContain('dup')
    expect(problems.join('\n')).toContain('panes.1.id')
  })

  it('refuse un pane hors de la grille en citant la limite', () => {
    const problems = problemsOf({
      ...validLayout,
      grid: { cols: 2, rows: 1 },
      panes: [{ id: 'oob', col: 5, row: 0 }],
    })
    expect(problems.join('\n')).toContain('panes.0.col')
    expect(problems.join('\n')).toContain('grid.cols (2)')
  })

  it('refuse deux panes sur la même cellule', () => {
    const problems = problemsOf({
      ...validLayout,
      panes: [
        { id: 'a', col: 0, row: 0 },
        { id: 'b', col: 0, row: 0 },
      ],
    })
    expect(problems.join('\n')).toContain('déjà occupée')
  })

  it('refuse une version future plutôt que de l’interpréter à moitié', () => {
    expect(LayoutSchema.safeParse({ ...validLayout, version: 2 }).success).toBe(false)
  })

  it('refuse une grille plus grande que la limite', () => {
    expect(LayoutSchema.safeParse({ ...validLayout, grid: { cols: 99, rows: 1 } }).success).toBe(
      false,
    )
  })

  it('refuse un identifiant vide', () => {
    expect(
      LayoutSchema.safeParse({ ...validLayout, panes: [{ id: '', col: 0, row: 0 }] }).success,
    ).toBe(false)
  })
})

describe('paneShell', () => {
  it('retombe sur le shell par défaut du layout', () => {
    const layout = LayoutSchema.parse(validLayout)
    expect(paneShell(layout, layout.panes[0]!)).toBe('pwsh')
  })

  it('respecte le shell déclaré par le pane', () => {
    const layout = LayoutSchema.parse({
      ...validLayout,
      defaults: { shell: 'pwsh', cwd: '.' },
      panes: [{ id: 'a', col: 0, row: 0, shell: 'cmd' }],
    })
    expect(paneShell(layout, layout.panes[0]!)).toBe('cmd')
  })
})

describe('defaultLayout', () => {
  it('produit un layout valide à un seul pane', () => {
    expect(LayoutSchema.safeParse(defaultLayout('projet')).success).toBe(true)
    expect(defaultLayout('projet').panes).toHaveLength(1)
  })
})
