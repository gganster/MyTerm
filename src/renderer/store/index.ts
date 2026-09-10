import { create } from 'zustand'
import type { Layout, Pane, ThemeMode } from '@shared/schema/layout'
import { defaultLayout } from '@shared/schema/layout'
import type { PaneRuntime, PaneStatus } from '@shared/pane-status'
import type { ResolvedThemeName } from '../theme/palette'

/**
 * One store, three slices (ARCHI § State Management).
 *
 * Discipline that matters more than the shape: grid components must always
 * subscribe through a narrow selector. Pane status changes several times a
 * second on six panes; a component reading the whole store would re-render the
 * entire grid on every tick.
 */

interface WorkspaceSlice {
  projectPath: string | null
  projectName: string | null
  layout: Layout
  dirty: boolean
  /**
   * Bumped on every workspace *load*, and used in the grid's React keys.
   *
   * Opening a project kills the previous project's ptys in the main process.
   * Without a changing key, panes that keep the same id are not remounted, so
   * their effect never re-runs and they sit there showing stale scrollback over
   * a dead shell. Deliberately NOT bumped by replaceLayout: editing or
   * reloading a layout must leave running panes alone (task 16).
   */
  generation: number
  /**
   * Per-pane remount counter, appended to the React key.
   *
   * Reloading a layout from disk must restart only the panes whose spec
   * actually changed: a title fix has no business killing a running dev server
   * (task 16). Bumping one pane's epoch remounts exactly that pane.
   */
  paneEpochs: Record<string, number>
  restartPane: (paneId: string) => void
  openWorkspace: (projectPath: string, projectName: string, layout: Layout) => void
  closeWorkspace: () => void
  replaceLayout: (layout: Layout, options?: { markDirty?: boolean }) => void
  markSaved: () => void
}

interface RuntimeSlice {
  /** Keyed by paneId. A plain object, not a Map: cheaper selector equality. */
  runtime: Record<string, PaneRuntime>
  setPaneStatus: (paneId: string, status: PaneStatus, extra?: Partial<PaneRuntime>) => void
  /**
   * Records what that pane last ran, for the folded pane's hover card.
   *
   * Separate from setPaneStatus on purpose: the last command changes when a
   * human presses Enter, the status several times a second. Folding them into
   * one setter would mean every status tick carried a string comparison.
   */
  setPaneLastCommand: (paneId: string, command: string) => void
  clearPaneRuntime: (paneId: string) => void
}

interface UiSlice {
  themeMode: ThemeMode
  resolvedTheme: ResolvedThemeName
  focusedPaneId: string | null
  zoomedPaneId: string | null
  editorOpen: boolean
  /**
   * Panes folded into the bottom bar, in layout order.
   *
   * View state, like the zoom: `pane.collapsed` in the file is only the value
   * this starts from. Folding a pane at runtime must not dirty the workspace —
   * hiding a tunnel for an afternoon is not an edit to commit.
   *
   * An array rather than a Set: Zustand compares snapshots by reference and the
   * selectors below return booleans, so a plain array costs nothing and stays
   * serialisable in devtools.
   */
  collapsedPaneIds: string[]
  /**
   * Panes per line at the current width, measured by GridView.
   *
   * View state, never layout state: it is derived from the window and must
   * never reach `.myterm.json` (ADR-003). It lives in the store only because
   * arrow-key navigation has to know the shape the user is actually looking at.
   */
  columns: number
  setThemeMode: (mode: ThemeMode) => void
  setResolvedTheme: (theme: ResolvedThemeName) => void
  setFocusedPane: (paneId: string | null) => void
  toggleZoom: (paneId?: string) => void
  setCollapsed: (paneId: string, collapsed: boolean) => void
  toggleCollapse: (paneId?: string) => void
  setEditorOpen: (open: boolean) => void
  setColumns: (columns: number) => void
}

export type Store = WorkspaceSlice & RuntimeSlice & UiSlice

function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index])
}

export const useStore = create<Store>()((set, get) => ({
  // ---- workspace ----------------------------------------------------------
  projectPath: null,
  projectName: null,
  layout: defaultLayout(),
  dirty: false,
  generation: 0,
  paneEpochs: {},

  restartPane: (paneId) =>
    set((state) => ({
      paneEpochs: { ...state.paneEpochs, [paneId]: (state.paneEpochs[paneId] ?? 0) + 1 },
    })),

  openWorkspace: (projectPath, projectName, layout) =>
    set((state) => ({
      projectPath,
      projectName,
      layout,
      dirty: false,
      generation: state.generation + 1,
      // Opening a project never inherits the previous one's runtime or view state.
      paneEpochs: {},
      runtime: {},
      // The one moment `pane.collapsed` is read: opening is what "par défaut"
      // means. Every later fold is the user's, and outlives a reload.
      collapsedPaneIds: layout.panes.filter((p) => p.collapsed).map((p) => p.id),
      focusedPaneId: layout.panes.find((p) => !p.collapsed)?.id ?? layout.panes[0]?.id ?? null,
      zoomedPaneId: null,
    })),

  closeWorkspace: () =>
    set({
      projectPath: null,
      projectName: null,
      layout: defaultLayout(),
      dirty: false,
      paneEpochs: {},
      runtime: {},
      collapsedPaneIds: [],
      focusedPaneId: null,
      zoomedPaneId: null,
      editorOpen: false,
    }),

  replaceLayout: (layout, options) =>
    set((state) => {
      const known = new Set(state.layout.panes.map((p) => p.id))
      // Built from the new list, so dead ids are dropped and the bottom bar
      // keeps the layout's own order for free.
      //
      // A pane that already existed keeps what the user is currently looking
      // at; only a pane the layout has just introduced adopts its declared
      // default. This is what stops a reload from re-folding a pane you had
      // just opened — the same rule the reload already follows for processes,
      // where a renamed pane keeps running.
      const rebuilt = layout.panes
        .filter((pane) =>
          known.has(pane.id)
            ? state.collapsedPaneIds.includes(pane.id)
            : Boolean(pane.collapsed),
        )
        .map((pane) => pane.id)
      // The previous array when nothing moved, not an equal copy: the layout
      // editor calls replaceLayout on every keystroke in the title field, and
      // a fresh reference each time would re-render the bottom bar and every
      // chip in it for a rename that concerns none of them.
      const collapsedPaneIds = sameIds(rebuilt, state.collapsedPaneIds)
        ? state.collapsedPaneIds
        : rebuilt
      const folded = new Set(collapsedPaneIds)

      return {
        layout,
        dirty: options?.markDirty ?? true,
        collapsedPaneIds,
        // Focus and zoom must never point at a pane the new layout dropped.
        focusedPaneId:
          state.focusedPaneId && layout.panes.some((p) => p.id === state.focusedPaneId)
            ? state.focusedPaneId
            : (layout.panes.find((p) => !folded.has(p.id))?.id ?? layout.panes[0]?.id ?? null),
        zoomedPaneId:
          state.zoomedPaneId && layout.panes.some((p) => p.id === state.zoomedPaneId)
            ? state.zoomedPaneId
            : null,
      }
    }),

  markSaved: () => set({ dirty: false }),

  // ---- runtime ------------------------------------------------------------
  runtime: {},

  setPaneStatus: (paneId, status, extra) =>
    set((state) => {
      const current = state.runtime[paneId]
      if (current?.status === status && extra === undefined) return state
      return { runtime: { ...state.runtime, [paneId]: { ...current, ...extra, status } } }
    }),

  setPaneLastCommand: (paneId, command) =>
    set((state) => {
      const current = state.runtime[paneId]
      if (current?.lastCommand === command) return state
      return { runtime: { ...state.runtime, [paneId]: { status: 'idle', ...current, lastCommand: command } } }
    }),

  clearPaneRuntime: (paneId) =>
    set((state) => {
      if (!(paneId in state.runtime)) return state
      const next = { ...state.runtime }
      delete next[paneId]
      return { runtime: next }
    }),

  // ---- ui -----------------------------------------------------------------
  themeMode: 'system',
  resolvedTheme: 'light',
  focusedPaneId: null,
  zoomedPaneId: null,
  editorOpen: false,
  collapsedPaneIds: [],
  columns: 1,

  setThemeMode: (mode) => set({ themeMode: mode }),
  setResolvedTheme: (theme) => set({ resolvedTheme: theme }),
  setFocusedPane: (paneId) => set({ focusedPaneId: paneId }),

  toggleZoom: (paneId) => {
    const target = paneId ?? get().focusedPaneId
    if (!target) return
    // Zooming something that is folded away unfolds it: the two are opposite
    // ends of the same axis, and "make this one fill the window" cannot mean
    // "leave it in the bar".
    get().setCollapsed(target, false)
    set((state) => ({ zoomedPaneId: state.zoomedPaneId === target ? null : target }))
  },

  setCollapsed: (paneId, collapsed) =>
    set((state) => {
      const isCollapsed = state.collapsedPaneIds.includes(paneId)
      if (isCollapsed === collapsed) return state
      if (!collapsed) {
        return { collapsedPaneIds: state.collapsedPaneIds.filter((id) => id !== paneId) }
      }

      // Kept in layout order rather than in fold order: the bar is read like
      // the grid, and a chip that jumped position every time you folded
      // something else would have to be hunted for.
      const order = state.layout.panes.map((pane) => pane.id)
      const next = [...state.collapsedPaneIds, paneId].sort(
        (a, b) => order.indexOf(a) - order.indexOf(b),
      )

      // Folding the pane you were looking at hands the keyboard to the next
      // one still on the grid; without this the focus ring, and the next
      // keystroke, would go to a terminal nobody can see.
      const stillVisible = state.layout.panes.find(
        (pane) => pane.id !== paneId && !next.includes(pane.id),
      )
      return {
        collapsedPaneIds: next,
        zoomedPaneId: state.zoomedPaneId === paneId ? null : state.zoomedPaneId,
        focusedPaneId:
          state.focusedPaneId === paneId && stillVisible
            ? stillVisible.id
            : state.focusedPaneId,
      }
    }),

  toggleCollapse: (paneId) => {
    const target = paneId ?? get().focusedPaneId
    if (!target) return
    get().setCollapsed(target, !get().collapsedPaneIds.includes(target))
  },

  setEditorOpen: (open) => set({ editorOpen: open }),

  setColumns: (columns) =>
    set((state) => (state.columns === columns ? state : { columns })),
}))

// ---- selectors -------------------------------------------------------------
// Exported so components cannot accidentally subscribe to the whole store.

export const selectPanes = (state: Store): Pane[] => state.layout.panes
export const selectColumns = (state: Store): number => state.columns
export const selectGeneration = (state: Store): number => state.generation

export const selectPaneKey =
  (paneId: string) =>
  (state: Store): string =>
    `${state.generation}:${paneId}:${state.paneEpochs[paneId] ?? 0}`

export const selectPaneStatus =
  (paneId: string) =>
  (state: Store): PaneStatus =>
    state.runtime[paneId]?.status ?? 'idle'

export const selectIsFocused =
  (paneId: string) =>
  (state: Store): boolean =>
    state.focusedPaneId === paneId

export const selectIsHidden =
  (paneId: string) =>
  (state: Store): boolean =>
    state.zoomedPaneId !== null && state.zoomedPaneId !== paneId

export const selectIsCollapsed =
  (paneId: string) =>
  (state: Store): boolean =>
    state.collapsedPaneIds.includes(paneId)

export const selectCollapsedPaneIds = (state: Store): string[] => state.collapsedPaneIds

/**
 * The panes actually on the grid, in order.
 *
 * Arrow-key navigation walks what is on screen, not what the file declares:
 * `neighbourIndex` reasons in rows of `columns` cells, and a folded pane
 * occupies no cell. Feeding it the full list would make "the pane to my right"
 * mean a pane in the bottom bar.
 *
 * **Read through `getState()`, never subscribed to.** It builds a new array, so
 * a component calling `useStore(visiblePanes)` would get a fresh reference on
 * every store read and re-render forever.
 */
export const visiblePanes = (state: Store): Pane[] =>
  state.collapsedPaneIds.length === 0
    ? state.layout.panes
    : state.layout.panes.filter((pane) => !state.collapsedPaneIds.includes(pane.id))

export const selectLastCommand =
  (paneId: string) =>
  (state: Store): string | undefined =>
    state.runtime[paneId]?.lastCommand
