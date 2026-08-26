import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createInstanceRegistry, HEARTBEAT_MS } from '../../src/main/services/instances'

/**
 * The registry replaces what the single-instance lock used to guarantee, so its
 * two answers have to hold under the ugly cases rather than the tidy one:
 * a process killed without unregistering, a pid Windows has since handed to
 * something else, and a machine that slept through a heartbeat.
 *
 * Clock and liveness are injected, so none of this depends on real processes or
 * on waiting three minutes.
 */

let dir: string
let clock: number

const now = (): number => clock

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'myterm-instances-'))
  clock = 1_000_000
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function registryFor(pid: number, alive: Set<number>) {
  return createInstanceRegistry({ dir, pid, now, isAlive: (p) => alive.has(p) })
}

describe('registre des instances — décompte', () => {
  it('une instance seule ne compte aucune autre', () => {
    const alive = new Set([1])
    const one = registryFor(1, alive)
    one.register()

    expect(one.otherCount()).toBe(0)
    expect(one.isPrimary()).toBe(true)
  })

  it('deux instances vivantes se voient l’une l’autre', () => {
    const alive = new Set([1, 2])
    const one = registryFor(1, alive)
    const two = registryFor(2, alive)
    one.register()
    clock += 10
    two.register()

    expect(one.otherCount()).toBe(1)
    expect(two.otherCount()).toBe(1)
  })

  it('une instance qui se retire cesse d’être comptée', () => {
    const alive = new Set([1, 2])
    const one = registryFor(1, alive)
    const two = registryFor(2, alive)
    one.register()
    two.register()

    two.unregister()

    expect(one.otherCount()).toBe(0)
  })

  it('se compte elle-même même si son propre fichier a disparu', () => {
    // Sinon une instance balayée par erreur devient invisible à elle-même, et
    // `isPrimary` n’élit plus personne.
    const alive = new Set([1])
    const one = registryFor(1, alive)
    one.register()
    rmSync(join(dir, '1.json'))

    expect(one.live().map((r) => r.pid)).toEqual([1])
    expect(one.isPrimary()).toBe(true)
  })

  it('un dossier absent ne fait pas échouer la lecture', () => {
    const alone = createInstanceRegistry({
      dir: join(dir, 'jamais-cree'),
      pid: 1,
      now,
      isAlive: () => true,
    })

    expect(alone.otherCount()).toBe(0)
    expect(alone.isPrimary()).toBe(true)
  })
})

describe('registre des instances — entrées mortes', () => {
  it('ignore et supprime l’entrée d’un processus disparu', () => {
    const alive = new Set([1])
    registryFor(2, new Set([2])).register()
    const one = registryFor(1, alive)
    one.register()

    expect(one.otherCount()).toBe(0)
    expect(readdirSync(dir)).not.toContain('2.json')
  })

  it('ignore une entrée dont le pid a été recyclé par un autre programme', () => {
    // Windows recycle les pid. Le seul test de vie laisserait vivante pour
    // toujours l’entrée d’une instance tuée dont le numéro appartient
    // désormais à un programme sans rapport — et cette entrée, triée en
    // premier, élirait un updater qui n’existe pas : plus personne ne
    // vérifierait les mises à jour.
    const alive = new Set([1, 2])
    registryFor(2, alive).register()
    const one = registryFor(1, alive)
    one.register()

    expect(one.otherCount()).toBe(1)

    clock += HEARTBEAT_MS * 3 + 1

    expect(one.otherCount()).toBe(0)
  })

  it('un battement de cœur garde l’entrée vivante', () => {
    const alive = new Set([1, 2])
    const two = registryFor(2, alive)
    two.register()
    const one = registryFor(1, alive)
    one.register()

    clock += HEARTBEAT_MS * 2
    two.heartbeat()
    clock += HEARTBEAT_MS * 2

    expect(one.otherCount()).toBe(1)
  })

  it('ignore les fichiers qui ne sont pas des entrées', () => {
    writeFileSync(join(dir, 'notes.txt'), 'x')
    writeFileSync(join(dir, 'pas-un-pid.json'), '{}')
    const one = registryFor(1, new Set([1]))
    one.register()

    expect(one.otherCount()).toBe(0)
  })
})

describe('registre des instances — élection', () => {
  it('la plus ancienne instance vivante est élue, et une seule', () => {
    const alive = new Set([1, 2, 3])
    const first = registryFor(1, alive)
    first.register()
    clock += 10
    const second = registryFor(2, alive)
    second.register()
    clock += 10
    const third = registryFor(3, alive)
    third.register()

    expect([first.isPrimary(), second.isPrimary(), third.isPrimary()]).toEqual([true, false, false])
  })

  it('l’élection passe à la suivante quand l’élue s’en va', () => {
    // Rien à transmettre : chaque instance se repose la question à chaque tick.
    const alive = new Set([1, 2])
    const first = registryFor(1, alive)
    first.register()
    clock += 10
    const second = registryFor(2, alive)
    second.register()

    expect(second.isPrimary()).toBe(false)

    first.unregister()
    alive.delete(1)

    expect(second.isPrimary()).toBe(true)
  })
})
