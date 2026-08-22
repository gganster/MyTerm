import { tmpdir } from 'node:os'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseCliArgs, userArgsOf } from '../../src/main/cli-args'

const projectDir = mkdtempSync(join(tmpdir(), 'myterm-cli-'))
const aFile = join(projectDir, 'file.txt')
writeFileSync(aFile, 'x')

describe('userArgsOf', () => {
  it('retire l’exécutable en mode packagé', () => {
    expect(userArgsOf(['MyTerm.exe', 'C:\\proj'], true)).toEqual(['C:\\proj'])
  })

  it('retire aussi le chemin de l’app hors packaging', () => {
    expect(userArgsOf(['electron.exe', '.', 'C:\\proj'], false)).toEqual(['C:\\proj'])
  })

  it("filtre les switches AVANT de trancher — le piège de second-instance", () => {
    // Electron passes the raw command line, with its own switches ahead of the
    // app path. Slicing first would take the app path for the project.
    const argv = [
      'electron.exe',
      '--user-data-dir=C:\\profil',
      '--allow-file-access-from-files',
      'C:\\app',
      'C:\\proj',
    ]
    expect(userArgsOf(argv, false)).toEqual(['C:\\proj'])
  })

  it('ne renvoie rien pour un lancement nu en développement', () => {
    expect(userArgsOf(['electron.exe', '.'], false)).toEqual([])
  })

  it('ne renvoie rien pour un lancement nu en packagé', () => {
    expect(userArgsOf(['MyTerm.exe'], true)).toEqual([])
  })
})

describe('parseCliArgs', () => {
  it('résout "." contre le dossier de l’appelant, pas le nôtre', () => {
    const result = parseCliArgs(['MyTerm.exe', '.'], projectDir, true)
    expect(result.error).toBeNull()
    expect(result.projectPath?.toLowerCase()).toBe(projectDir.toLowerCase())
  })

  it('accepte un chemin absolu', () => {
    expect(parseCliArgs(['MyTerm.exe', projectDir], 'C:\\ailleurs', true).projectPath).toBeTruthy()
  })

  it('signale un chemin inexistant sans lever', () => {
    const result = parseCliArgs(['MyTerm.exe', 'C:\\nexiste\\pas'], projectDir, true)
    expect(result.projectPath).toBeNull()
    expect(result.error).toContain('introuvable')
  })

  it('refuse un fichier : on ouvre des dossiers', () => {
    const result = parseCliArgs(['MyTerm.exe', aFile], projectDir, true)
    expect(result.projectPath).toBeNull()
    expect(result.error).toContain("n'est pas un dossier")
  })

  it('ne demande rien quand il n’y a pas d’argument', () => {
    expect(parseCliArgs(['MyTerm.exe'], projectDir, true)).toEqual({
      projectPath: null,
      error: null,
    })
  })
})
