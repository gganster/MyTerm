# Task 16 : Sauvegarde du layout et détection d'édition externe

## Context

Boucle finale de la Feature 1 du PRD : le fichier doit rester la source de vérité **dans les deux sens**. L'éditeur écrit dedans, et une édition à la main depuis VS Code doit être détectée.

Deux règles d'ARCHI encadrent cette tâche. L'écriture est atomique — une coupure ne doit jamais laisser un fichier tronqué dans le dépôt de l'utilisateur. Et une modification externe n'est **jamais** appliquée automatiquement : elle tuerait des process en cours.

## Scope

Écriture du `.myterm.json` depuis le store, surveillance du fichier, bannière de rechargement.

## Implementation Details

### Files to Create/Modify

- `src/main/services/workspace.ts` — `writeLayout`, `watchLayout`
- `src/main/ipc/handlers.ts` — branchement de `workspace:save` et émission de `workspace:changed-on-disk`
- `src/renderer/components/ReloadBanner.tsx` — nouveau
- `src/renderer/store/workspace-slice.ts` — remise à zéro de `dirty`, action de rechargement
- `src/renderer/hooks/use-autosave.ts` — nouveau

### Key Functionality

- Sauvegarde par `Ctrl+S` **et** automatiquement, débouncée à ~1 s après la dernière modification. L'utilisateur ne doit pas perdre son layout parce qu'il a oublié d'enregistrer.
- L'écriture réutilise l'`atomicWrite` de Task 10 : `.tmp` puis `rename`, indentation 2 espaces, saut de ligne final.
- **Suppression de l'auto-déclenchement** : une écriture par l'application ne doit pas être interprétée par le watcher comme une édition externe. Solution retenue : suspendre le watcher pendant l'écriture et le réarmer après un court délai, en comparant en plus le contenu écrit au contenu détecté (le simple délai seul est peu fiable).
- `fs.watch` sur le fichier ; à la détection, `workspace:changed-on-disk` est émis et le renderer affiche une bannière non modale « Le fichier a changé sur le disque · Recharger · Ignorer ».
- « Recharger » relit, valide, et **redémarre uniquement les panes dont la spec a effectivement changé** — un pane inchangé conserve son process et son scrollback. Comparer pane par pane sur `{cwd, shell, command}`.
- Conflit (fichier modifié à l'extérieur **et** modifications locales non sauvegardées) : avertir explicitement que recharger écrasera les modifications locales. Ne pas fusionner — trop de complexité pour un gain nul.
- Fichier supprimé pendant la session (changement de branche git) : afficher un avertissement, garder le layout en mémoire, ne pas planter.
- Le watcher est libéré à la fermeture du projet.

### Technologies Used

- **`node:fs` `watch`** — suffisant pour un fichier unique ; `chokidar` serait surdimensionné
- **`atomicWrite`** de Task 10

### Architectural Patterns

Le main possède le système de fichiers ; le renderer demande une sauvegarde et reçoit des notifications, il ne touche jamais au disque (ARCHI § Process Architecture).

La politique « ne jamais appliquer automatiquement » est une décision d'architecture, pas un manque : appliquer un changement externe reviendrait à tuer des serveurs de dev pendant que l'utilisateur travaille.

## Success Criteria

- [ ] Une modification dans l'éditeur est écrite dans `.myterm.json` en moins de 2 s, sans action de l'utilisateur
- [ ] `Ctrl+S` force la sauvegarde immédiate et efface l'indicateur `dirty`
- [ ] Le fichier écrit est valide, indenté, relisible par l'application
- [ ] Une sauvegarde par l'application ne déclenche **pas** la bannière de rechargement
- [ ] Modifier le fichier depuis VS Code affiche la bannière en moins de 2 s
- [ ] « Recharger » applique les changements et ne redémarre que les panes réellement modifiés
- [ ] « Ignorer » masque la bannière ; une modification externe ultérieure la réaffiche
- [ ] Un fichier externe devenu invalide affiche l'erreur et **ne casse pas** le workspace en cours
- [ ] Modifications locales + modification externe → avertissement explicite avant écrasement
- [ ] Supprimer le fichier pendant la session n'entraîne pas de crash
- [ ] `git diff` après une sauvegarde sans changement réel est vide

## Testing & Validation

### Manual Testing Steps

1. Modifier un pane dans l'éditeur, attendre, vérifier le contenu du fichier.
2. Ouvrir le projet dans VS Code, changer un titre, sauvegarder → bannière.
3. Recharger et vérifier que le pane exécutant `npm run dev` n'a **pas** redémarré (son titre seul a changé).
4. Changer une `command` à l'extérieur → seul ce pane redémarre au rechargement.
5. Modifier localement puis à l'extérieur → avertissement de conflit.
6. Rendre le fichier invalide à l'extérieur → erreur affichée, workspace intact.
7. `git checkout` d'une branche sans le fichier pendant que l'app tourne.

### Edge Cases

- `fs.watch` sous Windows émet fréquemment des événements en double : dédupliquer.
- Certains éditeurs sauvegardent par `rename` plutôt que par écriture en place, ce qui peut invalider le watcher — surveiller le **dossier** et filtrer sur le nom de fichier est plus robuste que surveiller le fichier lui-même.
- Sauvegarde pendant qu'une dialog de trust est ouverte.
- Fichier en lecture seule (`git checkout` en cours) → erreur propre, `dirty` conservé, nouvelle tentative possible.

## Dependencies

**Must complete first** :
- Task 15 : Éditeur de layout dans l'interface
- Task 10 : Schéma Zod et écriture atomique

**Blocks** : aucune. **Complète la Feature 1 du PRD.**

## Related Documentation

- **ARCHI** : § Le schéma `.myterm.json` (écriture atomique, édition externe) ; § Process Architecture
- **PRD** : Feature 1 ; Feature 3 ; Parcours secondaire (étape 4)

---
**Estimated Time** : 2-3 h
**Phase** : Integration
