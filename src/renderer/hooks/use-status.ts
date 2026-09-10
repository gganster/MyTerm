import { useEffect, useState } from 'react'
import type { UsageByProvider } from '@shared/ipc-contract'
import type { SystemLoad } from '@shared/system-load'

/**
 * The two ambient readings behind the status bar.
 *
 * Called from `StatusBar` and nowhere else, deliberately. Hoisting it into
 * `App` would re-render the entire grid every two seconds for a footer nobody
 * is looking at — the exact failure mode ARCHI § State Management warns about.
 * A leaf component owning its own subscription re-renders only itself.
 */

/** The countdown is minute-granular, so a slow tick is enough to keep it honest. */
const COUNTDOWN_TICK_MS = 20_000

export interface StatusReadings {
  usage: UsageByProvider | null
  load: SystemLoad | null
  /** Clock used to render countdowns, refreshed on its own slow tick. */
  now: number
}

export function useStatus(): StatusReadings {
  const [usage, setUsage] = useState<UsageByProvider | null>(null)
  const [load, setLoad] = useState<SystemLoad | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let cancelled = false
    const unsubscribe = window.myterm.status.onUsage(setUsage)

    // Pull as well as subscribe: the main process starts polling long before
    // this component mounts, and a push emitted in between would be lost.
    void window.myterm.status.getUsage().then((pulled) => {
      if (cancelled) return
      // Never overwrite a push that won the race — it is strictly newer, and
      // it carries both providers, so there is nothing to merge in from here.
      setUsage((current) => current ?? pulled)
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const unsubscribe = window.myterm.status.onLoad(setLoad)
    void window.myterm.status.getLoad().then((sample) => {
      if (cancelled) return
      setLoad((current) => current ?? sample)
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), COUNTDOWN_TICK_MS)
    return () => clearInterval(timer)
  }, [])

  return { usage, load, now }
}
