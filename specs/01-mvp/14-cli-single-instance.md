# Task 14 : CLI `myterm .` et instance unique

## Context

Second point d'entrée du PRD : lancer l'application depuis un terminal existant, dans le dossier du projet. Cela suppose deux choses — un exécutable atteignable depuis le `PATH`, et une application qui, si elle tourne déjà, ouvre le projet dans la fenêtre existante au lieu d'en démarrer une seconde.

Cette tâche livre la partie applicative ; l'installation du shim dans le `PATH` est faite par l'installeur en Task 18.

## Scope

Le script shim, le verrou d'instance unique, le traitement d'`argv` et la mise au premier plan de la fenêtre.

## Implementation Details

### Files to Create/Modify

- `resources/myterm.cmd` — le shim
- `src/main/index.ts` — `requestSingleInstanceLock`, événement `second-instance`
- `src/main/cli-args.ts` — nouveau, analyse et validation d'`argv`
- `src/main/window.ts` — `focusWindow()`

### Key Functionality

- **`requestSingleInstanceLock()` appelé le plus tôt possible** dans le main : si le verrou n'est pas obtenu, `app.quit()` immédiat. Toute autre initialisation avant ce point serait du travail perdu, voire dangereux (deux process touchant `preferences.json`).
- L'événement `second-instance` reçoit l'`argv` et le `workingDirectory` de l'instance secondaire : en extraire le chemin de projet, ouvrir le workspace, restaurer la fenêtre si elle est minimisée, puis `focus()`.
- **`argv` est une entrée non fiable** (ARCHI § Le CLI) : vérifier que le chemin existe, que c'est bien un dossier, et le normaliser. Un chemin invalide n'ouvre rien et affiche un message, il ne fait pas planter l'application.
- Gérer `myterm .`, `myterm` (sans argument → écran d'accueil), et `myterm C:\chemin\vers\projet`. Un `.` se résout depuis le `workingDirectory` transmis, **pas** depuis le `cwd` du process principal — c'est l'erreur classique.
- Le shim `myterm.cmd` résout le dossier courant en chemin absolu et lance l'exécutable en lui passant cet argument, sans bloquer le terminal appelant (`start ""`).
- **Le trust prompt de Task 12 s'applique intégralement** à une ouverture par CLI. Aucun contournement.
- Au démarrage à froid, `process.argv` doit être traité de la même façon que dans `second-instance` — factoriser dans `cli-args.ts` pour éviter deux comportements divergents.

### Technologies Used

- **Electron `app.requestSingleInstanceLock()`** et l'événement `second-instance`
- **Batch Windows** pour le shim

### Architectural Patterns

Un unique chemin de code d'ouverture de projet, quelle que soit l'origine (clic sur un récent, sélecteur de dossier, CLI). Trois portes d'entrée, une seule implémentation — sinon le trust prompt finira par être oublié sur l'une d'elles.

## Success Criteria

- [ ] `myterm .` depuis un dossier de projet ouvre ce projet (shim invoqué manuellement, l'installation dans le `PATH` viendra en Task 18)
- [ ] Application déjà ouverte : `myterm .` sur un **autre** projet le charge dans la fenêtre existante et la met au premier plan
- [ ] Aucun second process Electron ne démarre jamais
- [ ] Fenêtre minimisée : `myterm .` la restaure et lui donne le focus
- [ ] `myterm` sans argument ouvre l'écran d'accueil
- [ ] `myterm C:\chemin\inexistant` affiche un message clair sans planter
- [ ] `myterm` sur un **fichier** (et non un dossier) est rejeté proprement
- [ ] Le terminal appelant reprend la main immédiatement, sans rester bloqué
- [ ] Une ouverture par CLI d'un projet non approuvé déclenche bien le trust prompt
- [ ] Le projet ouvert par CLI apparaît dans les récents

## Testing & Validation

### Manual Testing Steps

1. Application fermée : `.\resources\myterm.cmd .` depuis un dossier de projet.
2. Application ouverte sur le projet A : lancer le shim depuis le projet B.
3. Minimiser puis relancer le shim.
4. Tester les arguments invalides : chemin inexistant, chemin de fichier, chaîne vide.
5. Vérifier dans le gestionnaire des tâches qu'un seul `MyTerm.exe` principal tourne.
6. Lancer le shim depuis un dossier dont le chemin contient des espaces et des accents.

### Edge Cases

- Chemin avec espaces : le shim doit guillemeter correctement — c'est le bug le plus probable de cette tâche.
- Deux invocations quasi simultanées du shim : la seconde doit être absorbée sans race condition.
- Application en cours de démarrage lorsqu'une seconde invocation arrive : mettre l'ouverture en file d'attente jusqu'à `whenReady`.
- Le `.` résolu depuis le mauvais répertoire — vérifier explicitement en lançant le shim depuis un dossier différent de celui de l'exécutable.

## Dependencies

**Must complete first** :
- Task 13 : Préférences et projets récents
- Task 12 : Trust prompt (le chemin CLI doit y passer)

**Blocks** :
- Task 18 (l'installeur déploie le shim et modifie le `PATH`)

## Related Documentation

- **ARCHI** : § Le CLI `myterm .`
- **PRD** : Parcours principal (étape 1) ; Feature 1

---
**Estimated Time** : 2 h
**Phase** : Integration
