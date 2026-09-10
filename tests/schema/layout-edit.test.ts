import { describe, expect, it } from 'vitest'
import { LAYOUT_VERSION, LayoutSchema, MAX_PANES } from '@shared/schema/layout'
import type { Layout } from '@shared/schema/layout'
import {
  addPane,
  movePane,
  panesNeedingRestart,
  removePane,
  updatePane,
} from '@shared/schema/layout-edit'

function layoutOf(panes: unknown[]): Layout {
  return LayoutSchema.parse({ version: LAYOUT_VERSION, panes })
}

const base = layoutOf([{ id: 'a', cwd: 'frontend', command: 'npm run dev' }, { id: 'b' }])

describe('addPane', () => {
  it('ajoute le nouveau pane à la fin du flux', () => {
    const result = addPane(base)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.layout.panes.map((pane) => pane.id)).toEqual(['a', 'b', 'pane-3'])
  })

  it('refuse proprement au-delà de la limite de panes', () => {
    const full = layoutOf(Array.from({ length: MAX_PANES }, (_, index) => ({ id: `p${index}` })))
    const result = addPane(full)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain(String(MAX_PANES))
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
    const single = layoutOf([{ id: 'a' }])
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
    // Two panes would then share the id 'b'.
    const result = updatePane(base, 'a', { id: 'b' })
    expect(result.ok).toBe(false)
  })

  it('pose la couleur de contour demandée', () => {
    const result = updatePane(base, 'a', { color: 'blue' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.layout.panes[0]).toMatchObject({ color: 'blue' })
  })

  it('efface la clé couleur au retour au défaut, plutôt que de la vider', () => {
    const colored = updatePane(base, 'a', { color: 'green' })
    expect(colored.ok).toBe(true)
    if (!colored.ok) return
    const cleared = updatePane(colored.layout, 'a', { color: undefined })
    expect(cleared.ok).toBe(true)
    if (!cleared.ok) return
    expect(cleared.layout.panes[0]).not.toHaveProperty('color')
  })

  it('rejette une couleur hors liste sans altérer le layout', () => {
    const result = updatePane(base, 'a', { color: 'turquoise' } as never)
    expect(result.ok).toBe(false)
  })

  it('marque un pane comme démarrant réduit', () => {
    const result = updatePane(base, 'a', { collapsed: true })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.layout.panes[0]).toMatchObject({ collapsed: true })
  })

  it("efface la clé « collapsed » quand elle repasse à faux, plutôt que d'écrire false", () => {
    // Le fichier est versionné : un « collapsed: false » sur chaque pane
    // jamais réduit polluerait le diff de tout le monde.
    const folded = updatePane(base, 'a', { collapsed: true })
    expect(folded.ok).toBe(true)
    if (!folded.ok) return
    const unfolded = updatePane(folded.layout, 'a', { collapsed: false })
    expect(unfolded.ok).toBe(true)
    if (!unfolded.ok) return
    expect(unfolded.layout.panes[0]).not.toHaveProperty('collapsed')
  })
})

describe('movePane', () => {
  it("remonte un pane d'un cran sans toucher au reste", () => {
    const result = movePane(base, 'b', 'up')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.layout.panes.map((pane) => pane.id)).toEqual(['b', 'a'])
    expect(result.layout.panes[1]).toMatchObject({ command: 'npm run dev' })
  })

  it("descend un pane d'un cran", () => {
    const result = movePane(base, 'a', 'down')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.layout.panes.map((pane) => pane.id)).toEqual(['b', 'a'])
  })

  it('refuse de sortir des extrémités', () => {
    expect(movePane(base, 'a', 'up').ok).toBe(false)
    expect(movePane(base, 'b', 'down').ok).toBe(false)
  })

  it('refuse un pane inconnu', () => {
    const result = movePane(base, 'inexistant', 'up')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message).toContain('introuvable')
  })
})

describe('panesNeedingRestart', () => {
  it('ignore un pane replié : le terminal continue de tourner derrière la barre', () => {
    const folded = updatePane(base, 'a', { collapsed: true })
    expect(folded.ok).toBe(true)
    if (!folded.ok) return
    expect(panesNeedingRestart(base, folded.layout)).toEqual([])
  })

  it('ignore un changement de couleur : repeindre un contour ne tue pas un shell', () => {
    const recolored = updatePane(base, 'a', { color: 'purple' })
    expect(recolored.ok).toBe(true)
    if (!recolored.ok) return
    expect(panesNeedingRestart(base, recolored.layout)).toEqual([])
  })

  it('ignore un simple renommage', () => {
    const renamed = updatePane(base, 'a', { title: 'nouveau nom' })
    expect(renamed.ok).toBe(true)
    if (!renamed.ok) return
    expect(panesNeedingRestart(base, renamed.layout)).toEqual([])
  })

  it('ignore un déplacement dans le flux', () => {
    const moved = movePane(base, 'a', 'down')
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
