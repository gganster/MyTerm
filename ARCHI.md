# Technical Architecture : MyTerm

> Document technique dérivé de [PRD.md](./PRD.md). Le PRD dit *quoi*, celui-ci dit *comment*.
> Cible : application desktop Electron, Windows 11, mono-utilisateur, sans backend.

---

## Architecture Overview

**Philosophie**

Trois principes gouvernent toutes les décisions ci-dessous.

1. **Le fichier est la base de données.** Le PRD exclut toute persistance ; l'état durable se résume à un `.myterm.json` par projet et à un fichier de préférences globales. Aucun SQLite, aucun ORM, aucune migration de schéma — juste du JSON validé à la lecture.
2. **Le main process possède les process, le renderer ne possède que des pixels.** Tous les PTY vivent dans le main ; le renderer ne reçoit que des octets et n'a aucun accès à Node. Cela permet `contextIsolation: true` + `sandbox: true`, et garde la frontière de sécurité nette malgré une app dont le métier est d'exécuter des commandes arbitraires.
3. **Rien qui ne serve un item du PRD.** Pas de couche d'abstraction anticipant les splits redimensionnables ou macOS. Le coût d'un refactor plus tard est inférieur au coût de porter une abstraction spéculative pendant tout le MVP.

**Tech Stack Summary**

| Couche | Choix |
|---|---|
| Runtime desktop | Electron (dernière version stable), `contextIsolation` + `sandbox` |
| Build | electron-vite (main / preload / renderer) |
| Packaging | electron-builder → NSIS x64 + electron-updater |
| UI | React 19 + TypeScript strict + Tailwind CSS v4 + shadcn/ui |
| Terminal (rendu) | `@xterm/xterm` + addons fit / webgl / canvas |
| Terminal (process) | `node-pty` (ConPTY sous Windows) |
| État renderer | Zustand |
| Validation | Zod (schéma `.myterm.json`) |
| Tests | Vitest sur la logique pure |
| Persistance | Fichiers JSON — `.myterm.json` (projet) + `userData/preferences.json` (global) |

---

## Process Architecture

```
┌─ MAIN PROCESS (Node) ──────────────────────────────────┐
│                                                        │
│  WorkspaceService   lecture/écriture .myterm.json      │
│                     validation Zod, écriture atomique  │
│                                                        │
│  PtyManager         Map<paneId, IPty>                  │
│                     spawn / write / resize / kill      │
│                                                        │
│  OutputBatcher      buffer par pane, flush ~16 ms      │
│                     détection d'état (BEL / idle)      │
│                                                        │
│  PreferencesStore   projets récents, thème             │
│  AppLifecycle       single-instance lock, argv du CLI  │
└────────────────────────┬───────────────────────────────┘
                         │  ipcMain.handle  (requêtes)
                         │  webContents.send (flux sortie)
┌────────────────────────┴───────────────────────────────┐
│  PRELOAD  — contextBridge, surface API typée, ~80 lignes│
│             aucun require Node exposé au renderer       │
└────────────────────────┬───────────────────────────────┘
                         │  window.myterm.*
┌────────────────────────┴───────────────────────────────┐
│  RENDERER (React, sandboxed)                            │
│                                                         │
│  Zustand store   layout, panes, focus, thème, états     │
│  TerminalRegistry  Map<paneId, Terminal>  ← HORS React  │
│  GridView / PaneView / LayoutEditor / ProjectPicker     │
└─────────────────────────────────────────────────────────┘
```

**Règle structurante** : les instances `Terminal` d'xterm.js ne sont **jamais** placées dans un state React. Elles vivent dans un registre module-level indexé par `paneId` ; React ne rend qu'un `<div ref>` conteneur et le cycle de vie de l'instance est piloté par un `useEffect` de montage/démontage. Mettre un objet xterm dans un state provoquerait sa recréation à chaque rendu et la perte du scrollback.

---

## Frontend Architecture

### Core Stack

**React 19 + TypeScript strict**
- *Pourquoi* : la grille est un arbre de composants avec un état partagé (focus, zoom, badges) ; React est le choix par défaut et l'écosystème xterm/Electron l'assume.
- *Trade-off* : le modèle de rendu React est mal adapté à un flux de 60 mises à jour/seconde. On le contourne en gardant le terminal hors du cycle React — React ne rend que le *chrome* autour du terminal.

**Tailwind CSS v4 + shadcn/ui**
- *Pourquoi* : le thème light/dark/system du PRD est la feature n°5, et Tailwind v4 expose ses tokens en variables CSS natives (`@theme`). Un basculement de thème devient un changement d'attribut sur `<html>`, sans re-render React. shadcn/ui fournit dialog, select, input, tooltip, dropdown — les cinq composants dont l'éditeur de layout a besoin, copiés dans le repo donc modifiables.
- *Trade-off* : shadcn amène Radix UI (~40 Ko gzip) pour une poignée de composants. Acceptable : ce sont exactement les composants les plus pénibles à écrire correctement (focus trap, navigation clavier, accessibilité) et une app Electron n'a pas de budget de téléchargement.
- *Alternative écartée* : composants maison. Économise ~40 Ko dans un binaire de 150 Mo — un faux gain, payé en bugs de clavier.

### State Management

**Zustand — un store unique, découpé en slices**

```
workspaceSlice   projectPath, layout (grid + panes), dirty
runtimeSlice     Map<paneId, { status, exitCode, pid }>
uiSlice          focusedPaneId, zoomedPaneId, theme, editorOpen
```

- *Pourquoi* : les badges d'activité changent plusieurs fois par seconde sur 6 panes. Avec Context + useReducer, chaque changement re-rend tout l'arbre sous le provider ; avec Zustand, un `PaneBadge` s'abonne à `state.runtime.get(id).status` via un sélecteur et lui seul se re-rend.
- *Trade-off* : une dépendance de plus (~1 Ko). Négligeable face au problème qu'elle évite.
- *Discipline* : jamais de `useStore()` sans sélecteur dans un composant de la grille.

**Pas de state serveur, pas de state URL.** Il n'y a ni serveur ni router : TanStack Query et nuqs seraient du poids mort. La navigation se limite à deux vues (accueil / workspace) pilotées par un booléen dérivé de `projectPath`.

### Rendu du terminal

`@xterm/xterm` avec trois addons :

| Addon | Rôle | Note |
|---|---|---|
| `@xterm/addon-fit` | recalcule cols/rows selon la taille du conteneur | appelé sur resize et sur zoom, débouncé, puis propagé au PTY |
| `@xterm/addon-webgl` | rendu GPU | ~10× plus rapide que le DOM sur les sorties verbeuses |
| `@xterm/addon-canvas` | fallback | voir ci-dessous |

**Point de vigilance WebGL** : chaque terminal WebGL consomme un contexte WebGL, et Chromium en plafonne le nombre (~16) avant de recycler les plus anciens. Six panes passent confortablement, une grille 4×4 non. Stratégie retenue : charger l'addon WebGL par défaut, écouter son événement de perte de contexte, et basculer ce terminal sur l'addon canvas en cas d'échec. Coût : ~20 lignes, et cela couvre définitivement le cas des grandes grilles.

`@xterm/addon-search` n'est pas installé au MVP — la recherche dans le scrollback est explicitement post-MVP dans le PRD.

### Thème : une seule source de vérité

Le thème existe à deux endroits (le CSS de l'app et la palette ANSI d'xterm) et doit rester cohérent. Un module `src/renderer/theme/palette.ts` exporte, pour chaque mode, un objet unique consommé des deux côtés : les variables CSS Tailwind pour le chrome, un objet `ITheme` pour chaque terminal.

Le mode `system` s'appuie sur `nativeTheme.shouldUseDarkColors` d'Electron relayé au renderer (et non sur `prefers-color-scheme`, moins fiable dans une fenêtre Electron sans configuration explicite).

**Piège documenté d'xterm.js** : `theme` est une option objet comparée par référence. Muter `terminal.options.theme.background` n'a aucun effet ; il faut réassigner un nouvel objet (`terminal.options.theme = { ...next }`). Le changement de thème itère donc le `TerminalRegistry` et réassigne une palette fraîche à chaque instance.

---

## Backend Architecture (main process)

### Le contrat IPC

Deux directions, deux mécanismes.

**Renderer → Main** — `ipcRenderer.invoke`, requête/réponse, toutes typées :

```ts
workspace:open(path)        → Layout        // lit + valide .myterm.json
workspace:save(layout)      → void          // écriture atomique
workspace:pick()            → path | null   // dialog natif de dossier
pane:spawn(paneSpec)        → { pid }
pane:write(paneId, data)    → void          // saisie clavier
pane:resize(paneId, c, r)   → void
pane:kill(paneId)           → void
prefs:get() / prefs:set(p)  → Preferences
theme:resolve()             → 'light' | 'dark'
```

**Main → Renderer** — `webContents.send`, flux poussé :

```ts
pane:data(paneId, chunk)          // sortie batchée
pane:status(paneId, status)       // running | attention | idle | exited
pane:exit(paneId, code)
workspace:changed-on-disk()       // .myterm.json édité à l'extérieur
theme:system-changed(mode)
```

### Le batching de sortie (le point chaud)

Un `npm run dev` verbeux émet des centaines de petits chunks par seconde. Un message IPC par chunk × 6 panes sature le thread renderer en sérialisation.

**Mécanisme** : `OutputBatcher` maintient un buffer de chaînes par pane. À chaque `onData` du PTY, le chunk est poussé dans le buffer et un flush est programmé s'il ne l'est pas déjà. Le flush s'exécute toutes les **16 ms** (une frame), concatène le buffer de chaque pane et envoie **un** message par pane non vide. Résultat : au pire 6 messages IPC par frame, quel que soit le débit.

**Contre-pression** : si le buffer d'un pane dépasse ~1 Mo entre deux flushes (un `cat` sur un gros fichier), on ne conserve que la queue et on préfixe le flush d'un marqueur de troncature. Le terminal reste réactif au lieu de bloquer la fenêtre.

*Pourquoi pas un `MessageChannel` par pane ?* Plus rapide en théorie, mais le batching supprime déjà le goulot : 6 messages/frame ne coûtent rien. Le canal dédié devient intéressant vers 15-20 panes très verbeux — c'est le seuil de migration à retenir, pas une optimisation à faire maintenant.

### Détection d'état des panes — la question ouverte du PRD, tranchée

Le PRD laissait ouvert *« comment savoir qu'un pane attend une saisie »*. Une heuristique purement temporelle (« pas de sortie depuis 500 ms donc il attend ») produit des faux positifs à chaque pause de réflexion d'un agent. La machine d'état retenue combine trois signaux, du plus fiable au moins fiable :

| Signal | État produit | Fiabilité |
|---|---|---|
| **BEL (`\x07`) dans le flux** | `attention` | Élevée — Claude Code sonne la cloche du terminal quand il attend une validation. C'est le signal le plus direct disponible, et il est standard. |
| **OSC 133 (marqueurs de prompt shell)** | `idle` | Élevée quand présent — nécessite d'activer l'intégration shell dans le profil PowerShell. Optionnel, détecté s'il est là. |
| **Silence de sortie > 800 ms, process vivant** | `idle` | Faible — utilisé en dernier recours, uniquement pour distinguer « ça tourne » de « ça ne tourne plus ». |
| **Exit du process** | `exited` + code | Certaine |

Le BEL est intercepté dans le main lors du batching (avant envoi), pas dans le renderer : cela évite de dépendre de la configuration `bellStyle` d'xterm et permet de remonter l'état même pour un pane non visible. L'état retombe de `attention` à `running` dès la prochaine saisie de l'utilisateur dans ce pane.

*Risque assumé* : si Claude Code cesse d'émettre le BEL, la détection dégrade vers l'heuristique de silence. Point à revalider au premier dogfooding (M5).

### Le schéma `.myterm.json` et sa validation

Zod définit le schéma, TypeScript en dérive le type (`z.infer`) — un seul endroit à maintenir.

```ts
const PaneSchema = z.object({
  id:      z.string().min(1),
  title:   z.string().default(''),
  col:     z.number().int().min(0),
  row:     z.number().int().min(0),
  cwd:     z.string().default('.'),          // relatif à la racine du projet
  shell:   z.enum(['pwsh','powershell','cmd','bash']).optional(),
  command: z.string().optional(),            // absent = shell nu, en attente
})

const LayoutSchema = z.object({
  version:  z.literal(1),
  name:     z.string().optional(),
  theme:    z.enum(['light','dark','system']).default('system'),
  grid:     z.object({ cols: z.number().int().min(1).max(6),
                       rows: z.number().int().min(1).max(4) }),
  defaults: z.object({ shell: z.string().default('pwsh'),
                       cwd:   z.string().default('.') }).default({}),
  panes:    z.array(PaneSchema),
}).superRefine(/* ids uniques, positions dans la grille, pas de collision */)
```

- **`version: 1` littéral** : un fichier d'une version future est rejeté avec un message clair plutôt que partiellement interprété. Le jour où un `version: 2` arrive, une fonction de migration explicite `v1 → v2` s'insère avant la validation.
- **Fichier invalide** : jamais d'échec silencieux ni de réécriture automatique. L'app affiche l'erreur Zod formatée avec le chemin du champ fautif, et propose « ouvrir un pane unique » ou « corriger le fichier ». Un fichier commité ne doit jamais être écrasé par l'app à cause d'une erreur de parsing.
- **Écriture atomique** : écriture dans `.myterm.json.tmp` puis `fs.rename`. Une coupure pendant la sauvegarde ne peut pas laisser un fichier tronqué dans le repo de l'utilisateur.
- **Édition externe** : `fs.watch` sur le fichier ; une modification externe n'est jamais appliquée automatiquement (elle tuerait des process en cours) — elle lève une bannière « le fichier a changé sur le disque · Recharger ».
- **Résolution des chemins** : `cwd` est résolu par `path.resolve(projectRoot, cwd)` et doit rester sous la racine du projet ; un `..` sortant est refusé à la validation. Cela évite qu'un layout cloné aille lancer des commandes ailleurs sur la machine.

### Sécurité — le vrai enjeu de ce produit

L'app exécute des commandes arbitraires décrites dans un fichier **commité dans un dépôt git**. Cloner un repo hostile et l'ouvrir dans MyTerm reviendrait à exécuter son `command` sans confirmation. C'est exactement le problème que VS Code résout avec le Workspace Trust, et il faut le traiter dès le MVP.

**Mesures retenues :**

1. **Trust prompt à la première ouverture** d'un chemin de projet inconnu : la liste des commandes d'autolaunch est affichée, l'utilisateur approuve ou ouvre en mode « panes vierges » (grille restaurée, aucune commande exécutée). Le chemin approuvé est mémorisé dans les préférences globales. Une commande qui *change* dans un projet déjà approuvé redemande une approbation.
2. **Pas de shell interprétant une chaîne composée.** La commande est écrite dans le PTY comme une ligne de saisie utilisateur après le démarrage du shell, exactement comme si l'utilisateur l'avait tapée — pas de `exec` d'une chaîne concaténée avec des variables. Le shell reste interactif et le pane survit à la fin de la commande.
3. **`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.** Le preload n'utilise que `contextBridge` + `ipcRenderer`, tous deux disponibles en sandbox ; aucun module Node n'a besoin d'être chargé côté renderer.
4. **Aucun contenu distant.** Le renderer ne charge que des fichiers locaux, `webSecurity` reste activé, et `will-navigate` / `setWindowOpenHandler` sont bloqués.

### Persistance globale

`app.getPath('userData')/preferences.json` — un seul fichier, validé par Zod comme le layout :

```jsonc
{
  "version": 1,
  "theme": "system",
  "recentProjects": [{ "path": "...", "name": "...", "lastOpenedAt": "..." }],
  "trustedProjects": [{ "path": "...", "commandsHash": "..." }],
  "window": { "width": 1600, "height": 1000, "maximized": false }
}
```

Pas de `electron-store` : une lecture, des écritures débouncées, le même helper d'écriture atomique que le layout. La dépendance n'apporterait rien qu'une trentaine de lignes ne couvrent.

### Le CLI `myterm .`

- L'installeur NSIS dépose `myterm.cmd` dans `%LOCALAPPDATA%\MyTerm\bin` et ajoute ce dossier au `PATH` **utilisateur** (jamais au PATH système : pas de droits admin requis, désinstallation propre).
- Le shim résout le chemin absolu du dossier courant et lance l'exécutable avec ce chemin en argument.
- Côté app : `app.requestSingleInstanceLock()`. Une seconde invocation ne démarre pas un second Electron — elle transmet son `argv` à l'instance existante via l'événement `second-instance`, qui ouvre le projet et met la fenêtre au premier plan.
- Le `argv` est traité comme une entrée non fiable : on vérifie que le chemin existe et qu'il s'agit d'un dossier avant toute chose.

---

## Build, Packaging & Distribution

### electron-vite

Trois cibles de build (`main`, `preload`, `renderer`) avec HMR sur le renderer et redémarrage à chaud du main.

**Le point critique : node-pty est un module natif.** Il ne peut pas être bundlé par Rollup et doit rester une dépendance externe résolue depuis `node_modules` à l'exécution :

```js
// electron.vite.config.ts
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { external: ['node-pty'] } },
  },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: { plugins: [react(), tailwindcss()] },
})
```

Corollaires à ne pas rater :
- `node-pty` va dans `dependencies`, **pas** `devDependencies` — sinon electron-builder ne l'embarque pas.
- Le binaire natif doit être compilé contre l'ABI d'Electron, pas celle de Node : `electron-rebuild` en `postinstall`, ce qui impose **Visual Studio Build Tools + Python** sur la machine de build. C'est le vrai coût de ce choix (voir ADR-002).
- Dans electron-builder, `asarUnpack: ["**/node_modules/node-pty/**"]` : un `.node` ne se charge pas depuis une archive asar.

### electron-builder

- Cible unique **NSIS x64** (Windows 11 uniquement, cf. PRD).
- `extraResources` pour le shim CLI, script NSIS personnalisé pour la modification du `PATH` utilisateur à l'install et son retrait à la désinstallation.
- **Signature de code** : sans certificat, SmartScreen affiche un avertissement à chaque installation. Tolérable pour un usage personnel, bloquant à la publication open-source (voir la section coûts).

### electron-updater

Publication via GitHub Releases sur un dépôt public. `checkForUpdatesAndNotify` au démarrage, téléchargement en arrière-plan, application au redémarrage. Deux réserves :
- Une mise à jour ne doit **jamais** s'appliquer pendant qu'un pane tourne — l'installation est proposée, jamais forcée.
- Sans signature, l'auto-update fonctionne mais chaque mise à jour hérite du même avertissement SmartScreen.

### Tests

**Vitest sur la logique pure**, celle qui casse silencieusement :
- validation Zod du layout — fixtures valides, invalides, version future, ids dupliqués, positions hors grille ;
- résolution des `cwd` — chemins relatifs, séparateurs Windows, tentatives de sortie de la racine ;
- machine d'état des panes — séquences de chunks BEL / silence / exit ;
- `OutputBatcher` — coalescence, contre-pression, ordre préservé ;
- hash des commandes pour l'invalidation du trust.

Pas de Playwright au MVP : le rapport coût/valeur d'un E2E Electron est mauvais tant qu'on dogfoode l'app quotidiennement. À reconsidérer avant la publication (M5).

---

## Architecture Decision Records

### ADR-001 — Aucune base de données

- **Contexte** : Switchboard indexe les sessions dans SQLite (better-sqlite3). Le PRD exclut explicitement historique, session browser et fork/resume.
- **Décision** : deux fichiers JSON validés par Zod. Aucune DB, aucun ORM.
- **Alternatives** : SQLite pour les projets récents et un futur historique ; `electron-store`.
- **Rationale** : la seule donnée durable est un layout de quelques kilo-octets et une liste de projets récents. Une DB ajouterait un second module natif à rebuilder, un schéma à migrer, et un état opaque — l'exact contraire du « la config est du texte versionnable » du PRD.
- **Conséquences** : si l'historique revient un jour au scope, il faudra réintroduire un stockage. Assumé : le PRD l'exclut par construction, pas par manque de temps.

### ADR-002 — `node-pty` malgré le coût de build

- **Contexte** : il faut de vrais PTY Windows (ConPTY) pour que Claude Code, `npm run dev` et `git rebase -i` se comportent normalement. `node-pty` est un module natif : rebuild contre l'ABI Electron, VS Build Tools et Python requis.
- **Décision** : `node-pty` officiel, avec `electron-rebuild` en `postinstall`.
- **Alternatives** : `@lydell/node-pty` (binaires précompilés pour Electron, zéro toolchain) ; `child_process.spawn` avec des pipes.
- **Rationale** : `spawn` est éliminé d'office — sans PTY, pas de couleurs, pas de redimensionnement, et les CLI interactifs se comportent comme s'ils écrivaient dans un fichier. Entre les deux node-pty, l'officiel est celui de VS Code et de Switchboard : documentation, issues et correctifs ConPTY y arrivent en premier. Le coût de la toolchain est payé une fois sur une machine de dev qui l'a déjà.
- **Conséquences** : la barrière à la contribution monte à l'open-sourcing (un contributeur doit installer VS Build Tools). Mitigation retenue si cela devient un frein : basculer sur le fork prebuilt, qui est API-compatible — la migration coûte une ligne de `package.json`.

### ADR-003 — Grille N×M rigide plutôt qu'un arbre de splits

- **Contexte** : le PRD choisit une grille `cols × rows`, chaque pane occupant une cellule.
- **Décision** : positions absolues `{col, row}` dans le JSON, rendu en CSS Grid natif.
- **Alternatives** : arbre binaire de splits avec ratios (modèle tmux/VS Code).
- **Rationale** : un arbre de splits impose un modèle récursif, une sérialisation imbriquée, une logique de redimensionnement en cascade et une UX de drag-and-drop de séparateurs — plusieurs jours de travail pour un besoin qui n'est pas exprimé. CSS Grid rend la grille en une ligne de style, et le JSON reste lisible et éditable à la main, ce qui est un objectif du PRD.
- **Conséquences** : pas de panes de tailles inégales. Si la contrainte devient gênante, la migration vers un modèle de splits est un changement de schéma (`version: 2`) avec migration automatique v1 → v2 — d'où le champ `version` dès maintenant.

### ADR-004 — Trust prompt sur les projets inconnus

- **Contexte** : le `.myterm.json` est commité dans le repo (choix du PRD, pour le partage d'équipe). Ouvrir un repo cloné exécuterait ses commandes d'autolaunch.
- **Décision** : approbation explicite à la première ouverture d'un chemin inconnu ; mode « panes vierges » en alternative ; ré-approbation si les commandes changent.
- **Alternatives** : ne rien faire (l'utilisateur est seul sur sa machine) ; config centralisée hors du repo (rejetée par le PRD).
- **Rationale** : c'est le prix de la décision produit de commiter le fichier. Le coût est d'une boîte de dialogue vue une fois par projet ; le risque évité est l'exécution de code arbitraire au clic. VS Code a exactement ce mécanisme pour exactement cette raison.
- **Conséquences** : une friction minime au premier lancement, et une décision de sécurité prise avant l'open-sourcing plutôt qu'après un rapport de vulnérabilité.

### ADR-005 — Batching à 16 ms plutôt que canal dédié par pane

- **Contexte** : le débit PTY est le principal risque de performance de l'app.
- **Décision** : buffer par pane dans le main, flush aligné sur la frame, un message IPC par pane et par flush, avec contre-pression au-delà de ~1 Mo.
- **Alternatives** : un `MessageChannel` par pane ; envoi direct sans batching.
- **Rationale** : l'envoi direct sature le renderer sur une sortie verbeuse. Le batching plafonne le trafic à 6 messages/frame — l'écran ne rafraîchit de toute façon que 60 fois par seconde, envoyer plus souvent est du travail perdu. Le canal dédié optimise une couche qui n'est plus le goulot.
- **Conséquences** : ~16 ms de latence ajoutée à l'affichage de la frappe, imperceptible. Seuil de migration documenté : au-delà de ~15 panes simultanément verbeux.

### ADR-006 — Instances xterm hors de React

- **Contexte** : un terminal est un objet impératif avec un état interne lourd (scrollback, contexte WebGL).
- **Décision** : `TerminalRegistry` — une `Map<paneId, Terminal>` au niveau module. React ne rend que le conteneur ; un `useEffect` crée/détruit l'instance et branche les listeners IPC.
- **Alternatives** : instance dans un `useState` ou dans le store Zustand.
- **Rationale** : placer un objet non sérialisable et coûteux dans un state React expose à sa recréation et à la perte du scrollback ; Zustand n'est pas fait pour stocker des handles impératifs.
- **Conséquences** : le nettoyage devient manuel et explicite — `terminal.dispose()` au démontage, sous peine de fuite de contexte WebGL. Point de vigilance permanent au code review.

---

## Folder Structure

```
MyTerm/
├── PRD.md
├── ARCHI.md
├── electron.vite.config.ts
├── electron-builder.yml
├── package.json
├── build/
│   ├── installer.nsh            # PATH utilisateur + shim CLI
│   └── icon.ico
├── resources/
│   └── myterm.cmd               # shim CLI
└── src/
    ├── shared/                  # importé par main ET renderer
    │   ├── schema/
    │   │   ├── layout.ts        # Zod + types dérivés
    │   │   └── preferences.ts
    │   ├── ipc-contract.ts      # noms de canaux + signatures typées
    │   └── pane-status.ts       # enum + machine d'état
    ├── main/
    │   ├── index.ts             # app lifecycle, single-instance, argv CLI
    │   ├── window.ts
    │   ├── services/
    │   │   ├── workspace.ts     # lecture/écriture/watch .myterm.json
    │   │   ├── pty-manager.ts
    │   │   ├── output-batcher.ts
    │   │   ├── preferences.ts
    │   │   └── trust.ts
    │   ├── ipc/handlers.ts
    │   └── util/atomic-write.ts
    ├── preload/
    │   └── index.ts             # contextBridge, surface unique
    └── renderer/
        ├── main.tsx
        ├── store/               # slices Zustand
        ├── terminal/
        │   ├── registry.ts      # Map<paneId, Terminal> — hors React
        │   ├── create-terminal.ts
        │   └── theme.ts         # palette → ITheme
        ├── theme/palette.ts     # source unique light/dark
        ├── components/
        │   ├── ProjectPicker/
        │   ├── Grid/            # GridView, PaneView, PaneBadge, PaneHeader
        │   ├── LayoutEditor/
        │   ├── TrustDialog/
        │   └── ui/              # shadcn
        └── styles/globals.css   # @theme Tailwind v4
```

`src/shared/` est la clé du typage de bout en bout : le contrat IPC et le schéma du layout y sont définis une fois et consommés des deux côtés de la frontière de process. Une signature de canal modifiée casse la compilation du main *et* du renderer.

---

## Cost Estimation

Une app desktop sans backend n'a pas de coût d'infrastructure — le poste de dépense est la distribution.

| Poste | Coût | Note |
|---|---|---|
| Hébergement / base de données / API | **0 €** | Aucun serveur : tout est local. |
| GitHub (repo public + Releases + Actions) | **0 €** | Releases illimitées en bande passante pour un repo public ; 2000 min/mois d'Actions. |
| Certificat de signature de code OV | **~250–400 €/an** | Nécessaire pour supprimer l'avertissement SmartScreen. Exige désormais un token matériel ou un HSM cloud. |
| Certificat EV (réputation SmartScreen immédiate) | ~350–600 €/an | Surdimensionné ici. |
| Signature gratuite pour projet open-source | **0 €** | SignPath Foundation signe gratuitement les projets OSS éligibles — piste à privilégier au moment de la publication. |
| **Total usage personnel** | **0 €/an** | Build local non signé, avertissement SmartScreen accepté. |
| **Total après open-sourcing** | **0 à ~350 €/an** | 0 € si SignPath accepte le projet. |

Le vrai coût du projet est le temps de développement, pas la facture.

---

## Implementation Priority

Aligné sur les jalons M1–M5 du PRD.

### Phase 1 — Fondations (M1 : « le terminal fonctionne »)
1. Scaffold electron-vite + React 19 + TypeScript strict + Tailwind v4 ; `contextIsolation` / `sandbox` activés dès le premier commit.
2. `node-pty` en dépendance, `electron-rebuild` en postinstall, externalisation dans la config Vite — **valider un `pwsh` qui démarre avant d'écrire une ligne d'UI**. C'est le risque technique le plus élevé du projet ; il doit être levé en premier.
3. Un pane unique : xterm + fit + webgl, IPC bidirectionnel, resize propagé au PTY.
4. `src/shared/palette.ts`, thème light/dark/system, `nativeTheme` relayé, réassignation du `ITheme` sur changement.

### Phase 2 — La grille (M2)
5. CSS Grid `cols × rows`, `TerminalRegistry`, dispose propre au démontage.
6. `OutputBatcher` avec flush 16 ms et contre-pression.
7. Machine d'état des panes (BEL → `attention`), badges, focus clavier, zoom plein écran.
8. Fallback canvas sur perte de contexte WebGL.

### Phase 3 — Le fichier (M3)
9. Schéma Zod + écriture atomique + erreurs de validation lisibles.
10. Ouverture d'un projet : lecture, spawn de la grille, autolaunch, résolution des `cwd`.
11. `TrustDialog` et persistance des projets approuvés (ADR-004).
12. Écran de projets récents, `preferences.json`, restauration de la géométrie de fenêtre.
13. Shim CLI `myterm .`, single-instance lock, traitement d'`argv`.

### Phase 4 — L'édition (M4)
14. Éditeur de layout : ajout/suppression/déplacement de panes, édition de `cwd`/shell/commande, redimensionnement de la grille.
15. Sauvegarde vers `.myterm.json`, `fs.watch` et bannière de rechargement.

### Phase 5 — Distribution (M5)
16. Suite Vitest sur la logique pure.
17. electron-builder NSIS, `asarUnpack` de node-pty, script NSIS de `PATH`, icône.
18. electron-updater + GitHub Releases, workflow CI de release.
19. Deux semaines de dogfooding exclusif, puis publication MIT — et revalidation de l'heuristique BEL sur usage réel.

---

## Risques ouverts

| Risque | Impact | Mitigation |
|---|---|---|
| `electron-rebuild` de node-pty échoue sur une machine sans VS Build Tools | Bloque le build | Basculer sur `@lydell/node-pty`, API-compatible (ADR-002) |
| Claude Code n'émet pas le BEL de façon fiable | Le badge `attention`, feature 4 du PRD, perd sa valeur | Vérifier empiriquement dès la Phase 2, avant de construire l'UI autour |
| Contextes WebGL épuisés sur grandes grilles | Terminaux noirs | Fallback canvas implémenté en Phase 2 |
| `.myterm.json` commité avec des chemins spécifiques à une machine | Conflits git récurrents | Surcharge `.myterm.local.json` non versionnée — question ouverte du PRD, à trancher au premier conflit réel |
| SmartScreen bloque l'installation chez les premiers utilisateurs | Frein à l'adoption OSS | Demande SignPath Foundation en amont de la publication |
