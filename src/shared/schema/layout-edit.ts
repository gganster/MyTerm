import { LayoutSchema, MAX_PANES } from './layout'
import type { Layout, Pane } from './layout'

/**
 * Pure layout mutations, shared by the editor UI and by the reload diff.
 *
 * Kept out of React so each operation can be reasoned about — and tested —
 * on its own, and so the editor can never push an invalid layout into the
 * store: every mutation is re-validated before it is returned.
 */

export type EditResult = { ok: true; layout: Layout } | { ok: false; message: string }

function validated(layout: Layout): EditResult {
  const result = LayoutSchema.safeParse(layout)
  if (!result.success) {
    const first = result.error.issues[0]
    return { ok: false, message: first ? `${first.path.join('.')} : ${first.message}` : 'layout invalide' }
  }
  return { ok: true, layout: result.data }
}

function uniqueId(layout: Layout): string {
  let index = layout.panes.length + 1
  while (layout.panes.some((pane) => pane.id === `pane-${index}`)) index++
  return `pane-${index}`
}

/** Appended at the end: position is order, and a new pane belongs last. */
export function addPane(layout: Layout): EditResult {
  if (layout.panes.length >= MAX_PANES) {
    return { ok: false, message: `un workspace ne peut pas dépasser ${MAX_PANES} panes` }
  }
  return validated({
    ...layout,
    panes: [...layout.panes, { id: uniqueId(layout), title: '', cwd: '.' }],
  })
}

export function removePane(layout: Layout, paneId: string): EditResult {
  // An empty workspace is not a state the app can be in.
  if (layout.panes.length <= 1) {
    return { ok: false, message: 'un workspace doit garder au moins un pane' }
  }
  return validated({ ...layout, panes: layout.panes.filter((pane) => pane.id !== paneId) })
}

export function updatePane(layout: Layout, paneId: string, patch: Partial<Pane>): EditResult {
  return validated({
    ...layout,
    panes: layout.panes.map((pane) => {
      if (pane.id !== paneId) return pane
      const next = { ...pane, ...patch }
      // Optional fields are dropped rather than stored empty: the file stays
      // clean and diffs stay small.
      if (!next.command) delete next.command
      if (!next.shell) delete next.shell
      if (!next.color) delete next.color
      if (!next.collapsed) delete next.collapsed
      return next
    }),
  })
}

/**
 * Moves a pane one position earlier or later in the flow.
 *
 * The old grid needed a swap because two panes could not share a cell; an
 * ordered list needs only a shift, and a shift is what the user means by
 * "move this one up".
 */
export function movePane(layout: Layout, paneId: string, direction: 'up' | 'down'): EditResult {
  const from = layout.panes.findIndex((pane) => pane.id === paneId)
  if (from === -1) return { ok: false, message: 'pane introuvable' }

  const to = direction === 'up' ? from - 1 : from + 1
  if (to < 0 || to >= layout.panes.length) {
    return { ok: false, message: 'ce pane est déjà à cette extrémité' }
  }

  const panes = [...layout.panes]
  const [moved] = panes.splice(from, 1)
  panes.splice(to, 0, moved!)
  return validated({ ...layout, panes })
}

/**
 * Which panes must restart for a new layout to take effect.
 *
 * Only the three fields that define the process. A renamed pane keeps running:
 * killing a dev server over a typo would be indefensible — and so would
 * killing it because someone ticked "start folded", which is the whole point
 * of folding a pane rather than closing it.
 */
export function panesNeedingRestart(previous: Layout, next: Layout): string[] {
  const before = new Map(previous.panes.map((pane) => [pane.id, pane]))
  const changed: string[] = []

  for (const pane of next.panes) {
    const old = before.get(pane.id)
    if (!old) {
      changed.push(pane.id)
      continue
    }
    if (old.cwd !== pane.cwd || old.shell !== pane.shell || old.command !== pane.command) {
      changed.push(pane.id)
    }
  }
  return changed
}
