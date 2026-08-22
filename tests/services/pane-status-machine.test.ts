import { describe, expect, it } from 'vitest'
import {
  BEL,
  initialPaneStatus,
  reducePaneStatus,
} from '../../src/main/services/pane-status-machine'
import type { PaneStatusState } from '../../src/main/services/pane-status-machine'

const at = (ms: number): number => 1_000_000 + ms

function feed(
  state: PaneStatusState,
  events: Parameters<typeof reducePaneStatus>[1][],
): PaneStatusState {
  return events.reduce((current, event) => reducePaneStatus(current, event), state)
}

describe('reducePaneStatus', () => {
  it('passe en running dès qu’il y a de la sortie', () => {
    const state = reducePaneStatus(initialPaneStatus(at(0)), {
      type: 'output',
      chunk: 'hello',
      at: at(10),
    })
    expect(state.status).toBe('running')
  })

  it('lève attention sur un BEL', () => {
    const state = reducePaneStatus(initialPaneStatus(at(0)), {
      type: 'output',
      chunk: `en attente ${BEL}`,
      at: at(10),
    })
    expect(state.status).toBe('attention')
  })

  it('garde attention malgré la sortie qui continue', () => {
    // An agent redrawing its spinner while the prompt is still waiting must not
    // clear the badge.
    const state = feed(initialPaneStatus(at(0)), [
      { type: 'output', chunk: BEL, at: at(10) },
      { type: 'output', chunk: 'spinner...', at: at(20) },
      { type: 'output', chunk: 'spinner...', at: at(30) },
    ])
    expect(state.status).toBe('attention')
  })

  it('un tick ne peut pas effacer attention', () => {
    const state = feed(initialPaneStatus(at(0)), [
      { type: 'output', chunk: BEL, at: at(10) },
      { type: 'tick', at: at(60_000) },
    ])
    expect(state.status).toBe('attention')
  })

  it('la frappe de l’utilisateur acquitte attention', () => {
    const state = feed(initialPaneStatus(at(0)), [
      { type: 'output', chunk: BEL, at: at(10) },
      { type: 'input', at: at(20) },
    ])
    expect(state.status).toBe('running')
  })

  it('ne produit aucun faux positif pendant une commande longue', () => {
    let state = initialPaneStatus(at(0))
    for (let i = 1; i <= 20; i++) {
      state = reducePaneStatus(state, { type: 'output', chunk: `ligne ${i}`, at: at(i * 100) })
      state = reducePaneStatus(state, { type: 'tick', at: at(i * 100 + 50) })
    }
    expect(state.status).toBe('running')
  })

  it('retombe sur idle après un silence prolongé', () => {
    const state = feed(initialPaneStatus(at(0)), [
      { type: 'output', chunk: 'fini', at: at(100) },
      { type: 'tick', at: at(300) },
      { type: 'tick', at: at(1500) },
    ])
    expect(state.status).toBe('idle')
  })

  it('reconnaît un marqueur OSC 133 découpé entre deux chunks', () => {
    const state = feed(initialPaneStatus(at(0)), [
      { type: 'output', chunk: 'travail\x1b]13', at: at(10) },
      { type: 'output', chunk: '3;B', at: at(20) },
    ])
    expect(state.status).toBe('idle')
  })

  it('enregistre le code de sortie et n’en bouge plus', () => {
    const state = feed(initialPaneStatus(at(0)), [
      { type: 'exit', code: 3, at: at(10) },
      { type: 'output', chunk: 'zombie', at: at(20) },
      { type: 'input', at: at(30) },
      { type: 'tick', at: at(40) },
    ])
    expect(state.status).toBe('exited')
    expect(state.exitCode).toBe(3)
  })
})
