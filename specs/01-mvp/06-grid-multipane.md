# Task 06 : Grille N×M multi-panes et cycle de vie des terminaux

## Context

Feature 2 du PRD. On passe d'un terminal unique à une grille de panes indépendants, chacun avec son process et son répertoire de travail. ADR-003 impose une grille rigide `cols × rows` en CSS Grid plutôt qu'un arbre de splits : positions absolues, sérialisation triviale, une ligne de CSS pour le rendu.

C'est aussi ici que se pose le problème des contextes WebGL : Chromium en plafonne le nombre (~16) et une grille de six terminaux commence à s'en approcher.

## Scope

Rendu d'une grille de N×M panes vivants et indépendants, à partir d'une structure de layout **en dur dans le code**. La lecture du fichier `.myterm.json` arrive en Task 10/11.

## Implementation Details

### Files to Create/Modify

- `src/renderer/store/workspace-slice.ts` — `grid`, `panes[]`
- `src/renderer/components/Grid/GridView.tsx` — conteneur CSS Grid
- `src/renderer/components/Grid/PaneView.tsx` — généralisation du composant de Task 04
- `src/renderer/components/Grid/PaneHeader.tsx` — titre, indicateur, bouton de fermeture
- `src/renderer/terminal/registry.ts` — gestion multi-instances
- `src/renderer/terminal/create-terminal.ts` — fallback WebGL → canvas
- `package.json` — `zustand`

### Key Functionality

- `GridView` applique `grid-template-columns: repeat(var(--cols), 1fr)` et son équivalent en lignes ; chaque `PaneView` se positionne via `gridColumn` / `gridRow` calculés depuis `{col, row}`.
- Chaque pane possède son propre PTY avec son propre `cwd` — vérifier que deux panes dans des dossiers différents ne partagent rien.
- Clé React = `pane.id` (jamais l'index) : un changement d'ordre ne doit pas recréer les terminaux.
- **Fallback WebGL** : écouter l'événement de perte de contexte de `WebglAddon` et le **décharger** — xterm retombe sur son renderer DOM intégré pour ce terminal uniquement. Journaliser le basculement. (`@xterm/addon-canvas@0.7` déclare un peer `@xterm/xterm@^5` et est incompatible avec xterm 6 : pas d'addon canvas.)
- `PaneHeader` affiche le titre et l'emplacement du pane ; l'indicateur d'état est un emplacement réservé rempli en Task 08.
- Démontage d'un pane : `dispose()`, `pane:kill`, retrait du registre — sans quoi chaque suppression fuit un contexte WebGL.

### Technologies Used

- **CSS Grid** natif (ADR-003)
- **Zustand** — `workspace-slice`, lu par sélecteurs uniquement
- **renderer DOM intégré d'xterm** — repli de rendu, sans dépendance

### Architectural Patterns

**Discipline Zustand** (ARCHI § State Management) : jamais de `useStore()` sans sélecteur dans un composant de la grille. Un `PaneView` s'abonne à *son* pane, pas au tableau complet — sinon les six panes se re-rendent à chaque changement d'état de l'un d'eux.

Le `TerminalRegistry` reste la seule source des instances xterm (ADR-006).

## Success Criteria

- [ ] Une grille 3×2 affiche six terminaux vivants et indépendants
- [ ] Chaque pane a son propre prompt et son propre `cwd` (vérifiable avec `pwd` dans chacun)
- [ ] Taper dans un pane n'affecte aucun autre
- [ ] Redimensionner la fenêtre reflow correctement les six terminaux
- [ ] Fermer un pane tue son process et libère son contexte WebGL, sans affecter les autres
- [ ] Une grille 4×4 (16 panes) démarre : les panes en excès basculent sur le rendu DOM sans écran noir
- [ ] Aucun `pwsh.exe` orphelin après fermeture de l'application
- [ ] Modifier l'état d'un pane ne re-rend que ce pane (vérifié au React DevTools Profiler)

## Testing & Validation

### Manual Testing Steps

1. Layout en dur 3×2 avec des `cwd` distincts ; `pwd` dans chacun.
2. Lancer `npm run dev` dans deux panes simultanément.
3. Redimensionner la fenêtre pendant que plusieurs panes produisent de la sortie.
4. Fermer un pane, vérifier la disparition du process dans le gestionnaire des tâches.
5. Pousser à 4×4 et surveiller la console pour les basculements canvas.
6. Profiler React : taper dans un pane ne doit re-rendre que lui.

### Edge Cases

- Deux panes déclarant la même position `{col, row}` → doit être détecté (la validation Zod le refusera en Task 10 ; ici, journaliser).
- `cwd` inexistant → le PTY doit démarrer dans un dossier de repli avec un message dans le pane, pas planter l'application.
- Grille de 1×1 : la mise en page doit rester correcte.

## Dependencies

**Must complete first** :
- Task 04 : Un pane terminal fonctionnel de bout en bout
- Task 05 : Thème (les terminaux doivent naître avec la bonne palette)

**Blocks** :
- Task 08 (badges), Task 09 (focus et zoom), Task 11 (spawn depuis le layout), Task 15 (éditeur)

## Related Documentation

- **ARCHI** : ADR-003 ; ADR-006 ; § Rendu du terminal (vigilance WebGL) ; § State Management
- **PRD** : Feature 2 « Grille de terminaux N×M »

---
**Estimated Time** : 3 h
**Phase** : Core
