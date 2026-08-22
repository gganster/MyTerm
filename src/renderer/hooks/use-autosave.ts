import { useCallback, useEffect, useRef, useState } from 'react'
import type { Layout } from '@shared/schema/layout'
import { useStore } from '../store'

/**
 * Persists layout edits without the user having to think about it.
 *
 * Debounced rather than manual-only: losing a layout because someone forgot
 * Ctrl+S would be a bad trade for a file this small. Ctrl+S still forces an
 * immediate write, because people expect it to.
 */
export function useAutosave(): {
  saveNow: () => Promise<void>
  saveError: string | null
} {
  const dirty = useStore((state) => state.dirty)
  const layout = useStore((state) => state.layout)
  const projectPath = useStore((state) => state.projectPath)
  const markSaved = useStore((state) => state.markSaved)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Kept in a ref so the debounced timer always writes the newest layout
  // without being restarted on every keystroke.
  const latest = useRef<Layout>(layout)
  latest.current = layout

  const saveNow = useCallback(async () => {
    if (!useStore.getState().projectPath) return
    const result = await window.myterm.workspace.save(latest.current)
    if (result.ok) {
      setSaveError(null)
      markSaved()
    } else {
      // Keep `dirty` set: the edit is still unsaved and must be retried.
      setSaveError(result.problems.join('\n'))
    }
  }, [markSaved])

  useEffect(() => {
    if (!dirty || !projectPath) return
    const timer = window.setTimeout(() => void saveNow(), 1000)
    return () => window.clearTimeout(timer)
  }, [dirty, projectPath, layout, saveNow])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!event.ctrlKey || event.shiftKey || event.key.toLowerCase() !== 's') return
      event.preventDefault()
      void saveNow()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [saveNow])

  return { saveNow, saveError }
}
