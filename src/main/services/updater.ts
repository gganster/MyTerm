import { app } from 'electron'
import electronUpdater from 'electron-updater'

/**
 * Background updates via GitHub Releases.
 *
 * Two rules shape this, both from ARCHI § electron-updater:
 *
 * 1. An update is never installed while a pane is alive. Restarting the app
 *    kills every shell in it — dev servers, agents mid-conversation. That is
 *    the user's call, never ours.
 * 2. Failures are silent. Being offline, or GitHub rate-limiting, is not
 *    something to interrupt someone's work over.
 *
 * Disabled outside a packaged build: electron-updater throws on every start
 * otherwise, and `npm run dev` should not be noisy.
 */

const { autoUpdater } = electronUpdater

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

export interface UpdateInfo {
  version: string
}

let timer: NodeJS.Timeout | null = null

export function initUpdater(callbacks: {
  onUpdateReady: (info: UpdateInfo) => void
  hasLivePanes: () => boolean
}): void {
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  // We decide when to install, in installUpdate(); never on quit behind the
  // user's back while their panes are running.
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('update-downloaded', (info) => {
    callbacks.onUpdateReady({ version: info.version })
  })

  autoUpdater.on('error', (error) => {
    // Offline, rate-limited, unsigned mirror: none of it is worth a dialog.
    console.warn('[myterm] vérification de mise à jour échouée', error?.message ?? error)
  })

  const check = (): void => {
    void autoUpdater.checkForUpdates().catch(() => undefined)
  }

  // Not awaited at startup: opening a project in under 5 seconds is a PRD
  // metric, and a network round-trip has no business in that path.
  setTimeout(check, 5000)
  timer = setInterval(check, CHECK_INTERVAL_MS)
}

/**
 * Applies a downloaded update. Refuses while panes are alive unless the caller
 * states the user was warned and accepted.
 */
export function installUpdate(options: { force: boolean; hasLivePanes: () => boolean }): boolean {
  if (!app.isPackaged) return false
  if (options.hasLivePanes() && !options.force) return false
  autoUpdater.quitAndInstall(false, true)
  return true
}

export function disposeUpdater(): void {
  if (timer) clearInterval(timer)
  timer = null
}
