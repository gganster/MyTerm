import { isAbsolute, resolve, sep } from 'node:path'

/**
 * Path containment for pane working directories.
 *
 * A `.myterm.json` is committed and cloned, so `cwd: "../../Windows"` in a
 * hostile layout must not send a pane wandering off the project. Every pane cwd
 * is resolved against the project root and refused if it escapes.
 *
 * Two Windows-specific traps this has to get right:
 *   - comparison is case-insensitive, so C:\Proj and c:\proj are one directory;
 *   - a plain startsWith would accept C:\proj2 as a child of C:\proj, hence the
 *     trailing separator.
 */

export class PathOutsideProjectError extends Error {
  constructor(
    readonly projectRoot: string,
    readonly requested: string,
  ) {
    super(`« ${requested} » sort de la racine du projet (${projectRoot})`)
    this.name = 'PathOutsideProjectError'
  }
}

function normalise(path: string): string {
  const resolved = resolve(path)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

export function isInsideRoot(projectRoot: string, candidate: string): boolean {
  const root = normalise(projectRoot)
  const target = normalise(candidate)
  if (target === root) return true
  return target.startsWith(root.endsWith(sep) ? root : root + sep)
}

/**
 * Resolves a pane cwd. Absolute paths are allowed only if they still land
 * inside the project — a layout may legitimately be written with one, but it
 * cannot be used to reach outside.
 */
export function resolveCwd(projectRoot: string, cwd: string): string {
  const target = isAbsolute(cwd) ? resolve(cwd) : resolve(projectRoot, cwd)
  if (!isInsideRoot(projectRoot, target)) {
    throw new PathOutsideProjectError(projectRoot, cwd)
  }
  return target
}
