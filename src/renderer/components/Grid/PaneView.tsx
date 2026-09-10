import { useEffect, useRef } from 'react'
import type { Pane } from '@shared/schema/layout'
import { focusPane } from '../../pane-focus'
import { createCommandCapture } from '../../terminal/command-capture'
import { createTerminal } from '../../terminal/create-terminal'
import { disposeTerminal, getTerminal, registerTerminal } from '../../terminal/registry'
import { selectIsCollapsed, selectIsFocused, selectIsHidden, useStore } from '../../store'
import { paneBorderColor } from '../../theme/palette'
import { PaneHeader } from './PaneHeader'

interface PaneViewProps {
  pane: Pane
}

/**
 * One pane: a header plus a live terminal.
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
  const isCollapsed = useStore(selectIsCollapsed(paneId))
  const isZoomed = useStore((state) => state.zoomedPaneId === paneId)
  const setPaneStatus = useStore((state) => state.setPaneStatus)
  // The colour is a *theme-dependent* value, so it is resolved here rather than
  // written into a class: the same `color: "blue"` is two different hexes.
  const resolvedTheme = useStore((state) => state.resolvedTheme)
  const borderColor = paneBorderColor(resolvedTheme, pane.color)

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

    // The autolaunch command is written straight to the pty by the main
    // process, so the capture below never sees it. Seeding it here is what
    // makes a pane that has run one command since it started — a tunnel, the
    // whole point of folding — able to say so. Re-seeded on every restart,
    // which is exactly when the running command changes.
    const { command } = useStore.getState().layout.panes.find((p) => p.id === paneId) ?? {}
    if (command) useStore.getState().setPaneLastCommand(paneId, command)

    const capture = createCommandCapture(handle.terminal, (submitted) => {
      useStore.getState().setPaneLastCommand(paneId, submitted)
    })

    handle.terminal.onData((data) => {
      void window.myterm.pane.write(paneId, data)
      capture.onData(data)
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
      capture.dispose()
      void window.myterm.pane.kill(paneId)
      disposeTerminal(paneId)
    }
    // paneId only: the pane must not respawn because its title changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneId])

  // Coming back from zoom, the box changes while this pane is display:none, so
  // ResizeObserver never fires. Refit explicitly once it is visible again —
  // and on unfolding too, where the pane goes from its holding size straight
  // to a grid cell.
  const offGrid = isHidden || isCollapsed
  useEffect(() => {
    if (offGrid) return
    const handle = getTerminal(paneId)
    if (!handle) return
    const id = window.setTimeout(() => {
      const dims = handle.fit.proposeDimensions()
      if (!dims || dims.cols < 1 || dims.rows < 1) return
      handle.fit.fit()
      void window.myterm.pane.resize(paneId, dims.cols, dims.rows)
    }, 30)
    return () => window.clearTimeout(id)
  }, [offGrid, paneId])

  return (
    <section
      data-pane={paneId}
      data-focused={isFocused || undefined}
      data-zoomed={isZoomed || undefined}
      data-collapsed={isCollapsed || undefined}
      data-pane-color={pane.color ?? undefined}
      // A folded pane is off screen but still laid out, so its terminal is
      // still focusable and still announced. `inert` closes both: the keyboard
      // cannot land in a terminal nobody can see, and a screen reader is not
      // handed six invisible panes. Programmatic focus is blocked too, which
      // is why focusPane() unfolds before it focuses.
      inert={isCollapsed}
      onMouseDown={() => focusPane(paneId)}
      // A coloured pane keeps its colour even while focused — losing it there
      // would blank the one pane you are looking at, which is precisely when
      // knowing which repo you are in matters. Focus moves to a ring instead.
      style={borderColor ? { borderColor } : undefined}
      // No explicit placement: panes flow in document order and the grid wraps
      // them (ADR-003). Zoom is handled by GridView collapsing to one cell;
      // hidden siblings keep `display: none` rather than unmounting, which
      // would destroy their terminals and scrollback.
      className={[
        'flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md bg-surface',
        // 2px when coloured: at 1px a hue is a hairline you have to look for,
        // which defeats the whole point. The default border stays at 1px so
        // nothing changes for a workspace that never sets a colour.
        borderColor ? 'border-2' : `border ${isFocused ? 'border-accent' : 'border-border'}`,
        // Where the border is already spoken for, focus moves outward — and it
        // must NOT simply abut the colour: the accent is itself a blue, 1.9°
        // and 1.08:1 from `paneBorder.blue`, so an outline flush against a blue
        // pane's border is invisible. `outline-offset-2` puts two pixels of the
        // grid's own background between the two bands, which is what makes the
        // focus readable whatever colour the pane carries.
        borderColor && isFocused ? 'outline-2 outline-offset-2 outline-accent' : '',
        // Folding parks the pane off screen at a *fixed size* rather than
        // hiding it, and the difference is the whole feature. `display: none`
        // reports a 0x0 box, so a pane folded from the file would never reach
        // the branch below that spawns its shell — the tunnel that is supposed
        // to run all afternoon would never start. Out of flow so it takes no
        // grid cell, `fixed` so it is outside the scroll container entirely,
        // and negative-x so it cannot extend anything: the document itself
        // cannot scroll (`body { overflow: hidden }`).
        isCollapsed
          ? 'pointer-events-none fixed top-0 -left-[9999px] h-[420px] w-[720px]'
          : isHidden
            ? 'hidden'
            : '',
      ].join(' ')}
    >
      <PaneHeader paneId={paneId} title={pane.title || pane.id} />
      <div ref={containerRef} className="min-h-0 flex-1" data-pane-terminal={paneId} />
    </section>
  )
}
