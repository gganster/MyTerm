import { useEffect } from 'react'
import type { Layout } from '@shared/schema/layout'
import { LAYOUT_VERSION } from '@shared/schema/layout'
import { GridView } from './components/Grid/GridView'
import { ThemeToggle } from './components/ThemeToggle'
import { useShortcuts } from './hooks/use-shortcuts'
import { useStore } from './store'
import { applyTheme } from './theme/apply'

/**
 * Staging layout for task 06: a hard-coded 3×2 grid matching the PRD example.
 * Task 11 replaces it with the validated `.myterm.json`, task 13 with the
 * project picker as the entry point.
 */
const STAGING_LAYOUT: Layout = {
  version: LAYOUT_VERSION,
  name: 'scratch',
  theme: 'system',
  grid: { cols: 3, rows: 2 },
  defaults: { shell: 'pwsh', cwd: '.' },
  panes: [
    { id: 'claude-1', title: 'Claude · feature', col: 0, row: 0, cwd: '.' },
    { id: 'claude-2', title: 'Claude · review', col: 1, row: 0, cwd: '.' },
    { id: 'claude-3', title: 'Claude · libre', col: 2, row: 0, cwd: '.' },
    { id: 'web', title: 'frontend', col: 0, row: 1, cwd: '.' },
    { id: 'api', title: 'backend', col: 1, row: 1, cwd: '.' },
    { id: 'free', title: 'scratch', col: 2, row: 1, cwd: '.' },
  ],
}

export function App(): React.JSX.Element {
  useShortcuts()
  const projectName = useStore((state) => state.projectName)
  const setResolvedTheme = useStore((state) => state.setResolvedTheme)
  const replaceLayout = useStore((state) => state.replaceLayout)

  // Theme first, before anything paints a wrong colour.
  useEffect(() => {
    void window.myterm.theme.resolve().then((resolved) => {
      setResolvedTheme(resolved)
      applyTheme(resolved)
    })

    // Only meaningful in `system` mode, but harmless otherwise: the main
    // process only emits when nativeTheme actually flips.
    return window.myterm.theme.onSystemChanged((resolved) => {
      if (useStore.getState().themeMode !== 'system') return
      setResolvedTheme(resolved)
      applyTheme(resolved)
    })
  }, [setResolvedTheme])

  // Re-apply whenever the resolved theme changes for any reason (toggle or OS).
  const resolvedTheme = useStore((state) => state.resolvedTheme)
  useEffect(() => {
    applyTheme(resolvedTheme)
  }, [resolvedTheme])

  useEffect(() => {
    replaceLayout(STAGING_LAYOUT, { markDirty: false })
  }, [replaceLayout])

  return (
    <div className="flex h-full flex-col bg-surface text-text">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5 text-xs">
        <span className="font-semibold">MyTerm</span>
        <span className="text-text-muted" aria-hidden>
          ·
        </span>
        <span className="text-text-muted">{projectName ?? 'aucun projet'}</span>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </header>
      <main className="min-h-0 flex-1">
        <GridView />
      </main>
    </div>
  )
}
