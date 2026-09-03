import { describe, expect, it } from 'vitest'
import type { IPty } from 'node-pty'
import { PtyManager } from '../../src/main/services/pty-manager'
import type { PtySpawner } from '../../src/main/services/pty-manager'

/**
 * Restarting a pane is one user action and two processes, and that is the whole
 * subject of this file.
 *
 * The old shell does not die when it is told to. Under Electron node-pty's kill
 * falls back on a five second timeout (ARCHI, ADR-002, mesure du 2026-08-22),
 * so its exit lands long after the replacement already owns the pane. A manager
 * keyed on the pane id alone lets that late exit unregister the *new* shell,
 * and the symptom is nasty precisely because it looks fine — the pane still
 * shows a prompt, its autolaunch command has already run, and every keystroke
 * from then on goes nowhere.
 *
 * No module is mocked here: the fake goes in through the `PtySpawner` seam the
 * manager already exposes, the way external-editor's tests inject their
 * `spawnFn` (ARCHI § Tests). What it reproduces is the one thing that matters —
 * `kill()` returns long before the process is gone, so the test drives the exit
 * itself rather than letting the fake fire it and hide the race.
 */

interface FakePty extends IPty {
  emitData: (chunk: string) => void
  emitExit: (exitCode: number) => void
  written: string[]
  killed: boolean
  /** Set by a test to reproduce node-pty throwing on an already dead shell. */
  killThrows: boolean
}

function fakeSpawner(): { spawnFn: PtySpawner; spawned: FakePty[] } {
  const spawned: FakePty[] = []
  let nextPid = 1000

  const spawnFn: PtySpawner = () => {
    let onData: (chunk: string) => void = () => {}
    let onExit: (event: { exitCode: number; signal?: number }) => void = () => {}

    const pty = {
      pid: nextPid++,
      cols: 80,
      rows: 24,
      process: 'fake',
      handleFlowControl: false,
      written: [] as string[],
      killed: false,
      killThrows: false,
      onData: (listener: (chunk: string) => void) => {
        onData = listener
        return { dispose: () => {} }
      },
      onExit: (listener: (event: { exitCode: number; signal?: number }) => void) => {
        onExit = listener
        return { dispose: () => {} }
      },
      on: () => {},
      write: (data: string) => pty.written.push(data),
      resize: () => {},
      clear: () => {},
      pause: () => {},
      resume: () => {},
      // The real kill() is asynchronous: the exit lands later, which is what
      // makes a restart racy in the first place. Firing it here would hide the
      // bug, so the test drives it explicitly with emitExit().
      kill: () => {
        pty.killed = true
        if (pty.killThrows) throw new Error('AttachConsole failed')
      },
      emitData: (chunk: string) => onData(chunk),
      emitExit: (exitCode: number) => onExit({ exitCode }),
    } as unknown as FakePty

    spawned.push(pty)
    return pty
  }

  return { spawnFn, spawned }
}

function setup(): {
  manager: PtyManager
  spawned: FakePty[]
  data: { paneId: string; chunk: string }[]
  exits: { paneId: string; exitCode: number }[]
  closed: string[]
  /** Whether the pane still had a registered pty at each onClosed. */
  closedWhileRegistered: boolean[]
} {
  const { spawnFn, spawned } = fakeSpawner()
  const data: { paneId: string; chunk: string }[] = []
  const exits: { paneId: string; exitCode: number }[] = []
  const closed: string[] = []
  const closedWhileRegistered: boolean[] = []

  const manager: PtyManager = new PtyManager(
    {
      onData: (paneId, chunk) => data.push({ paneId, chunk }),
      onExit: (paneId, exitCode) => exits.push({ paneId, exitCode }),
      onClosed: (paneId) => {
        closed.push(paneId)
        // The consumer clears this pane's state, so being called while a live
        // pty already sits in the slot would wipe the wrong pane's bookkeeping.
        closedWhileRegistered.push(manager.has(paneId))
      },
    },
    spawnFn,
  )

  return { manager, spawned, data, exits, closed, closedWhileRegistered }
}

const SPEC = { paneId: 'api', shell: 'powershell', cwd: 'C:\\projet', cols: 100, rows: 30 }

describe('PtyManager', () => {
  it('keeps the restarted pane writable when the previous shell finally exits', () => {
    const { manager, spawned } = setup()

    manager.spawn(SPEC)
    manager.spawn(SPEC)
    const [first, second] = spawned
    expect(first!.killed).toBe(true)

    // The old shell reports its exit only now, after the new one took the slot.
    first!.emitExit(1)

    manager.write('api', 'docker compose up -d\r')
    expect(second!.written).toEqual(['docker compose up -d\r'])
    expect(manager.has('api')).toBe(true)
  })

  it('drops the dying shell’s last bytes instead of printing them in the new pane', () => {
    const { manager, spawned, data, exits } = setup()

    manager.spawn(SPEC)
    manager.spawn(SPEC)
    const [first, second] = spawned

    first!.emitData('adieu')
    first!.emitExit(1)
    second!.emitData('bonjour')

    expect(data).toEqual([{ paneId: 'api', chunk: 'bonjour' }])
    expect(exits).toEqual([])
  })

  it('still reports the exit of the shell that currently owns the pane', () => {
    const { manager, spawned, exits } = setup()

    manager.spawn(SPEC)
    spawned[0]!.emitExit(3)

    expect(exits).toEqual([{ paneId: 'api', exitCode: 3 }])
    expect(manager.has('api')).toBe(false)
  })

  it('says nothing when a pane we killed on purpose finishes dying', () => {
    const { manager, spawned, exits } = setup()

    manager.spawn(SPEC)
    manager.kill('api')
    spawned[0]!.emitExit(0)

    expect(exits).toEqual([])
    expect(manager.activeCount).toBe(0)
  })

  it('announces every pane it closes itself, killAll included', () => {
    const { manager, exits, closed } = setup()

    manager.spawn(SPEC)
    manager.spawn({ ...SPEC, paneId: 'web' })
    // Each spawn opens with a close of its own slot; only the killAll matters.
    closed.length = 0

    manager.killAll()

    expect(closed).toEqual(['api', 'web'])
    expect(exits).toEqual([])
    expect(manager.activeCount).toBe(0)
  })

  it('announces the close of a pane whose shell had already exited on its own', () => {
    const { manager, spawned, closed } = setup()

    // The user typed `exit` an hour ago; the pane is still on screen, still
    // holding its scrollback, its status and its buffered output.
    manager.spawn(SPEC)
    spawned[0]!.emitExit(0)
    closed.length = 0

    manager.kill('api')

    expect(closed).toEqual(['api'])
  })

  it('announces the close before the replacement takes the slot', () => {
    const { manager, closed, closedWhileRegistered } = setup()

    manager.spawn(SPEC)
    closed.length = 0
    closedWhileRegistered.length = 0

    manager.spawn(SPEC)

    expect(closed).toEqual(['api'])
    expect(closedWhileRegistered).toEqual([false])
    expect(manager.has('api')).toBe(true)
  })

  it('still announces the close when node-pty throws on the way out', () => {
    const { manager, spawned, closed } = setup()

    manager.spawn(SPEC)
    spawned[0]!.killThrows = true
    closed.length = 0

    manager.kill('api')

    expect(closed).toEqual(['api'])
    expect(manager.activeCount).toBe(0)
  })

  it('survives a pane restarted twice in a row, whatever order the exits land in', () => {
    const { manager, spawned } = setup()

    manager.spawn(SPEC)
    manager.spawn(SPEC)
    manager.spawn(SPEC)
    const [first, second, third] = spawned

    second!.emitExit(1)
    first!.emitExit(1)

    manager.write('api', 'toujours vivant\r')
    expect(third!.written).toEqual(['toujours vivant\r'])
    expect(manager.has('api')).toBe(true)
  })

  it('routes writes and resizes to the pane that is actually live', () => {
    const { manager, spawned } = setup()

    manager.spawn(SPEC)
    manager.spawn({ ...SPEC, paneId: 'web' })
    manager.write('api', 'a')
    manager.write('web', 'b')

    expect(spawned[0]!.written).toEqual(['a'])
    expect(spawned[1]!.written).toEqual(['b'])
  })
})
