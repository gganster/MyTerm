# Task 15 : Éditeur de layout dans l'interface

## Context

Feature 3 du PRD : construire son layout en travaillant, sans quitter l'application pour éditer du JSON. Le critère de succès est explicite — créer de zéro le layout 3×2 de l'exemple en moins de deux minutes, sans jamais ouvrir un éditeur de texte.

Le fichier reste néanmoins lisible et modifiable à la main : l'éditeur est un confort, pas une couche d'abstraction qui s'approprierait le format.

## Scope

L'interface d'édition : ajouter, supprimer, renommer, déplacer un pane, modifier son `cwd`, son shell et sa commande, redimensionner la grille. La persistance vers le fichier est en Task 16.

## Implementation Details

### Files to Create/Modify

- `src/renderer/components/LayoutEditor/LayoutEditor.tsx` — panneau latéral
- `src/renderer/components/LayoutEditor/PaneForm.tsx` — édition d'un pane
- `src/renderer/components/LayoutEditor/GridSizeControl.tsx`
- `src/renderer/components/Grid/PaneHeader.tsx` — bouton d'édition
- `src/renderer/store/workspace-slice.ts` — actions de mutation + `dirty`

### Key Functionality

- Panneau latéral ouvrable par bouton ou raccourci, éditant le pane sélectionné : titre, `cwd`, shell, commande d'autolaunch.
- Ajout d'un pane sur une cellule libre ; suppression avec confirmation **si le process tourne encore**.
- Déplacement : bouton d'échange de position entre deux panes, ou glisser-déposer si le temps le permet. Deux panes ne peuvent jamais partager une cellule — l'échange est l'opération sûre.
- Redimensionnement de la grille : réduire `cols`/`rows` doit gérer les panes qui se retrouveraient hors grille — les lister explicitement et demander confirmation avant suppression. **Jamais de perte silencieuse d'un pane.**
- **Distinguer les modifications à effet immédiat de celles qui exigent un redémarrage du pane** : renommer un titre s'applique tout de suite ; changer le `cwd`, le shell ou la commande ne peut prendre effet qu'au redémarrage du pane. L'afficher clairement, avec un bouton « redémarrer ce pane », plutôt que de tuer le process sans prévenir — un `npm run dev` en cours n'a pas à mourir parce qu'on a corrigé une faute de frappe dans son titre.
- Indicateur `dirty` (modifications non sauvegardées) visible dans le chrome.
- Validation à la saisie via le schéma Zod de Task 10 : un layout invalide n'est jamais poussé dans le store.
- Sélecteur de dossier natif pour le champ `cwd`, avec conversion automatique en chemin **relatif** à la racine du projet.

### Technologies Used

- **shadcn/ui** — `Sheet`/`Dialog`, `Input`, `Select`, `Button`, `Tooltip`
- **Zustand** — actions de mutation du `workspace-slice`
- **Zod** — validation à la saisie

### Architectural Patterns

Le store reste la source de vérité de la session ; le fichier est écrit en Task 16. Une mutation invalide est refusée par le store, pas rattrapée à la sauvegarde.

`zoomedPaneId` et `focusedPaneId` restent dans `ui-slice` et ne sont jamais touchés par l'éditeur : l'état d'affichage n'appartient pas au layout (Task 09).

## Success Criteria

- [ ] Créer de zéro le layout 3×2 de l'exemple du PRD en moins de 2 minutes, sans éditeur de texte — **c'est le critère de succès du PRD, à chronométrer**
- [ ] Ajouter un pane le fait apparaître dans la grille avec un shell démarré
- [ ] Supprimer un pane dont le process tourne demande confirmation
- [ ] Renommer un pane est immédiat et ne redémarre rien
- [ ] Changer le `cwd`/shell/commande signale qu'un redémarrage est requis et propose le bouton
- [ ] Échanger deux panes conserve leurs process et leur scrollback
- [ ] Réduire la grille en laissant des panes hors limites les liste et demande confirmation
- [ ] Une saisie invalide (cellule occupée, `cwd` hors du projet) est refusée avec un message
- [ ] Le sélecteur de dossier renvoie un chemin relatif, pas absolu
- [ ] L'indicateur `dirty` apparaît à la première modification

## Testing & Validation

### Manual Testing Steps

1. Partir d'un dossier sans `.myterm.json`, construire le layout complet du PRD au chronomètre.
2. Lancer `npm run dev` dans un pane, renommer son titre → le serveur ne doit pas être interrompu.
3. Changer le `cwd` du même pane → message de redémarrage requis, puis redémarrer et vérifier le nouveau dossier.
4. Échanger deux panes chargés de contenu, vérifier la préservation du scrollback.
5. Passer une grille 3×2 en 2×2 avec des panes en colonne 2.
6. Saisir un `cwd` du type `..\..\Windows` → refus.

### Edge Cases

- Ajouter un pane sur une grille pleine → proposer d'agrandir la grille plutôt que d'échouer sèchement.
- Supprimer le dernier pane → interdire, ou recréer immédiatement un pane vierge (une grille vide n'a pas de sens).
- Nom de pane vide → autorisé, afficher un libellé de repli (`Pane 1`).
- Commande très longue : le champ doit rester lisible (textarea plutôt qu'input).

## Dependencies

**Must complete first** :
- Task 11 : Ouvrir un projet et reconstituer sa grille
- Task 10 : Schéma Zod (validation à la saisie)

**Blocks** :
- Task 16 : Sauvegarde et rechargement à chaud

## Related Documentation

- **ARCHI** : § State Management ; § Le schéma `.myterm.json`
- **PRD** : Feature 3 « Éditeur de layout intégré » ; Parcours secondaire

---
**Estimated Time** : 3 h
**Phase** : Integration
