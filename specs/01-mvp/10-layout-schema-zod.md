# Task 10 : Schéma Zod du layout, écriture atomique, erreurs lisibles

## Context

Feature 1 du PRD et pilier d'ADR-001 : **le fichier est la base de données**. Il n'y a ni SQLite ni ORM ; toute la robustesse des données repose sur ce schéma et sur la discipline d'écriture.

Deux exigences non négociables d'ARCHI : un `.myterm.json` commité par l'utilisateur ne doit **jamais** être écrasé ni réécrit automatiquement à cause d'une erreur de parsing, et une coupure pendant une sauvegarde ne doit **jamais** laisser un fichier tronqué dans son dépôt.

## Scope

La couche de données pure : schéma, validation, lecture, écriture atomique, formatage d'erreurs. Aucune UI, aucun spawn de process. Cette tâche est **parallélisable** avec les tâches 06 à 09.

## Implementation Details

### Files to Create/Modify

- `package.json` — `zod`
- `src/shared/schema/layout.ts` — schéma + types dérivés + migration
- `src/shared/schema/format-error.ts` — erreur Zod → message lisible
- `src/main/util/atomic-write.ts` — nouveau
- `src/main/util/resolve-cwd.ts` — nouveau
- `src/main/services/workspace.ts` — `readLayout` / `writeLayout`
- `tests/fixtures/` — layouts valides et invalides

### Key Functionality

Le schéma exact d'ARCHI :

```ts
const PaneSchema = z.object({
  id:      z.string().min(1),
  title:   z.string().default(''),
  col:     z.number().int().min(0),
  row:     z.number().int().min(0),
  cwd:     z.string().default('.'),
  shell:   z.enum(['pwsh','powershell','cmd','bash']).optional(),
  command: z.string().optional(),
})

const LayoutSchema = z.object({
  version:  z.literal(1),
  name:     z.string().optional(),
  theme:    z.enum(['light','dark','system']).default('system'),
  grid:     z.object({ cols: z.number().int().min(1).max(6),
                       rows: z.number().int().min(1).max(4) }),
  defaults: z.object({ shell: z.string().default('pwsh'),
                       cwd:   z.string().default('.') }).default({}),
  panes:    z.array(PaneSchema),
}).superRefine(/* ids uniques · positions dans la grille · pas de collision */)
```

- **`version: 1` littéral** : un fichier de version supérieure est rejeté avec un message explicite (« créé par une version plus récente de MyTerm ») plutôt qu'interprété à moitié. Prévoir dès maintenant l'emplacement d'une fonction `migrate(raw)` appelée avant validation.
- **`superRefine`** valide trois invariants que le schéma de base ne couvre pas : unicité des `id`, `col < grid.cols` et `row < grid.rows`, et absence de deux panes sur la même cellule.
- **`resolveCwd(projectRoot, cwd)`** : `path.resolve`, puis rejet si le résultat sort de `projectRoot` (protection contre un `../..` dans un layout cloné, ARCHI § Résolution des chemins). Attention à la comparaison de chemins Windows : insensible à la casse, séparateurs normalisés, et il faut éviter le faux positif `C:\proj2` considéré comme enfant de `C:\proj`.
- **`atomicWrite(path, content)`** : écriture dans `<path>.tmp` puis `fs.rename` (atomique sur NTFS pour un même volume). Le `.tmp` est nettoyé en cas d'échec.
- **`formatZodError`** produit un message avec le chemin du champ fautif, du type `panes[2].col : doit être inférieur à grid.cols (3)`.
- Le JSON est écrit indenté sur 2 espaces avec un saut de ligne final — il est destiné à être lu et diffé dans git.

### Technologies Used

- **Zod** — validation et dérivation de types via `z.infer` : un seul endroit à maintenir (ARCHI § Le schéma)
- **`node:fs/promises`**, **`node:path`**

### Architectural Patterns

Le schéma vit dans `src/shared/` et est importé par le main **et** le renderer : le type `Layout` du store Zustand est le même objet que celui validé à la lecture du fichier.

Aucune fonction de cette tâche ne dépend d'Electron — c'est ce qui les rend testables en Task 17.

## Success Criteria

- [ ] Un `.myterm.json` valide (l'exemple 3×2 du PRD) est lu et produit un objet `Layout` typé
- [ ] Les valeurs par défaut sont appliquées (`theme`, `cwd`, `title`, `defaults`)
- [ ] Un fichier avec deux panes de même `id` est rejeté avec un message le nommant
- [ ] Un pane en `col: 5` dans une grille de 3 colonnes est rejeté
- [ ] Deux panes sur la même cellule sont rejetés
- [ ] `version: 2` est rejeté avec un message parlant, pas une erreur Zod brute
- [ ] Un JSON syntaxiquement invalide produit un message lisible, et **le fichier n'est pas modifié**
- [ ] `cwd: "../../Windows"` est refusé
- [ ] Une écriture interrompue ne laisse jamais de `.myterm.json` tronqué (seulement, au pire, un `.tmp` résiduel)
- [ ] Un aller-retour lecture → écriture ne produit aucun diff git parasite sur un fichier déjà normalisé

## Testing & Validation

### Manual Testing Steps

1. Créer les fixtures et faire passer chacune par `readLayout`, en observant les messages.
2. Écrire un layout, l'ouvrir dans un éditeur : indentation cohérente, saut de ligne final.
3. Écrire dans un fichier en lecture seule → erreur propre, pas de crash.
4. `git diff` après un aller-retour sur un fichier normalisé → vide.

### Edge Cases

- Fichier vide (0 octet) → message « fichier vide », pas une exception de parsing.
- BOM UTF-8 en tête (fréquent avec les éditeurs Windows) → doit être toléré à la lecture.
- Fins de ligne CRLF vs LF : ne pas se battre avec git, écrire en LF et laisser `core.autocrlf` faire son travail.
- `cwd` pointant vers un dossier valide mais inexistant sur le disque → **accepté à la validation** (le fichier n'est pas invalide), le problème est traité au spawn en Task 11.

## Dependencies

**Must complete first** :
- Task 01 : Scaffold (pour l'alias `@shared/*`)

**Blocks** :
- Task 11 (ouverture de projet), Task 12 (hash des commandes), Task 16 (sauvegarde), Task 17 (tests)

## Related Documentation

- **ARCHI** : § Le schéma `.myterm.json` et sa validation ; ADR-001 ; § Résolution des chemins
- **PRD** : Feature 1 « Workspace projet déclaratif »

---
**Estimated Time** : 2-3 h
**Phase** : Core
