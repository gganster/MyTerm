import { useEffect, useRef } from 'react'
import { createTerminal } from '../../terminal/create-terminal'
import { disposeTerminal, getTerminal, registerTerminal } from '../../terminal/registry'
import type { ResolvedThemeName } from '../../theme/palette'

interface PaneViewProps {
  paneId: string
  theme: ResolvedThemeName
  onFocus?: (paneId: string) => void
}

/**
 * Renders one live terminal.
 *
 * React owns the container element and nothing else: the xterm instance is
 * created here but lives in the module-level registry (ADR-006), and every
 * subscription set up in this effect is torn down in its cleanup. Skipping that
 * cleanup leaks a WebGL context and an orphan shell on each remount.
 */
export function PaneView({ paneId, theme, onFocus }: PaneViewProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  // The theme changes far more often than a pane is created; keeping it in a
  // ref stops it from retriggering the mount effect and respawning the shell.
  const themeRef = useRef(theme)
  themeRef.current = theme

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let disposed = false
    const handle = createTerminal(themeRef.current)
    registerTerminal(paneId, handle)
    handle.terminal.open(container)

    const unsubscribeData = window.myterm.pane.onData((event) => {
      if (event.paneId !== paneId) return
      getTerminal(paneId)?.terminal.write(event.chunk)
    })

    const unsubscribeExit = window.myterm.pane.onExit((event) => {
      if (event.paneId !== paneId) return
      handle.terminal.write(`\r\n\x1b[2m[processus terminé · code ${event.exitCode}]\x1b[0m\r\n`)
    })

    handle.terminal.onData((data) => {
      void window.myterm.pane.write(paneId, data)
    })

    const syncSize = (): void => {
      const dims = handle.fit.proposeDimensions()
      if (!dims || !Number.isFinite(dims.cols) || !Number.isFinite(dims.rows)) return
      if (dims.cols < 1 || dims.rows < 1) return
      handle.fit.fit()
      void window.myterm.pane.resize(paneId, dims.cols, dims.rows)
    }

    // The container is 0x0 on the first paint, which would spawn an absurdly
    // sized pty. Wait for a real measurement before starting the shell.
    let spawned = false
    let debounce: number | undefined
    const observer = new ResizeObserver(() => {
      if (disposed) return
      const { width, height } = container.getBoundingClientRect()
      if (width < 8 || height < 8) return

      if (!spawned) {
        spawned = true
        handle.fit.fit()
        const dims = handle.fit.proposeDimensions()
        void window.myterm.pane
          .spawn({ paneId, cols: dims?.cols ?? 80, rows: dims?.rows ?? 24 })
          .catch((error: unknown) => {
            handle.terminal.write(`\r\n\x1b[31mimpossible de démarrer le shell : ${String(error)}\x1b[0m\r\n`)
          })
        return
      }

      window.clearTimeout(debounce)
      debounce = window.setTimeout(syncSize, 50)
    })
    observer.observe(container)

    return () => {
      disposed = true
      window.clearTimeout(debounce)
      observer.disconnect()
      unsubscribeData()
      unsubscribeExit()
      void window.myterm.pane.kill(paneId)
      disposeTerminal(paneId)
    }
  }, [paneId])

  return (
    <div
      className="h-full min-h-0 w-full min-w-0 overflow-hidden bg-surface"
      onMouseDown={() => {
        onFocus?.(paneId)
        getTerminal(paneId)?.terminal.focus()
      }}
    >
      <div ref={containerRef} className="h-full w-full" data-pane-id={paneId} />
    </div>
  )
}
