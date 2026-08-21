/**
 * Coalesces pty output so the renderer receives at most one message per pane
 * per frame (ADR-005).
 *
 * A verbose `npm run dev` emits hundreds of small chunks per second. One IPC
 * message per chunk across six panes saturates the renderer in serialisation
 * alone, and the screen only repaints 60 times a second anyway, so anything
 * more frequent is work thrown away.
 *
 * Migration threshold, for whoever reads this next: a dedicated MessageChannel
 * per pane becomes worthwhile somewhere around 15 simultaneously verbose panes.
 * Below that this is not the bottleneck.
 *
 * No Electron import on purpose — the emit callback is injected, which is what
 * makes this unit-testable (task 17).
 */

export interface OutputBatcherOptions {
  emit: (paneId: string, chunk: string) => void
  /** One frame. */
  flushIntervalMs?: number
  /** Above this, only the tail of the buffer survives, with a visible marker. */
  maxBufferedChars?: number
  scheduler?: {
    setTimeout: (fn: () => void, ms: number) => unknown
    clearTimeout: (handle: unknown) => void
  }
}

const TRUNCATION_MARKER = '\r\n\x1b[2m[… sortie tronquée …]\x1b[0m\r\n'

export class OutputBatcher {
  private readonly buffers = new Map<string, string[]>()
  private readonly truncated = new Set<string>()
  private readonly emit: (paneId: string, chunk: string) => void
  private readonly flushIntervalMs: number
  private readonly maxBufferedChars: number
  private readonly scheduler: NonNullable<OutputBatcherOptions['scheduler']>
  private handle: unknown = null
  private bufferedChars = new Map<string, number>()

  constructor(options: OutputBatcherOptions) {
    this.emit = options.emit
    this.flushIntervalMs = options.flushIntervalMs ?? 16
    this.maxBufferedChars = options.maxBufferedChars ?? 1_000_000
    this.scheduler = options.scheduler ?? {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    }
  }

  push(paneId: string, chunk: string): void {
    if (!chunk) return

    let buffer = this.buffers.get(paneId)
    if (!buffer) {
      buffer = []
      this.buffers.set(paneId, buffer)
    }
    buffer.push(chunk)

    const size = (this.bufferedChars.get(paneId) ?? 0) + chunk.length
    this.bufferedChars.set(paneId, size)

    if (size > this.maxBufferedChars) this.truncate(paneId)

    // A single shared timer, not one per pane: the flush walks every buffer.
    if (this.handle === null) {
      this.handle = this.scheduler.setTimeout(() => {
        this.handle = null
        this.flush()
      }, this.flushIntervalMs)
    }
  }

  /**
   * Drops everything but the tail. Concatenating first keeps the boundary
   * consistent — slicing individual chunks could cut an escape sequence in half.
   */
  private truncate(paneId: string): void {
    const joined = (this.buffers.get(paneId) ?? []).join('')
    const tail = joined.slice(-Math.floor(this.maxBufferedChars / 2))
    this.buffers.set(paneId, [tail])
    this.bufferedChars.set(paneId, tail.length)
    this.truncated.add(paneId)
  }

  flush(): void {
    for (const [paneId, chunks] of this.buffers) {
      if (chunks.length === 0) continue
      // Order is not negotiable: reversing chunks would corrupt every escape
      // sequence that straddles a chunk boundary.
      const payload = (this.truncated.has(paneId) ? TRUNCATION_MARKER : '') + chunks.join('')
      this.buffers.set(paneId, [])
      this.bufferedChars.set(paneId, 0)
      this.truncated.delete(paneId)
      this.emit(paneId, payload)
    }
  }

  /** Called when a pane dies: never emit towards a paneId that no longer exists. */
  remove(paneId: string): void {
    this.buffers.delete(paneId)
    this.bufferedChars.delete(paneId)
    this.truncated.delete(paneId)
  }

  dispose(): void {
    if (this.handle !== null) {
      this.scheduler.clearTimeout(this.handle)
      this.handle = null
    }
    this.buffers.clear()
    this.bufferedChars.clear()
    this.truncated.clear()
  }

  /** Test/diagnostic helper. */
  get pendingPanes(): number {
    let count = 0
    for (const chunks of this.buffers.values()) if (chunks.length > 0) count++
    return count
  }
}
