import { accessSync, constants } from 'node:fs'
import { delimiter, join } from 'node:path'
import type { IPty, IWindowsPtyForkOptions } from 'node-pty'
import { spawn as spawnPty } from 'node-pty'

/** What the caller asks for. Shell and cwd are already resolved to absolutes. */
export interface PtySpec {
  paneId: string
  shell: string
  cwd: string
  cols: number
  rows: number
}

export interface PtyCallbacks {
  onData: (paneId: string, chunk: string) => void
  onExit: (paneId: string, exitCode: number, signal?: number) => void
  /**
   * "This pane is over: drop anything you still keep for it."
   *
   * Raised by kill(), and deliberately *not* the mirror of `onExit`. A pane can
   * reach kill() with no live shell — the user typed `exit` an hour ago — and
   * that pane's bookkeeping has to go too, so this fires whether or not there
   * was a process to end. It is therefore idempotent by contract: closing twice
   * says so twice, and closing something that was never opened is legal.
   *
   * Required rather than optional: the whole point is that no caller of kill()
   * has to remember the cleanup, and `killAll()` is exactly where that gets
   * forgotten.
   *
   * Ordering matters and is guaranteed: kill() drops the map entry first, so
   * this always runs while the pane's slot is empty. A respawn is
   * `onClosed` → new pty registered → `statusTracker.start()`; deferring this
   * callback would invert those and wipe the state of the *live* pane.
   */
  onClosed: (paneId: string) => void
}

/** Shell names accepted in .myterm.json, mapped to their Windows executable. */
const SHELL_EXECUTABLES: Record<string, string> = {
  pwsh: 'pwsh.exe',
  powershell: 'powershell.exe',
  cmd: 'cmd.exe',
  bash: 'bash.exe',
}

/**
 * Resolves an executable by scanning PATH ourselves rather than letting the
 * spawn fail: node-pty surfaces a missing shell as an opaque native error, and
 * we want to fall back to Windows PowerShell before that happens.
 */
function findOnPath(executable: string): string | null {
  const path = process.env['PATH'] ?? ''
  for (const dir of path.split(delimiter)) {
    if (!dir) continue
    const candidate = join(dir, executable)
    try {
      accessSync(candidate, constants.X_OK)
      return candidate
    } catch {
      /* not here */
    }
  }
  return null
}

/**
 * `pwsh` is preferred but is not installed by default on Windows; Windows
 * PowerShell always is. A pane that asks for a shell we cannot find falls back
 * rather than failing to open.
 */
export function resolveShell(requested: string): string {
  const wanted = SHELL_EXECUTABLES[requested] ?? requested
  const found = findOnPath(wanted)
  if (found) return found

  for (const fallback of ['powershell.exe', 'cmd.exe']) {
    const alt = findOnPath(fallback)
    if (alt) return alt
  }
  // Let node-pty produce the error; every fallback is missing.
  return wanted
}

/** Injected in tests: the real one starts a shell, which no unit test wants. */
export type PtySpawner = (
  file: string,
  args: string[],
  options: IWindowsPtyForkOptions,
) => IPty

export class PtyManager {
  private readonly ptys = new Map<string, IPty>()

  constructor(
    private readonly callbacks: PtyCallbacks,
    private readonly spawnFn: PtySpawner = spawnPty,
  ) {}

  spawn(spec: PtySpec): { pid: number } {
    this.kill(spec.paneId)

    const shell = resolveShell(spec.shell)
    const pty = this.spawnFn(shell, [], {
      name: 'xterm-256color',
      cwd: spec.cwd,
      cols: Math.max(spec.cols, 1),
      rows: Math.max(spec.rows, 1),
      env: process.env as Record<string, string>,
      useConpty: true,
    })

    // Registered *before* the handlers, because those handlers ask this map
    // whether they still speak for the pane.
    this.ptys.set(spec.paneId, pty)

    // Bound to this pty, not merely to its pane id.
    //
    // Restarting a pane (the layout editor's « Relancer », a reloaded layout,
    // a remounted PaneView) is one user action but two processes, and the old
    // one takes its time: under Electron node-pty's kill falls back on a five
    // second timeout (ADR-002, mesure du 2026-08-22), so its exit lands long
    // after the new shell has taken the slot. Keyed on the id alone, that late
    // exit deleted the *replacement* from this map — after which every write
    // went nowhere and the pane silently refused to accept a single keystroke,
    // while still looking alive and having run its autolaunch command. Same
    // story for the dying shell's last bytes, which would otherwise land in the
    // new pane.
    const isCurrent = (): boolean => this.ptys.get(spec.paneId) === pty

    pty.onData((chunk) => {
      if (isCurrent()) this.callbacks.onData(spec.paneId, chunk)
    })
    pty.onExit(({ exitCode, signal }) => {
      if (!isCurrent()) return
      this.ptys.delete(spec.paneId)
      this.callbacks.onExit(spec.paneId, exitCode, signal)
    })

    return { pid: pty.pid }
  }

  write(paneId: string, data: string): void {
    this.ptys.get(paneId)?.write(data)
  }

  resize(paneId: string, cols: number, rows: number): void {
    const pty = this.ptys.get(paneId)
    if (!pty) return
    // node-pty throws on zero or negative dimensions, which a collapsed
    // container can legitimately produce mid-layout.
    pty.resize(Math.max(cols, 1), Math.max(rows, 1))
  }

  /**
   * Ends a pane.
   *
   * The map entry goes first, on purpose: from here on this pty no longer
   * speaks for the pane, so its eventual exit raises nothing. Every caller
   * already knows the pane is going — a PaneView unmounting, a workspace being
   * replaced, the app quitting — and a "[processus terminé]" arriving after the
   * fact would be printed into whatever took the slot next.
   *
   * `onClosed` fires unconditionally, including for a pane whose shell had
   * already exited on its own: that pane still carries buffered output and a
   * status state, and this is the only moment anyone says it is gone.
   *
   * `paneId` is trusted here, where onData/onExit no longer trust it, because a
   * kill only ever comes from a caller that owns the pane at that instant: the
   * renderer sends `pane:kill` from a PaneView's unmount, before that pane's
   * replacement asks to spawn, and `invoke` keeps the two in order. A kill that
   * ever managed to overtake a spawn would take the replacement down with it.
   */
  kill(paneId: string): void {
    const pty = this.ptys.get(paneId)
    this.ptys.delete(paneId)
    if (pty) {
      try {
        pty.kill()
      } catch {
        // Already dead: the exit handler has run or the process vanished.
      }
    }
    this.callbacks.onClosed(paneId)
  }

  /** Called on app shutdown: a leaked pty leaves an orphan pwsh.exe behind. */
  killAll(): void {
    for (const paneId of [...this.ptys.keys()]) this.kill(paneId)
  }

  has(paneId: string): boolean {
    return this.ptys.has(paneId)
  }

  get activeCount(): number {
    return this.ptys.size
  }
}
