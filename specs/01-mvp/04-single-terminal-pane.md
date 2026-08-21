# Task 04 : Un pane terminal fonctionnel de bout en bout

## Context

Première jonction des trois couches : PTY dans le main (Task 02), contrat IPC (Task 03) et rendu xterm.js dans le renderer. À l'issue de cette tâche on peut réellement taper dans un shell depuis l'application — c'est la validation du cœur technique du produit avant d'ajouter la grille.

## Scope

Un terminal unique, plein écran, pleinement interactif : frappe clavier, couleurs, redimensionnement, `Ctrl+C`. Pas de grille, pas de layout, pas de fichier de config.

## Implementation Details

### Files to Create/Modify

- `package.json` — `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-webgl`
- `src/renderer/terminal/create-terminal.ts` — fabrique d'instance
- `src/renderer/terminal/registry.ts` — `Map<paneId, TerminalHandle>` au niveau module
- `src/renderer/components/Grid/PaneView.tsx` — conteneur React
- `src/renderer/App.tsx` — rend un `PaneView` unique
- `src/main/ipc/handlers.ts` — branchement réel de `pane:spawn` / `write` / `resize` / `kill`
- `src/main/services/pty-manager.ts` — émission de `pane:data` vers le renderer

### Key Functionality

- `createTerminal()` instancie `Terminal` avec `fontFamily: 'Cascadia Mono, Consolas, monospace'`, `fontSize: 13`, `cursorBlink: true`, `scrollback: 5000`, `allowProposedApi: true`, puis charge `FitAddon` et `WebglAddon`.
- `PaneView` : un `<div ref>` et un `useEffect` de montage qui crée l'instance, l'enregistre dans le registre, appelle `terminal.open(el)`, `fit()`, puis `pane:spawn` avec les `cols`/`rows` obtenus.
- `terminal.onData` → `window.myterm.pane.write(paneId, data)`.
- Listener `pane:data` → `terminal.write(chunk)`.
- `ResizeObserver` sur le conteneur, débouncé à ~50 ms → `fitAddon.fit()` puis `pane:resize(id, cols, rows)`.
- Cleanup du `useEffect` : désabonnement IPC, `pane:kill`, `terminal.dispose()`, suppression du registre.

### Technologies Used

- **@xterm/xterm** + **@xterm/addon-fit** + **@xterm/addon-webgl** (ARCHI § Rendu du terminal)
- **node-pty** côté main

### Architectural Patterns

**ADR-006 — l'instance `Terminal` ne va jamais dans un state React ni dans Zustand.** Elle vit dans `registry.ts`, une `Map` au niveau module. React ne rend que le `<div>` conteneur. Un oubli de `dispose()` fuit un contexte WebGL : le cleanup est obligatoire, pas optionnel.

L'ordre d'initialisation compte : `terminal.open()` **avant** `fit()`, et `fit()` **avant** `pane:spawn`, pour que le PTY démarre avec les bonnes dimensions et n'ait pas à se réajuster.

## Success Criteria

- [ ] Un prompt PowerShell s'affiche au lancement de l'application
- [ ] La frappe clavier apparaît à l'écran et les commandes s'exécutent
- [ ] `dir` produit une sortie **colorée** (les couleurs ANSI passent)
- [ ] Redimensionner la fenêtre reflow le contenu et `$Host.UI.RawUI.WindowSize` reflète les nouvelles dimensions
- [ ] `Ctrl+C` interrompt une commande longue (`ping -t localhost`)
- [ ] `claude` démarre et son interface s'affiche correctement
- [ ] `npm run dev` dans un projet réel affiche les logs du serveur sans artefact visuel
- [ ] Aucun avertissement de contexte WebGL dans la console

## Testing & Validation

### Manual Testing Steps

1. Lancer l'app, taper `dir` — vérifier les couleurs.
2. Redimensionner la fenêtre pendant qu'une sortie longue défile.
3. `ping -t localhost` puis `Ctrl+C`.
4. `git rebase -i HEAD~2` dans un dépôt de test — l'éditeur plein écran doit s'afficher et se piloter au clavier.
5. Lancer `claude` et échanger un message.
6. Recharger le renderer (`Ctrl+R`) plusieurs fois : vérifier qu'aucun `pwsh.exe` ne s'accumule.

### Edge Cases

- Rechargement du renderer en dev : l'ancien PTY doit être tué, sinon les process s'accumulent à chaque HMR.
- Conteneur de largeur nulle au premier rendu → `fit()` calcule des dimensions absurdes ; ne spawn qu'après un `ResizeObserver` ayant renvoyé une taille non nulle.
- Sortie massive (`Get-ChildItem -Recurse C:\Windows`) : c'est attendu que ce soit lent ici — Task 07 y remédie.

## Dependencies

**Must complete first** :
- Task 02 : Faire démarrer un vrai PTY PowerShell
- Task 03 : Contrat IPC typé et surface preload

**Blocks** :
- Task 05 (thème du terminal), Task 06 (grille), Task 07 (batcher)

## Related Documentation

- **ARCHI** : § Rendu du terminal ; ADR-006 ; § Process Architecture
- **PRD** : Feature 2 « Grille de terminaux N×M » — critère de fidélité vis-à-vis de Windows Terminal

---
**Estimated Time** : 3 h
**Phase** : Foundation
