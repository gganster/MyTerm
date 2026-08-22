import { useEffect } from 'react'
import { GridView } from './components/Grid/GridView'
import { ProjectPicker } from './components/ProjectPicker/ProjectPicker'
import { ThemeToggle } from './components/ThemeToggle'
import { TrustDialog } from './components/TrustDialog/TrustDialog'
import { useShortcuts } from './hooks/use-shortcuts'
import { useWorkspace } from './hooks/use-workspace'
import { useStore } from './store'
import { applyTheme } from './theme/apply'

export function App(): React.JSX.Element {
  useShortcuts()

  const workspace = useWorkspace()
  const projectPath = useStore((state) => state.projectPath)
  const projectName = useStore((state) => state.projectName)
  const dirty = useStore((state) => state.dirty)
  const setResolvedTheme = useStore((state) => state.setResolvedTheme)
  const resolvedTheme = useStore((state) => state.resolvedTheme)

  useEffect(() => {
    void window.myterm.theme.resolve().then((resolved) => {
      setResolvedTheme(resolved)
      applyTheme(resolved)
    })
    return window.myterm.theme.onSystemChanged((resolved) => {
      if (useStore.getState().themeMode !== 'system') return
      setResolvedTheme(resolved)
      applyTheme(resolved)
    })
  }, [setResolvedTheme])

  useEffect(() => {
    applyTheme(resolvedTheme)
  }, [resolvedTheme])

  // Exposed for the CLI: `myterm .` reaches the main process, which asks the
  // renderer to open that path through the same single code path as every
  // other entry point (task 14).
  useEffect(() => {
    window.__mytermOpenProject = workspace.open
  }, [workspace.open])

  const trust = workspace.pendingTrust

  if (!projectPath) {
    return (
      <>
        <ProjectPicker
          preferences={workspace.preferences}
          error={workspace.error}
          onOpen={(path) => void workspace.open(path)}
          onPick={() => void workspace.pick()}
          onForget={(path) => void workspace.forget(path)}
        />
        {trust ? (
          <TrustDialog
            projectPath={trust.projectPath}
            projectName={trust.projectName}
            commands={trust.commands}
            onApprove={() => void workspace.decideTrust('approve')}
            onOpenWithoutExecuting={() => void workspace.decideTrust('open-without-executing')}
            onCancel={() => void workspace.decideTrust('cancel')}
          />
        ) : null}
      </>
    )
  }

  return (
    <div className="flex h-full flex-col bg-surface text-text">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5 text-xs">
        <span className="font-semibold">MyTerm</span>
        <span className="text-text-muted" aria-hidden>
          ·
        </span>
        <span className="truncate text-text-muted" title={projectPath}>
          {projectName}
        </span>
        {dirty ? (
          <span data-dirty className="text-[11px] text-status-attention">
            • non enregistré
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            data-action="close-workspace"
            onClick={() => void workspace.close()}
            className="rounded px-2 py-1 text-xs text-text-muted hover:bg-surface-sunken hover:text-text"
          >
            Fermer le projet
          </button>
          <ThemeToggle />
        </div>
      </header>

      {workspace.warnings.length > 0 ? (
        <ul
          data-workspace-warnings
          className="shrink-0 border-b border-border bg-status-attention/10 px-3 py-1 text-[11px] text-status-attention"
        >
          {workspace.warnings.map((warning) => (
            <li key={warning.paneId}>
              {warning.paneId} : {warning.message}
            </li>
          ))}
        </ul>
      ) : null}

      <main className="min-h-0 flex-1">
        <GridView />
      </main>

      {trust ? (
        <TrustDialog
          projectPath={trust.projectPath}
          projectName={trust.projectName}
          commands={trust.commands}
          onApprove={() => void workspace.decideTrust('approve')}
          onOpenWithoutExecuting={() => void workspace.decideTrust('open-without-executing')}
          onCancel={() => void workspace.decideTrust('cancel')}
        />
      ) : null}
    </div>
  )
}

declare global {
  interface Window {
    __mytermOpenProject: (projectPath: string) => Promise<void>
  }
}
