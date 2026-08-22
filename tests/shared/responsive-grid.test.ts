import { describe, expect, it } from 'vitest'
import { columnsForWidth, neighbourIndex } from '@shared/responsive-grid'

describe('columnsForWidth', () => {
  it('donne trois panes par ligne en plein écran', () => {
    expect(columnsForWidth(1920, 6)).toBe(3)
    expect(columnsForWidth(2560, 6)).toBe(3)
  })

  it('donne deux panes par ligne sur un demi-grand-écran', () => {
    expect(columnsForWidth(1440, 6)).toBe(2)
    expect(columnsForWidth(1201, 6)).toBe(2)
  })

  it('donne un pane par ligne en dessous', () => {
    expect(columnsForWidth(1200, 6)).toBe(1)
    expect(columnsForWidth(900, 6)).toBe(1)
    expect(columnsForWidth(320, 6)).toBe(1)
  })

  it('bascule exactement sur les seuils annoncés', () => {
    expect(columnsForWidth(1600, 6)).toBe(2)
    expect(columnsForWidth(1601, 6)).toBe(3)
  })

  it('ne crée jamais plus de colonnes que de panes', () => {
    // Two panes on a 4K screen take half the width each, not two thirds with a
    // hole on the right.
    expect(columnsForWidth(2560, 2)).toBe(2)
    expect(columnsForWidth(2560, 1)).toBe(1)
  })

  it('survit à une largeur nulle ou absurde pendant le premier rendu', () => {
    expect(columnsForWidth(0, 4)).toBe(1)
    expect(columnsForWidth(Number.NaN, 4)).toBe(1)
    expect(columnsForWidth(1920, 0)).toBe(1)
  })
})

describe('neighbourIndex', () => {
  // Six panes on three columns:  0 1 2
  //                              3 4 5
  const count = 6
  const columns = 3

  it('se déplace dans la ligne', () => {
    expect(neighbourIndex(1, count, columns, 'ArrowLeft')).toBe(0)
    expect(neighbourIndex(1, count, columns, 'ArrowRight')).toBe(2)
  })

  it('se déplace entre les lignes', () => {
    expect(neighbourIndex(4, count, columns, 'ArrowUp')).toBe(1)
    expect(neighbourIndex(1, count, columns, 'ArrowDown')).toBe(4)
  })

  it('ne repasse pas à la ligne précédente en allant à gauche', () => {
    expect(neighbourIndex(3, count, columns, 'ArrowLeft')).toBeNull()
    expect(neighbourIndex(2, count, columns, 'ArrowRight')).toBeNull()
  })

  it('ne sort pas de la grille', () => {
    expect(neighbourIndex(0, count, columns, 'ArrowUp')).toBeNull()
    expect(neighbourIndex(5, count, columns, 'ArrowDown')).toBeNull()
  })

  it('ne vise pas une cellule vide de la dernière ligne', () => {
    // Five panes on three columns: index 4 is alone-ish on the second row and
    // has no neighbour to its right.
    expect(neighbourIndex(4, 5, 3, 'ArrowRight')).toBeNull()
    expect(neighbourIndex(2, 5, 3, 'ArrowDown')).toBeNull()
  })

  it('devient une simple liste verticale à une colonne', () => {
    expect(neighbourIndex(1, 3, 1, 'ArrowDown')).toBe(2)
    expect(neighbourIndex(1, 3, 1, 'ArrowUp')).toBe(0)
    expect(neighbourIndex(1, 3, 1, 'ArrowRight')).toBeNull()
    expect(neighbourIndex(1, 3, 1, 'ArrowLeft')).toBeNull()
  })

  it('tolère un nombre de colonnes pas encore mesuré', () => {
    expect(neighbourIndex(0, 3, 0, 'ArrowDown')).toBe(1)
  })
})
