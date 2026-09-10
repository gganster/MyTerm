/**
 * The single source of truth for colour in MyTerm.
 *
 * The theme lives in two places that must never drift: the app chrome (CSS
 * variables consumed by Tailwind) and the ANSI palette of every xterm instance.
 * Both are generated from the objects below, so a colour is defined once.
 *
 * The light palette is designed first, not derived by inverting the dark one.
 * That is the whole point of the product (PRD problem statement), and it is not
 * cosmetic: the standard bright ANSI colours are unreadable on white. Yellow in
 * particular has to become dark amber, and the bright variants must go *darker*
 * than their normal counterparts rather than lighter.
 */
import type { PaneColor } from '@shared/schema/layout'

export interface AnsiPalette {
  background: string
  foreground: string
  cursor: string
  cursorAccent: string
  selectionBackground: string
  black: string
  red: string
  green: string
  yellow: string
  blue: string
  magenta: string
  cyan: string
  white: string
  brightBlack: string
  brightRed: string
  brightGreen: string
  brightYellow: string
  brightBlue: string
  brightMagenta: string
  brightCyan: string
  brightWhite: string
}

export interface ChromePalette {
  surface: string
  surfaceRaised: string
  surfaceSunken: string
  border: string
  borderStrong: string
  text: string
  textMuted: string
  accent: string
  accentContrast: string
  statusRunning: string
  statusAttention: string
  statusIdle: string
  statusExited: string
  /**
   * The two quota bars, coloured by *whose* quota they are.
   *
   * The footer used to name each agent in words; with two agents and four
   * gauges the words cost more room than the bar itself, so the name became a
   * logo and the fill became the second half of that identity (see StatusBar).
   *
   * Which means the fill can no longer carry severity as well: `warn` is left
   * to the number, and only `critical` overrides the identity — at 90 % it no
   * longer matters whose quota it is. Orange and amber are the same hue family
   * and no orange sits far from `statusAttention`, so the warn step is carried
   * by the number's colour *and* its weight rather than by hue alone.
   */
  quotaClaude: string
  quotaCodex: string
}

/**
 * The eight pane border colours, one entry per name in `PANE_COLORS`.
 *
 * `Record` rather than an interface: adding a name to the schema then breaks
 * both themes at compile time, which is the only way two lists this far apart
 * stay in step.
 */
export type PaneBorderPalette = Record<PaneColor, string>

export interface Palette {
  chrome: ChromePalette
  ansi: AnsiPalette
  paneBorder: PaneBorderPalette
}

export const light: Palette = {
  chrome: {
    surface: '#ffffff',
    surfaceRaised: '#f6f7f9',
    surfaceSunken: '#eceef1',
    border: '#e2e4e9',
    borderStrong: '#c9ced6',
    text: '#1c1f26',
    textMuted: '#646b76',
    accent: '#0b62d6',
    accentContrast: '#ffffff',
    statusRunning: '#1a7f37',
    statusAttention: '#bc4c00',
    statusIdle: '#8c959f',
    statusExited: '#a40e26',
    // 5.2:1 on the footer and 4.5:1 on the gauge track — a bar this thin has
    // to clear WCAG's 3:1 for graphical objects with room to spare.
    quotaClaude: '#c2410c',
    // Deliberately the same green as `statusRunning` rather than a second one
    // a few degrees away: two greens nobody can tell apart is how a palette
    // rots. Codex is green, and green already means nominal here.
    quotaCodex: '#1a7f37',
  },
  ansi: {
    background: '#ffffff',
    foreground: '#1c1f26',
    cursor: '#0b62d6',
    cursorAccent: '#ffffff',
    selectionBackground: '#bcd9ff',
    black: '#1c1f26',
    red: '#cf222e',
    green: '#116329',
    // Pure yellow on white is invisible: dark amber instead.
    yellow: '#7d4e00',
    blue: '#0550ae',
    magenta: '#7b3fbf',
    cyan: '#1b6f78',
    white: '#6e7781',
    // "Bright" must mean *more contrast*, which on white means darker.
    brightBlack: '#57606a',
    brightRed: '#a40e26',
    brightGreen: '#0d5122',
    brightYellow: '#633c01',
    brightBlue: '#0a3d91',
    brightMagenta: '#5f2da8',
    brightCyan: '#125861',
    brightWhite: '#404752',
  },
  // Held at ~4.9:1 against the white pane and ~4.2:1 against the sunken gutter,
  // so no colour reads as "the faint one". The dark set below carries the same
  // eight hues (±9°) at the luminance that side needs: a project keeps its
  // identity across a theme switch, it does not get recoloured.
  paneBorder: {
    red: '#d1242f',
    orange: '#c4460a',
    // Not a true yellow: on white it would be invisible, and it has to stay
    // ~25° clear of orange to remain a *different* marker.
    yellow: '#8a6d00',
    green: '#1a7f37',
    cyan: '#1b7c83',
    blue: '#0969da',
    purple: '#8250df',
    pink: '#bf3989',
  },
}

export const dark: Palette = {
  chrome: {
    surface: '#16181d',
    surfaceRaised: '#1d2027',
    surfaceSunken: '#101216',
    border: '#2a2f38',
    borderStrong: '#3d4450',
    text: '#d9dee6',
    textMuted: '#8b939f',
    accent: '#4c8dff',
    accentContrast: '#0b1220',
    statusRunning: '#3fb950',
    statusAttention: '#f0883e',
    statusIdle: '#6e7681',
    statusExited: '#ff7b72',
    // Pulled toward coral rather than sitting on `statusAttention`: identical
    // to the amber it would be indistinguishable from the warn number, and the
    // point of this colour is to say "Claude", not "attention".
    quotaClaude: '#ef8354',
    quotaCodex: '#3fb950',
  },
  ansi: {
    background: '#16181d',
    foreground: '#d9dee6',
    cursor: '#4c8dff',
    cursorAccent: '#16181d',
    selectionBackground: '#2f4b73',
    black: '#484f58',
    red: '#ff7b72',
    green: '#3fb950',
    yellow: '#d29922',
    blue: '#58a6ff',
    magenta: '#bc8cff',
    cyan: '#39c5cf',
    white: '#b1bac4',
    brightBlack: '#6e7681',
    brightRed: '#ffa198',
    brightGreen: '#56d364',
    brightYellow: '#e3b341',
    brightBlue: '#79c0ff',
    brightMagenta: '#d2a8ff',
    brightCyan: '#56d4dd',
    brightWhite: '#f0f6fc',
  },
  // Same eight hues as the light set, lifted to ~7:1 against the dark pane.
  paneBorder: {
    red: '#ff7b72',
    orange: '#fa9b52',
    yellow: '#d8b024',
    green: '#3fb950',
    cyan: '#39c5cf',
    blue: '#58a6ff',
    purple: '#bc8cff',
    pink: '#f778ba',
  },
}

export const palettes = { light, dark } as const
export type ResolvedThemeName = keyof typeof palettes

export function paletteFor(theme: ResolvedThemeName): Palette {
  return palettes[theme]
}

/**
 * The border a pane should paint, or null for "use the theme's own border".
 *
 * Returning null rather than the default border value keeps the fallback in
 * CSS, where the theme already lives: an uncoloured pane goes on following
 * `--mt-border` without this function having to know what that is.
 */
export function paneBorderColor(theme: ResolvedThemeName, color?: PaneColor): string | null {
  if (!color) return null
  const { paneBorder } = palettes[theme]
  // hasOwn, not `?? null`: the schema rejects unknown names long before this,
  // but `paneBorder['constructor']` would return a *function* — truthy, so it
  // would sail past a nullish check and reach a style attribute. Own keys only.
  return Object.hasOwn(paneBorder, color) ? paneBorder[color] : null
}
