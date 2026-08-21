import type { ThemeMode } from '@shared/schema/layout'
import { useStore } from '../store'

const MODES: { value: ThemeMode; label: string; icon: string }[] = [
  { value: 'light', label: 'Thème clair', icon: '☀' },
  { value: 'dark', label: 'Thème sombre', icon: '☾' },
  { value: 'system', label: 'Suivre Windows', icon: '⌂' },
]

export function ThemeToggle(): React.JSX.Element {
  const themeMode = useStore((state) => state.themeMode)
  const setThemeMode = useStore((state) => state.setThemeMode)
  const setResolvedTheme = useStore((state) => state.setResolvedTheme)

  const choose = (mode: ThemeMode): void => {
    setThemeMode(mode)
    // The main process owns nativeTheme, so it decides what `system` resolves
    // to and hands the answer back.
    void window.myterm.theme.set(mode).then(setResolvedTheme)
  }

  return (
    <div
      role="radiogroup"
      aria-label="Thème"
      data-theme-toggle
      className="flex items-center gap-0.5 rounded-md border border-border bg-surface-raised p-0.5"
    >
      {MODES.map((mode) => (
        <button
          key={mode.value}
          type="button"
          role="radio"
          aria-checked={themeMode === mode.value}
          aria-label={mode.label}
          title={mode.label}
          data-mode={mode.value}
          onClick={() => choose(mode.value)}
          className={[
            'rounded px-1.5 py-0.5 text-xs leading-none transition-colors',
            themeMode === mode.value
              ? 'bg-accent text-accent-contrast'
              : 'text-text-muted hover:bg-surface-sunken hover:text-text',
          ].join(' ')}
        >
          {mode.icon}
        </button>
      ))}
    </div>
  )
}
