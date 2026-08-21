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
}

export interface Palette {
  chrome: ChromePalette
  ansi: AnsiPalette
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
}

export const palettes = { light, dark } as const
export type ResolvedThemeName = keyof typeof palettes

export function paletteFor(theme: ResolvedThemeName): Palette {
  return palettes[theme]
}
