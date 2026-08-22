import { useState } from 'react'
import type { Layout, Pane, Shell } from '@shared/schema/layout'
import { MAX_COLS, MAX_ROWS, SHELLS } from '@shared/schema/layout'
import {
  addPane,
  removePane,
  resizeGrid,
  swapPanes,
  updatePane,
} from '@shared/schema/layout-edit'
import type { EditResult } from '@shared/schema/layout-edit'
import { useStore } from '../../store'

interface LayoutEditorProps {
  onClose: () => void
  onRestartPane: (paneId: string) => void | Promise<void>
}

/** Fields that define the process: changing one needs a restart to take effect. */
const RESTART_FIELDS = new Set<keyof Pane>(['cwd', 'shell', 'command'])

export function LayoutEditor({ onClose, onRestartPane }: LayoutEditorProps): React.JSX.Element {
  const layout = useStore((state) => state.layout)
  const replaceLayout = useStore((state) => state.replaceLayout)
  const focusedPaneId = useStore((state) => state.focusedPaneId)
  const runtime = useStore((state) => state.runtime)

  const [selectedId, setSelectedId] = useState<string>(focusedPaneId ?? layout.panes[0]?.id ?? '')
  const [error, setError] = useState<string | null>(null)
  const [pendingRestart, setPendingRestart] = useState<Set<string>>(new Set())

  const selected = layout.panes.find((pane) => pane.id === selectedId) ?? layout.panes[0]

  const apply = (result: EditResult, restartPaneId?: string): void => {
    if (!result.ok) {
      setError(result.message)
      return
    }
    setError(null)
    replaceLayout(result.layout)
    if (restartPaneId) {
      setPendingRestart((current) => new Set(current).add(restartPaneId))
    }
  }

  const edit = (patch: Partial<Pane>): void => {
    if (!selected) return
    const needsRestart = Object.keys(patch).some((key) => RESTART_FIELDS.has(key as keyof Pane))
    apply(updatePane(layout, selected.id, patch), needsRestart ? selected.id : undefined)
  }

  const restart = (paneId: string): void => {
    // The caller flushes the pending autosave first: restarting before the new
    // cwd/shell/command has reached the main process would relaunch the pane
    // with its old spec, which looks exactly like the button not working.
    void Promise.resolve(onRestartPane(paneId))
    setPendingRestart((current) => {
      const next = new Set(current)
      next.delete(paneId)
      return next
    })
  }

  const changeGrid = (cols: number, rows: number): void => {
    const outcome = resizeGrid(layout, cols, rows)
    if (outcome.orphaned.length > 0) {
      const names = outcome.orphaned.map((pane) => pane.title || pane.id).join(', ')
      // Never a silent loss: shrinking the grid says exactly what it will drop.
      if (!window.confirm(`Réduire la grille supprimera ${outcome.orphaned.length} pane(s) : ${names}.\n\nContinuer ?`)) {
        return
      }
    }
    apply(outcome.apply())
  }

  const pickFolder = async (): Promise<void> => {
    if (!selected) return
    const picked = await window.myterm.workspace.pickPaneCwd()
    // Returned relative to the project root: an absolute path in the file would
    // not survive being cloned onto another machine.
    if (picked !== null) edit({ cwd: picked })
  }

  return (
    <aside
      data-layout-editor
      className="flex w-80 shrink-0 flex-col gap-3 overflow-y-auto border-l border-border bg-surface-raised p-3"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text">Layout</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fermer l'éditeur"
          className="rounded px-1.5 text-text-muted hover:bg-surface-sunken hover:text-text"
        >
          ✕
        </button>
      </div>

      {error ? (
        <p data-editor-error className="rounded border border-status-exited/40 bg-status-exited/10 px-2 py-1 text-[11px] text-status-exited">
          {error}
        </p>
      ) : null}

      <section className="flex items-end gap-2">
        <label className="flex flex-col gap-1 text-[11px] text-text-muted">
          Colonnes
          <input
            type="number"
            min={1}
            max={MAX_COLS}
            value={layout.grid.cols}
            data-grid-cols
            onChange={(event) => changeGrid(Number(event.target.value), layout.grid.rows)}
            className="w-16 rounded border border-border bg-surface px-1.5 py-1 text-xs text-text"
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-text-muted">
          Lignes
          <input
            type="number"
            min={1}
            max={MAX_ROWS}
            value={layout.grid.rows}
            data-grid-rows
            onChange={(event) => changeGrid(layout.grid.cols, Number(event.target.value))}
            className="w-16 rounded border border-border bg-surface px-1.5 py-1 text-xs text-text"
          />
        </label>
        <button
          type="button"
          data-action="add-pane"
          onClick={() => apply(addPane(layout))}
          className="ml-auto rounded bg-accent px-2 py-1 text-xs font-medium text-accent-contrast hover:opacity-90"
        >
          + Pane
        </button>
      </section>

      <section className="flex flex-col gap-1">
        {layout.panes.map((pane) => (
          <button
            key={pane.id}
            type="button"
            data-editor-pane={pane.id}
            onClick={() => setSelectedId(pane.id)}
            className={[
              'flex items-center gap-2 rounded border px-2 py-1 text-left text-xs',
              pane.id === selected?.id
                ? 'border-accent bg-surface text-text'
                : 'border-border text-text-muted hover:bg-surface-sunken',
            ].join(' ')}
          >
            <span className="font-mono text-[10px] text-text-muted">
              {pane.col},{pane.row}
            </span>
            <span className="truncate">{pane.title || pane.id}</span>
            {pendingRestart.has(pane.id) ? (
              <span className="ml-auto text-[10px] text-status-attention">redémarrage requis</span>
            ) : null}
          </button>
        ))}
      </section>

      {selected ? (
        <section className="flex flex-col gap-2 border-t border-border pt-3">
          <label className="flex flex-col gap-1 text-[11px] text-text-muted">
            Titre
            <input
              type="text"
              value={selected.title}
              data-pane-title
              onChange={(event) => edit({ title: event.target.value })}
              className="rounded border border-border bg-surface px-2 py-1 text-xs text-text"
            />
          </label>

          <label className="flex flex-col gap-1 text-[11px] text-text-muted">
            Dossier (relatif au projet)
            <div className="flex gap-1">
              <input
                type="text"
                value={selected.cwd}
                data-pane-cwd
                onChange={(event) => edit({ cwd: event.target.value })}
                className="min-w-0 flex-1 rounded border border-border bg-surface px-2 py-1 font-mono text-xs text-text"
              />
              <button
                type="button"
                onClick={() => void pickFolder()}
                title="Choisir un dossier"
                className="rounded border border-border px-2 text-xs text-text-muted hover:bg-surface-sunken"
              >
                …
              </button>
            </div>
          </label>

          <label className="flex flex-col gap-1 text-[11px] text-text-muted">
            Shell
            <select
              value={selected.shell ?? ''}
              data-pane-shell
              onChange={(event) => edit({ shell: (event.target.value || undefined) as Shell | undefined })}
              className="rounded border border-border bg-surface px-2 py-1 text-xs text-text"
            >
              <option value="">défaut ({layout.defaults.shell})</option>
              {SHELLS.map((shell) => (
                <option key={shell} value={shell}>
                  {shell}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-[11px] text-text-muted">
            Commande au lancement
            <textarea
              rows={2}
              value={selected.command ?? ''}
              data-pane-command
              placeholder="vide = shell en attente"
              onChange={(event) => edit({ command: event.target.value })}
              className="resize-y rounded border border-border bg-surface px-2 py-1 font-mono text-xs text-text"
            />
          </label>

          {pendingRestart.has(selected.id) ? (
            <button
              type="button"
              data-action="restart-pane"
              onClick={() => restart(selected.id)}
              className="rounded border border-status-attention/50 bg-status-attention/10 px-2 py-1 text-xs text-status-attention"
            >
              Redémarrer ce pane pour appliquer
            </button>
          ) : null}

          <div className="flex items-center gap-2 pt-1">
            <select
              data-swap-target
              defaultValue=""
              onChange={(event) => {
                if (!event.target.value) return
                apply(swapPanes(layout, selected.id, event.target.value))
                event.target.value = ''
              }}
              className="min-w-0 flex-1 rounded border border-border bg-surface px-2 py-1 text-xs text-text"
            >
              <option value="">Échanger avec…</option>
              {layout.panes
                .filter((pane) => pane.id !== selected.id)
                .map((pane) => (
                  <option key={pane.id} value={pane.id}>
                    {pane.title || pane.id}
                  </option>
                ))}
            </select>
            <button
              type="button"
              data-action="remove-pane"
              onClick={() => {
                const running = runtime[selected.id]?.status
                if (
                  running &&
                  running !== 'exited' &&
                  !window.confirm(`Le pane « ${selected.title || selected.id} » tourne encore. Le supprimer ?`)
                ) {
                  return
                }
                apply(removePane(layout, selected.id))
              }}
              className="rounded border border-border px-2 py-1 text-xs text-status-exited hover:bg-surface-sunken"
            >
              Supprimer
            </button>
          </div>
        </section>
      ) : null}
    </aside>
  )
}

export type { Layout }
