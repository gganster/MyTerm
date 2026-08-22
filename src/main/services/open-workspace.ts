import { existsSync, statSync } from 'node:fs'
import { basename } from 'node:path'
import type { OpenWorkspaceResult, TrustDecision } from '@shared/ipc-contract'
import { defaultLayout } from '@shared/schema/layout'
import type { Layout } from '@shared/schema/layout'
import { describeFailure } from '@shared/schema/format-error'
import { rememberProject } from './preferences'
import {
  commandsHash,
  commandsOf,
  requiresApproval,
  revokeProject,
  stripCommands,
  trustProject,
} from './trust'
import { readLayout, resolvePanes } from './workspace'
import { workspaceState } from './workspace-state'
import type { ResolvedPane } from './workspace-state'

/**
 * The single entry point for opening a project, whatever the door: recent list,
 * folder picker or `myterm .` from a terminal.
 *
 * One implementation on purpose — three copies of this flow would eventually
 * mean one of them forgetting the trust check.
 */

interface Pending {
  projectPath: string
  projectName: string
  layout: Layout
  panes: ResolvedPane[]
  warnings: { paneId: string; message: string }[]
}

/** Set while the user is answering the trust dialog. Nothing is spawned meanwhile. */
let pendingApproval: Pending | null = null

export async function openWorkspace(projectPath: string): Promise<OpenWorkspaceResult> {
  pendingApproval = null

  if (!existsSync(projectPath) || !statSync(projectPath).isDirectory()) {
    return { status: 'error', projectPath, message: "ce chemin n'est pas un dossier existant" }
  }

  const read = await readLayout(projectPath)

  let layout: Layout
  let generated = false

  if (read.ok) {
    layout = read.layout
  } else if (read.failure.kind === 'missing') {
    // No file: open a single pane. We do NOT create a .myterm.json — writing
    // into someone's repository uninvited is not ours to do.
    layout = defaultLayout(basename(projectPath))
    generated = true
  } else {
    return { status: 'error', projectPath, message: describeFailure(read.failure) }
  }

  const projectName = layout.name ?? basename(projectPath)
  const { panes, warnings } = resolvePanes(projectPath, layout)

  if (requiresApproval(projectPath, panes)) {
    // Held, not loaded: workspaceState stays untouched so no pane can spawn.
    pendingApproval = { projectPath, projectName, layout, panes, warnings }
    return {
      status: 'needs-trust',
      projectPath,
      projectName,
      layout,
      commands: commandsOf(panes),
    }
  }

  return commit({ projectPath, projectName, layout, panes, warnings }, generated)
}

export function decideTrust(decision: TrustDecision): OpenWorkspaceResult | null {
  const pending = pendingApproval
  pendingApproval = null
  if (!pending) return null

  if (decision === 'cancel') return null

  if (decision === 'approve') {
    trustProject(pending.projectPath, commandsHash(pending.panes))
    return commit(pending, false)
  }

  // open-without-executing: the grid is restored, the commands are not run, and
  // nothing is remembered — the user did not approve anything.
  return commit({ ...pending, panes: stripCommands(pending.panes) }, false)
}

function commit(pending: Pending, generated: boolean): OpenWorkspaceResult {
  workspaceState.load(pending.projectPath, pending.panes)
  rememberProject(pending.projectPath, pending.projectName)

  return {
    status: 'ok',
    projectPath: pending.projectPath,
    projectName: pending.projectName,
    layout: pending.layout,
    warnings: pending.warnings,
    generated,
  }
}

export function revokeTrust(projectPath: string): void {
  revokeProject(projectPath)
}

export function hasPendingApproval(): boolean {
  return pendingApproval !== null
}
