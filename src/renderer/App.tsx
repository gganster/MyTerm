import { useEffect, useState } from 'react'
import { PaneView } from './components/Grid/PaneView'
import type { ResolvedThemeName } from './theme/palette'

/**
 * Task 04 shell: a single full-window terminal.
 * Task 06 replaces this with the grid, task 13 with the project picker.
 */
export function App(): React.JSX.Element {
  const [theme, setTheme] = useState<ResolvedThemeName>('light')

  useEffect(() => {
    void window.myterm.theme.resolve().then(setTheme)
    return window.myterm.theme.onSystemChanged(setTheme)
  }, [])

  return (
    <div className="flex h-full flex-col bg-surface text-text">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5 text-xs text-text-muted">
        <span className="font-semibold text-text">MyTerm</span>
        <span aria-hidden>·</span>
        <span data-testid="pane-label">scratch</span>
      </header>
      <main className="min-h-0 flex-1">
        <PaneView paneId="scratch" theme={theme} />
      </main>
    </div>
  )
}
