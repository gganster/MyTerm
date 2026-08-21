import { accessSync, constants } from 'node:fs'
import { delimiter, join } from 'node:path'
import type { IPty } from 'node-pty'
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

export class PtyManager {
  private readonly ptys = new Map<string, IPty>()

  constructor(private readonly callbacks: PtyCallbacks) {}

  spawn(spec: PtySpec): { pid: number } {
    this.kill(spec.paneId)

    const shell = resolveShell(spec.shell)
    const pty = spawnPty(shell, [], {
      name: 'xterm-256color',
      cwd: spec.cwd,
      cols: Math.max(spec.cols, 1),
      rows: Math.max(spec.rows, 1),
      env: process.env as Record<string, string>,
      useConpty: true,
    })

    pty.onData((chunk) => this.callbacks.onData(spec.paneId, chunk))
    pty.onExit(({ exitCode, signal }) => {
      this.ptys.delete(spec.paneId)
      this.callbacks.onExit(spec.paneId, exitCode, signal)
    })

    this.ptys.set(spec.paneId, pty)
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

  kill(paneId: string): void {
    const pty = this.ptys.get(paneId)
    if (!pty) return
    this.ptys.delete(paneId)
    try {
      pty.kill()
    } catch {
      // Already dead: the exit handler has run or the process vanished.
    }
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
