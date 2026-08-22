import { MAX_TRUSTED_PROJECTS } from '@shared/schema/preferences'
import { normaliseProjectPath } from '@shared/normalise-path'
import { commandsHash, commandsOf, stripCommands } from '@shared/trust-hash'
import { getPreferences, updatePreferences } from './preferences'
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
  if (commandsOf(panes).length === 0) return false
  return !isTrusted(projectPath, commandsHash(panes))
}
