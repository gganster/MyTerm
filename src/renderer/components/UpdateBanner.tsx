interface UpdateBannerProps {
  version: string
  /** True when shells are still running: restarting would kill them. */
  hasLivePanes: boolean
  onRestart: () => void
  onLater: () => void
}

/**
 * Offers a downloaded update. Never applies one on its own.
 *
 * If panes are alive the banner says what restarting will cost, because the
 * cost is real: a dev server and any agent mid-conversation both die with the
 * app (ARCHI § electron-updater).
 */
export function UpdateBanner({
  version,
  hasLivePanes,
  onRestart,
  onLater,
}: UpdateBannerProps): React.JSX.Element {
  return (
    <div
      data-update-banner
      className="flex shrink-0 items-center gap-3 border-b border-border bg-surface-raised px-3 py-1.5 text-xs"
    >
      <span className="text-text">
        Version <span className="font-medium">{version}</span> disponible.
      </span>
      {hasLivePanes ? (
        <span className="text-status-attention">
          Redémarrer fermera les {'panes'} en cours d’exécution.
        </span>
      ) : null}
      <div className="ml-auto flex items-center gap-1.5">
        <button
          type="button"
          data-action="install-update"
          onClick={onRestart}
          className="rounded bg-accent px-2 py-1 text-xs font-medium text-accent-contrast hover:opacity-90"
        >
          Redémarrer maintenant
        </button>
        <button
          type="button"
          data-action="update-later"
          onClick={onLater}
          className="rounded px-2 py-1 text-xs text-text-muted hover:bg-surface-sunken hover:text-text"
        >
          Plus tard
        </button>
      </div>
    </div>
  )
}
