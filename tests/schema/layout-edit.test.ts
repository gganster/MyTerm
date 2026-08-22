import { describe, expect, it } from 'vitest'
import { LayoutSchema } from '@shared/schema/layout'
import type { Layout } from '@shared/schema/layout'
import {
  addPane,
  panesNeedingRestart,
  removePane,
  resizeGrid,
  swapPanes,
  updatePane,
} from '@shared/schema/layout-edit'

function layoutOf(panes: unknown[], cols = 2, rows = 2): Layout {
  return LayoutSchema.parse({ version: 1, grid: { cols, rows }, panes })
}

const base = layoutOf([
  { id: 'a', col: 0, row: 0, cwd: 'frontend', command: 'npm run dev' },
  { id: 'b', col: 1, row: 0 },
])

describe('addPane', () => {
  it('place le nouveau pane dans la première cellule libre', () => {
    const result = addPane(base)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.layout.panes).toHaveLength(3)
    expect(result.layout.panes[2]).toMatchObject({ col: 0, row: 1 })
  })

  it('refuse proprement quand la grille est pleine', () => {
    const full = layoutOf([{ id: 'a', col: 0, row: 0 }], 1, 1)
    const result = addPane(full)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain('pleine')
  })
})

describe('removePane', () => {
  it('supprime le pane demandé', () => {
    const result = removePane(base, 'b')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.layout.panes.map((pane) => pane.id)).toEqual(['a'])
  })

  it('refuse de vider complètement le workspace', () => {
    const single = layoutOf([{ id: 'a', col: 0, row: 0 }], 1, 1)
    expect(removePane(single, 'a').ok).toBe(false)
  })
})

describe('updatePane', () => {
  it('efface les champs optionnels vidés plutôt que de stocker du vide', () => {
    const result = updatePane(base, 'a', { command: '' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.layout.panes[0]).not.toHaveProperty('command')
  })

  it('rejette une modification qui rendrait le layout invalide', () => {
    // Moving 'a' onto 'b' would put two panes in one cell.
    const result = updatePane(base, 'a', { col: 1, row: 0 })
    expect(result.ok).toBe(false)
  })
})

describe('swapPanes', () => {
  it('échange les positions sans toucher au reste', () => {
    const result = swapPanes(base, 'a', 'b')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const a = result.layout.panes.find((pane) => pane.id === 'a')!
    const b = result.layout.panes.find((pane) => pane.id === 'b')!
    expect(a).toMatchObject({ col: 1, row: 0, command: 'npm run dev' })
    expect(b).toMatchObject({ col: 0, row: 0 })
  })
})

describe('resizeGrid', () => {
  it('annonce les panes qui sortiraient de la grille avant de rien faire', () => {
    const outcome = resizeGrid(base, 1, 2)
    expect(outcome.orphaned.map((pane) => pane.id)).toEqual(['b'])
    // Nothing has changed yet: the caller decides after seeing the list.
    expect(base.panes).toHaveLength(2)
  })

  it('applique la réduction en retirant exactement ces panes', () => {
    const result = resizeGrid(base, 1, 2).apply()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.layout.panes.map((pane) => pane.id)).toEqual(['a'])
  })

  it("n'orpheline personne en agrandissant", () => {
    expect(resizeGrid(base, 3, 3).orphaned).toHaveLength(0)
  })
})

describe('panesNeedingRestart', () => {
  it('ignore un simple renommage', () => {
    const renamed = updatePane(base, 'a', { title: 'nouveau nom' })
    expect(renamed.ok).toBe(true)
    if (!renamed.ok) return
    expect(panesNeedingRestart(base, renamed.layout)).toEqual([])
  })

  it('ignore un déplacement dans la grille', () => {
    const moved = swapPanes(base, 'a', 'b')
    expect(moved.ok).toBe(true)
    if (!moved.ok) return
    expect(panesNeedingRestart(base, moved.layout)).toEqual([])
  })

  it('signale un changement de cwd', () => {
    const edited = updatePane(base, 'a', { cwd: 'backend' })
    expect(edited.ok).toBe(true)
    if (!edited.ok) return
    expect(panesNeedingRestart(base, edited.layout)).toEqual(['a'])
  })

  it('signale un changement de commande', () => {
    const edited = updatePane(base, 'a', { command: 'npm run build' })
    expect(edited.ok).toBe(true)
    if (!edited.ok) return
    expect(panesNeedingRestart(base, edited.layout)).toEqual(['a'])
  })

  it('considère un pane nouvellement ajouté comme à démarrer', () => {
    const added = addPane(base)
    expect(added.ok).toBe(true)
    if (!added.ok) return
    expect(panesNeedingRestart(base, added.layout)).toHaveLength(1)
  })
})
