import { existsSync, statSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

/**
 * Turns a command line into a project path, or nothing.
 *
 * argv is untrusted input: it comes from a shim in the user's PATH and, for a
 * second instance, from another process entirely. Nothing here throws — a bad
 * argument lands on the home screen rather than taking the app down.
 *
 * Pure, and shared by the cold start and the `second-instance` event: two
 * copies would eventually disagree about what `.` means.
 */

export interface CliRequest {
  projectPath: string | null
  error: string | null
}

/**
 * Extracts the user's arguments from an Electron argv.
 *
 * Two shapes have to work, and they differ in more than length:
 *   packaged   [MyTerm.exe, ...userArgs]
 *   unpackaged [electron.exe, appPath, ...userArgs]
 *
 * And in the `second-instance` event argv is the raw command line, with
 * Chromium's own switches interleaved *before* the app path:
 *   [electron.exe, --user-data-dir=…, --allow-file-access-from-files, appPath, project]
 *
 * So switches are stripped first and only then is the fixed prefix dropped.
 * Slicing before filtering mistakes the app path for the requested project.
 */
export function userArgsOf(argv: string[], isPackaged: boolean): string[] {
  const positional = argv.filter((arg) => !arg.startsWith('-'))
  return isPackaged ? positional.slice(1) : positional.slice(2)
}

export function parseCliArgs(
  argv: string[],
  workingDirectory: string,
  isPackaged: boolean,
): CliRequest {
  const args = userArgsOf(argv, isPackaged)
  // Last wins: the project path is always the trailing argument.
  const requested = args[args.length - 1]
  if (!requested) return { projectPath: null, error: null }

  // `.` resolves against the *caller's* directory, not this process's cwd.
  // That is the whole point of `myterm .`, and the classic way to get it wrong.
  const target = isAbsolute(requested) ? resolve(requested) : resolve(workingDirectory, requested)

  if (!existsSync(target)) return { projectPath: null, error: `chemin introuvable : ${target}` }
  if (!statSync(target).isDirectory()) {
    return { projectPath: null, error: `${target} n'est pas un dossier` }
  }

  return { projectPath: target, error: null }
}
