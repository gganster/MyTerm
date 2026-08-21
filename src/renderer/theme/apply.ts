import { paletteFor } from './palette'
import type { ResolvedThemeName } from './palette'
import { ansiTheme } from '../terminal/create-terminal'
import { allTerminals } from '../terminal/registry'

/**
 * Pushes a resolved theme everywhere it has to exist.
 *
 * palette.ts holds the values; this writes them into CSS custom properties that
 * the Tailwind tokens in globals.css point at. Nothing is duplicated in CSS, and
 * the chrome repaints without a single React re-render.
 */
export function applyTheme(theme: ResolvedThemeName): void {
  const root = document.documentElement
  const { chrome } = paletteFor(theme)

  for (const [token, value] of Object.entries(chrome)) {
    // camelCase -> kebab-case: surfaceRaised -> --mt-surface-raised
    const name = token.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)
    root.style.setProperty(`--mt-${name}`, value)
  }

  root.dataset['theme'] = theme
  root.style.colorScheme = theme

  // xterm compares `theme` by reference: mutating the existing object does
  // nothing, so every terminal gets a fresh one (ARCHI § Thème).
  const next = ansiTheme(theme)
  for (const handle of allTerminals()) {
    handle.terminal.options.theme = { ...next }
  }
}
