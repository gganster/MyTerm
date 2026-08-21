# Task 03 : Contrat IPC typé et surface preload

## Context

Le renderer est sandboxé et n'a aucun accès à Node : tout passe par une frontière IPC. ARCHI § Le contrat IPC définit cette frontière comme un artefact de premier plan, déclaré une seule fois dans `src/shared` et consommé des deux côtés — de sorte qu'une signature modifiée casse la compilation du main **et** du renderer plutôt que de produire un bug silencieux à l'exécution.

## Scope

Le contrat de canaux typé, le preload qui l'expose via `contextBridge`, et l'enregistrement des handlers côté main. Les handlers peuvent renvoyer des stubs : cette tâche livre la tuyauterie, pas les fonctionnalités.

## Implementation Details

### Files to Create/Modify

- `src/shared/ipc-contract.ts` — noms de canaux + types de requête/réponse
- `src/shared/pane-status.ts` — enum `PaneStatus` (`running` | `attention` | `idle` | `exited`)
- `src/preload/index.ts` — `contextBridge.exposeInMainWorld('myterm', api)`
- `src/preload/api.d.ts` — déclaration globale de `window.myterm`
- `src/main/ipc/handlers.ts` — `registerIpcHandlers()`
- `src/main/index.ts` — appel de `registerIpcHandlers()` au démarrage

### Key Functionality

Canaux **renderer → main** (`ipcRenderer.invoke`, requête/réponse) :

```
workspace:open(path)      → Layout
workspace:save(layout)    → void
workspace:pick()          → string | null
pane:spawn(paneSpec)      → { pid: number }
pane:write(paneId, data)  → void
pane:resize(paneId, c, r) → void
pane:kill(paneId)         → void
prefs:get()               → Preferences
prefs:set(patch)          → Preferences
theme:resolve()           → 'light' | 'dark'
```

Canaux **main → renderer** (`webContents.send`, flux poussé) :

```
pane:data(paneId, chunk)
pane:status(paneId, status)
pane:exit(paneId, code)
workspace:changed-on-disk()
theme:system-changed(mode)
```

- Les noms de canaux sont des constantes exportées, jamais des littéraux dispersés dans le code.
- Le preload expose une API en objet plat (`window.myterm.pane.write(...)`), avec pour chaque flux entrant un `on*` renvoyant une fonction de désabonnement — indispensable pour que `PaneView` nettoie ses listeners au démontage.
- Les handlers valident leurs arguments : un `paneId` inconnu renvoie une erreur explicite, jamais un crash du main.

### Technologies Used

- **Electron `contextBridge` + `ipcRenderer`** — les deux seules API utilisables en mode `sandbox: true`
- **TypeScript** — types partagés via l'alias `@shared/*`

### Architectural Patterns

Aucune fonction, aucun objet Node, aucun handle de PTY ne traverse le `contextBridge` : uniquement des données sérialisables. Le preload reste mince (~80 lignes) et sans logique métier.

## Success Criteria

- [ ] `window.myterm` est défini dans le renderer et `window.require` reste `undefined`
- [ ] Appeler un canal avec un mauvais type d'argument produit une erreur **à la compilation**
- [ ] Un canal `invoke` de test fait l'aller-retour et renvoie sa valeur au renderer
- [ ] Un `webContents.send` de test est reçu par un listener enregistré via l'API du preload
- [ ] La fonction de désabonnement retournée par un `on*` supprime effectivement le listener (un second envoi ne déclenche plus rien)
- [ ] `npm run typecheck` passe

## Testing & Validation

### Manual Testing Steps

1. Depuis les DevTools : `await window.myterm.theme.resolve()` → renvoie `'light'` ou `'dark'`.
2. Enregistrer un listener sur `pane:data`, déclencher un envoi de test depuis le main, vérifier la réception.
3. Appeler la fonction de désabonnement, renvoyer un message, vérifier l'absence de réception.
4. Renommer un canal dans `ipc-contract.ts` et vérifier que `typecheck` échoue des deux côtés.

### Edge Cases

- Message envoyé au renderer alors que la fenêtre est détruite → garder `webContents.isDestroyed()` avant chaque `send`, sinon crash du main à la fermeture.
- Double enregistrement d'un même handler `ipcMain.handle` → lève une exception ; s'assurer que `registerIpcHandlers()` n'est appelé qu'une fois.

## Dependencies

**Must complete first** :
- Task 01 : Scaffolder le projet Electron sécurisé

**Blocks** :
- Task 04, 05, 07, 11, 12, 13, 14, 16 — tout ce qui traverse la frontière de process

## Related Documentation

- **ARCHI** : § Le contrat IPC ; § Process Architecture ; § Sécurité (point 3)

---
**Estimated Time** : 2 h
**Phase** : Foundation
