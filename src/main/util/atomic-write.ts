import { rename, unlink, writeFile } from 'node:fs/promises'

/**
 * Writes a file without ever leaving a truncated one behind.
 *
 * `.myterm.json` lives in the user's repository. A crash or a power cut halfway
 * through a save must not corrupt a committed file, so the content goes to a
 * sibling temp file first and is then renamed — atomic on NTFS within a volume.
 */
export async function atomicWrite(path: string, content: string): Promise<void> {
  const temporary = `${path}.tmp`
  try {
    await writeFile(temporary, content, 'utf8')
    await rename(temporary, path)
  } catch (error) {
    // Best effort: a leftover .tmp is untidy, a lost original is not acceptable.
    await unlink(temporary).catch(() => undefined)
    throw error
  }
}

/** JSON as it should land in git: 2-space indent, trailing newline, LF. */
export function serialiseJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}
