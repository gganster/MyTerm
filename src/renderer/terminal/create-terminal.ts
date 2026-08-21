import { Terminal } from '@xterm/xterm'
import type { ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { paletteFor } from '../theme/palette'
import type { ResolvedThemeName } from '../theme/palette'
import type { TerminalHandle } from './registry'
import { isAppShortcut } from '../hooks/use-shortcuts'

export function ansiTheme(theme: ResolvedThemeName): ITheme {
  // A fresh object every time on purpose: xterm compares `theme` by reference,
  // so mutating the previous one silently does nothing (ARCHI § Thème).
  return { ...paletteFor(theme).ansi }
}

export function createTerminal(theme: ResolvedThemeName): TerminalHandle {
  const terminal = new Terminal({
    fontFamily: '"Cascadia Mono", "Cascadia Code", Consolas, "Courier New", monospace',
    fontSize: 13,
    lineHeight: 1.2,
    cursorBlink: true,
    scrollback: 5000,
    allowProposedApi: true,
    theme: ansiTheme(theme),
  })

  const fit = new FitAddon()
  terminal.loadAddon(fit)

  // Returning false stops xterm from forwarding the key to the pty. Only the
  // app's own Ctrl+Shift bindings are withheld; everything else, Ctrl+C first
  // among them, belongs to whatever runs in the pane.
  terminal.attachCustomKeyEventHandler((event) => !isAppShortcut(event))

  const handle: TerminalHandle = {
    terminal,
    fit,
    renderer: 'dom',
    dispose: () => terminal.dispose(),
  }

  // WebGL is ~10x faster on verbose output, but Chromium caps the number of
  // live contexts (~16). Rather than budgeting contexts, we let it fail and
  // fall back: unloading the addon returns this terminal to xterm's built-in
  // DOM renderer. Only that pane degrades.
  try {
    const webgl = new WebglAddon()
    webgl.onContextLoss(() => {
      console.warn('[myterm] contexte WebGL perdu, repli sur le renderer DOM')
      handle.renderer = 'dom'
      webgl.dispose()
    })
    terminal.loadAddon(webgl)
    handle.renderer = 'webgl'
  } catch (error) {
    console.warn('[myterm] WebGL indisponible, rendu DOM', error)
  }

  return handle
}
