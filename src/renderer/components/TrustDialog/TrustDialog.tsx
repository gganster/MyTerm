import * as Dialog from '@radix-ui/react-dialog'
import type { TrustSubject } from '@shared/ipc-contract'

interface TrustDialogProps {
  projectPath: string
  projectName: string
  commands: TrustSubject[]
  onApprove: () => void
  onOpenWithoutExecuting: () => void
  onCancel: () => void
}

/**
 * Approval gate for a project we have not seen before (ADR-004).
 *
 * The whole value of this dialog is the list below: the exact commands, with
 * their working directory, exactly as written in the file. Summarising them
 * would remove the only information the decision rests on.
 *
 * Rendered on a Radix primitive rather than hand-rolled, because a security
 * prompt with a broken focus trap is worse than no prompt.
 */
export function TrustDialog({
  projectPath,
  projectName,
  commands,
  onApprove,
  onOpenWithoutExecuting,
  onCancel,
}: TrustDialogProps): React.JSX.Element {
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50" />
        <Dialog.Content
          data-trust-dialog
          className="fixed left-1/2 top-1/2 max-h-[80vh] w-[min(680px,92vw)] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-lg border border-border bg-surface p-5 shadow-xl"
        >
          <Dialog.Title className="text-base font-semibold text-text">
            Exécuter les commandes de ce projet ?
          </Dialog.Title>

          <Dialog.Description className="mt-1 text-xs text-text-muted">
            <span className="font-medium text-text">{projectName}</span> est ouvert pour la première
            fois. Son fichier <code className="font-mono">.myterm.json</code> demande à lancer{' '}
            {commands.length} commande{commands.length > 1 ? 's' : ''} automatiquement.
          </Dialog.Description>

          <p className="mt-1 truncate font-mono text-[11px] text-text-muted" title={projectPath}>
            {projectPath}
          </p>

          <ul className="mt-3 space-y-1.5" data-trust-commands>
            {commands.map((command) => (
              <li
                key={command.paneId}
                className="rounded border border-border bg-surface-raised px-2.5 py-2"
              >
                <div className="flex items-baseline gap-2">
                  <span className="text-xs font-medium text-text">{command.title}</span>
                  <span className="truncate font-mono text-[11px] text-text-muted">
                    {command.cwd}
                  </span>
                </div>
                {/* Shown raw, with no variable expansion: a rewritten command
                    would be more misleading than the original. */}
                <code className="mt-1 block break-all font-mono text-xs text-text">
                  {command.shell} → {command.command}
                </code>
              </li>
            ))}
          </ul>

          <p className="mt-3 text-[11px] text-text-muted">
            N'approuvez que si vous faites confiance à la source de ce dépôt. Un{' '}
            <code className="font-mono">.myterm.json</code> est un fichier versionné : il peut venir
            de n'importe qui.
          </p>

          <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              data-trust-action="cancel"
              className="rounded px-3 py-1.5 text-xs text-text-muted hover:bg-surface-sunken hover:text-text"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={onOpenWithoutExecuting}
              data-trust-action="open-without-executing"
              className="rounded border border-border px-3 py-1.5 text-xs text-text hover:bg-surface-sunken"
            >
              Ouvrir sans exécuter
            </button>
            <button
              type="button"
              onClick={onApprove}
              data-trust-action="approve"
              className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-accent-contrast hover:opacity-90"
            >
              Approuver et ouvrir
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
