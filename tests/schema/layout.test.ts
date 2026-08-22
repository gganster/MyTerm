import { describe, expect, it } from 'vitest'
import {
  LAYOUT_VERSION,
  LayoutSchema,
  MAX_PANES,
  defaultLayout,
  paneShell,
} from '@shared/schema/layout'
import { formatZodError } from '@shared/schema/format-error'

/** The README's own example, used as the canonical valid layout. */
const validLayout = {
  version: LAYOUT_VERSION,
  name: 'demo',
  panes: [
    { id: 'claude-1', title: 'Claude · feature', command: 'claude' },
    { id: 'web', title: 'frontend', cwd: 'frontend', command: 'npm run dev' },
    { id: 'free' },
  ],
}

function problemsOf(input: unknown): string[] {
  const result = LayoutSchema.safeParse(input)
  if (result.success) throw new Error('attendu invalide, mais la validation a réussi')
  return formatZodError(result.error)
}

describe('LayoutSchema', () => {
  it('accepte le layout exemple du README', () => {
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

  it("conserve l'ordre déclaré : la position est l'ordre", () => {
    const parsed = LayoutSchema.parse(validLayout)
    expect(parsed.panes.map((pane) => pane.id)).toEqual(['claude-1', 'web', 'free'])
  })

  it("ne conserve pas les coordonnées d'un ancien fichier", () => {
    // A v1 file reaches the schema already migrated; a stray col/row must not
    // survive into the object the app writes back.
    const parsed = LayoutSchema.parse({
      ...validLayout,
      panes: [{ id: 'a', col: 2, row: 1 }],
    })
    expect(parsed.panes[0]).not.toHaveProperty('col')
    expect(parsed.panes[0]).not.toHaveProperty('row')
  })

  it('refuse deux panes portant le même identifiant, en nommant le coupable', () => {
    const problems = problemsOf({
      ...validLayout,
      panes: [{ id: 'dup' }, { id: 'dup' }],
    })
    expect(problems.join('\n')).toContain('dup')
    expect(problems.join('\n')).toContain('panes.1.id')
  })

  it("refuse une version future plutôt que de l'interpréter à moitié", () => {
    expect(LayoutSchema.safeParse({ ...validLayout, version: LAYOUT_VERSION + 1 }).success).toBe(
      false,
    )
  })

  it('refuse un fichier v1 non migré', () => {
    expect(LayoutSchema.safeParse({ ...validLayout, version: 1 }).success).toBe(false)
  })

  it('refuse un workspace sans aucun pane', () => {
    expect(LayoutSchema.safeParse({ ...validLayout, panes: [] }).success).toBe(false)
  })

  it('refuse plus de panes que la limite', () => {
    const panes = Array.from({ length: MAX_PANES + 1 }, (_, index) => ({ id: `pane-${index}` }))
    expect(LayoutSchema.safeParse({ ...validLayout, panes }).success).toBe(false)
  })

  it('refuse un identifiant vide', () => {
    expect(LayoutSchema.safeParse({ ...validLayout, panes: [{ id: '' }] }).success).toBe(false)
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
      panes: [{ id: 'a', shell: 'cmd' }],
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
