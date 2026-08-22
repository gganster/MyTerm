import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { LayoutSchema, paneShell } from '@shared/schema/layout'
import type { Layout } from '@shared/schema/layout'
import { formatZodError } from '@shared/schema/format-error'
import type { LayoutReadFailure } from '@shared/schema/format-error'
import { atomicWrite, serialiseJson } from '../util/atomic-write'
import { PathOutsideProjectError, resolveCwd } from '../util/resolve-cwd'
import type { ResolvedPane } from './workspace-state'

export const LAYOUT_FILENAME = '.myterm.json'

export type LayoutReadResult =
  | { ok: true; layout: Layout }
  | { ok: false; failure: LayoutReadFailure }

export function layoutPath(projectRoot: string): string {
  return join(projectRoot, LAYOUT_FILENAME)
}

/**
 * Reads and validates a project layout.
 *
 * Never repairs, never rewrites: a file the user committed is only ever read
 * here. Every failure is reported with enough detail to fix the file by hand,
 * because that is the intended way to fix it.
 */
export async function readLayout(projectRoot: string): Promise<LayoutReadResult> {
  const path = layoutPath(projectRoot)
  if (!existsSync(path)) return { ok: false, failure: { kind: 'missing' } }

  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    return { ok: false, failure: { kind: 'unreadable', detail: String(error) } }
  }

  // Windows editors happily prepend a BOM; JSON.parse does not accept one.
  const text = raw.replace(/^﻿/, '').trim()
  if (text.length === 0) return { ok: false, failure: { kind: 'empty' } }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return {
      ok: false,
      failure: { kind: 'malformed-json', detail: (error as Error).message },
    }
  }

  // Checked before schema validation so a newer file gets a message about
  // versions rather than a wall of unrelated field errors.
  const version = (parsed as { version?: unknown })?.version
  if (typeof version === 'number' && version > 1) {
    return { ok: false, failure: { kind: 'future-version', found: version } }
  }

  const result = LayoutSchema.safeParse(parsed)
  if (!result.success) {
    return { ok: false, failure: { kind: 'invalid', problems: formatZodError(result.error) } }
  }

  return { ok: true, layout: result.data }
}

export async function writeLayout(projectRoot: string, layout: Layout): Promise<void> {
  await atomicWrite(layoutPath(projectRoot), serialiseJson(layout))
}

export interface ResolveOutcome {
  panes: ResolvedPane[]
  /** Panes whose cwd could not be used, with the reason, for display in-pane. */
  warnings: { paneId: string; message: string }[]
}

/**
 * Turns a validated layout into panes the PtyManager can start.
 *
 * A bad cwd degrades that one pane to the project root and reports it; it never
 * fails the whole workspace, because five working panes beat an error screen.
 */
export function resolvePanes(projectRoot: string, layout: Layout): ResolveOutcome {
  const warnings: ResolveOutcome['warnings'] = []

  const panes = layout.panes.map((pane): ResolvedPane => {
    const requested = pane.cwd || layout.defaults.cwd
    let cwd = projectRoot

    try {
      const resolved = resolveCwd(projectRoot, requested)
      if (existsSync(resolved)) {
        cwd = resolved
      } else {
        warnings.push({
          paneId: pane.id,
          message: `le dossier « ${requested} » n'existe pas — démarrage à la racine du projet`,
        })
      }
    } catch (error) {
      warnings.push({
        paneId: pane.id,
        message:
          error instanceof PathOutsideProjectError
            ? `${error.message} — démarrage à la racine du projet`
            : `cwd invalide (${String(error)}) — démarrage à la racine du projet`,
      })
    }

    return {
      id: pane.id,
      title: pane.title || pane.id,
      cwd,
      shell: paneShell(layout, pane),
      ...(pane.command ? { command: pane.command } : {}),
    }
  })

  return { panes, warnings }
}

export function projectNameFor(projectRoot: string, layout: Layout | null): string {
  return layout?.name ?? basename(projectRoot)
}
