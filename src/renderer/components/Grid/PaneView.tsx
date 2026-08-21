import { useEffect, useRef } from 'react'
import type { Pane } from '@shared/schema/layout'
import { createTerminal } from '../../terminal/create-terminal'
import { disposeTerminal, getTerminal, registerTerminal } from '../../terminal/registry'
import { selectIsFocused, selectIsHidden, useStore } from '../../store'
import { PaneHeader } from './PaneHeader'

interface PaneViewProps {
  pane: Pane
}

/**
 * One cell of the grid: a header plus a live terminal.
 *
 * React owns the container element and nothing else. The xterm instance is
 * created here but lives in the module-level registry (ADR-006), and every
 * subscription is torn down on unmount — skipping that leaks a WebGL context
 * and an orphan shell each time.
 */
export function PaneView({ pane }: PaneViewProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const paneId = pane.id

  // Narrow selectors only: a status tick on a sibling pane must not re-render
  // this one (ARCHI § State Management).
  const isFocused = useStore(selectIsFocused(paneId))
  const isHidden = useStore(selectIsHidden(paneId))
  const isZoomed = useStore((state) => state.zoomedPaneId === paneId)
  const setFocusedPane = useStore((state) => state.setFocusedPane)
  const setPaneStatus = useStore((state) => state.setPaneStatus)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let disposed = false
    const theme = useStore.getState().resolvedTheme
    const handle = createTerminal(theme)
    registerTerminal(paneId, handle)
    handle.terminal.open(container)

    const unsubscribeData = window.myterm.pane.onData((event) => {
      if (event.paneId !== paneId) return
      getTerminal(paneId)?.terminal.write(event.chunk)
    })

    const unsubscribeStatus = window.myterm.pane.onStatus((event) => {
      if (event.paneId !== paneId) return
      setPaneStatus(paneId, event.status, { exitCode: event.exitCode })
    })

    const unsubscribeExit = window.myterm.pane.onExit((event) => {
      if (event.paneId !== paneId) return
      getTerminal(paneId)?.terminal.write(
        `\r\n\x1b[2m[processus terminé · code ${event.exitCode}]\x1b[0m\r\n`,
      )
    })

    handle.terminal.onData((data) => {
      void window.myterm.pane.write(paneId, data)
    })

    let spawned = false
    let debounce: number | undefined

    const syncSize = (): void => {
      const dims = handle.fit.proposeDimensions()
      if (!dims || dims.cols < 1 || dims.rows < 1) return
      if (!Number.isFinite(dims.cols) || !Number.isFinite(dims.rows)) return
      handle.fit.fit()
      void window.myterm.pane.resize(paneId, dims.cols, dims.rows)
    }

    const observer = new ResizeObserver(() => {
      if (disposed) return
      const { width, height } = container.getBoundingClientRect()
      // A hidden pane (zoom) reports 0x0; ignore it rather than resizing the
      // pty to nothing and reflowing its scrollback.
      if (width < 8 || height < 8) return

      if (!spawned) {
        spawned = true
        handle.fit.fit()
        const dims = handle.fit.proposeDimensions()
        void window.myterm.pane
          .spawn({ paneId, cols: dims?.cols ?? 80, rows: dims?.rows ?? 24 })
          .catch((error: unknown) => {
            handle.terminal.write(
              `\r\n\x1b[31mimpossible de démarrer le shell : ${String(error)}\x1b[0m\r\n`,
            )
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
      unsubscribeStatus()
      unsubscribeExit()
      void window.myterm.pane.kill(paneId)
      disposeTerminal(paneId)
    }
    // paneId only: the pane must not respawn because its title changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneId])

  // Coming back from zoom, the box changes while this pane is display:none, so
  // ResizeObserver never fires. Refit explicitly once it is visible again.
  useEffect(() => {
    if (isHidden) return
    const handle = getTerminal(paneId)
    if (!handle) return
    const id = window.setTimeout(() => {
      const dims = handle.fit.proposeDimensions()
      if (!dims || dims.cols < 1 || dims.rows < 1) return
      handle.fit.fit()
      void window.myterm.pane.resize(paneId, dims.cols, dims.rows)
    }, 30)
    return () => window.clearTimeout(id)
  }, [isHidden, paneId])

  const focus = (): void => {
    setFocusedPane(paneId)
    getTerminal(paneId)?.terminal.focus()
  }

  return (
    <section
      data-pane={paneId}
      data-focused={isFocused || undefined}
      data-zoomed={isZoomed || undefined}
      onMouseDown={focus}
      // Zooming re-positions the pane over the whole grid. Hidden siblings keep
      // `display: none` rather than unmounting: unmounting would destroy their
      // terminals and scrollback.
      style={
        isZoomed
          ? { gridArea: '1 / 1 / -1 / -1' }
          : { gridColumn: pane.col + 1, gridRow: pane.row + 1 }
      }
      className={[
        'flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md border bg-surface',
        isFocused ? 'border-accent' : 'border-border',
        isHidden ? 'hidden' : '',
      ].join(' ')}
    >
      <PaneHeader paneId={paneId} title={pane.title || pane.id} />
      <div ref={containerRef} className="min-h-0 flex-1" data-pane-terminal={paneId} />
    </section>
  )
}
