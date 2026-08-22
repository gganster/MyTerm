/**
 * Canonical form of a project path for comparison.
 *
 * Windows paths compare case-insensitively and tolerate a trailing separator,
 * so `C:\Proj`, `c:\proj` and `C:\Proj\` are one project. Getting this wrong
 * would let the same directory be trusted, forgotten and re-prompted as if it
 * were three different projects.
 *
 * Deliberately dependency-free so it can be shared and tested directly.
 */
export function normaliseProjectPath(path: string, platform: string = process.platform): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  return platform === 'win32' ? trimmed.toLowerCase() : trimmed
}
