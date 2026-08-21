# Task 01 : Scaffolder le projet Electron sécurisé

## Context

Aucun code n'existe : le dépôt ne contient que `PRD.md`, `ARCHI.md` et un `.git` sans commit. Cette tâche pose le squelette sur lequel les 18 suivantes s'appuient. Le point non négociable : `contextIsolation`, `nodeIntegration: false` et `sandbox: true` sont activés **dès le premier commit** (ARCHI § Sécurité). Les activer après coup obligerait à réécrire toute la couche IPC.

## Scope

Un `npm run dev` qui ouvre une fenêtre Electron affichant un composant React stylé en Tailwind, avec HMR sur le renderer et redémarrage à chaud du main. Aucune fonctionnalité métier.

## Implementation Details

### Files to Create/Modify

- `package.json` — scripts `dev`, `build`, `typecheck`, `lint`
- `electron.vite.config.ts` — trois cibles `main` / `preload` / `renderer`
- `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json` — mode strict
- `src/main/index.ts` — bootstrap `app`, `whenReady`
- `src/main/window.ts` — création de la `BrowserWindow`
- `src/preload/index.ts` — stub vide (rempli en Task 03)
- `src/renderer/index.html`, `src/renderer/main.tsx`, `src/renderer/App.tsx`
- `src/renderer/styles/globals.css` — import Tailwind v4
- `.gitignore`, `.editorconfig`, `eslint.config.js`

### Key Functionality

- `electron-vite` avec `@vitejs/plugin-react` et `@tailwindcss/vite` sur la cible renderer.
- `BrowserWindow` : `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`, `preload` pointant sur le build du preload.
- Fenêtre créée avec `show: false` puis affichée sur `ready-to-show` (évite le flash blanc au démarrage).
- Blocage de la navigation : `will-navigate` annulé, `setWindowOpenHandler` retournant `{ action: 'deny' }`.
- TypeScript `strict: true` + `noUncheckedIndexedAccess: true`.
- Premier commit git de l'ensemble.

### Technologies Used

- **electron-vite** — build des trois process, HMR (ARCHI § Build)
- **React 19 + TypeScript strict**
- **Tailwind CSS v4** via son plugin Vite (pas de `tailwind.config.js`, la configuration passe par `@theme` en CSS)

### Architectural Patterns

Séparation stricte `src/main` / `src/preload` / `src/renderer` / `src/shared` telle que décrite dans ARCHI § Folder Structure. Le dossier `src/shared` est créé vide dès maintenant avec son alias de chemin (`@shared/*`) résolu dans les trois tsconfig.

## Success Criteria

- [ ] `npm run dev` ouvre une fenêtre affichant un composant React avec un style Tailwind visible
- [ ] Modifier `App.tsx` rafraîchit la fenêtre sans la fermer (HMR)
- [ ] Modifier `src/main/index.ts` redémarre le process main automatiquement
- [ ] `npm run typecheck` passe sans erreur en mode strict
- [ ] Dans la console du renderer, `window.require`, `window.process` et `window.module` sont tous `undefined`
- [ ] Un `import('fs')` dans le renderer échoue à la compilation ou à l'exécution
- [ ] `npm run build` produit un bundle sans erreur

## Testing & Validation

### Manual Testing Steps

1. `npm install` puis `npm run dev`.
2. Ouvrir les DevTools du renderer, taper `window.require` → doit afficher `undefined`.
3. Modifier un texte dans `App.tsx`, vérifier la mise à jour sans rechargement complet.
4. Ajouter un `console.log` dans `src/main/index.ts`, vérifier le redémarrage et le log dans le terminal.

### Edge Cases

- Chemin du preload différent entre dev et production : vérifier que la fenêtre trouve bien le preload dans le build de prod (`npm run build && npm start`).
- Un `sandbox: true` empêche le preload d'utiliser `require('fs')` — vérifier qu'aucun code du preload n'en dépend (il ne doit contenir que `contextBridge` et `ipcRenderer`).

## Dependencies

**Must complete first** : aucune — c'est la tâche racine.

**Blocks** : toutes les autres tâches.

## Related Documentation

- **ARCHI** : § Build, Packaging & Distribution → electron-vite ; § Sécurité (points 3 et 4) ; § Folder Structure
- **PRD** : contrainte de plateforme (Windows 11, Electron)

---
**Estimated Time** : 2 h
**Phase** : Foundation
