# Task 02 : Faire démarrer un vrai PTY PowerShell (spike de risque)

> ✅ **Résolu le 2026-08-22.** Tous les critères passent. Résultat inattendu : `node-pty@1.1.0` embarque des prebuilds **N-API** — le même `pty.node` se charge sous Node 24 (ABI 137) et Electron 43 (ABI 148). **Aucun rebuild, aucun VS Build Tools.** Le `postinstall` `electron-builder install-app-deps` a été retiré : il échouait sur `MSB8040` en recompilant `deps/winpty` (legacy pré-ConPTY, inutile ici). Voir ADR-002 révisé et `.agents/apex/runs/*/proof/t02/`.

## Context

ARCHI identifie `node-pty` comme **le risque technique numéro un du projet** (ADR-002, § Risques ouverts). C'est un module natif qui doit être recompilé contre l'ABI d'Electron, ce qui exige Visual Studio Build Tools et Python sur la machine. Si cette étape résiste, tout le reste du planning est faux.

Cette tâche est délibérément placée avant toute UI : elle lève le risque ou déclenche le plan B (`@lydell/node-pty`) pendant qu'il ne coûte encore rien.

## Scope

Un PTY PowerShell qui démarre dans le main process, exécute une commande et dont la sortie s'affiche dans la console Node. **Aucune interface** : la validation se fait dans le terminal de développement.

## Implementation Details

### Files to Create/Modify

- `package.json` — `node-pty` en **`dependencies`** (jamais `devDependencies`). ~~`@electron/rebuild` + `postinstall`~~ : inutiles, prebuilds N-API
- `electron.vite.config.ts` — externalisation du module natif
- `src/main/services/pty-manager.ts` — première version
- `src/main/index.ts` — appel temporaire de démonstration

### Key Functionality

- `PtyManager` avec une `Map<string, IPty>` et quatre méthodes : `spawn(spec)`, `write(id, data)`, `resize(id, cols, rows)`, `kill(id)`.
- `spawn` démarre `pwsh.exe` (repli sur `powershell.exe` s'il est absent) avec `cwd`, `env: process.env`, `cols`/`rows` initiaux et `useConpty: true`.
- Abonnement à `onData` et `onExit`, sortie relayée vers `console.log` pour l'instant.
- Nettoyage : tous les PTY sont tués sur `before-quit` — un PTY orphelin laisse un `pwsh.exe` fantôme dans le gestionnaire des tâches.

### Technologies Used

- **node-pty** — ConPTY sous Windows (ADR-002)
- ~~**@electron/rebuild**~~ — non requis : le prebuild N-API de node-pty vaut pour Node et Electron

### Architectural Patterns

Configuration Vite obligatoire (ARCHI § electron-vite) :

```ts
main: {
  plugins: [externalizeDepsPlugin()],
  build: { rollupOptions: { external: ['node-pty'] } },
}
```

Le main process est **seul propriétaire des PTY** ; aucune référence ne fuit vers le renderer.

## Success Criteria

- [x] `npm install` fournit un `node-pty` fonctionnel sans recompilation (prebuild N-API)
- [ ] Au lancement de `npm run dev`, un `pwsh` démarre et sa bannière apparaît dans la console Node
- [ ] Écrire `"echo hello`r`n"` dans le PTY affiche `hello` dans la sortie relayée
- [ ] La sortie contient des séquences d'échappement ANSI brutes (preuve qu'on est bien sur un PTY et non sur un pipe)
- [ ] `resize()` ne lève pas d'exception et un `pwsh` qui affiche `$Host.UI.RawUI.WindowSize` reflète la nouvelle taille
- [ ] Fermer la fenêtre ne laisse aucun `pwsh.exe` résiduel dans le gestionnaire des tâches
- [ ] `npm run build && npm start` fonctionne aussi (le module natif est bien résolu hors dev)

## Testing & Validation

### Manual Testing Steps

1. `npm install` — aucune étape de compilation native attendue.
2. `npm run dev` — la bannière PowerShell doit apparaître dans la console.
3. Envoyer `echo hello`, puis `dir` (sortie colorée), puis `git rebase -i` si un dépôt est disponible : le CLI interactif doit se comporter normalement.
4. Fermer la fenêtre, vérifier l'absence de `pwsh.exe` orphelin.

### Edge Cases

- ~~**`electron-rebuild` échoue**~~ → sans objet : aucune compilation native n'a lieu. Le plan B `@lydell/node-pty` reste disponible si node-pty cessait un jour de livrer des prebuilds.
- **`pwsh.exe` absent** de la machine → repli sur `powershell.exe`, à implémenter dès maintenant.
- **Erreur `Cannot find module` en production** → le module n'est pas externalisé, ou il est dans `devDependencies`.

## Dependencies

**Must complete first** :
- Task 01 : Scaffolder le projet Electron sécurisé

**Blocks** :
- Task 04 (pane terminal), Task 07 (batcher), Task 11 (spawn de la grille) — et de fait tout le produit

## Related Documentation

- **ARCHI** : ADR-002 ; § electron-vite ; § Risques ouverts (ligne 1)
- **PRD** : Feature 2 « Grille de terminaux N×M », métrique de fidélité du terminal

---
**Estimated Time** : 2-3 h (dont une part imprévisible de résolution de toolchain)
**Phase** : Foundation
