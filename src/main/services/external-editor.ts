import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ChildProcess } from 'node:child_process'
import type { ExternalEditorId, ExternalEditorInfo, OpenInEditorResult } from '@shared/ipc-contract'

/**
 * Launching the project in an external IDE.
 *
 * The renderer never names an executable, a path or a command line — it names
 * one of the ids below, and this module decides what that id is allowed to
 * start and on which folder (the project root the main process already holds).
 * That is the same rule as `pane:spawn`: a compromised renderer must not gain a
 * way to run an arbitrary binary (ARCHI § Sécurité, points 2 and 3).
 *
 * Two consequences follow:
 *
 * - **No shell.** The `.cmd` shims on PATH (`code.cmd`, `antigravity.cmd`) would
 *   need `shell: true`, which reintroduces string interpretation of the folder
 *   path. The real `.exe` is spawned directly with the folder as a single argv
 *   entry, so quoting is never a question. That is a security property, so the
 *   spawn itself is injectable and asserted in the tests rather than trusted.
 * - **Known install locations only.** An editor that cannot be located stays
 *   visibly unavailable rather than being guessed at.
 */

interface EditorDefinition {
  label: string
  /** Absolute-path templates, in the order a machine is likely to have them. */
  candidates: (env: NodeJS.ProcessEnv) => (string | undefined)[]
}

function underPrograms(env: NodeJS.ProcessEnv, ...parts: string[]): string | undefined {
  const base = env.LOCALAPPDATA
  return base ? join(base, 'Programs', ...parts) : undefined
}

function underProgramFiles(env: NodeJS.ProcessEnv, ...parts: string[]): string | undefined {
  const base = env.ProgramFiles
  return base ? join(base, ...parts) : undefined
}

const EDITORS: Record<ExternalEditorId, EditorDefinition> = {
  vscode: {
    label: 'VS Code',
    candidates: (env) => [
      // The user-scoped installer is the default download, so it goes first.
      underPrograms(env, 'Microsoft VS Code', 'Code.exe'),
      underProgramFiles(env, 'Microsoft VS Code', 'Code.exe'),
      env['ProgramFiles(x86)']
        ? join(env['ProgramFiles(x86)'], 'Microsoft VS Code', 'Code.exe')
        : undefined,
    ],
  },
  antigravity: {
    label: 'Antigravity',
    // Two products ship under this name and only one of them is an editor.
    // `Antigravity\Antigravity.exe` is the agent Manager: handed a folder it
    // ignores it and opens its own project list — measured, not assumed, and
    // the same is true of its bundled `cli.js`. Only `Antigravity IDE.exe`
    // opens the folder in an editor window, so it is the only thing we launch.
    candidates: (env) => [
      underPrograms(env, 'Antigravity IDE', 'Antigravity IDE.exe'),
      underProgramFiles(env, 'Antigravity IDE', 'Antigravity IDE.exe'),
    ],
  },
}

export const EDITOR_IDS = Object.keys(EDITORS) as ExternalEditorId[]

/**
 * First candidate that exists, or `null`.
 *
 * `exists` is injected so the resolution order is testable without installing
 * four IDEs on the test machine.
 */
export function resolveEditorPath(
  id: ExternalEditorId,
  env: NodeJS.ProcessEnv,
  exists: (path: string) => boolean = existsSync,
): string | null {
  for (const candidate of EDITORS[id].candidates(env)) {
    if (candidate && exists(candidate)) return candidate
  }
  return null
}

/** What the header renders: every editor, with the ones we cannot find marked. */
export function listEditors(
  env: NodeJS.ProcessEnv = process.env,
  exists: (path: string) => boolean = existsSync,
): ExternalEditorInfo[] {
  return EDITOR_IDS.map((id) => ({
    id,
    label: EDITORS[id].label,
    available: resolveEditorPath(id, env, exists) !== null,
  }))
}

/** Everything this module touches outside itself, so a test can stand in for it. */
export interface OpenInEditorDeps {
  spawnFn?: typeof spawn
  env?: NodeJS.ProcessEnv
  exists?: (path: string) => boolean
}

/**
 * Opens `projectRoot` in `id`.
 *
 * Asynchronous because the interesting failure is: `spawn` reports a missing,
 * empty or blocked executable through an `'error'` event, not by throwing. A
 * version of this that returned as soon as the child object existed would tell
 * the renderer "opened" for an editor that never started — and the button would
 * be a no-op with no way to find out why. So the promise settles on whichever
 * of `'spawn'` / `'error'` fires first.
 *
 * The child is detached and unref'd: the editor must outlive MyTerm, and stdio
 * we never read would only keep a handle open.
 */
export function openInEditor(
  id: ExternalEditorId,
  projectRoot: string | null,
  deps: OpenInEditorDeps = {},
): Promise<OpenInEditorResult> {
  const { spawnFn = spawn, env = process.env, exists = existsSync } = deps

  // The id crosses the process boundary, so the type annotation is a claim and
  // not a fact: anything the renderer sends lands here. An unknown key would
  // otherwise dereference `undefined` — or worse, `__proto__`.
  if (!Object.hasOwn(EDITORS, id)) return Promise.resolve({ ok: false, reason: 'not-installed' })
  if (!projectRoot) return Promise.resolve({ ok: false, reason: 'no-project' })

  const executable = resolveEditorPath(id, env, exists)
  if (!executable) return Promise.resolve({ ok: false, reason: 'not-installed' })

  return new Promise((resolve) => {
    let settled = false
    const settle = (result: OpenInEditorResult): void => {
      if (settled) return
      settled = true
      resolve(result)
    }

    let child: ChildProcess
    try {
      child = spawnFn(executable, [projectRoot], { detached: true, stdio: 'ignore' })
    } catch {
      // Only bad options reach here; a bad executable arrives as 'error' below.
      settle({ ok: false, reason: 'launch-failed' })
      return
    }

    child.on('error', () => settle({ ok: false, reason: 'launch-failed' }))
    child.on('spawn', () => settle({ ok: true }))
    child.unref()
  })
}
