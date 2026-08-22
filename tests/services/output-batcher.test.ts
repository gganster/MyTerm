import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OutputBatcher } from '../../src/main/services/output-batcher'

/**
 * Fake timers throughout: a batcher test that actually waits 16 ms per
 * assertion would be slow and flaky, and neither would prove more.
 */
describe('OutputBatcher', () => {
  let emitted: { paneId: string; chunk: string }[]
  let batcher: OutputBatcher

  beforeEach(() => {
    vi.useFakeTimers()
    emitted = []
    batcher = new OutputBatcher({
      emit: (paneId, chunk) => emitted.push({ paneId, chunk }),
      flushIntervalMs: 16,
      // Generous by default: only the truncation test wants a small cap, and it
      // builds its own batcher for that.
      maxBufferedChars: 100_000,
    })
  })

  afterEach(() => {
    batcher.dispose()
    vi.useRealTimers()
  })

  it('coalesce plusieurs chunks en un seul message', () => {
    for (let i = 0; i < 50; i++) batcher.push('a', `chunk${i} `)
    expect(emitted).toHaveLength(0)

    vi.advanceTimersByTime(16)
    expect(emitted).toHaveLength(1)
    expect(emitted[0]!.chunk).toContain('chunk0')
    expect(emitted[0]!.chunk).toContain('chunk49')
  })

  it('préserve strictement l’ordre', () => {
    for (let i = 0; i < 10; i++) batcher.push('a', String(i))
    vi.advanceTimersByTime(16)
    expect(emitted[0]!.chunk).toBe('0123456789')
  })

  it('reconstitue une séquence ANSI coupée entre deux chunks', () => {
    // Handling chunks individually would corrupt this; concatenation cannot.
    batcher.push('a', 'texte \x1b[3')
    batcher.push('a', '1mrouge\x1b[0m')
    vi.advanceTimersByTime(16)
    expect(emitted[0]!.chunk).toBe('texte \x1b[31mrouge\x1b[0m')
  })

  it('émet un message par pane, pas un message global', () => {
    batcher.push('a', 'un')
    batcher.push('b', 'deux')
    vi.advanceTimersByTime(16)
    expect(emitted).toHaveLength(2)
    expect(emitted.map((event) => event.paneId).sort()).toEqual(['a', 'b'])
  })

  it('plafonne le débit quelle que soit la quantité de sortie', () => {
    for (let tick = 0; tick < 5; tick++) {
      for (let i = 0; i < 200; i++) batcher.push('a', 'x')
      vi.advanceTimersByTime(16)
    }
    // 1000 pushes, at most one message per frame.
    expect(emitted.length).toBeLessThanOrEqual(5)
  })

  it('tronque en gardant la fin, avec un marqueur visible', () => {
    const emittedHere: string[] = []
    const small = new OutputBatcher({
      emit: (_paneId, chunk) => emittedHere.push(chunk),
      flushIntervalMs: 16,
      maxBufferedChars: 100,
    })
    small.push('a', 'D'.repeat(80))
    small.push('a', 'F'.repeat(80))
    vi.advanceTimersByTime(16)
    small.dispose()

    const payload = emittedHere[0]!
    expect(payload).toContain('sortie tronquée')
    // The tail is what matters: recent output, not the beginning.
    expect(payload.endsWith('F'.repeat(50))).toBe(true)
    expect(payload).not.toContain('D'.repeat(80))
  })

  it('n’émet plus rien pour un pane retiré', () => {
    batcher.push('a', 'perdu')
    batcher.remove('a')
    vi.advanceTimersByTime(16)
    expect(emitted).toHaveLength(0)
  })

  it('ne programme rien tant qu’il n’y a pas de sortie', () => {
    batcher.push('a', '')
    vi.advanceTimersByTime(100)
    expect(emitted).toHaveLength(0)
  })

  it('flush() vide immédiatement, pour le dernier souffle d’un process', () => {
    batcher.push('a', 'adieu')
    batcher.flush()
    expect(emitted).toHaveLength(1)
    expect(emitted[0]!.chunk).toBe('adieu')
  })
})
