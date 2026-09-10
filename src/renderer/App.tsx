import { useEffect, useState } from 'react'
import { CollapsedBar } from './components/Grid/CollapsedBar'
import { GridView } from './components/Grid/GridView'
import { LayoutEditor } from './components/LayoutEditor/LayoutEditor'
import { ProjectPicker } from './components/ProjectPicker/ProjectPicker'
import { StatusBar } from './components/StatusBar/StatusBar'
import { OpenInEditor } from './components/OpenInEditor'
import { ReloadBanner } from './components/ReloadBanner'
import { UpdateBanner } from './components/UpdateBanner'
import { ThemeToggle } from './components/ThemeToggle'
import { TrustDialog } from './components/TrustDialog/TrustDialog'
import { useAutosave } from './hooks/use-autosave'
import { useShortcuts } from './hooks/use-shortcuts'
import { useWorkspace } from './hooks/use-workspace'
import { useStore } from './store'
import { applyTheme } from './theme/apply'

export function App(): React.JSX.Element {
  useShortcuts()

  const workspace = useWorkspace()
  const { saveError, saveNow } = useAutosave()
  const editorOpen = useStore((state) => state.editorOpen)
  const setEditorOpen = useStore((state) => state.setEditorOpen)
  const restartPane = useStore((state) => state.restartPane)
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

  // `myterm .` reaches the main process, which asks the renderer to open that
  // path. It goes through the very same open() as the picker and the recent
  // list, so the trust gate cannot be bypassed by using the CLI.
  useEffect(() => {
    window.__mytermOpenProject = workspace.open
    return window.myterm.app.onOpenProjectRequest((projectPath) => {
      void workspace.open(projectPath)
    })
  }, [workspace.open])

  const [update, setUpdate] = useState<{ version: string } | null>(null)
  useEffect(() => window.myterm.app.onUpdateReady(setUpdate), [])

  // A boolean, not the runtime record: subscribing to the record itself would
  // re-render App — and with it the whole grid — on every status tick, several
  // times a second (ARCHI § State Management).
  const hasLivePanes = useStore((state) =>
    Object.values(state.runtime).some((pane) => pane.status !== 'exited'),
  )
  const updateBanner = update ? (
    <UpdateBanner
      version={update.version}
      hasLivePanes={hasLivePanes}
      onRestart={() => {
        // `force` carries the user's acceptance of losing the running panes.
        void window.myterm.app.installUpdate(hasLivePanes)
      }}
      onLater={() => setUpdate(null)}
    />
  ) : null

  const trust = workspace.pendingTrust

  if (!projectPath) {
    return (
      // The picker fills the window, so a banner above it needs a flex column
      // or the two together overflow.
      <div className="flex h-full flex-col">
        {updateBanner}
        <ProjectPicker
          preferences={workspace.preferences}
          error={workspace.error}
          onOpen={(path) => void workspace.open(path)}
          onPick={() => void workspace.pick()}
          onForget={(path) => void workspace.forget(path)}
        />
        <StatusBar />
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
        <OpenInEditor />
        {dirty ? (
          <span data-dirty className="text-[11px] text-status-attention">
            • non enregistré
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            data-action="toggle-editor"
            aria-pressed={editorOpen}
            onClick={() => setEditorOpen(!editorOpen)}
            className="rounded px-2 py-1 text-xs text-text-muted hover:bg-surface-sunken hover:text-text"
          >
            Layout
          </button>
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

      {updateBanner}

      {workspace.changedOnDisk ? (
        <ReloadBanner
          conflicting={dirty}
          onReload={() => void workspace.reload()}
          onDismiss={workspace.dismissDiskChange}
        />
      ) : null}

      {saveError ? (
        <p
          data-save-error
          className="shrink-0 border-b border-border bg-status-exited/10 px-3 py-1 text-[11px] whitespace-pre-wrap text-status-exited"
        >
          échec de la sauvegarde : {saveError}
        </p>
      ) : null}

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

      <div className="flex min-h-0 flex-1">
        {/* The folded panes belong to the pane area, not to the window: the bar
            stops at the layout editor's edge and sits above the status bar,
            which is the app's own footer and stays clickable-free. */}
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* The grid keeps its own `h-full`; this wrapper is what gives that
              percentage something definite to resolve against once the bar
              takes its share of the column. */}
          <div className="min-h-0 flex-1">
            <GridView />
          </div>
          <CollapsedBar />
        </main>
        {editorOpen ? (
          <LayoutEditor
            onClose={() => setEditorOpen(false)}
            onRestartPane={async (paneId) => {
              // Flush the debounced save so the main process already knows the
              // new spec when the pane respawns.
              await saveNow()
              restartPane(paneId)
            }}
          />
        ) : null}
      </div>

      <StatusBar />

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
