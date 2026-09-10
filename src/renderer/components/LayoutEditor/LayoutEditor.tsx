import { useEffect, useRef, useState } from 'react'
import type { Layout, Pane, PaneColor, Shell } from '@shared/schema/layout'
import { MAX_PANES, PANE_COLORS, SHELLS } from '@shared/schema/layout'
import { addPane, movePane, removePane, updatePane } from '@shared/schema/layout-edit'
import type { EditResult } from '@shared/schema/layout-edit'
import { selectPane } from '../../pane-focus'
import { selectCollapsedPaneIds, selectColumns, useStore } from '../../store'
import { paneBorderColor } from '../../theme/palette'

interface LayoutEditorProps {
  onClose: () => void
  onRestartPane: (paneId: string) => void | Promise<void>
}

/** Fields that define the process: changing one needs a restart to take effect. */
const RESTART_FIELDS = new Set<keyof Pane>(['cwd', 'shell', 'command'])

/** French labels for the eight names in the file — the file keeps the English. */
const COLOR_LABELS: Record<PaneColor, string> = {
  red: 'rouge',
  orange: 'orange',
  yellow: 'jaune',
  green: 'vert',
  cyan: 'cyan',
  blue: 'bleu',
  purple: 'violet',
  pink: 'rose',
}

export function LayoutEditor({ onClose, onRestartPane }: LayoutEditorProps): React.JSX.Element {
  const layout = useStore((state) => state.layout)
  const replaceLayout = useStore((state) => state.replaceLayout)
  const focusedPaneId = useStore((state) => state.focusedPaneId)
  const setCollapsed = useStore((state) => state.setCollapsed)
  const collapsedPaneIds = useStore(selectCollapsedPaneIds)
  const columns = useStore(selectColumns)
  const resolvedTheme = useStore((state) => state.resolvedTheme)

  const [error, setError] = useState<string | null>(null)
  const [pendingRestart, setPendingRestart] = useState<Set<string>>(new Set())

  // The edited pane *is* the focused one, rather than a second selection the
  // editor keeps to itself. Clicking a terminal in the grid therefore switches
  // what this panel edits — which is the only reading of "selected" that
  // survives having the real panes right next to the form.
  const selected = layout.panes.find((pane) => pane.id === focusedPaneId) ?? layout.panes[0]

  const order = layout.panes.map((pane) => pane.id).join(',')

  // With a dozen panes the list scrolls, so a pane picked over in the grid — or
  // walked past with the arrows — could be selected somewhere out of sight. The
  // list has its own scroll box so this can never push the form below the fold.
  const listRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!selected) return
    listRef.current
      ?.querySelector(`[data-editor-pane="${CSS.escape(selected.id)}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [selected?.id, order])

  // A pane that no longer exists cannot need a restart — and `uniqueId` reuses
  // freed names, so a stale entry would hand a brand-new pane a "restart
  // required" it never earned, offering to kill a shell that just started.
  useEffect(() => {
    setPendingRestart((current) => {
      if (current.size === 0) return current
      const alive = new Set(layout.panes.map((pane) => pane.id))
      if ([...current].every((id) => alive.has(id))) return current
      return new Set([...current].filter((id) => alive.has(id)))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order])

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

      <section className="flex items-center gap-2">
        <p data-layout-hint className="text-[11px] leading-tight text-text-muted">
          Disposition automatique :{' '}
          <strong className="font-medium text-text">
            {columns} pane{columns > 1 ? 's' : ''} par ligne
          </strong>{' '}
          à cette largeur. Les suivants passent à la ligne.
        </p>
        <button
          type="button"
          data-action="add-pane"
          disabled={layout.panes.length >= MAX_PANES}
          onClick={() => apply(addPane(layout))}
          className="ml-auto shrink-0 rounded bg-accent px-2 py-1 text-xs font-medium text-accent-contrast hover:opacity-90 disabled:opacity-40"
        >
          + Pane
        </button>
      </section>

      <section ref={listRef} className="flex max-h-64 flex-col gap-1 overflow-y-auto">
        {layout.panes.map((pane, index) => (
          <div key={pane.id} className="flex items-stretch gap-1">
            <button
              type="button"
              data-editor-pane={pane.id}
              data-editor-selected={pane.id === selected?.id || undefined}
              onClick={() => selectPane(pane.id)}
              className={[
                'flex min-w-0 flex-1 items-center gap-2 rounded border px-2 py-1 text-left text-xs',
                pane.id === selected?.id
                  ? 'border-accent bg-surface text-text'
                  : 'border-border text-text-muted hover:bg-surface-sunken',
              ].join(' ')}
            >
              <span className="font-mono text-[10px] text-text-muted">{index + 1}</span>
              {/* The list is where you compare panes, so it is where the
                  colours have to be readable side by side — not only on the
                  one pane whose form is open. Not aria-hidden: the colour is
                  the point of the row, and a dot nobody can read leaves a
                  screen-reader user with no way to know a pane's colour at
                  all. The label carries it instead. */}
              <span
                data-pane-swatch={pane.id}
                className="size-2.5 shrink-0 rounded-full border border-border"
                style={{ backgroundColor: paneBorderColor(resolvedTheme, pane.color) ?? 'transparent' }}
              >
                <span className="sr-only">
                  {pane.color ? `couleur ${COLOR_LABELS[pane.color]}` : 'couleur par défaut'}
                </span>
              </span>
              <span className="truncate">{pane.title || pane.id}</span>
              {/* Selecting a row does not unfold, so without this the list
                  would give no way to tell which panes are in the bottom bar
                  and which are on the grid. */}
              {collapsedPaneIds.includes(pane.id) ? (
                <span
                  data-editor-collapsed={pane.id}
                  title="réduit dans la barre du bas"
                  className="ml-auto shrink-0 text-[10px] text-text-muted"
                >
                  ⤓<span className="sr-only">réduit</span>
                </span>
              ) : null}
            </button>
            {/* On the row, not only on the selected pane's form: selecting
                another pane must not take away the action the user was about
                to perform on this one. */}
            {pendingRestart.has(pane.id) ? (
              <button
                type="button"
                data-action="restart-pane-row"
                data-pane-id={pane.id}
                title="Redémarrer ce pane pour appliquer les modifications"
                onClick={() => restart(pane.id)}
                className="shrink-0 rounded border border-status-attention/50 bg-status-attention/10 px-1.5 text-[10px] text-status-attention"
              >
                redémarrer
              </button>
            ) : null}
            {/* Order is the layout, so reordering is the positioning control. */}
            <button
              type="button"
              data-action="move-pane-up"
              data-pane-id={pane.id}
              aria-label={`Déplacer ${pane.title || pane.id} vers le haut`}
              disabled={index === 0}
              onClick={() => apply(movePane(layout, pane.id, 'up'))}
              className="rounded border border-border px-1 text-[10px] text-text-muted hover:bg-surface-sunken disabled:opacity-30"
            >
              ↑
            </button>
            <button
              type="button"
              data-action="move-pane-down"
              data-pane-id={pane.id}
              aria-label={`Déplacer ${pane.title || pane.id} vers le bas`}
              disabled={index === layout.panes.length - 1}
              onClick={() => apply(movePane(layout, pane.id, 'down'))}
              className="rounded border border-border px-1 text-[10px] text-text-muted hover:bg-surface-sunken disabled:opacity-30"
            >
              ↓
            </button>
          </div>
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

          {/* A radiogroup, not nine toggle buttons: the choice is exclusive,
              and `aria-pressed` would announce nine independent "pressed /
              not pressed" controls instead of "bleu, 6 sur 9". */}
          <fieldset className="flex flex-col gap-1 border-0 p-0">
            <legend className="text-[11px] text-text-muted">Couleur du contour</legend>
            <div role="radiogroup" aria-label="Couleur du contour" className="flex flex-wrap items-center gap-1">
              {/* Selected means *filled*, never "has an accent ring": the accent
                  is a blue, and on the blue swatch a 1px accent ring around a
                  2px blue border is the same colour twice. Fill vs outline
                  reads at a glance whatever the swatch happens to be. */}
              <button
                type="button"
                role="radio"
                data-color-swatch=""
                aria-checked={!selected.color}
                title="Défaut — suit le thème"
                aria-label="Couleur par défaut, suit le thème"
                onClick={() => edit({ color: undefined })}
                className={[
                  'flex size-6 items-center justify-center rounded border-2 text-[10px]',
                  !selected.color
                    ? 'border-accent bg-accent text-accent-contrast'
                    : 'border-border text-text-muted hover:bg-surface-sunken',
                ].join(' ')}
              >
                ∅
              </button>
              {PANE_COLORS.map((color) => {
                const value = paneBorderColor(resolvedTheme, color) ?? undefined
                const active = selected.color === color
                return (
                  <button
                    key={color}
                    type="button"
                    role="radio"
                    data-color-swatch={color}
                    aria-checked={active}
                    title={COLOR_LABELS[color]}
                    aria-label={COLOR_LABELS[color]}
                    onClick={() =>
                      // Clicking the active colour clears it: the ∅ button is
                      // the discoverable way out, this is the fast one.
                      edit({ color: active ? undefined : color })
                    }
                    className="size-6 rounded border-2"
                    style={{ borderColor: value, backgroundColor: active ? value : undefined }}
                  />
                )
              })}
            </div>
          </fieldset>

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

          {/* Writes the file's default *and* applies it now. The two could be
              separated, and separating them would mean ticking « démarrer
              réduit » does nothing visible until the next launch — a control
              whose only feedback is tomorrow. Unticking likewise brings the
              pane back. Folding by hand afterwards stays view state and never
              comes near the file. */}
          <label className="flex items-start gap-2 text-[11px] text-text-muted">
            <input
              type="checkbox"
              data-pane-collapsed
              checked={Boolean(selected.collapsed)}
              onChange={(event) => {
                edit({ collapsed: event.target.checked })
                setCollapsed(selected.id, event.target.checked)
              }}
              className="mt-0.5 accent-accent"
            />
            <span>
              Démarrer réduit
              <span className="block text-text-muted/80">
                Le pane s'ouvre dans la barre du bas. Son shell et sa commande démarrent
                normalement.
              </span>
            </span>
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
            <button
              type="button"
              data-action="remove-pane"
              onClick={() => {
                // Read at click time rather than subscribed: the sidebar has
                // no business re-rendering on every status tick.
                const running = useStore.getState().runtime[selected.id]?.status
                if (
                  running &&
                  running !== 'exited' &&
                  !window.confirm(`Le pane « ${selected.title || selected.id} » tourne encore. Le supprimer ?`)
                ) {
                  return
                }
                apply(removePane(layout, selected.id))
              }}
              className="ml-auto rounded border border-border px-2 py-1 text-xs text-status-exited hover:bg-surface-sunken"
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
