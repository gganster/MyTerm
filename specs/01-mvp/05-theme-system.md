# Task 05 : Thème light / dark / système, palette unifiée

## Context

Feature 5 du PRD, et la raison d'être initiale du projet : Switchboard n'a pas de thème clair. Le PRD exige que le clair soit le cas nominal, conçu en premier, et qu'il s'applique **aussi à la palette du terminal**, pas seulement au chrome de l'application.

La difficulté est la cohérence : le thème vit à deux endroits (variables CSS Tailwind et objet `ITheme` d'xterm) qui doivent rester synchronisés. ARCHI impose une source unique.

## Scope

Les trois modes fonctionnels, appliqués simultanément au chrome et à tous les terminaux, avec suivi du thème Windows en mode `system`.

## Implementation Details

### Files to Create/Modify

- `src/renderer/theme/palette.ts` — **source unique** des deux thèmes
- `src/renderer/styles/globals.css` — bloc `@theme` Tailwind v4 + surcharges `[data-theme="dark"]`
- `src/renderer/terminal/theme.ts` — conversion palette → `ITheme` xterm
- `src/renderer/store/ui-slice.ts` — état `theme` et `resolvedTheme`
- `src/main/services/theme.ts` — relais de `nativeTheme`
- `src/renderer/components/ThemeToggle.tsx`

### Key Functionality

- `palette.ts` exporte deux objets (`light`, `dark`) contenant les couleurs du chrome **et** les 16 couleurs ANSI + `background` / `foreground` / `cursor` / `selectionBackground`.
- Application du thème : `document.documentElement.dataset.theme = resolved`. Aucun re-render React n'est nécessaire pour le chrome — le CSS fait tout le travail.
- Pour les terminaux : itérer le `TerminalRegistry` et **réassigner un nouvel objet** à `terminal.options.theme`.
- Mode `system` : le main écoute `nativeTheme.on('updated')` et pousse `theme:system-changed`. On n'utilise **pas** `prefers-color-scheme` côté renderer (peu fiable dans une fenêtre Electron sans configuration explicite).
- `backgroundColor` de la `BrowserWindow` accordé au thème résolu pour éviter un flash de couleur inverse au démarrage.
- Le mode choisi est mémorisé (préférences globales, cf. Task 13 — en attendant, `localStorage` suffit et sera migré).

### Technologies Used

- **Tailwind CSS v4** — tokens en variables CSS natives via `@theme`
- **Electron `nativeTheme`** — détection du thème Windows
- **xterm.js `ITheme`**

### Architectural Patterns

**Piège documenté d'xterm.js** (ARCHI § Thème) : `theme` est une option objet comparée **par référence**. Muter `terminal.options.theme.background` n'a aucun effet.

```ts
// ne fonctionne pas
terminal.options.theme.background = '#ffffff'
// fonctionne
terminal.options.theme = { ...nextTheme }
```

## Success Criteria

- [ ] Les trois modes (clair / sombre / système) sont sélectionnables et le basculement est instantané, sans rechargement
- [ ] Le changement affecte le chrome **et** le fond, le texte et les couleurs ANSI du terminal
- [ ] En mode `system`, changer le thème de Windows met à jour l'application sans la relancer
- [ ] Le mode choisi survit à un redémarrage de l'application
- [ ] La sortie de `claude` et les logs colorés d'un `npm run dev` restent lisibles dans les deux thèmes (critère de succès du PRD, à vérifier à l'œil)
- [ ] Aucun flash de couleur inverse au démarrage
- [ ] `palette.ts` est le seul fichier contenant des valeurs hexadécimales de couleur

## Testing & Validation

### Manual Testing Steps

1. Basculer entre les trois modes, observer chrome et terminal.
2. Passer Windows en thème sombre (Paramètres → Personnalisation) avec l'app en mode `system`.
3. Lancer `npm run dev` d'un vrai projet et `claude`, comparer la lisibilité dans les deux thèmes — c'est le test qui compte.
4. Redémarrer l'application, vérifier la persistance.
5. `grep -rE "#[0-9a-fA-F]{6}" src/` ne doit remonter que `palette.ts`.

### Edge Cases

- Terminal créé **après** un changement de thème → `createTerminal()` doit lire le thème courant, pas une constante figée.
- Couleurs ANSI vives (jaune, cyan) illisibles sur fond blanc : le thème clair doit les assombrir. Ne pas se contenter d'inverser le thème sombre.
- Sélection de texte : `selectionBackground` doit avoir un contraste suffisant dans les deux modes.

## Dependencies

**Must complete first** :
- Task 04 : Un pane terminal fonctionnel de bout en bout
- Task 03 : Contrat IPC typé (canal `theme:*`)

**Blocks** :
- Task 06 (la grille consomme la palette), Task 13 (persistance du mode)

## Related Documentation

- **ARCHI** : § Thème : une seule source de vérité
- **PRD** : Feature 5 « Thème light / dark / système » ; Problem Statement (l'absence de thème clair de Switchboard)

---
**Estimated Time** : 2-3 h
**Phase** : Foundation
