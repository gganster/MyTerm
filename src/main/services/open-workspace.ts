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
import { readLayout, resolvePanes, writeLayout } from './workspace'
import { markSelfWrite, stopWatching, watchLayout } from './workspace-watcher'
import { serialiseJson } from '../util/atomic-write'
import { LayoutSchema } from '@shared/schema/layout'
import { formatZodError } from '@shared/schema/format-error'
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

let onDiskChange: (() => void) | null = null

/** Registered once by the IPC layer so this module stays Electron-free. */
export function setDiskChangeListener(listener: () => void): void {
  onDiskChange = listener
}

function commit(pending: Pending, generated: boolean): OpenWorkspaceResult {
  workspaceState.load(pending.projectPath, pending.panes)
  rememberProject(pending.projectPath, pending.projectName)
  watchLayout(pending.projectPath, () => onDiskChange?.())

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

export function closeWorkspace(): void {
  stopWatching()
  workspaceState.clear()
}

export type SaveResult = { ok: true; warnings: Pending['warnings'] } | { ok: false; problems: string[] }

/**
 * Persists a layout edited inside the app.
 *
 * Trust is refreshed rather than re-asked: the user typed these commands here,
 * which is consent by definition. The prompt exists for commands that arrive
 * from a file someone else wrote.
 */
export async function saveWorkspace(raw: unknown): Promise<SaveResult> {
  const projectRoot = workspaceState.projectRoot
  if (!projectRoot) return { ok: false, problems: ['aucun projet ouvert'] }

  const parsed = LayoutSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, problems: formatZodError(parsed.error) }

  markSelfWrite(serialiseJson(parsed.data))
  await writeLayout(projectRoot, parsed.data)

  const { panes, warnings } = resolvePanes(projectRoot, parsed.data)
  workspaceState.load(projectRoot, panes)
  trustProject(projectRoot, commandsHash(panes))

  return { ok: true, warnings }
}

/**
 * Re-reads the file after an external edit.
 *
 * Unlike opening, this does not kill anything: the renderer diffs the layouts
 * and restarts only the panes whose spec actually changed (task 16).
 */
export async function reloadWorkspace(): Promise<OpenWorkspaceResult> {
  const projectRoot = workspaceState.projectRoot
  if (!projectRoot) return { status: 'error', projectPath: '', message: 'aucun projet ouvert' }

  const read = await readLayout(projectRoot)
  if (!read.ok) {
    // The workspace in memory keeps running; only the reload fails.
    return { status: 'error', projectPath: projectRoot, message: describeFailure(read.failure) }
  }

  const layout = read.layout
  const projectName = layout.name ?? basename(projectRoot)
  const { panes, warnings } = resolvePanes(projectRoot, layout)

  if (requiresApproval(projectRoot, panes)) {
    pendingApproval = { projectPath: projectRoot, projectName, layout, panes, warnings }
    return {
      status: 'needs-trust',
      projectPath: projectRoot,
      projectName,
      layout,
      commands: commandsOf(panes),
    }
  }

  workspaceState.load(projectRoot, panes)
  return {
    status: 'ok',
    projectPath: projectRoot,
    projectName,
    layout,
    warnings,
    generated: false,
  }
}

export function hasPendingApproval(): boolean {
  return pendingApproval !== null
}
