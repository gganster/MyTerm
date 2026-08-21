# Task 09 : Focus clavier, zoom plein écran et raccourcis

## Context

Seconde moitié de la Feature 4 du PRD : « un raccourci clavier agrandit le pane focalisé en plein écran et le restaure dans la grille ». Sans cela, travailler dans un pane d'une grille 3×2 sur un écran standard est inconfortable.

Le piège : un terminal capture presque toutes les frappes. Les raccourcis de l'application doivent être interceptés **avant** xterm, tout en laissant passer `Ctrl+C`, `Ctrl+D` et compagnie vers le shell.

## Scope

Navigation entre panes au clavier, zoom/dézoom, et l'ensemble des raccourcis globaux de l'application.

## Implementation Details

### Files to Create/Modify

- `src/renderer/store/ui-slice.ts` — `focusedPaneId`, `zoomedPaneId`
- `src/renderer/hooks/use-shortcuts.ts` — nouveau
- `src/renderer/components/Grid/GridView.tsx` — rendu conditionnel du zoom
- `src/renderer/components/Grid/PaneView.tsx` — anneau de focus, `attachCustomKeyEventHandler`
- `src/renderer/terminal/create-terminal.ts` — filtre clavier

### Key Functionality

Jeu de raccourcis :

| Raccourci | Action |
|---|---|
| `Ctrl+Shift+Z` | zoom / dézoom du pane focalisé |
| `Ctrl+Shift+←↑→↓` | déplacer le focus dans la grille |
| `Ctrl+Shift+1..9` | focus direct sur le n-ième pane |
| `Escape` | dézoom (si zoomé) |

- Interception via `terminal.attachCustomKeyEventHandler` : retourner `false` pour les combinaisons de l'application (xterm ne les transmet alors pas au PTY), `true` pour tout le reste.
- **Ne jamais intercepter** `Ctrl+C`, `Ctrl+D`, `Ctrl+Z`, `Ctrl+L`, `Ctrl+R` seuls — ils appartiennent au shell. Le préfixe `Ctrl+Shift` est choisi précisément pour éviter toute collision.
- Zoom : le pane occupe toute la grille (`grid-area: 1 / 1 / -1 / -1`), les autres sont masqués via `display: none`. **Ne pas les démonter** — cela tuerait leurs terminaux et leur scrollback. Après le changement, appeler `fit()` sur le pane zoomé et sur tous les autres au retour.
- Focus : `terminal.focus()` sur le pane cible, plus un anneau visuel sur le pane actif. Le clic sur un pane le focalise aussi.
- La navigation directionnelle utilise les coordonnées `{col, row}` ; en bord de grille, ne rien faire (pas de wrap-around, source de désorientation).

### Technologies Used

- **xterm.js `attachCustomKeyEventHandler`** — filtre clavier au niveau du terminal
- **CSS Grid** — `grid-area` pour le zoom, sans démontage
- **Zustand** `ui-slice`

### Architectural Patterns

Le zoom est un **état d'affichage**, jamais une modification du layout : `zoomedPaneId` vit dans `ui-slice` et n'est pas persisté dans `.myterm.json`. Le layout sauvegardé décrit la grille, pas ce que l'utilisateur regarde à l'instant T.

## Success Criteria

- [ ] `Ctrl+Shift+Z` agrandit le pane focalisé et le restaure ; le contenu et le scrollback sont intacts au retour
- [ ] Le terminal zoomé se reflow à la nouvelle taille, et les autres se reflow correctement au retour
- [ ] `Ctrl+Shift+flèches` déplace le focus conformément à la géométrie de la grille
- [ ] Le pane focalisé est visuellement identifiable
- [ ] Cliquer sur un pane le focalise
- [ ] `Ctrl+C` interrompt bien la commande du pane et n'est pas capté par l'application
- [ ] Taper `Ctrl+Shift+Z` dans un `claude` en cours n'insère aucun caractère parasite
- [ ] `Escape` dézoome mais n'est pas volé au shell quand aucun pane n'est zoomé

## Testing & Validation

### Manual Testing Steps

1. Grille 3×2, parcourir tous les panes aux flèches puis aux chiffres.
2. Zoomer sur un pane affichant une longue sortie, dézoomer, vérifier scrollback et reflow.
3. `ping -t localhost` puis `Ctrl+C` dans le pane focalisé.
4. Dans `claude`, essayer chaque raccourci de l'app et vérifier qu'aucun caractère n'est inséré dans le prompt.
5. Dans `vim` ou `git rebase -i`, vérifier qu'`Escape` va bien à l'éditeur quand rien n'est zoomé.

### Edge Cases

- Zoom sur un pane puis fermeture de ce pane → le focus doit retomber sur un pane existant et le zoom se lever.
- Grille 1×1 : le zoom ne doit rien casser (idempotent).
- `Escape` alors qu'un pane est zoomé **et** qu'un éditeur plein écran tourne dedans : conflit assumé, le dézoom l'emporte — documenter, et prévoir `Ctrl+Shift+Z` comme alternative sans ambiguïté.
- Focus après le montage initial : un pane doit être focalisé d'office, sinon la première frappe se perd.

## Dependencies

**Must complete first** :
- Task 06 : Grille N×M multi-panes

**Blocks** : aucune.

## Related Documentation

- **ARCHI** : § Frontend Architecture — State Management (`ui-slice`)
- **PRD** : Feature 4 « Lisibilité de la grille : badge d'activité + zoom »

---
**Estimated Time** : 2 h
**Phase** : Core
