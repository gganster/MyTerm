import { useCallback, useEffect, useState } from 'react'
import type { OpenWorkspaceResult, TrustSubject } from '@shared/ipc-contract'
import { LayoutSchema } from '@shared/schema/layout'
import type { Preferences } from '@shared/schema/preferences'
import { useStore } from '../store'

/**
 * Owns opening a project, from every entry point.
 *
 * The three doors — recent list, folder picker and the CLI — all funnel through
 * `open()`, so the trust gate cannot be forgotten on one of them.
 */

export interface PendingTrust {
  projectPath: string
  projectName: string
  commands: TrustSubject[]
}

export interface WorkspaceController {
  preferences: Preferences | null
  pendingTrust: PendingTrust | null
  error: string | null
  warnings: { paneId: string; message: string }[]
  open: (projectPath: string) => Promise<void>
  pick: () => Promise<void>
  close: () => Promise<void>
  decideTrust: (decision: 'approve' | 'open-without-executing' | 'cancel') => Promise<void>
  forget: (projectPath: string) => Promise<void>
  dismissError: () => void
}

export function useWorkspace(): WorkspaceController {
  const [preferences, setPreferences] = useState<Preferences | null>(null)
  const [pendingTrust, setPendingTrust] = useState<PendingTrust | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<{ paneId: string; message: string }[]>([])

  const openWorkspace = useStore((state) => state.openWorkspace)
  const closeWorkspace = useStore((state) => state.closeWorkspace)

  useEffect(() => {
    void window.myterm.prefs.get().then((value) => setPreferences(value as Preferences))
  }, [])

  const applyResult = useCallback(
    (result: OpenWorkspaceResult | null) => {
      if (!result) return

      if (result.status === 'error') {
        setError(result.message)
        setPendingTrust(null)
        return
      }

      if (result.status === 'needs-trust') {
        setPendingTrust({
          projectPath: result.projectPath,
          projectName: result.projectName,
          commands: result.commands,
        })
        return
      }

      // The layout crossed the process boundary as `unknown`; validate it on
      // this side too rather than trusting the shape.
      const parsed = LayoutSchema.safeParse(result.layout)
      if (!parsed.success) {
        setError('le layout renvoyé par le processus principal est invalide')
        return
      }

      setPendingTrust(null)
      setError(null)
      setWarnings(result.warnings)
      openWorkspace(result.projectPath, result.projectName, parsed.data)
      void window.myterm.prefs.get().then((value) => setPreferences(value as Preferences))
    },
    [openWorkspace],
  )

  const open = useCallback(
    async (projectPath: string) => {
      setError(null)
      setWarnings([])
      applyResult(await window.myterm.workspace.open(projectPath))
    },
    [applyResult],
  )

  const pick = useCallback(async () => {
    const picked = await window.myterm.workspace.pick()
    if (picked) await open(picked)
  }, [open])

  const close = useCallback(async () => {
    await window.myterm.workspace.close()
    closeWorkspace()
    setWarnings([])
    setPendingTrust(null)
  }, [closeWorkspace])

  const decideTrust = useCallback(
    async (decision: 'approve' | 'open-without-executing' | 'cancel') => {
      const result = await window.myterm.workspace.trustDecide(decision)
      if (decision === 'cancel') {
        setPendingTrust(null)
        return
      }
      applyResult(result)
    },
    [applyResult],
  )

  const forget = useCallback(async (projectPath: string) => {
    const next = await window.myterm.workspace.forget(projectPath)
    setPreferences(next as Preferences)
  }, [])

  return {
    preferences,
    pendingTrust,
    error,
    warnings,
    open,
    pick,
    close,
    decideTrust,
    forget,
    dismissError: () => setError(null),
  }
}
