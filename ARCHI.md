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
| UI | React 19 + TypeScript strict + Tailwind CSS v4 + primitives Radix (`@radix-ui/react-dialog`) |
| Terminal (rendu) | `@xterm/xterm` + addons fit / webgl (repli renderer DOM) |
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

**Tailwind CSS v4 + primitives Radix**
- *Pourquoi* : le thème light/dark/system du PRD est la feature n°5, et Tailwind v4 expose ses tokens en variables CSS natives (`@theme`). Un basculement de thème devient un changement d'attribut sur `<html>`, sans re-render React. Le seul composant qu'il serait déraisonnable d'écrire à la main est la dialog de confiance : une invite de sécurité au focus trap cassé est pire que pas d'invite du tout.
- *Mise en œuvre* : les primitives Radix sont utilisées directement (`@radix-ui/react-dialog`) plutôt que via le générateur shadcn, qui suppose une arborescence Next.js. Le bénéfice visé — focus trap, navigation clavier, accessibilité correcte sur la dialog de confiance — est le même ; le reste de l'UI est écrit à la main avec Tailwind.
- *Trade-off* : Radix UI pèse ~40 Ko gzip pour un seul composant. Acceptable : ce sont exactement les composants les plus pénibles à écrire correctement (focus trap, navigation clavier, accessibilité) et une app Electron n'a pas de budget de téléchargement.
- *Alternative écartée* : composants maison. Économise ~40 Ko dans un binaire de 150 Mo — un faux gain, payé en bugs de clavier.

### State Management

**Zustand — un store unique, découpé en slices**

```
workspaceSlice   projectPath, layout (panes ordonnés), dirty
runtimeSlice     Map<paneId, { status, exitCode, pid }>
uiSlice          focusedPaneId, zoomedPaneId, theme, editorOpen, columns
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
| *(renderer DOM intégré)* | fallback | voir ci-dessous — l'addon canvas ne supporte pas xterm 6 |

**Point de vigilance WebGL** : chaque terminal WebGL consomme un contexte WebGL, et Chromium en plafonne le nombre (~16) avant de recycler les plus anciens. Six panes passent confortablement, une grille 4×4 non. Stratégie retenue : charger l'addon WebGL par défaut, écouter son événement de perte de contexte, et **décharger l'addon** en cas d'échec — xterm retombe alors sur son renderer DOM intégré, sans dépendance supplémentaire. (`@xterm/addon-canvas@0.7` déclare un peer `@xterm/xterm@^5` et ne supporte pas xterm 6 ; seules des préversions le font.) Coût : ~20 lignes, et cela couvre définitivement le cas des grandes grilles.

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
status:usage-get()          → UsageSnapshot   // dernier quota connu
status:load-get()           → SystemLoad      // dernier échantillon CPU/RAM
```

**Main → Renderer** — `webContents.send`, flux poussé :

```ts
pane:data(paneId, chunk)          // sortie batchée
pane:status(paneId, status)       // running | attention | idle | exited
pane:exit(paneId, code)
workspace:changed-on-disk()       // .myterm.json édité à l'extérieur
theme:system-changed(mode)
status:usage(snapshot)            // quota Claude, poussé à chaque sondage
status:load(sample)               // CPU/RAM, poussé toutes les 2 s
```

Les deux canaux `status:*` sont doublés d'un `*-get` : le renderer monte bien après le démarrage du main, et un push émis avant l'attachement du listener laisserait la barre bloquée sur « — ».

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
  cwd:     z.string().default('.'),          // relatif à la racine du projet
  shell:   z.enum(['pwsh','powershell','cmd','bash']).optional(),
  command: z.string().optional(),            // absent = shell nu, en attente
})

const LayoutSchema = z.object({
  version:  z.literal(2),
  name:     z.string().optional(),
  theme:    z.enum(['light','dark','system']).default('system'),
  defaults: z.object({ shell: z.string().default('pwsh'),
                       cwd:   z.string().default('.') }).default({}),
  panes:    z.array(PaneSchema).min(1).max(24),   // l'ordre EST la disposition
}).superRefine(/* ids uniques */)
```

- **`version: 2` littéral** : un fichier d'une version future est rejeté avec un message clair plutôt que partiellement interprété. Un fichier v1 (grille `cols × rows`, panes en `{col, row}`) est migré en mémoire par `migrateLayout` avant la validation — les panes sont aplatis dans le sens de lecture, ligne par ligne. La migration ne réécrit rien : le fichier sur le disque ne passe en v2 qu'à la première sauvegarde de l'utilisateur.
- **Fichier invalide** : jamais d'échec silencieux ni de réécriture automatique. L'app affiche l'erreur Zod formatée avec le chemin du champ fautif, et propose « ouvrir un pane unique » ou « corriger le fichier ». Un fichier commité ne doit jamais être écrasé par l'app à cause d'une erreur de parsing.
- **Écriture atomique** : écriture dans `.myterm.json.tmp` puis `fs.rename`. Une coupure pendant la sauvegarde ne peut pas laisser un fichier tronqué dans le repo de l'utilisateur.
- **Édition externe** : `fs.watch` sur le fichier ; une modification externe n'est jamais appliquée automatiquement (elle tuerait des process en cours) — elle lève une bannière « le fichier a changé sur le disque · Recharger ».
- **Résolution des chemins** : `cwd` est résolu par `path.resolve(projectRoot, cwd)` et doit rester sous la racine du projet ; un `..` sortant est refusé à la validation. Cela évite qu'un layout cloné aille lancer des commandes ailleurs sur la machine.

### Sécurité — le vrai enjeu de ce produit

L'app exécute des commandes arbitraires décrites dans un fichier **commité dans un dépôt git**. Cloner un repo hostile et l'ouvrir dans MyTerm reviendrait à exécuter son `command` sans confirmation. C'est exactement le problème que VS Code résout avec le Workspace Trust, et il faut le traiter dès le MVP.

**Mesures retenues :**

1. **Trust prompt à la première ouverture** d'un chemin de projet inconnu : la liste des commandes d'autolaunch est affichée, l'utilisateur approuve ou ouvre en mode « panes vierges » (grille restaurée, aucune commande exécutée). Le chemin approuvé est mémorisé dans les préférences globales. Une commande qui *change* dans un projet déjà approuvé redemande une approbation.
2. **Pas de shell interprétant une chaîne composée.** La commande est écrite dans le PTY comme une ligne de saisie utilisateur après le démarrage du shell, exactement comme si l'utilisateur l'avait tapée — pas de `exec` d'une chaîne concaténée avec des variables. Le shell reste interactif et le pane survit à la fin de la commande.
**Portée exacte du modèle de menace.** Le trust prompt protège contre un **contenu de dépôt hostile** — un `.myterm.json` écrit par quelqu'un d'autre. Il ne prétend pas résister à un renderer compromis : `workspace:save` réapprouve automatiquement les commandes, puisque l'utilisateur vient de les écrire lui-même dans l'éditeur, et un renderer contrôlé par un attaquant pourrait emprunter ce chemin. Exiger une approbation pour une commande que l'utilisateur vient de taper serait par ailleurs le meilleur moyen de lui apprendre à cliquer sans lire. La portée de cette auto-approbation reste bornée au projet déjà ouvert : le renderer ne choisit jamais la racine du projet.

3. **`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.** Le preload n'utilise que `contextBridge` + `ipcRenderer`, tous deux disponibles en sandbox ; aucun module Node n'a besoin d'être chargé côté renderer.
4. **Aucun contenu distant.** Le renderer ne charge que des fichiers locaux, `webSecurity` reste activé, et `will-navigate` / `setWindowOpenHandler` sont bloqués.
5. **Une seule sortie réseau authentifiée, confinée au main.** La barre de statut lit le quota Claude sur l'endpoint OAuth d'usage. Le jeton est lu depuis le fichier de credentials de Claude Code, posé dans un unique en-tête `Authorization`, puis oublié : il ne franchit jamais l'IPC, n'apparaît dans aucun log, et les échecs sont réduits à des codes grossiers (`no-credentials`, `token-expired`, `http-429`, `network`) — jamais un message d'exception, qui embarquerait le chemin absolu du fichier. Le point 4 reste vrai : c'est le main qui parle au réseau, le renderer ne charge toujours que du local.


### La barre de statut

Un pied de fenêtre permanent, présent dans les deux vues (sélecteur de projet et workspace) : quota Claude à gauche, charge machine à droite. Trois décisions le gouvernent.

**Le quota vient d'une seule source.** L'endpoint OAuth live, celui que `/usage` affiche. `claude-usage-overlay` y ajoute deux replis sur les fichiers de cache de la statusline personnelle de son auteur ; ces chemins n'existent que sur une machine, ils seraient du code mort pour tout autre utilisateur de MyTerm.

**Le sondage est bridé, parce que l'endpoint est partagé.** La statusline de Claude Code et tout overlay d'usage tapent le même endpoint avec le même compte, et il répond 429 quand la somme dépasse son budget — constaté pendant la preuve runtime de cette feature. D'où un intervalle de base de 2 minutes (un pourcentage de quota ne bouge pas de plus de quelques points en deux minutes), un backoff exponentiel plafonné à 15 minutes, et un recul immédiat de 5 minutes sur le premier 429. Un `setTimeout` qui se replanifie, pas un `setInterval` : un intervalle ne sait pas ralentir.

**Un échec ne vide pas la barre.** Tant que la dernière mesure réussie a moins de 15 minutes, elle reste affichée avec un `⋯` discret et l'explication en infobulle. Une barre qui clignote vers « indisponible » à chaque hoquet de Wi-Fi est une barre qu'on cesse de lire ; au-delà de 15 minutes, elle avoue ne pas savoir plutôt que de mentir.

Deux règles d'affichage, corollaires du PRD : une valeur inconnue vaut `—`, **jamais** `0 %` (un quota à zéro se lit « intact », soit l'inverse de « on ne sait pas »), et la couleur ne sert qu'à alerter — en dessous de 75 % la jauge est grise, sinon une barre en permanence verte apprendrait à l'œil à sauter la ligne, y compris quand elle passe au rouge.

Le CPU et la RAM viennent d'`os.cpus()` et `os.totalmem()`, échantillonnés toutes les 2 s dans le main. Aucune dépendance ajoutée. La charge CPU n'existe qu'en delta entre deux relevés — d'où un échantillonneur avec état côté main, et de l'arithmétique pure dans `@shared/system-load`, testable sans machine chargée.

Enfin, `useStatus()` n'est appelé que par `StatusBar`, jamais par `App`. Le remonter d'un cran re-rendrait toute la grille toutes les 2 s pour un pied de page que personne ne regarde — exactement le mode d'échec décrit en § State Management. Et rien dans la barre n'est cliquable : un contrôle en pied de fenêtre volerait le focus du terminal.

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

### Le menu contextuel de l'explorateur

Troisième porte d'entrée, et la plus courte : un clic droit dans le dossier du projet plutôt qu'un terminal à ouvrir d'abord. L'installeur écrit deux verbes, dans `HKCU\Software\Classes` comme le reste de l'installation par utilisateur :

| Clé | Menu | Libellé |
|---|---|---|
| `Directory\shell\MyTerm` | clic droit **sur** un dossier | *Ouvrir dans MyTerm* |
| `Directory\Background\shell\MyTerm` | clic droit **dans le vide** d'un dossier ouvert | *Ouvrir MyTerm ici* |

Trois points qui ne s'improvisent pas :

- La commande est `"$INSTDIR\MyTerm.exe" "%V"`. **`%V`, pas `%1`** : le menu du fond de dossier n'a aucun élément cliqué à substituer, `%1` y est vide et MyTerm s'ouvrirait sur l'écran d'accueil — un échec silencieux, puisque l'entrée apparaît et lance bien l'application.
- `MultiSelectModel = Single` sur le verbe du dossier. Sans cet attribut, un verbe en ligne de commande est invoqué **une fois par élément sélectionné** : six dossiers sélectionnés démarrent six `MyTerm.exe`, dont cinq perdent le verrou d'instance unique et poussent tour à tour leur projet dans la même fenêtre.
- Elle vise l'exécutable, pas `myterm.cmd` : un `.cmd` ferait clignoter une console à chaque lancement, et le shim n'existe que pour *retrouver* le dossier d'installation depuis un terminal.
- Elle n'ouvre aucun chemin de code nouveau : le dossier arrive dans `argv` et repart dans `parseCliArgs`, donc verrou d'instance unique, validation et **contrôle de confiance** s'appliquent à l'identique. Trois portes d'entrée, une seule implémentation (ADR-004).

**Racine de lecteur.** `%V` conserve l'antislash final : la ligne de commande se termine par `"C:\"`, et `CommandLineToArgvW` — celui qui construit `process.argv` — lit `\"` comme un guillemet échappé. L'argument reçu est `C:"`, ni absolu ni existant, et l'utilisateur retombe sur l'écran d'accueil sans un mot. Le fond d'une fenêtre de lecteur sert bien les verbes `Directory\Background\shell`, le cas est donc atteignable ; `myterm C:\` depuis un terminal y tombe aussi. La réparation est dans `cli-args.ts`, côté application : un `"` final ne peut pas venir d'autre part, ce caractère étant illégal dans un chemin Windows.

**La désinstallation pendant une mise à jour est sautée** (`${ifNot} ${isUpdated}`). electron-builder lance l'ancien désinstalleur *avant* de copier les nouveaux fichiers ; si la copie échoue, le modèle restaure les fichiers et abandonne — `customInstall` ne s'exécute jamais. Sans ce garde-fou, l'utilisateur se retrouve avec une application qui marche mais qui a perdu son `PATH`, son shim et ses deux verbes, sans aucun message.

**Windows 11 place ce verbe derrière « Afficher plus d'options »** (le menu hérité, aussi accessible par `Maj+F10`). Le menu compact n'accepte que les extensions `IExplorerCommand` déclarées via une **identité de paquet signée** — MSIX complet ou paquet *sparse*. Pour une application non signée et installée par utilisateur, le coût dépasse largement le gain. C'est une limite assumée, pas un oubli.

Non enregistrés, délibérément : `Drive\shell` (l'icône d'un lecteur dans « Ce PC » — le *fond* d'une fenêtre de lecteur, lui, est couvert), `DesktopBackground\Shell` et `LibraryFolder`. Ouvrir un lecteur entier comme projet n'a pas de sens. Pas de `SHChangeNotify` non plus : les verbes statiques sont relus à la construction du menu, ce qui a été vérifié — une entrée fraîchement écrite apparaît dans la session en cours, sans redémarrage.

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
- Le binaire natif est un prebuild N-API valable pour Node comme pour Electron : **aucune étape de rebuild, aucune toolchain C++ requise** (ADR-002, révisé et mesuré).
- Dans electron-builder, `asarUnpack: ["**/node_modules/node-pty/**"]` : un `.node` ne se charge pas depuis une archive asar.

**Versions verrouillées par l'écosystème (2026-08-22)** : `electron-vite@5` n'accepte pas encore Vite 8 — Vite est épinglé en `^7`, et `@vitejs/plugin-react` en `^5.2` (le `6.x` exige Vite 8). Par ailleurs `@xterm/addon-canvas@0.7` ne supporte pas xterm 6 ; le repli de rendu est donc le **renderer DOM intégré** d'xterm, sans dépendance supplémentaire.

### electron-builder

- Cible unique **NSIS x64** (Windows 11 uniquement, cf. PRD).
- `extraResources` pour le shim CLI, script NSIS personnalisé pour la modification du `PATH` utilisateur et l'enregistrement des verbes du menu contextuel à l'install, leur retrait à la désinstallation.
- **Signature de code** : sans certificat, SmartScreen affiche un avertissement à chaque installation. Tolérable pour un usage personnel, bloquant à la publication open-source (voir la section coûts).

### electron-updater

Publication via GitHub Releases sur un dépôt public. `checkForUpdatesAndNotify` au démarrage, téléchargement en arrière-plan, application au redémarrage. Deux réserves :
- Une mise à jour ne doit **jamais** s'appliquer pendant qu'un pane tourne — l'installation est proposée, jamais forcée.
- Sans signature, l'auto-update fonctionne mais chaque mise à jour hérite du même avertissement SmartScreen.

### Intégration continue

Deux workflows, `.github/workflows/` :

| Workflow | Déclencheur | Rôle |
|---|---|---|
| `ci.yml` | PR, push hors branche par défaut | build, tests, **et packaging de l'installeur** |
| `release.yml` | push sur `main`, dispatch | build, tests, packaging, publication conditionnelle |

Les deux tournent sur `windows-latest` : ce qui casse ici, ce sont `node-pty` et les chemins Windows, les tester sur Linux ne prouverait rien. `ci.yml` package l'installeur en plus des tests parce que la chaîne electron-vite → electron-builder échoue sur des choses qu'aucun test unitaire ne voit — `asarUnpack`, `extraResources`, le script NSIS.

`release.yml` ne se déclenche pas sur les tags. Le `package.json` est la seule source de vérité sur la version : un tag `v0.2.0` poussé sur un arbre où `package.json` dit `0.1.0` ferait tourner un build Windows complet pour conclure que `0.1.0` est déjà publiée.

Les deux jobs lancent `npm run build` **avant** electron-builder. Ce n'est pas une vérification redondante avec les tests : `out/` est gitignoré et n'est produit que par `electron-vite build`. Sans cette étape, le `files: out/**` d'electron-builder ne matche rien et le packaging s'arrête sur « Application entry file app.asar does not exist » — un pipeline qui ne publie jamais rien.

**Le point de conception de `release.yml`** est son étape `Gate`. `electron-builder --publish always` n'échoue pas devant une release déjà existante : `getOrCreateRelease` la réutilise — et en écrase les assets — si elle a moins de deux heures, et abandonne avec un simple warning au-delà. Publier à chaque push sans condition donnerait donc, selon l'heure, soit l'écrasement silencieux d'un installeur déjà distribué, soit un run vert qui n'a rien publié. Et côté client, electron-updater ne compare que des semver : republier la même version ne déclenche aucune mise à jour.

La règle est donc : **on publie si et seulement si `v<version>` n'a pas encore de release publiée**. Un push sur `main` publie quand le `version` du `package.json` a été incrémenté, et à ce moment-là seulement. Le job devient idempotent — un re-run ne peut ni dupliquer ni corrompre une release.

Cette règle seule ouvrirait pourtant un piège : un run qui échoue *après* la création de la release laisserait une release vide, que le garde-fou refuserait ensuite de reprendre. D'où le passage par un brouillon (`releaseType: draft`), qui est aussi le workflow recommandé par electron-builder : la CI crée la release en brouillon, téléverse, puis la promeut (`gh release edit --draft=false --latest`). Un brouillon est exclu de `/releases/latest`, donc aucun client ne voit jamais une release à moitié téléversée ; et comme `getOrCreateRelease` réutilise un brouillon existant, un run interrompu est repris par le suivant au lieu de bloquer la version. Le `Gate` traite donc « brouillon » comme « pas encore publié », jamais comme « déjà fait ».

`latest.yml` est téléversé au même titre que le `.exe` : c'est le fichier que l'app interroge. Une release qui n'en contient pas est installable à la main et invisible pour l'updater. L'étape de promotion le vérifie donc explicitement avant de rendre la release publique — et elle exige que l'asset soit en état `uploaded`, un téléversement interrompu laissant un asset qui porte son nom sans être téléchargeable. Les chemins d'upload d'electron-builder sortent en code 0 quand ils renoncent : sans ce contrôle, un run vert pourrait marquer « latest » une release vide.

Le garde-fou refuse aussi une version qui ne serait pas strictement supérieure à la plus haute déjà publiée. `make_latest` est posé sans condition à la promotion : publier une version inférieure — un revert du champ `version`, un correctif poussé depuis une branche de maintenance — ferait pointer `/releases/latest` sur l'ancienne release, et tout le parc cesserait silencieusement de voir des mises à jour. Le champ `version` est enfin validé contre un `X.Y.Z` strict avant tout usage — faute de quoi une valeur absente produirait une release `vundefined`. Les préversions sont refusées : rien ici ne définit de canal de préversion et la promotion pose `make_latest`, si bien qu'un `1.0.0-beta.1` publié partirait vers tout le parc. Les refuser supprime au passage toute comparaison d'ordre entre préversions, dont les règles sont un nid à bugs — comparer `beta.10` et `beta.9` comme des chaînes donne la mauvaise réponse.

`make_latest` est recalculé au moment de la promotion, pas repris du garde-fou : cinq minutes de build les séparent, et si une version supérieure a été publiée entre-temps, la release est quand même publiée mais sans être marquée « latest ».

Deux limites connues, sans effet à l'échelle actuelle. La pagination du garde-fou (100 par page) est plus large que celle d'`getOrCreateRelease`, qui ne lit que la première page de `/releases` : passé une trentaine de releases, le garde-fou peut voir un brouillon qu'electron-builder ne verra pas, et « reprendre le brouillon » deviendrait « en créer un second avec le même tag ». Et GitHub ne conserve qu'un seul run en attente par groupe de concurrence : trois incréments de version en moins d'un build verraient celui du milieu annulé, à rejouer via `workflow_dispatch`.

Le `publish` de `electron-builder.yml` (`owner: gganster`, `repo: myterm`) est aussi la source de l'`app-update.yml` embarqué dans le paquet : il désigne le dépôt interrogé par l'app installée, pas seulement la cible du téléversement. Le déplacer sans le mettre à jour couperait les mises à jour de toutes les versions déjà installées.

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

### ADR-002 — `node-pty` officiel, sans étape de rebuild

> **Révisé le 2026-08-22 après vérification empirique.** La version initiale de cet ADR affirmait qu'un rebuild contre l'ABI Electron était nécessaire et que VS Build Tools était un prérequis. **C'est faux pour `node-pty` 1.1.0.** Les mesures ci-dessous remplacent cette hypothèse.

- **Contexte** : il faut de vrais PTY Windows (ConPTY) pour que Claude Code, `npm run dev` et `git rebase -i` se comportent normalement.
- **Décision** : `node-pty` 1.1.0 officiel, installé tel quel. **Aucun `electron-rebuild`, aucun `postinstall`.**
- **Alternatives** : `@lydell/node-pty` (fork prebuilt) ; `child_process.spawn` avec des pipes.
- **Rationale** : `spawn` est éliminé d'office — sans PTY, pas de couleurs, pas de redimensionnement, et les CLI interactifs se comportent comme s'ils écrivaient dans un fichier. Quant au rebuild, la mesure le rend inutile : `node-pty` 1.1.0 embarque des binaires N-API dans `prebuilds/win32-x64/`, et **le même fichier `pty.node` se charge sous Node 24 (ABI 137) et sous Electron 43 (ABI 148)**. Le fork prebuilt perd donc sa raison d'être : l'officiel n'impose plus aucune toolchain.
- **Conséquences** :
  - La barrière à la contribution disparaît — un `npm install` suffit, sans Visual Studio ni Python.
  - `electron-builder install-app-deps` est **retiré** du `postinstall` : il échoue sur `MSB8040` (bibliothèques Spectre absentes) en tentant de recompiler `deps/winpty`, la couche legacy pré-ConPTY dont nous n'avons pas l'usage.
  - `asarUnpack` de `node-pty` reste requis au packaging (T18) : un `.node` ne se charge pas depuis une archive asar.

**Comportement mesuré du kill (2026-08-22).** Sous Electron, la fermeture d'un PTY fait échouer le helper `conpty_console_list_agent` de node-pty avec `AttachConsole failed` — il n'a pas de console à attacher dans un process GUI. node-pty tombe alors dans son timeout de 5 s et se rabat sur « ne tuer que le shell ».

Cela laissait craindre que les processus enfants (le `node.exe` derrière un `npm run dev`) survivent à la fermeture d'un pane. **Mesure faite sur trois stratégies — `pty.kill()` seul, `pty.kill()` + `taskkill /T /F`, et `useConptyDll` — les trois tuent l'enfant.** La destruction du pseudoconsole ConPTY suffit à terminer l'arbre attaché. Retenu : `useConpty: true` + `pty.kill()` simple, sans `taskkill`. L'erreur `AttachConsole` est du bruit cosmétique sur stderr d'un process transitoire, invisible dans l'application packagée.

### ADR-003 — Flux responsive plutôt qu'une grille N×M déclarée

- **Contexte** : la v1 déclarait une grille `cols × rows` et une position absolue `{col, row}` par pane. À l'usage, deux choses ont fait céder ce modèle : décrire une grille à la main pour six panes est laborieux, et surtout une grille figée ne survit pas au redimensionnement — un layout 3×2 confortable en plein écran devient six colonnes de trente caractères sur une fenêtre demi-écran.
- **Décision** : le fichier ne décrit plus que *quels* panes existent et dans quel ordre. Le nombre de panes par ligne est une fonction de la largeur disponible : `> 1600 px → 3`, `> 1200 px → 2`, sinon `1`, jamais plus que le nombre de panes. Les panes en excédent passent à la ligne suivante ; les lignes gardent une hauteur minimale de 200 px et la zone défile plutôt que d'écraser tous les terminaux.
- **Alternatives** : garder la grille déclarée avec un mode responsive optionnel (deux modèles à maintenir, et le fichier reste pénible à écrire) ; arbre de splits redimensionnables façon tmux (sérialisation imbriquée, redimensionnement en cascade, drag de séparateurs — plusieurs jours pour un besoin non exprimé).
- **Rationale** : la largeur est une propriété de la fenêtre, pas du projet. La mettre dans un fichier commité, c'est demander à l'utilisateur de la maintenir à la main à chaque changement d'écran. Le format y gagne aussi : un pane se décrit en une ligne, et l'ordre est la seule chose à comprendre pour éditer le fichier à la main — ce qui reste un objectif du PRD.
- **Conséquences** : pas de panes de tailles inégales, ni de disposition figée reproductible au pixel près. La largeur est mesurée sur la *zone de panes* et non sur la fenêtre, pour que l'ouverture de l'éditeur de layout (320 px) refasse couler les panes comme le ferait une fenêtre plus étroite. La mesure se fait sur la border-box : mesurer la content-box laisserait une barre de défilement apparue à un seuil retirer une colonne, ce qui ferait disparaître la barre, ce qui remettrait la colonne. Le schéma passe en `version: 2` avec migration automatique v1 → v2 — c'est exactement le cas prévu par le champ `version`.

### ADR-004 — Trust prompt sur les projets inconnus

- **Contexte** : le `.myterm.json` est commité dans le repo (choix du PRD, pour le partage d'équipe). Ouvrir un repo cloné exécuterait ses commandes d'autolaunch.
- **Décision** : approbation explicite à la première ouverture d'un chemin inconnu ; mode « panes vierges » en alternative ; ré-approbation si les commandes changent.
- **Alternatives** : ne rien faire (l'utilisateur est seul sur sa machine) ; config centralisée hors du repo (rejetée par le PRD).
- **Rationale** : c'est le prix de la décision produit de commiter le fichier. Le coût est d'une boîte de dialogue vue une fois par projet ; le risque évité est l'exécution de code arbitraire au clic. VS Code a exactement ce mécanisme pour exactement cette raison.
- **Conséquences** : une friction minime au premier lancement, et une décision de sécurité prise avant l'open-sourcing plutôt qu'après un rapport de vulnérabilité. Limite assumée et documentée : une sauvegarde depuis l'éditeur réapprouve les commandes sans redemander, ce qui borne la garantie au contenu de dépôt hostile et non à un renderer compromis.

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
│   ├── installer.nsh            # PATH utilisateur + shim CLI + menu contextuel
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
    │   │   ├── usage.ts         # quota Claude — seul endroit qui voit le jeton
    │   │   ├── load-monitor.ts  # échantillonnage CPU/RAM
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
        │   └── ui/              # primitives partagées
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
5. CSS Grid, `TerminalRegistry`, dispose propre au démontage. *(La grille `cols × rows` de cette étape a été remplacée depuis par le flux responsive d'ADR-003.)*
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
18. electron-updater + GitHub Releases, workflows CI (`ci.yml`) et release conditionnelle (`release.yml`).
19. Deux semaines de dogfooding exclusif, puis publication MIT — et revalidation de l'heuristique BEL sur usage réel.

---

## Risques ouverts

| Risque | Impact | Mitigation |
|---|---|---|
| ~~`electron-rebuild` de node-pty échoue sans VS Build Tools~~ | — | **Levé le 2026-08-22** : prebuilds N-API, aucun rebuild nécessaire (ADR-002 révisé) |
| Claude Code n'émet pas le BEL de façon fiable | Le badge `attention`, feature 4 du PRD, perd sa valeur | Vérifier empiriquement dès la Phase 2, avant de construire l'UI autour |
| Contextes WebGL épuisés sur grandes grilles | Terminaux noirs | Fallback canvas implémenté en Phase 2 |
| `.myterm.json` commité avec des chemins spécifiques à une machine | Conflits git récurrents | Surcharge `.myterm.local.json` non versionnée — question ouverte du PRD, à trancher au premier conflit réel |
| SmartScreen bloque l'installation chez les premiers utilisateurs | Frein à l'adoption OSS | Demande SignPath Foundation en amont de la publication |
