import { describe, expect, it } from 'vitest'
import { PANE_COLORS } from '@shared/schema/layout'
import type { PaneColor } from '@shared/schema/layout'
import { dark, light, paneBorderColor } from '../../src/renderer/theme/palette'

/**
 * The pane border palette, checked as *numbers* rather than looked at.
 *
 * The promise this feature makes is not "there are eight colours": it is that
 * each one stays visible and stays itself whichever theme you are in. Both
 * halves of that are measurable, and measuring them is the only way a later
 * "let's just brighten the yellow" cannot quietly break it.
 *
 * The thresholds come from WCAG 1.4.11 (non-text contrast, 3:1). The values in
 * palette.ts sit far above it — the assertions are a floor, not a target.
 */

/** WCAG relative luminance. */
function luminance(hex: string): number {
  const channels = [1, 3, 5]
    .map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

/** HSL hue in degrees — the axis on which two colours read as *different*. */
function hue(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255) as [
    number,
    number,
    number,
  ]
  const max = Math.max(r, g, b)
  const delta = max - Math.min(r, g, b)
  if (delta === 0) return 0
  const sector = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4
  return (sector * 60 + 360) % 360
}

/** Shortest angular distance, so 356° and 4° are 8° apart and not 352°. */
function hueGap(a: number, b: number): number {
  const raw = Math.abs(a - b) % 360
  return Math.min(raw, 360 - raw)
}

const themes = [
  { name: 'light', palette: light, surface: light.chrome.surface },
  { name: 'dark', palette: dark, surface: dark.chrome.surface },
] as const

describe('palette des contours de pane', () => {
  it('définit les huit couleurs dans les deux thèmes, sans doublon', () => {
    for (const { name, palette } of themes) {
      const values = PANE_COLORS.map((color) => palette.paneBorder[color])
      expect(values.filter(Boolean), name).toHaveLength(PANE_COLORS.length)
      expect(values.every((value) => /^#[0-9a-f]{6}$/.test(value)), name).toBe(true)
      expect(new Set(values).size, name).toBe(PANE_COLORS.length)
    }
  })

  it("n'expose aucune couleur que le schéma ne connaît pas", () => {
    // The other direction of the same guarantee: a stale name left in the
    // palette after a rename would never be reachable from a file.
    for (const { name, palette } of themes) {
      expect(Object.keys(palette.paneBorder).sort(), name).toEqual([...PANE_COLORS].sort())
    }
  })

  it('reste visible sur le fond de son thème (≥ 3:1, WCAG 1.4.11)', () => {
    for (const { name, palette, surface } of themes) {
      for (const color of PANE_COLORS) {
        const ratio = contrast(palette.paneBorder[color], surface)
        expect(ratio, `${name}/${color} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it('reste visible sur la gouttière de la grille, pas seulement sur le pane', () => {
    // The border is drawn between the pane and the sunken area around it: a
    // colour that only clears the pane background is half-invisible.
    for (const { name, palette } of themes) {
      for (const color of PANE_COLORS) {
        const ratio = contrast(palette.paneBorder[color], palette.chrome.surfaceSunken)
        expect(ratio, `${name}/${color} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it('garde les huit teintes distinguables entre elles (≥ 20° dans chaque thème)', () => {
    // 20°, la valeur annoncée par le commentaire de PANE_COLORS. Un seuil plus
    // bas que la promesse écrite ne teste pas la promesse.
    for (const { name, palette } of themes) {
      const hues = PANE_COLORS.map((color) => ({ color, deg: hue(palette.paneBorder[color]) })).sort(
        (a, b) => a.deg - b.deg,
      )
      for (const [index, current] of hues.entries()) {
        const next = hues[(index + 1) % hues.length]!
        const gap = hueGap(current.deg, next.deg)
        expect(gap, `${name}: ${current.color} vs ${next.color} = ${gap.toFixed(1)}°`).toBeGreaterThanOrEqual(20)
      }
    }
  })

  it("l'indicateur de focus reste lisible dans l'écart qui le sépare du contour", () => {
    // Le piège que ce test garde : `accent` EST un bleu — 1,9° et 1,08:1 de
    // `paneBorder.blue`. Un anneau de focus collé au contour d'un pane bleu est
    // donc invisible, et aucune contrainte sur la palette ne peut y remédier
    // sans interdire le bleu, qui est exactement la couleur qu'on veut offrir.
    // La réparation est géométrique (`outline-offset-2`, PaneView) : l'anneau
    // est séparé du contour par deux pixels de fond de grille. Ce qui doit
    // alors tenir, et ce qu'on vérifie ici, c'est que l'accent tranche sur ce
    // fond-là — pas sur les huit couleurs, qu'il ne touche jamais.
    for (const { name, palette } of themes) {
      const ratio = contrast(palette.chrome.accent, palette.chrome.surfaceSunken)
      expect(ratio, `${name}: accent sur gouttière = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3)
    }
  })

  it('documente le fait qui rend cet écart nécessaire', () => {
    // Si un jour l'accent s'éloigne du bleu, l'écart devient superflu et ce
    // test le dira — il échouera, et on pourra simplifier PaneView.
    const clash = themes.some(({ palette }) =>
      PANE_COLORS.some((color) => contrast(palette.paneBorder[color], palette.chrome.accent) < 3),
    )
    expect(clash).toBe(true)
  })

  it('garde chaque couleur reconnaissable au changement de thème (≤ 15° de dérive)', () => {
    // "Légère variation" is the requirement: the luminance changes so the
    // colour survives the background, the hue does not — a blue project must
    // not become a teal one because someone flipped the theme.
    for (const color of PANE_COLORS) {
      const drift = hueGap(hue(light.paneBorder[color]), hue(dark.paneBorder[color]))
      expect(drift, `${color} dérive de ${drift.toFixed(1)}°`).toBeLessThanOrEqual(15)
    }
  })

  it('éclaircit en thème sombre et fonce en thème clair', () => {
    // The variation is not arbitrary: every colour is lighter than the light
    // theme's white-facing version once it has to sit on a near-black pane.
    for (const color of PANE_COLORS) {
      expect(luminance(dark.paneBorder[color]), color).toBeGreaterThan(
        luminance(light.paneBorder[color]),
      )
    }
  })
})

describe('paneBorderColor', () => {
  it('rend null sans couleur : le défaut reste la bordure du thème', () => {
    expect(paneBorderColor('light', undefined)).toBeNull()
    expect(paneBorderColor('dark', undefined)).toBeNull()
  })

  it('rend la valeur du thème demandé', () => {
    // Des littéraux, pas `light.paneBorder.blue` : indexer le même objet que la
    // fonction ferait un test qui ne peut pas échouer sur une mauvaise valeur.
    expect(paneBorderColor('light', 'blue')).toBe('#0969da')
    expect(paneBorderColor('dark', 'blue')).toBe('#58a6ff')
    expect(paneBorderColor('light', 'yellow')).toBe('#8a6d00')
    expect(paneBorderColor('dark', 'yellow')).toBe('#d8b024')
  })

  it('rend null plutôt que undefined sur un nom inconnu venu du disque', () => {
    // The schema rejects these, but the renderer must not paint `undefined`
    // into a style attribute if one ever gets past it.
    expect(paneBorderColor('light', 'turquoise' as PaneColor)).toBeNull()
  })

  it("ne rend jamais une clé héritée d'Object.prototype", () => {
    // `paneBorder['constructor']` rend une *fonction* : truthy, donc elle
    // passerait un simple `?? null` et finirait dans un attribut style — et,
    // côté PaneView, ferait basculer le pane dans la branche « coloré ».
    for (const inherited of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) {
      expect(paneBorderColor('light', inherited as PaneColor), inherited).toBeNull()
      expect(paneBorderColor('dark', inherited as PaneColor), inherited).toBeNull()
    }
  })
})
