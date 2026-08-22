import type { Preferences, RecentProject } from '@shared/schema/preferences'
import { ThemeToggle } from '../ThemeToggle'

interface ProjectPickerProps {
  preferences: Preferences | null
  error: string | null
  onOpen: (projectPath: string) => void
  onPick: () => void
  onForget: (projectPath: string) => void
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(date)
}

function RecentRow({
  project,
  onOpen,
  onForget,
}: {
  project: RecentProject
  onOpen: (path: string) => void
  onForget: (path: string) => void
}): React.JSX.Element {
  // Missing is not the same as gone: an unplugged network drive should grey out,
  // not silently disappear from someone's list.
  const missing = project.missing === true

  return (
    <li className="group flex items-center gap-3 rounded-md border border-border bg-surface-raised px-3 py-2">
      <button
        type="button"
        data-recent-project={project.path}
        disabled={missing}
        onClick={() => onOpen(project.path)}
        className="flex min-w-0 flex-1 flex-col items-start text-left disabled:cursor-not-allowed"
      >
        <span className={`truncate text-sm ${missing ? 'text-text-muted' : 'text-text'}`}>
          {project.name}
          {missing ? ' · introuvable' : ''}
        </span>
        <span className="truncate font-mono text-[11px] text-text-muted" title={project.path}>
          {project.path}
        </span>
      </button>
      <span className="shrink-0 text-[11px] text-text-muted">
        {formatDate(project.lastOpenedAt)}
      </span>
      <button
        type="button"
        onClick={() => onForget(project.path)}
        aria-label={`Retirer ${project.name} de la liste`}
        title="Retirer de la liste"
        className="shrink-0 rounded px-1.5 py-0.5 text-xs text-text-muted opacity-0 transition-opacity hover:bg-surface-sunken hover:text-text group-hover:opacity-100"
      >
        ✕
      </button>
    </li>
  )
}

export function ProjectPicker({
  preferences,
  error,
  onOpen,
  onPick,
  onForget,
}: ProjectPickerProps): React.JSX.Element {
  const recents = preferences?.recentProjects ?? []

  return (
    <div className="flex h-full flex-col bg-surface text-text" data-project-picker>
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5 text-xs">
        <span className="font-semibold">MyTerm</span>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 overflow-auto p-8">
        <div className="flex items-baseline justify-between">
          <h1 className="text-lg font-semibold">Ouvrir un projet</h1>
          <button
            type="button"
            data-action="pick-folder"
            onClick={onPick}
            className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-accent-contrast hover:opacity-90"
          >
            Ouvrir un dossier…
          </button>
        </div>

        {error ? (
          <p
            data-open-error
            className="rounded border border-status-exited/40 bg-status-exited/10 px-3 py-2 text-xs whitespace-pre-wrap text-status-exited"
          >
            {error}
          </p>
        ) : null}

        {recents.length === 0 ? (
          <div className="rounded-md border border-dashed border-border px-4 py-10 text-center">
            <p className="text-sm text-text">Aucun projet récent</p>
            <p className="mt-1 text-xs text-text-muted">
              Ouvrez un dossier, ou lancez <code className="font-mono">myterm .</code> depuis un
              terminal.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {recents.map((project) => (
              <RecentRow
                key={project.path}
                project={project}
                onOpen={onOpen}
                onForget={onForget}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
