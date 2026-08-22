import { describe, expect, it } from 'vitest'
import { LAYOUT_VERSION, LayoutSchema } from '@shared/schema/layout'
import { migrateLayout } from '@shared/schema/layout-migrate'

/**
 * The v1 -> v2 upgrade is the only thing standing between a user's committed
 * `.myterm.json` and an error screen, so it is tested on the exact file the
 * README used to document.
 */
const v1 = {
  version: 1,
  name: 'demo',
  theme: 'dark',
  grid: { cols: 3, rows: 2 },
  defaults: { shell: 'cmd', cwd: '.' },
  panes: [
    { id: 'web', title: 'frontend', col: 0, row: 1, cwd: 'frontend', command: 'npm run dev' },
    { id: 'claude-2', title: 'Claude · review', col: 1, row: 0, command: 'claude' },
    { id: 'free', title: 'scratch', col: 2, row: 1 },
    { id: 'claude-1', title: 'Claude · feature', col: 0, row: 0, command: 'claude' },
  ],
}

describe('migrateLayout', () => {
  it('produit un layout v2 valide à partir du fichier v1 du README', () => {
    const result = LayoutSchema.safeParse(migrateLayout(v1))
    expect(result.success).toBe(true)
  })

  it('aplatit la grille dans le sens de lecture : ligne par ligne, de gauche à droite', () => {
    const layout = LayoutSchema.parse(migrateLayout(v1))
    expect(layout.panes.map((pane) => pane.id)).toEqual(['claude-1', 'claude-2', 'web', 'free'])
  })

  it('conserve tout ce qui décrit le process', () => {
    const layout = LayoutSchema.parse(migrateLayout(v1))
    expect(layout.name).toBe('demo')
    expect(layout.theme).toBe('dark')
    expect(layout.defaults.shell).toBe('cmd')
    expect(layout.panes.find((pane) => pane.id === 'web')).toMatchObject({
      cwd: 'frontend',
      command: 'npm run dev',
      title: 'frontend',
    })
  })

  it('supprime la grille et les coordonnées', () => {
    const migrated = migrateLayout(v1) as Record<string, unknown>
    expect(migrated).not.toHaveProperty('grid')
    expect(migrated.version).toBe(LAYOUT_VERSION)
    for (const pane of migrated.panes as Record<string, unknown>[]) {
      expect(pane).not.toHaveProperty('col')
      expect(pane).not.toHaveProperty('row')
    }
  })

  it('laisse un fichier déjà en v2 strictement intact', () => {
    const v2 = { version: LAYOUT_VERSION, panes: [{ id: 'b' }, { id: 'a' }] }
    expect(migrateLayout(v2)).toBe(v2)
  })

  it('garde leur ordre de déclaration aux panes sans coordonnées exploitables', () => {
    const migrated = migrateLayout({
      version: 1,
      panes: [{ id: 'x' }, { id: 'y', col: 'nope' }, { id: 'z' }],
    }) as { panes: { id: string }[] }
    expect(migrated.panes.map((pane) => pane.id)).toEqual(['x', 'y', 'z'])
  })

  it('bascule quand même la version sur un v1 cassé, pour que Zod dise le vrai problème', () => {
    // Reporting "version invalide" on a file that legitimately declares v1
    // would send the user looking in the wrong place.
    const migrated = migrateLayout({ version: 1, panes: 'pas un tableau' }) as Record<
      string,
      unknown
    >
    expect(migrated.version).toBe(LAYOUT_VERSION)
    const problems = LayoutSchema.safeParse(migrated)
    expect(problems.success).toBe(false)
  })

  it('ne touche pas à ce qui n’est pas un objet', () => {
    expect(migrateLayout(null)).toBeNull()
    expect(migrateLayout('texte')).toBe('texte')
    expect(migrateLayout([1, 2])).toEqual([1, 2])
  })
})
