import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { atomicWrite, serialiseJson, withFileLock } from '../../src/main/util/atomic-write'

/**
 * Both guarantees here only started to matter when MyTerm allowed several
 * instances: one file, several processes writing it.
 */

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'myterm-atomic-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('atomicWrite', () => {
  it('écrit le contenu et ne laisse aucun fichier temporaire', async () => {
    const path = join(dir, 'prefs.json')
    await atomicWrite(path, 'bonjour')

    expect(readFileSync(path, 'utf8')).toBe('bonjour')
    expect(readdirSync(dir)).toEqual(['prefs.json'])
  })

  it('nomme le temporaire d’après le pid *et* un compteur', () => {
    // Deux processus enregistrant le même fichier partageaient un unique
    // `<path>.tmp` : ils écrivaient dedans en même temps et le renommaient
    // chacun leur tour, si bien que le survivant était l’entrelacement des
    // deux — le fichier tronqué que cette fonction existe pour empêcher.
    //
    // Le pid seul ne suffit pas : deux écritures concurrentes *dans le même
    // processus* retombent sur le même nom, et le second `rename` échoue en
    // ENOENT parce que le premier a déjà déplacé le fichier.
    const source = readFileSync(
      join(__dirname, '../../src/main/util/atomic-write.ts'),
      'utf8',
    )

    expect(source).toContain('${path}.${process.pid}.${(writeSequence += 1)}.tmp')
    expect(source).not.toMatch(/`\$\{path\}\.tmp`/)
  })

  it('deux écritures concurrentes laissent un fichier entier, jamais un mélange', async () => {
    const path = join(dir, 'prefs.json')
    const a = 'a'.repeat(20_000)
    const b = 'b'.repeat(20_000)

    await Promise.all([atomicWrite(path, a), atomicWrite(path, b)])

    const written = readFileSync(path, 'utf8')
    expect([a, b]).toContain(written)
    expect(readdirSync(dir)).toEqual(['prefs.json'])
  })

  it('ne détruit pas l’original quand l’écriture échoue', async () => {
    const path = join(dir, 'existe.json')
    writeFileSync(path, 'original')

    // Une destination dans un dossier inexistant : le writeFile du temporaire
    // échoue, et rien de ce qui existait déjà ne doit en pâtir.
    await expect(atomicWrite(join(dir, 'absent', 'x.json'), 'nouveau')).rejects.toThrow()

    expect(readFileSync(path, 'utf8')).toBe('original')
    expect(readdirSync(dir)).toEqual(['existe.json'])
  })
})

describe('serialiseJson', () => {
  it('indente à deux espaces et termine par un saut de ligne', () => {
    expect(serialiseJson({ a: 1 })).toBe('{\n  "a": 1\n}\n')
  })
})

describe('withFileLock', () => {
  it('sérialise deux sections critiques concurrentes', async () => {
    const path = join(dir, 'prefs.json')
    const trace: string[] = []

    const critical = (name: string) =>
      withFileLock(path, async () => {
        trace.push(`${name}:entre`)
        await new Promise((resolve) => setTimeout(resolve, 30))
        trace.push(`${name}:sort`)
      })

    await Promise.all([critical('a'), critical('b')])

    // Aucune entrée ne s’intercale entre une entrée et sa sortie.
    expect(trace).toHaveLength(4)
    expect(trace[1]).toBe(`${trace[0]?.split(':')[0]}:sort`)
  })

  it('supprime le verrou à la sortie, y compris quand le travail échoue', async () => {
    const path = join(dir, 'prefs.json')

    await expect(
      withFileLock(path, async () => {
        throw new Error('boum')
      }),
    ).rejects.toThrow('boum')

    expect(existsSync(`${path}.lock`)).toBe(false)
  })

  it('vole un verrou périmé plutôt que de bloquer pour toujours', async () => {
    // Une instance tuée en pleine écriture laisse son verrou derrière elle. Sans
    // le vol, plus aucune préférence ne serait jamais sauvegardée.
    const path = join(dir, 'prefs.json')
    const lock = `${path}.lock`
    writeFileSync(lock, '')
    const vieux = new Date(Date.now() - 60_000)
    const { utimesSync } = await import('node:fs')
    utimesSync(lock, vieux, vieux)

    const started = Date.now()
    await withFileLock(path, async () => undefined)

    expect(Date.now() - started).toBeLessThan(1_500)
    expect(existsSync(lock)).toBe(false)
  })

  it('exécute le travail malgré tout si le verrou ne se libère jamais', async () => {
    // Un enregistrement de préférences ne doit jamais être la raison pour
    // laquelle une fermeture se bloque : passé le délai, on écrit sans verrou.
    const path = join(dir, 'prefs.json')
    let done = false

    await withFileLock(path, async () => {
      await withFileLock(path, async () => {
        done = true
      })
    })

    expect(done).toBe(true)
  })
})

describe('atomicWrite — contention sur le renommage (Windows)', () => {
  it('survit à de nombreuses écritures simultanées sur le même fichier', async () => {
    // Remplacer un fichier est atomique sur NTFS mais pas exempt de contention :
    // pendant qu'un renommage échange la destination, un second renommage vers
    // cette même destination échoue en EPERM. Sans nouvelle tentative, une
    // sauvegarde sur trois environ était perdue dès que deux instances
    // écrivaient en même temps — mesuré, pas supposé.
    const path = join(dir, 'prefs.json')
    const contenus = Array.from({ length: 12 }, (_, i) => `contenu-${i}`.padEnd(4_000, 'x'))

    await Promise.all(contenus.map((c) => atomicWrite(path, c)))

    expect(contenus).toContain(readFileSync(path, 'utf8'))
    expect(readdirSync(dir)).toEqual(['prefs.json'])
  })

  it('remonte une erreur qui n’est pas transitoire', async () => {
    // Un dossier inexistant ne devient pas disponible en réessayant : l'appel
    // doit échouer tout de suite plutôt que de tourner cinq fois.
    await expect(atomicWrite(join(dir, 'absent', 'x.json'), 'nouveau')).rejects.toThrow()
  })
})
