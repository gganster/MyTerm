import { createHash } from 'node:crypto'
import { normaliseProjectPath } from './normalise-path'

/**
 * Identity of "what this project will execute" (ADR-004).
 *
 * Split out of the trust service, which needs the preferences store and
 * therefore Electron: this half is pure and directly testable, and it is the
 * half where a mistake is dangerous.
 */

export interface CommandBearingPane {
  id: string
  title: string
  cwd: string
  shell: string
  command?: string
}

export interface TrustSubject {
  paneId: string
  title: string
  cwd: string
  shell: string
  command: string
}

/**
 * Covers only command, cwd and shell.
 *
 * Renaming a pane or moving it in the grid changes nothing about what runs;
 * re-prompting for that would train the user to dismiss the dialog unread,
 * which is worse than not having one.
 */
export function commandsHash(panes: CommandBearingPane[]): string {
  const material = panes
    .filter((pane) => pane.command)
    .map((pane) => ({
      id: pane.id,
      cwd: normaliseProjectPath(pane.cwd),
      shell: pane.shell,
      command: pane.command,
    }))
    // Sorted so pane order in the file cannot change the identity.
    .sort((a, b) => a.id.localeCompare(b.id))

  return createHash('sha256').update(JSON.stringify(material)).digest('hex')
}

export function commandsOf(panes: CommandBearingPane[]): TrustSubject[] {
  return panes
    .filter((pane): pane is CommandBearingPane & { command: string } => Boolean(pane.command))
    .map((pane) => ({
      paneId: pane.id,
      title: pane.title,
      cwd: pane.cwd,
      shell: pane.shell,
      command: pane.command,
    }))
}

/** Same panes with commands removed: the "open without executing" fallback. */
export function stripCommands<T extends CommandBearingPane>(panes: T[]): T[] {
  return panes.map(({ command: _command, ...rest }) => rest as T)
}
