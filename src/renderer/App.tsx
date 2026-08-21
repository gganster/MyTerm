/*
 * Scaffold placeholder (task 01). Replaced by the terminal pane in task 04 and
 * by the project picker / grid split in tasks 06 and 13.
 *
 * It doubles as a live sandbox assertion: if any of these are defined, the
 * renderer is not properly isolated and that is a security regression.
 */
const sandboxLeaks = (['require', 'process', 'module', 'global'] as const).filter(
  (key) => typeof (window as unknown as Record<string, unknown>)[key] !== 'undefined',
)

export function App(): React.JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-surface text-text">
      <h1 className="text-2xl font-semibold tracking-tight">MyTerm</h1>
      <p className="text-sm text-text-muted">Scaffold opérationnel — tâche 01</p>
      <p
        className={
          sandboxLeaks.length === 0
            ? 'rounded border border-border bg-surface-raised px-3 py-1 font-mono text-xs text-text-muted'
            : 'rounded border border-red-500 bg-red-50 px-3 py-1 font-mono text-xs text-red-700'
        }
      >
        {sandboxLeaks.length === 0
          ? 'sandbox ok · require/process/module/global indéfinis'
          : `FUITE SANDBOX : ${sandboxLeaks.join(', ')}`}
      </p>
    </div>
  )
}
