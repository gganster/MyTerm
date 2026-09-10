import { describe, expect, it } from 'vitest'
import { QUOTA_PROVIDERS } from '@shared/quota'
import { dark, light } from '../../src/renderer/theme/palette'

/**
 * The two quota-bar colours, checked as numbers rather than looked at.
 *
 * The promise these colours make is not "there is an orange and a green": it
 * is that a glance at the footer tells you *whose* quota you are reading, in
 * either theme, without reading a word. Both halves of that are measurable.
 *
 * The escalation assertion is the one that matters most and is the least
 * obvious. Colour on these bars means identity, so `critical` is the only
 * state allowed to take the fill back — and it can only do that if red reads
 * as different from both provider colours. Orange and red are neighbours on
 * the wheel, so the floor here is deliberately low and the design does not
 * lean on it alone: the track is tinted and the number goes bold as well
 * (see StatusBar). This test exists so that a later "let's warm the orange up
 * a bit" cannot quietly close the gap the rest of the way.
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
function hueGap(a: string, b: string): number {
  const raw = Math.abs(hue(a) - hue(b)) % 360
  return Math.min(raw, 360 - raw)
}

const themes = [
  { name: 'light', palette: light },
  { name: 'dark', palette: dark },
] as const

const colorOf = (chrome: (typeof light)['chrome'], provider: (typeof QUOTA_PROVIDERS)[number]): string =>
  provider === 'claude' ? chrome.quotaClaude : chrome.quotaCodex

describe('couleurs des jauges de quota', () => {
  it('définit une couleur par fournisseur dans les deux thèmes', () => {
    for (const { name, palette } of themes) {
      for (const provider of QUOTA_PROVIDERS) {
        expect(colorOf(palette.chrome, provider), `${name}/${provider}`).toMatch(
          /^#[0-9a-f]{6}$/,
        )
      }
    }
  })

  it('reste lisible sur le pied de page et sur la piste de la jauge', () => {
    // WCAG 1.4.11, objets non textuels : 3:1. Une barre de 4 px de haut n'a
    // aucune marge pour être « presque » visible.
    for (const { name, palette } of themes) {
      for (const provider of QUOTA_PROVIDERS) {
        const value = colorOf(palette.chrome, provider)
        expect(contrast(value, palette.chrome.surface), `${name}/${provider}/surface`).toBeGreaterThanOrEqual(3)
        expect(
          contrast(value, palette.chrome.surfaceSunken),
          `${name}/${provider}/piste`,
        ).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it('sépare franchement les deux fournisseurs', () => {
    // C'est la seule chose que la couleur a maintenant à dire ; si les deux se
    // rapprochaient, elle ne dirait plus rien du tout.
    for (const { name, palette } of themes) {
      expect(
        hueGap(palette.chrome.quotaClaude, palette.chrome.quotaCodex),
        name,
      ).toBeGreaterThanOrEqual(60)
    }
  })

  it("laisse le rouge critique se distinguer de l'identité qu'il remplace", () => {
    for (const { name, palette } of themes) {
      for (const provider of QUOTA_PROVIDERS) {
        expect(
          hueGap(colorOf(palette.chrome, provider), palette.chrome.statusExited),
          `${name}/${provider}`,
        ).toBeGreaterThanOrEqual(12)
      }
    }
  })

  it("n'est pas identique à l'ambre d'alerte, qui coexiste avec elle", () => {
    // Le chiffre passe en ambre à 75 % pendant que la barre garde sa couleur
    // de fournisseur. Deux valeurs strictement égales rendraient ce palier
    // invisible sur Claude — d'où aussi le passage en gras côté chiffre.
    for (const { name, palette } of themes) {
      expect(palette.chrome.quotaClaude, name).not.toBe(palette.chrome.statusAttention)
    }
  })
})
