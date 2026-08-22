import { createHash } from 'node:crypto'
import { readFileSync, watch } from 'node:fs'
import type { FSWatcher } from 'node:fs'
import { basename, dirname } from 'node:path'
import { LAYOUT_FILENAME, layoutPath } from './workspace'

/**
 * Notices when `.myterm.json` is edited outside the app.
 *
 * Never applies the change: reloading kills and restarts panes, and doing that
 * under the user while a dev server runs is not acceptable. It raises a banner
 * and waits (ARCHI § Le schéma).
 *
 * Two Windows details this has to survive:
 *   - fs.watch fires duplicate events for a single save;
 *   - many editors save by writing a temp file and renaming over the target,
 *     which invalidates a watch on the file itself. Watching the *directory*
 *     and filtering by name is the robust form.
 */

let watcher: FSWatcher | null = null
let watchedPath: string | null = null
let selfWrittenHash: string | null = null
let notifyTimer: NodeJS.Timeout | null = null

function hash(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

/** Called right before the app writes, so its own write is not reported back. */
export function markSelfWrite(content: string): void {
  selfWrittenHash = hash(content)
}

export function watchLayout(projectRoot: string, onChanged: () => void): void {
  stopWatching()
  watchedPath = layoutPath(projectRoot)

  try {
    watcher = watch(dirname(watchedPath), (_event, filename) => {
      if (!filename || basename(filename.toString()) !== LAYOUT_FILENAME) return

      // Coalesce the duplicate events a single save produces.
      if (notifyTimer) clearTimeout(notifyTimer)
      notifyTimer = setTimeout(() => {
        notifyTimer = null
        let current: string
        try {
          current = readFileSync(watchedPath!, 'utf8')
        } catch {
          // Deleted or briefly locked mid-save: report it, the renderer decides.
          onChanged()
          return
        }
        // Content comparison rather than a timing window: reliable regardless of
        // how slow the write was.
        if (selfWrittenHash && hash(current) === selfWrittenHash) return
        onChanged()
      }, 150)
    })
  } catch (error) {
    console.warn('[myterm] surveillance de .myterm.json impossible', error)
  }
}

export function stopWatching(): void {
  if (notifyTimer) clearTimeout(notifyTimer)
  notifyTimer = null
  watcher?.close()
  watcher = null
  watchedPath = null
  selfWrittenHash = null
}
