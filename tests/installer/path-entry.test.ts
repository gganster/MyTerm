import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The PATH half of the installer shipped broken from 0.1.0 through 0.2.0 and
 * nobody noticed, because everything around it worked: the shim was copied, the
 * registry key was written, the installer reported success. Only the PATH entry
 * was missing, and nothing said so.
 *
 * Two causes, and there is a guard here for each:
 *
 * 1. The PowerShell was inlined in an NSIS string and quoted by doubling the
 *    quotes. NSIS escapes a quote as `$\'`; doubling is not an escape, so
 *    `''Path''` reached PowerShell, which reads `''` as the empty string, and
 *    the command died on a parse error.
 * 2. The exit code was printed, never tested, so a command that died still
 *    produced "PATH utilisateur mis a jour".
 *
 * What these assertions cannot prove is that the entry actually lands in the
 * registry and that a fresh terminal resolves `myterm`. That is runtime proof,
 * and it lives in the run's proof directory.
 */

const ROOT = resolve(__dirname, '../..')
const NSH = readFileSync(resolve(ROOT, 'build/installer.nsh'), 'utf8')
const PS1 = readFileSync(resolve(ROOT, 'resources/path-entry.ps1'), 'utf8')
const BUILDER = readFileSync(resolve(ROOT, 'electron-builder.yml'), 'utf8')

/**
 * Comments are stripped from both files before any assertion, and for the same
 * reason in each: they deliberately *name* the broken forms — `''Path''`,
 * `SetEnvironmentVariable` — in order to say those must never be used. A scan
 * of the raw text would read each warning as a violation of itself.
 */
const NSH_CODE = NSH.split('\n')
  .filter((line) => !line.trimStart().startsWith(';'))
  .join('\n')

/** PowerShell has both `<# … #>` blocks and `#` line comments. */
const PS1_CODE = PS1.replace(/<#[\s\S]*?#>/g, '')
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('#'))
  .join('\n')

function macroBody(name: string): string {
  const start = NSH_CODE.indexOf(`!macro ${name}`)
  expect(start, `macro ${name} introuvable`).toBeGreaterThanOrEqual(0)
  const end = NSH_CODE.indexOf('!macroend', start)
  return NSH_CODE.slice(start, end)
}

const install = macroBody('customInstall')
const uninstall = macroBody('customUnInstall')

describe('installer.nsh — le PATH est modifié par un script, pas par une ligne inline', () => {
  it('les deux macros appellent path-entry.ps1 avec -File', () => {
    for (const [name, body] of [
      ['customInstall', install],
      ['customUnInstall', uninstall],
    ] as const) {
      expect(body, `${name} n’invoque pas le script`).toContain('-File')
      expect(body).toContain('path-entry.ps1')
    }
    expect(install).toMatch(/-Mode\s+Add/)
    expect(uninstall).toMatch(/-Mode\s+Remove/)
  })

  it('plus aucune commande PowerShell inline dans le fichier', () => {
    // La régression exacte : `-Command "…"` réintroduit la couche de
    // guillemets NSIS qui a fait échouer la fonctionnalité pendant deux
    // versions.
    expect(NSH_CODE).not.toContain('-Command')
  })

  it('aucun guillemet doublé : NSIS échappe avec $\\\', jamais en doublant', () => {
    expect(NSH_CODE).not.toContain("''")
  })

  it('le script est copié à côté du shim, hors du dossier désinstallé', () => {
    // L’exécuter depuis $INSTDIR marcherait à l’installation et échouerait à la
    // désinstallation, qui est précisément en train de supprimer ce dossier.
    expect(install).toContain('$INSTDIR\\resources\\path-entry.ps1')
    expect(install).toContain('$LOCALAPPDATA\\MyTerm\\bin\\path-entry.ps1')
    for (const body of [install, uninstall]) {
      expect(body).toMatch(/-File "\$LOCALAPPDATA\\MyTerm\\bin\\path-entry\.ps1"/)
    }
  })

  it('la désinstallation retire le script comme elle retire le shim', () => {
    expect(uninstall).toContain('Delete "$LOCALAPPDATA\\MyTerm\\bin\\path-entry.ps1"')
  })

  it('electron-builder embarque le script dans le paquet', () => {
    // Sans cette entrée, $INSTDIR\resources\path-entry.ps1 n’existe pas et la
    // copie échoue en silence — le mode d’échec d’origine, à l’identique.
    expect(BUILDER).toMatch(/from:\s*resources\/path-entry\.ps1/)
  })

  it('teste le code de sortie au lieu de se contenter de l’afficher', () => {
    const call = install.slice(install.indexOf('path-entry.ps1'))
    expect(call).toMatch(/Pop \$0/)
    expect(call).toMatch(/\$\{If\}\s+\$0\s*==\s*0/)
    expect(call).toMatch(/\$\{Else\}/)
    // Le message d’échec doit dire ce qui est perdu, pas seulement qu’il a échoué.
    expect(call).toMatch(/ECHEC[\s\S]*myterm/)
  })
})

describe('path-entry.ps1 — l’édition du PATH ne peut pas casser le reste', () => {
  it('n’utilise jamais [Environment]::SetEnvironmentVariable', () => {
    // Elle écrit toujours en REG_SZ. Un PATH utilisateur en REG_EXPAND_SZ
    // réécrit ainsi voit chacune de ses entrées %VAR% devenir un littéral mort.
    expect(PS1_CODE).not.toContain('SetEnvironmentVariable')
  })

  it('relit et réapplique le type de la valeur existante', () => {
    expect(PS1_CODE).toContain('GetValueKind')
    expect(PS1_CODE).toMatch(/SetValue\('Path',\s*\$joined,\s*\$kind\)/)
  })

  it('lit la valeur brute, sans développer les %VAR%', () => {
    // Sans DoNotExpandEnvironmentNames, %PNPM_HOME% serait réécrit développé —
    // c’est-à-dire figé, ou vide si la variable n’est pas définie.
    expect(PS1_CODE).toContain('DoNotExpandEnvironmentNames')
  })

  it('diffuse WM_SETTINGCHANGE, sinon les nouveaux terminaux ne voient rien', () => {
    // Écrire dans le registre sans diffuser laisse l’explorateur distribuer son
    // bloc d’environnement périmé : l’utilisateur installe MyTerm et obtient
    // toujours « myterm n’est pas reconnu » jusqu’à la prochaine session.
    expect(PS1_CODE).toContain('WM_SETTINGCHANGE')
    expect(PS1_CODE).toContain('SendMessageTimeout')
  })

  it('vérifie le résultat et sort non nul s’il ne correspond pas', () => {
    expect(PS1_CODE).toMatch(/exit 2/)
    expect(PS1_CODE).toMatch(/exit 3/)
    expect(PS1_CODE).toMatch(/exit 0/)
  })

  it('n’accepte que Add et Remove', () => {
    expect(PS1_CODE).toMatch(/ValidateSet\('Add',\s*'Remove'\)/)
  })

  it('ajoute en fin de PATH, pour ne masquer aucune commande existante', () => {
    expect(PS1_CODE).toMatch(/@\(\$without \+ \$bin\)/)
  })
})
