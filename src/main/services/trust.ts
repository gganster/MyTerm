import { normaliseProjectPath } from '@shared/normalise-path'
import { commandsHash, commandsOf, stripCommands } from '@shared/trust-hash'
import { getPreferences, recordRevoke, recordTrust } from './preferences'
import type { ResolvedPane } from './workspace-state'

/**
 * Workspace trust (ADR-004) — the stateful half.
 *
 * The PRD commits `.myterm.json` to the repository so a team shares one setup.
 * The price of that decision is this: cloning a hostile repository and opening
 * it would otherwise run its autolaunch commands on sight. VS Code solved the
 * same problem the same way, for the same reason.
 *
 * The decision is taken here, in the main process. The renderer shows a dialog
 * and reports a choice, but it is main that refuses to spawn — compromising the
 * renderer must not be enough to get past the gate.
 *
 * The hashing itself lives in @shared/trust-hash, which is pure and tested.
 */

export { commandsHash, commandsOf, stripCommands }

export function isTrusted(projectPath: string, hash: string): boolean {
  const key = normaliseProjectPath(projectPath)
  return getPreferences().trustedProjects.some(
    (entry) => normaliseProjectPath(entry.path) === key && entry.commandsHash === hash,
  )
}

/**
 * An approval and a withdrawal are recorded as *what changed*, never as a new
 * copy of the whole list. With several instances sharing preferences.json, a
 * list written wholesale is indistinguishable from a stale cache: another
 * window saving a moment later would put back the approval this one just
 * withdrew, re-arming autolaunch on a repository the user had refused.
 * @shared/schema/preferences-merge is where the two are told apart.
 */
export function trustProject(projectPath: string, hash: string): void {
  recordTrust(projectPath, hash)
}

export function revokeProject(projectPath: string): void {
  recordRevoke(projectPath)
}

/** A layout with no autolaunch command has nothing to approve. */
export function requiresApproval(projectPath: string, panes: ResolvedPane[]): boolean {
  if (commandsOf(panes).length === 0) return false
  return !isTrusted(projectPath, commandsHash(panes))
}
