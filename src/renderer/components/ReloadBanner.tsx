interface ReloadBannerProps {
  /** True when the user also has unsaved edits: reloading would discard them. */
  conflicting: boolean
  onReload: () => void
  onDismiss: () => void
}

/**
 * Raised when `.myterm.json` changes on disk.
 *
 * Non-modal and never automatic: applying an external edit restarts panes, and
 * doing that unannounced under a running dev server is not acceptable
 * (ARCHI § Le schéma). No merge is offered either — the conflict is stated
 * plainly and the user chooses.
 */
export function ReloadBanner({
  conflicting,
  onReload,
  onDismiss,
}: ReloadBannerProps): React.JSX.Element {
  return (
    <div
      data-reload-banner
      className="flex shrink-0 items-center gap-3 border-b border-border bg-surface-raised px-3 py-1.5 text-xs"
    >
      <span className="text-text">
        Le fichier <code className="font-mono">.myterm.json</code> a changé sur le disque.
      </span>
      {conflicting ? (
        <span data-reload-conflict className="text-status-attention">
          Vous avez des modifications non enregistrées : recharger les écrasera.
        </span>
      ) : null}
      <div className="ml-auto flex items-center gap-1.5">
        <button
          type="button"
          data-action="reload-layout"
          onClick={onReload}
          className="rounded bg-accent px-2 py-1 text-xs font-medium text-accent-contrast hover:opacity-90"
        >
          Recharger
        </button>
        <button
          type="button"
          data-action="dismiss-reload"
          onClick={onDismiss}
          className="rounded px-2 py-1 text-xs text-text-muted hover:bg-surface-sunken hover:text-text"
        >
          Ignorer
        </button>
      </div>
    </div>
  )
}
