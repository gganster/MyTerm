import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The installer is the one piece of this project that writes outside the app's
 * own folders, and its mistakes are silent by construction: an NSIS script that
 * compiles will happily leave a dead verb in the user's shell forever, and
 * nobody notices until they uninstall and right-click a folder.
 *
 * So the invariants are asserted against the real `installer.nsh` rather than
 * against a copy: every registry key the install macro creates has to be
 * removed by the uninstall macro, everything stays under HKCU, and the shared
 * `Directory\shell` parents are never the target of a delete.
 *
 * What this file cannot prove is that the keys *do* anything — that the shell
 * resolves the verb and that the command opens the project. That is runtime
 * proof, and it lives in the run's proof directory.
 */

const NSH = readFileSync(resolve(__dirname, '../../build/installer.nsh'), 'utf8')

/**
 * NSIS comments start with `;`. They are stripped before any assertion: the
 * comments in this script deliberately *name* HKLM and HKCR to say the code
 * must never write there, and a naive scan of the raw file would read that
 * warning as a violation of itself.
 */
const NSH_CODE = NSH.split('\n')
  .filter((line) => !line.trimStart().startsWith(';'))
  .join('\n')

function macroBody(name: string): string {
  const start = NSH_CODE.indexOf(`!macro ${name}`)
  expect(start, `macro ${name} introuvable`).toBeGreaterThanOrEqual(0)
  const end = NSH_CODE.indexOf('!macroend', start)
  expect(end, `!macroend manquant après ${name}`).toBeGreaterThan(start)
  return NSH_CODE.slice(start, end)
}

interface RegWrite {
  root: string
  key: string
  valueName: string
  value: string
}

function writesIn(body: string): RegWrite[] {
  const writes: RegWrite[] = []
  const pattern = /^\s*WriteRegStr\s+(\S+)\s+"([^"]*)"\s+"([^"]*)"\s+(.+)$/gm
  for (const match of body.matchAll(pattern)) {
    const [, root, key, valueName, value] = match
    if (!root || !key || value === undefined) continue
    writes.push({ root, key, valueName: valueName ?? '', value: value.trim() })
  }
  return writes
}

function deletesIn(body: string): { root: string; key: string }[] {
  const deletes: { root: string; key: string }[] = []
  const pattern = /^\s*DeleteRegKey\s+(?:\/ifempty\s+)?(\S+)\s+"([^"]*)"/gm
  for (const match of body.matchAll(pattern)) {
    const [, root, key] = match
    if (!root || !key) continue
    deletes.push({ root, key })
  }
  return deletes
}

const install = macroBody('customInstall')
const uninstall = macroBody('customUnInstall')
const installWrites = writesIn(install)
const uninstallDeletes = deletesIn(uninstall)

const CONTEXT_MENU_KEYS = [
  'Software\\Classes\\Directory\\shell\\MyTerm',
  'Software\\Classes\\Directory\\Background\\shell\\MyTerm',
]

describe('installer.nsh — menu contextuel de l’explorateur', () => {
  it('enregistre un verbe sur le dossier et un dans le fond du dossier', () => {
    for (const key of CONTEXT_MENU_KEYS) {
      const label = installWrites.find((w) => w.key === key && w.valueName === '')
      expect(label, `libellé manquant pour ${key}`).toBeDefined()
      expect(label?.value).toMatch(/MyTerm/)
    }
  })

  it('lance l’exécutable installé, pas le shim .cmd', () => {
    for (const key of CONTEXT_MENU_KEYS) {
      const command = installWrites.find((w) => w.key === `${key}\\command`)
      expect(command, `commande manquante pour ${key}`).toBeDefined()
      expect(command?.value).toContain('$INSTDIR\\MyTerm.exe')
      expect(command?.value).not.toContain('myterm.cmd')
    }
  })

  it('substitue %V et jamais %1 — %1 est vide dans le menu du fond de dossier', () => {
    for (const key of CONTEXT_MENU_KEYS) {
      const command = installWrites.find((w) => w.key === `${key}\\command`)
      expect(command?.value).toContain('"%V"')
      expect(command?.value).not.toContain('%1')
    }
  })

  it('masque l’entrée quand plusieurs dossiers sont sélectionnés', () => {
    // Sans MultiSelectModel, un verbe en ligne de commande est invoqué une fois
    // par élément : six dossiers sélectionnés démarrent six MyTerm.exe.
    const model = installWrites.find(
      (w) => w.key === CONTEXT_MENU_KEYS[0] && w.valueName === 'MultiSelectModel',
    )
    expect(model?.value).toBe('"Single"')
  })

  it('cite le chemin, sinon un dossier contenant un espace casse la commande', () => {
    for (const key of CONTEXT_MENU_KEYS) {
      const command = installWrites.find((w) => w.key === `${key}\\command`)
      // Attendu : '"$INSTDIR\MyTerm.exe" "%V"' — les deux membres entre guillemets.
      expect(command?.value).toMatch(/^'"\$INSTDIR\\MyTerm\.exe"\s+"%V"'$/)
    }
  })
})

describe('installer.nsh — contrat par utilisateur', () => {
  /**
   * Sans ce test, les deux suivants sont creux : ils bouclent sur ce que le
   * parseur a vu. Une écriture d'une forme qu'il ignore — clé non entre
   * guillemets, `WriteRegExpandStr`, `WriteRegDWORD` — sortirait des deux
   * boucles sans faire échouer quoi que ce soit, et l'invariant du fichier
   * cesserait de tenir en silence.
   */
  it('le parseur voit toutes les écritures de registre du fichier', () => {
    const written = (NSH_CODE.match(/^\s*WriteReg\w+/gm) ?? []).length
    expect(installWrites.length + writesIn(uninstall).length).toBe(written)
    expect(installWrites.length).toBeGreaterThanOrEqual(8)
  })

  it('n’écrit que dans HKCU', () => {
    for (const write of [...installWrites, ...writesIn(uninstall)]) {
      expect(write.root, `${write.key} écrit hors de HKCU`).toBe('HKCU')
    }
  })

  it('ne touche jamais HKLM, HKCR ni HKEY_CLASSES_ROOT', () => {
    expect(NSH_CODE).not.toMatch(/\b(HKLM|HKCR|HKEY_LOCAL_MACHINE|HKEY_CLASSES_ROOT)\b/)
  })
})

describe('installer.nsh — la désinstallation ne laisse rien', () => {
  it('supprime toutes les clés que l’installation a créées', () => {
    for (const write of installWrites) {
      const covered = uninstallDeletes.some(
        (d) =>
          d.root === write.root && (write.key === d.key || write.key.startsWith(`${d.key}\\`)),
      )
      expect(covered, `${write.root}\\${write.key} n’est jamais supprimée`).toBe(true)
    }
  })

  it('ne supprime pas les branches partagées avec les autres applications', () => {
    // La base de registre est insensible à la casse et tolère un antislash
    // final : une comparaison exacte laisserait passer `SOFTWARE\Classes\
    // Directory\shell`, qui effacerait les verbes de toutes les autres
    // applications — précisément ce que ce fichier existe pour empêcher.
    const norm = (k: string) => k.toLowerCase().replace(/\\+$/, '')
    const shared = [
      'Software',
      'Software\\Classes',
      'Software\\Classes\\Directory',
      'Software\\Classes\\Directory\\shell',
      'Software\\Classes\\Directory\\Background',
      'Software\\Classes\\Directory\\Background\\shell',
    ].map(norm)
    for (const d of uninstallDeletes) {
      expect(shared, `la désinstallation supprime ${d.key}, partagée`).not.toContain(norm(d.key))
    }
  })

  /**
   * Une mise à jour lance l'ancien désinstalleur avant d'installer les nouveaux
   * fichiers. Si le démontage n'est pas sauté, un échec de la copie laisse une
   * application fonctionnelle mais désintégrée : plus de PATH, plus de shim,
   * plus de menu contextuel, et rien qui le dise.
   */
  it('saute le démontage pendant une mise à jour', () => {
    expect(uninstall).toMatch(/\$\{ifNot\}\s+\$\{isUpdated\}/)
    expect(uninstall.match(/\$\{endif\}/gi)?.length ?? 0).toBeGreaterThanOrEqual(1)
  })
})
