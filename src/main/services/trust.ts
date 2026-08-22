import { createHash } from 'node:crypto'
import { MAX_TRUSTED_PROJECTS } from '@shared/schema/preferences'
import {
  getPreferences,
  normaliseProjectPath,
  updatePreferences,
} from './preferences'
import type { ResolvedPane } from './workspace-state'

/**
 * Workspace trust (ADR-004).
 *
 * The PRD commits `.myterm.json` to the repository so a team shares one setup.
 * The price of that decision is this file: cloning a hostile repository and
 * opening it would otherwise run its autolaunch commands on sight. VS Code
 * solved the same problem the same way, for the same reason.
 *
 * The decision is taken in the main process. The renderer shows a dialog and
 * reports a choice, but it is main that refuses to spawn — compromising the
 * renderer must not be enough to bypass the check.
 */

export interface TrustSubject {
  paneId: string
  title: string
  cwd: string
  shell: string
  command: string
}

/**
 * Identity of "what this project will execute".
 *
 * Deliberately covers only command, cwd and shell. Renaming a pane or moving it
 * in the grid changes nothing about what runs, and re-prompting for that would
 * train the user to click through the dialog without reading it.
 */
export function commandsHash(panes: ResolvedPane[]): string {
  const material = panes
    .filter((pane) => pane.command)
    .map((pane) => ({
      id: pane.id,
      cwd: normaliseProjectPath(pane.cwd),
      shell: pane.shell,
      command: pane.command,
    }))
    .sort((a, b) => a.id.localeCompare(b.id))

  return createHash('sha256').update(JSON.stringify(material)).digest('hex')
}

export function commandsOf(panes: ResolvedPane[]): TrustSubject[] {
  return panes
    .filter((pane): pane is ResolvedPane & { command: string } => Boolean(pane.command))
    .map((pane) => ({
      paneId: pane.id,
      title: pane.title,
      cwd: pane.cwd,
      shell: pane.shell,
      command: pane.command,
    }))
}

export function isTrusted(projectPath: string, hash: string): boolean {
  const key = normaliseProjectPath(projectPath)
  return getPreferences().trustedProjects.some(
    (entry) => normaliseProjectPath(entry.path) === key && entry.commandsHash === hash,
  )
}

export function trustProject(projectPath: string, hash: string): void {
  const key = normaliseProjectPath(projectPath)
  const others = getPreferences().trustedProjects.filter(
    (entry) => normaliseProjectPath(entry.path) !== key,
  )
  updatePreferences({
    trustedProjects: [{ path: projectPath, commandsHash: hash }, ...others].slice(
      0,
      MAX_TRUSTED_PROJECTS,
    ),
  })
}

export function revokeProject(projectPath: string): void {
  const key = normaliseProjectPath(projectPath)
  updatePreferences({
    trustedProjects: getPreferences().trustedProjects.filter(
      (entry) => normaliseProjectPath(entry.path) !== key,
    ),
  })
}

/** A layout with no autolaunch command has nothing to approve. */
export function requiresApproval(projectPath: string, panes: ResolvedPane[]): boolean {
  const commands = commandsOf(panes)
  if (commands.length === 0) return false
  return !isTrusted(projectPath, commandsHash(panes))
}

/** Same panes, commands removed: the "open without executing" fallback. */
export function stripCommands(panes: ResolvedPane[]): ResolvedPane[] {
  return panes.map(({ command: _command, ...rest }) => rest)
}
