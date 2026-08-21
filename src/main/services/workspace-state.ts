import { app } from 'electron'

/**
 * A pane with every path already resolved to an absolute location.
 *
 * The renderer never produces one of these: it asks to spawn a pane *id*, and
 * the main process looks up what that id is allowed to run. Task 11 fills this
 * from the validated `.myterm.json`; until then a single scratch pane stands in.
 */
export interface ResolvedPane {
  id: string
  title: string
  cwd: string
  shell: string
  command?: string
}

const SCRATCH_PANE_ID = 'scratch'

class WorkspaceState {
  private root: string | null = null
  private panes = new Map<string, ResolvedPane>()

  get projectRoot(): string | null {
    return this.root
  }

  /** Replaces the whole workspace: opening a project never merges into the old one. */
  load(projectRoot: string, panes: ResolvedPane[]): void {
    this.root = projectRoot
    this.panes = new Map(panes.map((pane) => [pane.id, pane]))
  }

  clear(): void {
    this.root = null
    this.panes.clear()
  }

  list(): ResolvedPane[] {
    return [...this.panes.values()]
  }

  /**
   * With no project open we still want a usable terminal, so an unknown id
   * resolves to a scratch shell in the user's home directory. It carries no
   * `command`: nothing is ever auto-executed outside an approved layout.
   */
  resolve(paneId: string): ResolvedPane {
    const known = this.panes.get(paneId)
    if (known) return known

    return {
      id: paneId,
      title: paneId === SCRATCH_PANE_ID ? 'scratch' : paneId,
      cwd: this.root ?? app.getPath('home'),
      shell: 'pwsh',
    }
  }
}

export const workspaceState = new WorkspaceState()
