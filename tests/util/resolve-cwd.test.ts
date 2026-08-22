import { describe, expect, it } from 'vitest'
import { PathOutsideProjectError, isInsideRoot, resolveCwd } from '../../src/main/util/resolve-cwd'
import { normaliseProjectPath } from '@shared/normalise-path'

/**
 * Windows-shaped on purpose: it is the only MVP target, and every interesting
 * failure here is Windows-specific.
 */
const ROOT = 'C:\\Users\\dev\\proj'

describe('resolveCwd', () => {
  it('résout un chemin relatif simple', () => {
    expect(resolveCwd(ROOT, 'frontend').toLowerCase()).toContain('proj\\frontend')
  })

  it('résout un chemin imbriqué', () => {
    expect(resolveCwd(ROOT, 'apps/web').toLowerCase()).toContain('proj\\apps\\web')
  })

  it('accepte "." comme la racine du projet', () => {
    expect(normaliseProjectPath(resolveCwd(ROOT, '.'))).toBe(normaliseProjectPath(ROOT))
  })

  it('accepte les deux séparateurs', () => {
    expect(resolveCwd(ROOT, 'a/b')).toBe(resolveCwd(ROOT, 'a\\b'))
  })

  it("refuse un chemin qui sort de la racine", () => {
    expect(() => resolveCwd(ROOT, '../../Windows')).toThrow(PathOutsideProjectError)
  })

  it('refuse un absolu situé ailleurs', () => {
    expect(() => resolveCwd(ROOT, 'C:\\Windows\\System32')).toThrow(PathOutsideProjectError)
  })

  it('accepte un absolu qui reste dans le projet', () => {
    expect(() => resolveCwd(ROOT, 'C:\\Users\\dev\\proj\\frontend')).not.toThrow()
  })

  it("refuse un aller-retour qui sort puis revient ailleurs", () => {
    expect(() => resolveCwd(ROOT, 'frontend/../../other')).toThrow(PathOutsideProjectError)
  })
})

describe('isInsideRoot', () => {
  it('est insensible à la casse comme Windows', () => {
    expect(isInsideRoot('C:\\Proj', 'c:\\proj\\src')).toBe(true)
  })

  it('traite la racine elle-même comme intérieure', () => {
    expect(isInsideRoot(ROOT, ROOT)).toBe(true)
  })

  it("ne prend pas un dossier voisin pour un enfant (le piège du préfixe)", () => {
    // Without the trailing separator, a plain startsWith would accept this.
    expect(isInsideRoot('C:\\Users\\dev\\proj', 'C:\\Users\\dev\\proj2')).toBe(false)
    expect(isInsideRoot('C:\\Users\\dev\\proj', 'C:\\Users\\dev\\proj2\\src')).toBe(false)
  })

  it('tolère un séparateur final sur la racine', () => {
    expect(isInsideRoot('C:\\Users\\dev\\proj\\', 'C:\\Users\\dev\\proj\\src')).toBe(true)
  })
})

describe('normaliseProjectPath', () => {
  it('rend équivalents casse et séparateur final sous Windows', () => {
    const forms = ['C:\\Proj', 'c:\\proj', 'C:\\Proj\\', 'c:/proj/']
    const normalised = new Set(forms.map((form) => normaliseProjectPath(form, 'win32')))
    // 'c:/proj' and 'c:\proj' differ only by separator, which comparison does
    // not need to unify — what matters is that case and trailing slash do.
    expect(normalised.size).toBeLessThanOrEqual(2)
    expect(normaliseProjectPath('C:\\Proj\\', 'win32')).toBe(normaliseProjectPath('c:\\proj', 'win32'))
  })

  it('reste sensible à la casse ailleurs que sous Windows', () => {
    expect(normaliseProjectPath('/home/Proj', 'linux')).not.toBe(
      normaliseProjectPath('/home/proj', 'linux'),
    )
  })
})
