import { app, dialog } from 'electron'
import electronUpdater from 'electron-updater'
import { isPrimaryInstance, otherInstanceCount } from './instances'

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
 * Several instances can run at once, and both rules had to be re-earned:
 *
 * - Only the elected instance checks. Every instance polling would multiply the
 *   GitHub requests and, worse, point several electron-updater downloads at one
 *   shared cache folder — the same partial file written twice.
 * - `quitAndInstall` hands over to the NSIS installer, which closes *every*
 *   MyTerm on the machine, not just the one whose banner was clicked. Rule 1
 *   would be a fiction if this process only counted its own panes, so an
 *   install with other instances alive asks first.
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
    // Re-asked every tick rather than decided once: the elected instance is
    // simply the oldest one alive, so when it quits the next one picks the duty
    // up on its own schedule with nothing to hand over.
    if (!isPrimaryInstance()) return
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
 *
 * The second gate is the one the banner cannot cover. Its warning speaks for
 * the window it is drawn in; the installer closes the other windows too, and
 * their shells are not this renderer's to spend. So when another instance is
 * alive the choice is put to the user here, in a modal, before anything quits.
 */
export async function installUpdate(options: {
  force: boolean
  hasLivePanes: () => boolean
}): Promise<boolean> {
  if (!app.isPackaged) return false
  if (options.hasLivePanes() && !options.force) return false

  const others = otherInstanceCount()
  if (others > 0) {
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      buttons: ['Installer et tout fermer', 'Annuler'],
      defaultId: 1,
      cancelId: 1,
      title: 'Mise à jour de MyTerm',
      message:
        others === 1
          ? 'Une autre fenêtre MyTerm est ouverte.'
          : `${others} autres fenêtres MyTerm sont ouvertes.`,
      detail:
        "L'installation ferme toutes les fenêtres MyTerm, et les shells qui y tournent, pas seulement celle-ci.",
    })
    if (response !== 0) return false
  }

  autoUpdater.quitAndInstall(false, true)
  return true
}

export function disposeUpdater(): void {
  if (timer) clearInterval(timer)
  timer = null
}
