import { describe, expect, it } from 'vitest'
import {
  defaultPreferences,
  MAX_RECENT_PROJECTS,
  MAX_TRUSTED_PROJECTS,
} from '@shared/schema/preferences'
import type { Preferences, RecentProject, TrustedProject } from '@shared/schema/preferences'
import { emptyIntents, mergePreferences } from '@shared/schema/preferences-merge'

/**
 * Several MyTerm instances share one preferences.json. Every assertion here is
 * a data-loss or fail-open scenario that the old "write my whole cache back"
 * save produced, and that the merge exists to prevent.
 *
 * `win32` is passed explicitly everywhere: the path comparison is
 * case-insensitive only on Windows, and a suite that passed only on the
 * developer's own platform would prove nothing about the one that ships.
 */

const WIN = 'win32'

function prefs(patch: Partial<Preferences> = {}): Preferences {
  return { ...defaultPreferences(), ...patch }
}

function recent(path: string, lastOpenedAt: string): RecentProject {
  return { path, name: path.split('\\').pop() ?? path, lastOpenedAt }
}

function trusted(path: string, commandsHash = 'h1'): TrustedProject {
  return { path, commandsHash }
}

describe('mergePreferences — projets récents', () => {
  it('garde les projets ouverts par une autre instance', () => {
    const disk = prefs({ recentProjects: [recent('C:\\B', '2026-08-26T10:00:00Z')] })
    const ours = prefs({ recentProjects: [recent('C:\\A', '2026-08-26T09:00:00Z')] })
    const intents = emptyIntents()
    intents.remembered.set('c:\\a', recent('C:\\A', '2026-08-26T09:00:00Z'))

    const merged = mergePreferences(disk, ours, intents, WIN)

    expect(merged.recentProjects.map((p) => p.path)).toEqual(['C:\\B', 'C:\\A'])
  })

  it('classe du plus récemment ouvert au plus ancien', () => {
    const disk = prefs({
      recentProjects: [recent('C:\\Old', '2026-01-01T00:00:00Z'), recent('C:\\Mid', '2026-06-01T00:00:00Z')],
    })
    const intents = emptyIntents()
    intents.remembered.set('c:\\new', recent('C:\\New', '2026-08-26T12:00:00Z'))

    const merged = mergePreferences(disk, prefs(), intents, WIN)

    expect(merged.recentProjects.map((p) => p.path)).toEqual(['C:\\New', 'C:\\Mid', 'C:\\Old'])
  })

  it('un oubli fait ici gagne sur la copie disque', () => {
    const disk = prefs({ recentProjects: [recent('C:\\A', '2026-08-26T10:00:00Z')] })
    const intents = emptyIntents()
    intents.forgotten.add('c:\\a')

    expect(mergePreferences(disk, prefs(), intents, WIN).recentProjects).toEqual([])
  })

  it('compare les chemins sans tenir compte de la casse ni du séparateur final', () => {
    const disk = prefs({ recentProjects: [recent('C:\\Proj\\', '2026-08-26T10:00:00Z')] })
    const intents = emptyIntents()
    intents.remembered.set('c:\\proj', recent('c:\\proj', '2026-08-26T11:00:00Z'))

    const merged = mergePreferences(disk, prefs(), intents, WIN)

    expect(merged.recentProjects).toHaveLength(1)
    expect(merged.recentProjects[0]?.lastOpenedAt).toBe('2026-08-26T11:00:00Z')
  })

  it('applique le plafond après la fusion, pas avant', () => {
    // Deux instances sous le plafond chacune peuvent le dépasser une fois
    // réunies : si le plafond n'est pas réappliqué ici, le fichier grossit sans
    // limite.
    const disk = prefs({
      recentProjects: Array.from({ length: MAX_RECENT_PROJECTS }, (_, i) =>
        recent(`C:\\D${i}`, `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`),
      ),
    })
    const intents = emptyIntents()
    intents.remembered.set('c:\\new', recent('C:\\New', '2026-12-01T00:00:00Z'))

    const merged = mergePreferences(disk, prefs(), intents, WIN)

    expect(merged.recentProjects).toHaveLength(MAX_RECENT_PROJECTS)
    expect(merged.recentProjects[0]?.path).toBe('C:\\New')
  })

  it("ne persiste jamais `missing`, calculé à la lecture", () => {
    const disk = prefs({
      recentProjects: [{ ...recent('C:\\A', '2026-08-26T10:00:00Z'), missing: true }],
    })

    const merged = mergePreferences(disk, prefs(), emptyIntents(), WIN)

    expect(merged.recentProjects[0]).not.toHaveProperty('missing')
  })
})

describe('mergePreferences — confiance (ADR-004)', () => {
  it('une révocation faite ici ne peut pas être ressuscitée par le disque', () => {
    // Le scénario qui compte : l'instance A révoque, l'instance B avait encore
    // le projet approuvé en cache. Sans cette règle, la sauvegarde suivante de
    // B réarme l'autolaunch sur un dépôt que l'utilisateur venait de refuser.
    const disk = prefs({ trustedProjects: [trusted('C:\\Hostile')] })
    const intents = emptyIntents()
    intents.revoked.add('c:\\hostile')

    expect(mergePreferences(disk, prefs(), intents, WIN).trustedProjects).toEqual([])
  })

  it('garde les approbations données par une autre instance', () => {
    const disk = prefs({ trustedProjects: [trusted('C:\\B', 'hb')] })
    const intents = emptyIntents()
    intents.trusted.set('c:\\a', trusted('C:\\A', 'ha'))

    const merged = mergePreferences(disk, prefs(), intents, WIN)

    expect(merged.trustedProjects.map((t) => t.path).sort()).toEqual(['C:\\A', 'C:\\B'])
  })

  it("l'approbation la plus récente remplace le hash présent sur le disque", () => {
    const disk = prefs({ trustedProjects: [trusted('C:\\A', 'ancien')] })
    const intents = emptyIntents()
    intents.trusted.set('c:\\a', trusted('C:\\A', 'nouveau'))

    const merged = mergePreferences(disk, prefs(), intents, WIN)

    expect(merged.trustedProjects).toEqual([{ path: 'C:\\A', commandsHash: 'nouveau' }])
  })

  it('révoquer et approuver le même projet : la révocation gagne', () => {
    // L'appelant efface l'intention opposée, mais la fonction ne peut pas en
    // dépendre : en cas de doute elle refuse, jamais elle n'approuve.
    const intents = emptyIntents()
    intents.trusted.set('c:\\a', trusted('C:\\A'))
    intents.revoked.add('c:\\a')

    expect(mergePreferences(prefs(), prefs(), intents, WIN).trustedProjects).toEqual([])
  })
})

describe('mergePreferences — champs scalaires', () => {
  it("laisse intact un champ que ce processus n'a jamais touché", () => {
    const disk = prefs({ theme: 'dark', window: { width: 800, height: 600, maximized: true } })
    const ours = prefs({ theme: 'light', window: { width: 1600, height: 1000, maximized: false } })

    const merged = mergePreferences(disk, ours, emptyIntents(), WIN)

    expect(merged.theme).toBe('dark')
    expect(merged.window.width).toBe(800)
  })

  it('un champ modifié ici gagne : c’est la dernière action de l’utilisateur', () => {
    const disk = prefs({ theme: 'dark' })
    const ours = prefs({ theme: 'light' })
    const intents = emptyIntents()
    intents.dirtyKeys.add('theme')

    expect(mergePreferences(disk, ours, intents, WIN).theme).toBe('light')
  })

  it('déplacer une fenêtre ne réécrit pas le thème choisi ailleurs', () => {
    const disk = prefs({ theme: 'dark', window: { width: 800, height: 600, maximized: false } })
    const ours = prefs({ theme: 'light', window: { width: 1200, height: 900, maximized: false } })
    const intents = emptyIntents()
    intents.dirtyKeys.add('window')

    const merged = mergePreferences(disk, ours, intents, WIN)

    expect(merged.window.width).toBe(1200)
    expect(merged.theme).toBe('dark')
  })
})

describe('mergePreferences — le plafond ne doit pas manger la dernière décision', () => {
  it("garde l'approbation donnée ici quand le disque est déjà plein", () => {
    // Le plafond tranche par la fin. Avec les entrées disque en tête, une
    // approbation donnée alors que le fichier contient déjà MAX_TRUSTED_PROJECTS
    // projets tombait hors du plafond : la dialog de confiance réapparaissait
    // sur ce projet à chaque ouverture, sans que rien ne l'explique.
    const disk = prefs({
      trustedProjects: Array.from({ length: MAX_TRUSTED_PROJECTS }, (_, i) =>
        trusted(`C:\T${i}`, `h${i}`),
      ),
    })
    const intents = emptyIntents()
    intents.trusted.set('c:\neuf', trusted('C:\Neuf', 'hneuf'))

    const merged = mergePreferences(disk, prefs(), intents, WIN)

    expect(merged.trustedProjects).toHaveLength(MAX_TRUSTED_PROJECTS)
    expect(merged.trustedProjects).toContainEqual({ path: 'C:\Neuf', commandsHash: 'hneuf' })
  })

  it('ne duplique pas un projet approuvé ici et déjà présent sur le disque', () => {
    const disk = prefs({ trustedProjects: [trusted('C:\A', 'ancien')] })
    const intents = emptyIntents()
    intents.trusted.set('c:\a', trusted('C:\A', 'nouveau'))

    const merged = mergePreferences(disk, prefs(), intents, WIN)

    expect(merged.trustedProjects).toEqual([{ path: 'C:\A', commandsHash: 'nouveau' }])
  })
})
