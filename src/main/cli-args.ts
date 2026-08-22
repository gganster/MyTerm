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

/**
 * Undoes the one way Windows hands us a path it has already broken.
 *
 * A command line ending `"C:\"` is not what it looks like. `CommandLineToArgvW`,
 * which builds `process.argv`, reads `\"` as an escaped quote, so the argument
 * becomes `C:"` and the quote is never closed. Measured, not deduced:
 *
 *   "…\MyTerm.exe" "C:\"   ->  argv[1] = C:"
 *
 * It only bites at a drive root, because only a drive root keeps its trailing
 * backslash — and it is reachable: the Explorer context menu substitutes `%V`
 * with `C:\` when you right-click the background of an open drive window, and a
 * drive root's background does serve `Directory\Background\shell` verbs.
 * `myterm C:\` from a terminal lands in exactly the same place.
 *
 * Left alone the failure is silent: `C:"` is not absolute, resolves against the
 * caller's directory into nonsense, and the user gets the home screen.
 *
 * A trailing quote cannot occur any other way — `"` is not a legal character in
 * a Windows path — so the repair cannot swallow a real argument.
 */
function repairDriveRoot(requested: string | undefined): string | undefined {
  if (!requested || !requested.endsWith('"')) return requested
  return `${requested.slice(0, -1)}\\`
}

export function parseCliArgs(
  argv: string[],
  workingDirectory: string,
  isPackaged: boolean,
): CliRequest {
  const args = userArgsOf(argv, isPackaged)
  // Last wins: the project path is always the trailing argument.
  const requested = repairDriveRoot(args[args.length - 1])
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
