# Task 13 : Préférences globales et écran de projets récents

## Context

Le PRD retient deux points d'entrée : la liste des projets récents et le CLI `myterm .` (Task 14). Cette tâche livre le premier, ainsi que la couche de préférences globales qui sert aussi le thème (Task 05) et la liste des projets approuvés (Task 12).

ADR-001 s'applique ici aussi : un fichier JSON, pas de base de données, pas d'`electron-store`.

## Scope

`preferences.json` dans `userData`, écran d'accueil listant les projets récents, restauration de la géométrie de fenêtre.

## Implementation Details

### Files to Create/Modify

- `src/shared/schema/preferences.ts` — schéma Zod
- `src/main/services/preferences.ts` — lecture, écriture débouncée, valeurs par défaut
- `src/main/window.ts` — restauration et enregistrement de la géométrie
- `src/renderer/components/ProjectPicker/ProjectPicker.tsx` — écran d'accueil
- `src/renderer/components/ProjectPicker/RecentProjectCard.tsx`
- `src/renderer/store/ui-slice.ts` — migration du thème depuis `localStorage`

### Key Functionality

Structure du fichier (ARCHI § Persistance globale) :

```jsonc
{
  "version": 1,
  "theme": "system",
  "recentProjects": [{ "path": "...", "name": "...", "lastOpenedAt": "..." }],
  "trustedProjects": [{ "path": "...", "commandsHash": "..." }],
  "window": { "width": 1600, "height": 1000, "maximized": false }
}
```

- Lecture unique au démarrage, cache en mémoire, écritures **débouncées à ~500 ms** avec le même `atomicWrite` que le layout (Task 10).
- Fichier corrompu ou illisible → repartir des valeurs par défaut avec un log, sans jamais bloquer le démarrage. Sauvegarder l'ancien en `.bak` pour ne pas perdre silencieusement la liste de projets de l'utilisateur.
- `recentProjects` : plafonné à 15 entrées, trié par `lastOpenedAt` décroissant, dédupliqué sur le chemin normalisé (même normalisation qu'en Task 12).
- L'écran d'accueil affiche pour chaque projet son nom, son chemin et sa date de dernière ouverture, avec un bouton « ouvrir un dossier » et un raccourci de suppression d'une entrée.
- Les projets dont le dossier n'existe plus sont **affichés grisés**, pas supprimés d'office : un lecteur réseau déconnecté n'est pas un projet disparu. Suppression manuelle uniquement.
- Géométrie de fenêtre restaurée au démarrage, avec vérification que la fenêtre retombe sur un écran actuellement connecté (`screen.getAllDisplays()`).

### Technologies Used

- **Zod** — même discipline de validation que pour le layout
- **Electron `app.getPath('userData')`**, **`screen`**
- **shadcn/ui** — `Button`, `Card`

### Architectural Patterns

ADR-001 : deux fichiers JSON validés, rien d'autre. Le refus d'`electron-store` est délibéré — une trentaine de lignes couvrent le besoin et évitent une dépendance de plus.

## Success Criteria

- [ ] Ouvrir un projet l'ajoute en tête des récents ; le rouvrir le remonte sans le dupliquer
- [ ] Les préférences survivent au redémarrage
- [ ] Le thème choisi en Task 05 est désormais lu depuis `preferences.json`, plus depuis `localStorage`
- [ ] La taille, la position et l'état maximisé de la fenêtre sont restaurés
- [ ] Une fenêtre positionnée sur un écran secondaire débranché revient sur l'écran principal
- [ ] Un `preferences.json` corrompu ne bloque pas le démarrage et est sauvegardé en `.bak`
- [ ] Un projet dont le dossier n'existe plus apparaît grisé et reste supprimable manuellement
- [ ] La liste est plafonnée à 15 entrées
- [ ] Aucune écriture disque en rafale (vérifiable en observant le `mtime` du fichier lors d'un redimensionnement continu)

## Testing & Validation

### Manual Testing Steps

1. Ouvrir trois projets, vérifier l'ordre et l'absence de doublons.
2. Redimensionner, déplacer, maximiser, redémarrer.
3. Corrompre volontairement `preferences.json` et relancer.
4. Renommer un dossier de projet et rouvrir l'app → entrée grisée.
5. Redimensionner la fenêtre en continu pendant 10 s et observer le `mtime` : le debounce doit limiter les écritures.

### Edge Cases

- Premier lancement (aucun fichier) : valeurs par défaut, écran d'accueil vide avec un état vide soigné plutôt qu'une page blanche.
- Chemin de projet contenant des accents ou des espaces : encodage correct à la relecture.
- Deux instances écrivant simultanément : impossible grâce au single-instance lock de Task 14, mais l'écriture atomique protège de toute façon.
- Changement de résolution d'écran entre deux sessions.

## Dependencies

**Must complete first** :
- Task 11 : Ouvrir un projet et reconstituer sa grille
- Task 05 : Thème (migration de la persistance)

**Blocks** :
- Task 14 (le CLI ouvre un projet et alimente les récents)

## Related Documentation

- **ARCHI** : § Persistance globale ; ADR-001
- **PRD** : Parcours principal (étape 1) ; Parcours secondaire (étape 1)

---
**Estimated Time** : 2 h
**Phase** : Integration
