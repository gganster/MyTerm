import { useEffect, useState } from 'react'
import type { ExternalEditorId, ExternalEditorInfo } from '@shared/ipc-contract'
import { useStore } from '../store'

/**
 * "Open this project in…" — one button per known IDE, next to the folder name.
 *
 * It sits beside the project name rather than in the action group on the right
 * because it acts on *that* name: the folder MyTerm has open is the folder the
 * editor receives. Nothing here is a path — the renderer sends an id and the
 * main process resolves both the executable and the folder.
 *
 * An IDE we cannot locate is shown as unavailable rather than hidden. A button
 * that silently disappears reads as a bug on a machine where the IDE is
 * installed somewhere unusual; one that says so does not. It is marked with
 * `aria-disabled` rather than `disabled` so it keeps its place in the tab
 * order — `disabled` would make the explanation reachable only with a mouse.
 */

const FAILURE_HINT: Record<string, string> = {
  'no-project': 'aucun projet ouvert',
  'not-installed': 'installation introuvable',
  'launch-failed': "l'éditeur n'a pas démarré",
}

export function OpenInEditor(): React.JSX.Element | null {
  const [editors, setEditors] = useState<ExternalEditorInfo[]>([])
  const [failure, setFailure] = useState<string | null>(null)
  const projectPath = useStore((state) => state.projectPath)

  // Installs do not appear while the window is open, so this is read once.
  useEffect(() => {
    let cancelled = false
    void window.myterm.editor.list().then((list) => {
      if (!cancelled) setEditors(list)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Opening another project (the picker, or `myterm .` from a second instance)
  // keeps this component mounted, so a message about the previous folder would
  // otherwise sit next to the new one's name forever.
  useEffect(() => setFailure(null), [projectPath])

  if (editors.length === 0) return null

  const open = (editor: ExternalEditorInfo): void => {
    setFailure(null)
    if (!editor.available) {
      setFailure(`${editor.label} : ${FAILURE_HINT['not-installed']}`)
      return
    }
    void window.myterm.editor.open(editor.id).then((result) => {
      if (result.ok) return
      setFailure(`${editor.label} : ${FAILURE_HINT[result.reason] ?? result.reason}`)
    })
  }

  return (
    <span className="flex shrink-0 items-center gap-1" data-open-in-editor>
      {editors.map((editor) => (
        <button
          key={editor.id}
          type="button"
          data-editor={editor.id as ExternalEditorId}
          aria-disabled={!editor.available}
          onClick={() => open(editor)}
          title={
            editor.available
              ? `Ouvrir le projet dans ${editor.label}`
              : `${editor.label} introuvable sur cette machine`
          }
          className={[
            'rounded border border-border px-1.5 py-0.5 text-[11px] leading-none transition-colors',
            editor.available
              ? 'text-text-muted hover:bg-surface-sunken hover:text-text'
              : 'cursor-not-allowed text-text-muted/40',
          ].join(' ')}
        >
          {editor.label}
        </button>
      ))}
      {/* A live region: clicking is the only way to reach this text, and the
          click gives no other feedback. */}
      <span
        data-open-in-editor-error
        role="status"
        aria-live="polite"
        className="text-[11px] text-status-exited"
      >
        {failure}
      </span>
    </span>
  )
}
