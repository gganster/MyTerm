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

  openWorkspace: (projectPath, projectName, layout) =>
    set({
      projectPath,
      projectName,
      layout,
      dirty: false,
      // Opening a project never inherits the previous one's runtime or view state.
      runtime: {},
      focusedPaneId: layout.panes[0]?.id ?? null,
      zoomedPaneId: null,
    }),

  closeWorkspace: () =>
    set({
      projectPath: null,
      projectName: null,
      layout: defaultLayout(),
      dirty: false,
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
