import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import type { spawn as spawnType } from 'node:child_process'
import {
  listEditors,
  openInEditor,
  resolveEditorPath,
} from '../../src/main/services/external-editor'

const LOCAL = String.raw`C:\Users\dev\AppData\Local`

const ENV = {
  LOCALAPPDATA: LOCAL,
  ProgramFiles: String.raw`C:\Program Files`,
  'ProgramFiles(x86)': String.raw`C:\Program Files (x86)`,
} as NodeJS.ProcessEnv

const VSCODE_USER = String.raw`${LOCAL}\Programs\Microsoft VS Code\Code.exe`
const VSCODE_MACHINE = String.raw`C:\Program Files\Microsoft VS Code\Code.exe`
const ANTIGRAVITY_IDE = String.raw`${LOCAL}\Programs\Antigravity IDE\Antigravity IDE.exe`
/** The agent Manager that ships under the same brand — not an editor. */
const ANTIGRAVITY_MANAGER = String.raw`${LOCAL}\Programs\Antigravity\Antigravity.exe`

const PROJECT = String.raw`C:\Users\dev\Desktop\mon projet`

const only =
  (...installed: string[]) =>
  (path: string): boolean =>
    installed.includes(path)

const none = (): boolean => false

/**
 * A child that behaves like the real one on the two paths that matter: it
 * announces itself with `spawn`, or fails with `error`, and never both.
 */
function fakeSpawn(outcome: 'spawn' | 'error'): {
  spawnFn: typeof spawnType
  calls: { file: string; args: string[]; options: Record<string, unknown> }[]
} {
  const calls: { file: string; args: string[]; options: Record<string, unknown> }[] = []
  const spawnFn = ((file: string, args: string[], options: Record<string, unknown>) => {
    calls.push({ file, args, options })
    const child = Object.assign(new EventEmitter(), { unref: (): void => {} })
    queueMicrotask(() =>
      child.emit(outcome, outcome === 'error' ? new Error('ENOENT') : undefined),
    )
    return child
  }) as unknown as typeof spawnType
  return { spawnFn, calls }
}

describe('resolveEditorPath', () => {
  it('trouve VS Code installé pour la machine', () => {
    expect(resolveEditorPath('vscode', ENV, only(VSCODE_MACHINE))).toBe(VSCODE_MACHINE)
  })

  it('préfère l’installation utilisateur à celle de la machine', () => {
    expect(resolveEditorPath('vscode', ENV, only(VSCODE_USER, VSCODE_MACHINE))).toBe(VSCODE_USER)
  })

  it('vise l’IDE Antigravity', () => {
    expect(resolveEditorPath('antigravity', ENV, only(ANTIGRAVITY_IDE))).toBe(ANTIGRAVITY_IDE)
  })

  it('ignore le Manager Antigravity, qui n’ouvre pas de dossier', () => {
    expect(resolveEditorPath('antigravity', ENV, only(ANTIGRAVITY_MANAGER))).toBeNull()
  })

  it('rend null plutôt que de deviner un chemin', () => {
    expect(resolveEditorPath('vscode', ENV, none)).toBeNull()
    expect(resolveEditorPath('antigravity', ENV, none)).toBeNull()
  })

  it('survit à un environnement sans les variables Windows', () => {
    expect(resolveEditorPath('vscode', {}, () => true)).toBeNull()
  })
})

describe('listEditors', () => {
  it('marque disponible ce qui est réellement présent', () => {
    const list = listEditors(ENV, only(VSCODE_MACHINE))
    expect(list.map((editor) => [editor.id, editor.available])).toEqual([
      ['vscode', true],
      ['antigravity', false],
    ])
  })

  it('annonce toujours les deux éditeurs, installés ou non', () => {
    expect(listEditors(ENV, none)).toHaveLength(2)
  })
})

describe('openInEditor', () => {
  it('refuse quand aucun projet n’est ouvert', async () => {
    await expect(openInEditor('vscode', null)).resolves.toEqual({
      ok: false,
      reason: 'no-project',
    })
  })

  it('refuse un id inconnu venu du renderer sans lever', async () => {
    // Le type ment au-delà de la frontière IPC : ce que le renderer envoie
    // arrive tel quel, y compris une clé héritée d’Object.prototype.
    const forged = '__proto__' as unknown as 'vscode'
    await expect(openInEditor(forged, PROJECT)).resolves.toEqual({
      ok: false,
      reason: 'not-installed',
    })
  })

  it('refuse quand aucune installation n’est trouvée', async () => {
    await expect(
      openInEditor('vscode', PROJECT, { env: ENV, exists: none, spawnFn: fakeSpawn('spawn').spawnFn }),
    ).resolves.toEqual({ ok: false, reason: 'not-installed' })
  })

  it('lance l’exécutable résolu, sans shell, le dossier en un seul argument', async () => {
    const { spawnFn, calls } = fakeSpawn('spawn')
    await expect(
      openInEditor('vscode', PROJECT, { env: ENV, exists: only(VSCODE_MACHINE), spawnFn }),
    ).resolves.toEqual({ ok: true })

    expect(calls).toHaveLength(1)
    const [call] = calls
    expect(call?.file).toBe(VSCODE_MACHINE)
    // Un seul argument : rien à quoi une option pourrait être injectée, et
    // aucune concaténation de chaîne à citer.
    expect(call?.args).toEqual([PROJECT])
    // La propriété de sécurité du module : jamais de shell interposé.
    expect(call?.options.shell).toBeUndefined()
    expect(call?.options).toMatchObject({ detached: true, stdio: 'ignore' })
  })

  it('signale un lancement raté au lieu de prétendre avoir ouvert', async () => {
    // Un .exe résiduel après désinstallation, ou bloqué par un antivirus :
    // `spawn` ne lève pas, il émet `error` plus tard.
    const { spawnFn } = fakeSpawn('error')
    await expect(
      openInEditor('antigravity', PROJECT, { env: ENV, exists: only(ANTIGRAVITY_IDE), spawnFn }),
    ).resolves.toEqual({ ok: false, reason: 'launch-failed' })
  })
})
