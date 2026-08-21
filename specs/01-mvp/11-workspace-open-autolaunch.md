# Task 11 : Ouvrir un projet et reconstituer sa grille

## Context

**C'est la tâche qui fait exister le produit.** Toutes les précédentes sont des briques ; celle-ci les assemble pour délivrer la promesse du PRD : ouvrir un projet et voir six panes démarrer avec les bons `cwd` et les bonnes commandes, en moins de 5 secondes.

C'est aussi la tâche sur laquelle se mesure la métrique primaire du PRD.

## Scope

Sélection d'un dossier de projet → lecture du `.myterm.json` → spawn de la grille → exécution des commandes d'autolaunch. Le trust prompt arrive en Task 12 ; ici, on exécute directement (à corriger impérativement avant tout usage sur un dépôt cloné).

## Implementation Details

### Files to Create/Modify

- `src/main/services/workspace.ts` — `openProject(path)`
- `src/main/ipc/handlers.ts` — branchement de `workspace:open` et `workspace:pick`
- `src/main/services/pty-manager.ts` — `spawn` accepte `cwd`, `shell`, `command`
- `src/renderer/store/workspace-slice.ts` — hydratation depuis le layout lu
- `src/renderer/App.tsx` — bascule accueil / workspace
- `src/renderer/components/ProjectPicker/OpenFolderButton.tsx`

### Key Functionality

- `workspace:pick` ouvre un `dialog.showOpenDialog` en mode `openDirectory`.
- `openProject(path)` : lecture et validation du layout, ou — en son absence — génération d'un layout par défaut 1×1 en mémoire (**sans écrire de fichier** : on ne crée pas de `.myterm.json` dans le dépôt de l'utilisateur sans qu'il l'ait demandé).
- Le renderer hydrate son store, monte la grille, et chaque `PaneView` appelle `pane:spawn` avec sa spec résolue.
- **Exécution de la commande d'autolaunch** : le shell démarre d'abord, puis la commande est **écrite dans le PTY comme une ligne de saisie utilisateur** suivie de `\r`. Pas de `exec` d'une chaîne concaténée (ARCHI § Sécurité, point 2). Deux bénéfices : le shell reste interactif après la fin de la commande, et l'utilisateur voit la commande dans son historique comme s'il l'avait tapée.
- `cwd` résolu via `resolveCwd()` (Task 10). Si le dossier n'existe pas : démarrer à la racine du projet et écrire un avertissement lisible **dans le pane**, ne jamais faire échouer l'ouverture du workspace.
- Fermeture/changement de projet : tous les PTY du projet précédent sont tués avant d'ouvrir le suivant.
- **Instrumenter le temps d'ouverture** (log du délai entre `workspace:open` et le dernier `pane:spawn` résolu) : c'est la métrique primaire du PRD, elle doit être mesurée, pas estimée.

### Technologies Used

- **Electron `dialog`** — sélecteur de dossier natif
- **node-pty** — spawn avec `cwd` et shell par pane
- Schéma et résolution de chemins de Task 10

### Architectural Patterns

Le main est seul à toucher au système de fichiers et aux process ; le renderer ne reçoit qu'un `Layout` validé et sérialisable (ARCHI § Process Architecture).

Ordre de démarrage : le `fit()` d'un pane doit précéder son `spawn` pour que le PTY naisse aux bonnes dimensions (établi en Task 04) — le respecter aussi dans le spawn en masse.

## Success Criteria

- [ ] Le layout exemple du PRD (3×2 : trois `claude`, deux `npm run dev`, un pane vierge) se restaure intégralement
- [ ] Chaque pane démarre dans le bon `cwd` (`pwd` le confirme dans les six)
- [ ] Les commandes d'autolaunch s'exécutent ; le pane vierge reste sur un prompt en attente
- [ ] **Le temps entre le clic et la disponibilité du premier pane est inférieur à 5 s** — mesuré, pas estimé
- [ ] Un projet sans `.myterm.json` s'ouvre sur un pane unique, et **aucun fichier n'est créé** dans le dépôt
- [ ] Un `.myterm.json` invalide affiche l'erreur formatée avec le choix « ouvrir un pane unique » ou « corriger le fichier »
- [ ] Un `cwd` inexistant démarre le pane à la racine avec un avertissement visible, sans casser les autres panes
- [ ] Changer de projet tue tous les process du précédent (vérifié au gestionnaire des tâches)
- [ ] Après la fin d'un `npm run dev`, le shell du pane reste utilisable

## Testing & Validation

### Manual Testing Steps

1. Créer un vrai projet de test avec `frontend/` et `backend/` contenant chacun un `package.json` et un script `dev`.
2. Y déposer le `.myterm.json` de l'exemple du PRD, ouvrir dans MyTerm, chronométrer.
3. `pwd` dans les six panes.
4. Laisser tourner les deux serveurs de dev une minute, vérifier la stabilité de l'UI (le batcher de Task 07 est ici sous charge réelle).
5. Ouvrir un dossier sans `.myterm.json`, puis un dossier avec un fichier volontairement cassé.
6. Enchaîner deux projets et surveiller les process résiduels.

### Edge Cases

- Chemin de projet avec espaces ou accents (`C:\Users\guili\Mes Projets\démo`) — cas courant sous Windows.
- Projet sur un lecteur réseau ou un chemin UNC : le spawn peut être lent ; ne pas bloquer l'UI.
- Commande d'autolaunch qui échoue immédiatement (`npm run dev` sans `node_modules`) : l'erreur s'affiche dans le pane, le workspace reste fonctionnel.
- Ouvrir deux fois le même projet : ne pas dupliquer les process, réutiliser le workspace courant.

## Dependencies

**Must complete first** :
- Task 10 : Schéma Zod du layout
- Task 06 : Grille N×M multi-panes

**Blocks** :
- Task 12 (trust prompt), Task 13 (projets récents), Task 14 (CLI), Task 15 (éditeur)

## Related Documentation

- **ARCHI** : § Sécurité (point 2, écriture de la commande dans le PTY) ; § Le schéma ; § Process Architecture
- **PRD** : Feature 1 ; Parcours principal ; métrique primaire « < 5 s »

---
**Estimated Time** : 3 h
**Phase** : Core
