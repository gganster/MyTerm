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
  clearPaneRuntime: (paneId: string) => void
}

interface UiSlice {
  themeMode: ThemeMode
  resolvedTheme: ResolvedThemeName
  focusedPaneId: string | null
  zoomedPaneId: string | null
  editorOpen: boolean
  setThemeMode: (mode: ThemeMode) => void
  setResolvedTheme: (theme: ResolvedThemeName) => void
  setFocusedPane: (paneId: string | null) => void
  toggleZoom: (paneId?: string) => void
  setEditorOpen: (open: boolean) => void
}

export type Store = WorkspaceSlice & RuntimeSlice & UiSlice

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
      focusedPaneId: layout.panes[0]?.id ?? null,
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
      focusedPaneId: null,
      zoomedPaneId: null,
      editorOpen: false,
    }),

  replaceLayout: (layout, options) =>
    set((state) => ({
      layout,
      dirty: options?.markDirty ?? true,
      // Focus and zoom must never point at a pane the new layout dropped.
      focusedPaneId:
        state.focusedPaneId && layout.panes.some((p) => p.id === state.focusedPaneId)
          ? state.focusedPaneId
          : (layout.panes[0]?.id ?? null),
      zoomedPaneId:
        state.zoomedPaneId && layout.panes.some((p) => p.id === state.zoomedPaneId)
          ? state.zoomedPaneId
          : null,
    })),

  markSaved: () => set({ dirty: false }),

  // ---- runtime ------------------------------------------------------------
  runtime: {},

  setPaneStatus: (paneId, status, extra) =>
    set((state) => {
      const current = state.runtime[paneId]
      if (current?.status === status && extra === undefined) return state
      return { runtime: { ...state.runtime, [paneId]: { ...current, ...extra, status } } }
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

  setThemeMode: (mode) => set({ themeMode: mode }),
  setResolvedTheme: (theme) => set({ resolvedTheme: theme }),
  setFocusedPane: (paneId) => set({ focusedPaneId: paneId }),

  toggleZoom: (paneId) => {
    const target = paneId ?? get().focusedPaneId
    if (!target) return
    set((state) => ({ zoomedPaneId: state.zoomedPaneId === target ? null : target }))
  },

  setEditorOpen: (open) => set({ editorOpen: open }),
}))

// ---- selectors -------------------------------------------------------------
// Exported so components cannot accidentally subscribe to the whole store.

export const selectPanes = (state: Store): Pane[] => state.layout.panes
export const selectGrid = (state: Store): Layout['grid'] => state.layout.grid
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
