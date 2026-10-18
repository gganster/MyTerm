---
proposal_id: "0001"
slug: "stack-rust-natif"
title: "Pile Rust native de MyTerm et bascule depuis Electron 0.5.0"
status: Accepted
format: standard
author: "gganster"
created: "2026-10-17"
updated: "2026-10-17"
stepsCompleted: [init, context, problem, alternatives, design, risks, recommendation, impl-plan, review, finalize]
resume_cmd: "/ship docs/proposals/0001-stack-rust-natif"
scope_path: "MyTerm(rust)/"
source_brief: "docs/brief/migration-rust/"
auto_mode: false
skip_review: true
---

# 0001 : Pile Rust native de MyTerm et bascule depuis Electron 0.5.0

Les chemins sont relatifs à `Desktop/MyTerm/`. La référence fonctionnelle est
le brief `docs/brief/migration-rust/` (AC1 à AC16).

## 1. Résumé

**Problème.** Le brief impose du 100 % natif Rust. Il laisse ouverts le
framework d'interface, l'émulateur de terminal, l'accès à ConPTY et le rendu,
ainsi que la façon dont la 0.5.0 se remplace elle-même.

**Recommandation.** iced 0.14 pour l'interface, et le widget `iced_term` 0.8
pour les terminaux (il s'appuie sur `alacritty_terminal`, qui accède
lui-même à ConPTY). On garde un processus par projet, comme aujourd'hui.
L'installeur est en NSIS écrit à la main et reprend l'identité Windows exacte
de la 0.5.0 (clé de désinstallation, dossier, AppUserModelID, nom de l'exe).
Le premier `latest.yml` est donc consommé tel quel par `electron-updater`.
Ensuite, un updater Rust minimal lit ce même `latest.yml`.

**Impact.** La couche IPC et le batching de sortie disparaissent, et tout le
front est réécrit. Un spike de mesure (P01) conditionne le reste : il vérifie
que la cible d'empreinte est atteinte avant d'écrire le moindre écran.

## 3. Problème et motivation

Chaque `myterm .` lance un processus Electron complet
(`MyTerm(electron)/src/main/index.ts:16-37`). L'installation 0.5.0 relevée
sur la machine de développement occupe **369 Mo** (`EstimatedSize` = `0x5c4fe`
Ko dans `HKCU\…\Uninstall\bb20937c-569f-5a89-9956-bcc0a0242b0b`). La mémoire
par fenêtre et le temps d'ouverture n'ont pas encore été mesurés (T01 du
brief).

L'implémentation sera faite par un agent : l'utilisateur ne connaît pas Rust.
Un framework peu documenté, ou dont l'API bouge sans cesse, coûte donc plus
cher qu'un framework un peu moins performant.

## 4. Objectifs et non-objectifs

Objectifs :
- Une fenêtre de 6 panes coûte moins de RAM et s'ouvre plus vite qu'en 0.5.0, mesuré avec le protocole de T01.
- La parité exigée par AC1 à AC16 s'obtient en assemblant des briques existantes, sans écrire d'émulateur VT ni de moteur de rendu.
- La 0.5.0 se met à jour vers la version Rust sans intervention.

Non-objectifs :
- Une architecture multi-plateforme. Windows 11 x64 seulement.
- La réutilisation de l'UI React : le brief exclut toute webview.
- Le retour automatique vers Electron. Option « aller simple » choisie par l'utilisateur.

## 5. Alternatives envisagées

| Option | Verdict |
|---|---|
| Statu quo Electron | Rejeté par le brief. Il coûte 369 Mo installés et un Chromium par fenêtre. |
| **iced 0.14 + `iced_term` 0.8** | **Retenu.** Le widget terminal existe et a été testé sous Windows. L'architecture Elm est régulière et facile à générer. Deux rendus sont disponibles (wgpu, tiny-skia). |
| egui + `egui_term` | Le widget s'appuie sur egui 0.31 et son auteur écrit qu'il n'est « pas testé sous Windows ». En mode immédiat, toute l'interface est reconstruite à chaque frame, donc à chaque sortie de six terminaux actifs. C'est sans mise en cache par widget, contrairement au `canvas::Cache` d'`iced_term`. |
| gpui (Zed) + élément terminal inspiré de Zed | Meilleur rendu de texte (DirectWrite), mais pas de version publiable à jour sur crates.io (seulement la 0.2.2 de 2025-10, avant la séparation de la plateforme, ou des instantanés non officiels). La documentation se résume à « lire le code de Zed ». C'est le pire cas pour du code généré. |
| winit + wgpu + rendu sur mesure | Rendu de glyphes, layout et widgets seraient à écrire. Plusieurs mois pour retrouver l'éditeur de layout et les dialogues. |
| Slint | Pas de widget terminal : la grille de cellules serait à peindre à la main. On cumule le coût de l'option sur mesure et celui d'un DSL. |
| Tauri | Exclu par le brief (pas de webview). |

Ce qui ferait changer d'avis : si le spike P01 montre qu'iced en wgpu **et**
en tiny-skia dépasse la RAM de la 0.5.0, ou qu'`iced_term` ne peut pas
laisser passer les accords `Ctrl+Shift+*` à l'application, il faudra
réévaluer gpui avec une dépendance git épinglée.

Sources : crates.io `iced_term` 0.8.0 (mise à jour 2026-03-27, iced ^0.14,
alacritty_terminal ^0.25.1, « tested on MacOS, Linux and Windows ») ;
crates.io `egui_term` ; crates.io `gpui` (0.2.2, 2025-10-22) et
zed-industries/zed discussion #55271 (2026-04-30) ; docs.rs `iced` 0.14.0
(wgpu DX12/Vulkan, tiny-skia en repli).

## 6. Conception retenue

### Processus et données

- **Un processus par projet**, comme en 0.5.0. Les instances se coordonnent par fichiers, sans serveur ni verrou global. On porte tel quel le registre `instances/` avec battement de cœur, la fusion de `preferences.json` sous verrou et l'écriture atomique (`src/main/services/instances.ts`, `src/shared/schema/preferences-merge.ts`, `src/main/util/atomic-write.ts`).
- **Pas d'IPC.** `src/shared/ipc-contract.ts` et `src/preload/` n'ont pas d'équivalent. L'invariant de sécurité n° 3 du README devient une règle de code : `workspace::spawn_autolaunch` est le seul appelant qui transmet une `command` au PTY, et il exige un `TrustDecision::Approved`.
- **Le dossier de données est inchangé** : `%APPDATA%\MyTerm`. On y a observé `preferences.json` et `instances/`, plus les dossiers de Chromium.
- **Pas de batching de sortie.** `output-batcher.ts` existait pour ne pas noyer l'IPC (ADR-005). Ici, `alacritty_terminal` émet `Event::Wakeup` et iced redessine à la demande.

### Modules (une seule crate binaire `myterm`)

| Module | Porte | Contenu |
|---|---|---|
| `schema` | `src/shared/schema/*` | serde + validation à la main, mêmes messages que `format-error.ts`, migration v1, édition du layout |
| `trust` | `src/shared/trust-hash.ts`, `services/trust.ts` | SHA-256 du même JSON (`id, cwd, shell, command`, triés par `id`) |
| `prefs`, `instances`, `atomic` | `services/preferences.ts`, `instances.ts`, `util/atomic-write.ts` | fusion, verrou, cascade des fenêtres |
| `workspace` | `services/open-workspace.ts`, `workspace*.ts`, `util/resolve-cwd.ts` | ouverture, confiance, surveillance (`notify`), autosave |
| `term` | `renderer/terminal/*`, `theme/palette.ts` | `iced_term` : palettes clair/sombre, Cascadia Mono 13, liaisons `Ctrl+Entrée` → `\n` et `Ctrl+Shift+C`, capture de la dernière commande |
| `status` | `services/pane-status-machine.ts` | `Event::Bell` → en attente, `Event::ChildExit` → terminé, horodatage des `Wakeup` → heuristique de silence |
| `usage`, `load` | `services/usage-*.ts`, `load-monitor.ts`, `shared/quota.ts` | client HTTP bloquant dans un thread, recul, dégradation, `sysinfo` |
| `identity` | `services/instance-identity.ts`, `util/logo-icon.ts`, `util/app-id.ts` | icône ICO générée par du code pur, AppUserModelID par fenêtre via `HWND` (`iced::window::run`) et `SHGetPropertyStoreForWindow` |
| `editor` | `services/external-editor.ts` | mêmes emplacements connus, lancement sans shell |
| `updater` | `services/updater.ts` | voir ci-dessous |
| `ui` | `renderer/components/*`, `hooks/*` | accueil, grille, en-têtes et badges, barre des panes réduits, éditeur de layout, dialogue de confiance, bannières, barre de statut, raccourcis |

Les tests Vitest deviennent des tests `cargo test` avec les mêmes cas. Ceux de
`tests/schema/`, `trust-hash`, `preferences-merge`, `atomic-write`,
`responsive-grid`, `quota` et `pane-status-machine` constituent la
spécification.

### Identité Windows : la condition de la bascule

L'installeur NSIS est écrit à la main, sans electron-builder (il exige
Electron) et sans MSI (`electron-updater` lance l'exécutable téléchargé
directement). Il reproduit ce qui a été relevé sur l'installation 0.5.0 :

- dossier `%LOCALAPPDATA%\Programs\MyTerm\`, exécutable `MyTerm.exe`, désinstalleur `Uninstall MyTerm.exe` (ces noms sont utilisés par les raccourcis, le shim `resources/myterm.cmd` et la clé de désinstallation) ;
- `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\bb20937c-569f-5a89-9956-bcc0a0242b0b` (mêmes valeurs, `DisplayVersion` mis à jour), et `HKCU\Software\bb20937c-…` avec `InstallLocation` ;
- raccourcis avec l'AppUserModelID `dev.gganster.myterm` ;
- les macros `customInstall` / `customUnInstall` de `build/installer.nsh` (PATH, `HKCU\Software\MyTerm\InstallDir`, menu contextuel), reprises telles quelles.

Si `InstallLocation` existe, l'installeur commence par lancer l'ancien
désinstalleur comme le fait electron-builder :
`"Uninstall MyTerm.exe" /S /KEEP_APP_DATA --updated _?=<dir>`
(`app-builder-lib/templates/nsis/include/installUtil.nsh:205-230`). Avec
`--updated`, l'ancien désinstalleur ne touche ni au PATH ni au menu
contextuel (`build/installer.nsh:110`). Le nouvel installeur les réécrit
quand même : l'opération est idempotente. Il supprime ensuite de
`%APPDATA%\MyTerm` la liste fermée des dossiers Chromium (`Cache`, `Code Cache`,
`GPUCache`, `Dawn*Cache`, `Local Storage`, `Session Storage`, `Network`,
`blob_storage`, `Shared Dictionary`, `SharedStorage`, `DIPS`, `Local State`,
`Preferences`, `DevToolsActivePort`). Il ne touche ni à `preferences.json`, ni à
`instances/`, ni à `instance-icons/`.

L'installeur accepte `--updated`, `/S` et `--force-run` (relance l'application
à la fin) : ce sont les arguments que passe `electron-updater` 6.8.9
(`NsisUpdater.js:107-113`). La 0.5.0 appelle `quitAndInstall(false, true)`,
donc l'installation n'est pas silencieuse mais relance l'application.

### Publication et mise à jour

- La CI construit `MyTerm-<version>-setup.exe` et génère `latest.yml` (`version`, `files[{url, sha512, size}]`, `path`, `sha512`, `releaseDate`, avec le sha512 en base64). Elle garde les garde-fous de `.github/workflows/release.yml` : version strictement supérieure, brouillon, puis publication. Aucun `.blockmap` n'est publié : sans lui, `electron-updater` retombe sur un téléchargement complet (inféré de `NsisUpdater.js:47-50`, à vérifier en P09).
- Première version Rust : **0.6.0** par défaut (parité, sans nouveauté), sur `gganster/myterm`.
- L'updater Rust lit `releases/latest/download/latest.yml`, compare les versions semver, télécharge, vérifie le sha512, puis attend la bannière. Une seule instance, l'élue du registre, vérifie. Au clic, il ferme toutes les fenêtres et lance l'installeur avec `--updated --force-run`. Le format reste celui d'electron-builder, ce qui laisse en état de marche toute 0.5.0 restée hors ligne.

## 7. Inconvénients et risques

- **Le front est entièrement réécrit.** C'est le coût du choix « 100 % natif ». L'éditeur de layout (384 lignes de React) et la barre de statut sont les plus gros morceaux.
- **iced et `iced_term` sont en version 0.x**, et `iced_term` annonce une « unstable widget API » avec un seul mainteneur. Parade : versions épinglées dans `Cargo.lock`. Si un besoin n'est pas exposé (capture de commande, accès à la grille), on copie le widget dans `src/term/` au lieu d'attendre l'amont.
- **Accords clavier.** Le widget terminal capte les touches. Il faut prouver que `Ctrl+Shift+←↑→↓/1..9/Z/M` et `Échap` (quand un pane est agrandi) remontent à l'application, et que `Ctrl+C/D/L/R` restent au shell. C'est vérifié en P01, pas supposé.
- **Empreinte non prouvée.** wgpu en DX12 a un coût fixe par processus, et il n'existe pas de chiffre fiable pour ce cas. P01 mesure wgpu et tiny-skia face à la référence de T01. Si aucun ne passe sous la 0.5.0, on s'arrête et on revient à la section 5.
- **Rendu du texte.** cosmic-text n'est pas ClearType. La différence de netteté avec xterm.js en WebGL est visible ou non selon les yeux : P01 compare des captures.
- **Empreinte de confiance.** Le TypeScript trie avec `localeCompare` (collation ICU), pas par octets. Pour des `id` qui diffèrent par la casse ou des caractères non ASCII, l'ordre peut changer, et donc le hash. L'échec reste sûr (on redemande l'approbation), mais il contredit AC3. Parade : P02 recalcule les hash présents dans le vrai `preferences.json` et reproduit la collation pour les cas qui divergent.
- **Aller simple.** Si une version Rust casse, réinstaller la 0.5.0 à la main ne suffit pas : elle se remettrait aussitôt à jour vers la version Rust, plus récente. Le seul retour arrière est donc une version corrective publiée. P09 doit être concluant **avant** la promotion en `latest`.
- **Test de bascule.** On le fait sans publier : dans une copie installée de la 0.5.0, à l'intérieur d'un Windows Sandbox, on remplace `resources/app-update.yml` (aujourd'hui `provider: github`) par un fournisseur `generic` qui pointe vers un serveur HTTP local.

Décisions prises après relecture :
- **Dépôt** (décision de l'utilisateur, 2026-10-17) : à la bascule, `MyTerm(rust)/` remplace le contenu de `main` sur `gganster/myterm`. L'Electron reste figé au tag `v0.5.0`, et le workflow `Release` et ses secrets sont conservés.
- **NSIS en CI** : il n'est pas présent sur l'image Windows Server 2025, donc sur `windows-latest`. Il a été retiré à la création de l'image (actions/runner-images PR #11037, issue #11754, et `Generate-SoftwareReport.ps1` qui l'exclut pour Win25). Chocolatey y est installé : le workflow lance `choco install nsis -y` avant `makensis`, et épingle la version.

## 9. Recommandation et justification

iced + `iced_term` est la seule option qui fournit déjà, sous Windows, un
terminal complet (ConPTY, sélection, défilement, palettes, liaisons) dans un
framework assez documenté pour un développement par agent. egui perd sur
deux points : il n'a pas été testé sous Windows, et il reconstruit toute l'interface à chaque frame.
gpui perd sur la distribution et la documentation. Les options sur mesure
perdent sur le délai.

La bascule repose sur des faits relevés, pas supposés : les arguments
d'installation (`NsisUpdater.js`), la désinstallation de l'ancienne version
(`installUtil.nsh`) et les clés de registre réelles. C'est le reproduire
fidèlement qui la rend transparente, pas un mécanisme nouveau.

**Confiance : moyenne.** Le design tient si P01 confirme trois choses :
l'empreinte, les accords clavier et un rendu acceptable. À revoir si P01
échoue, si iced 0.15 casse `iced_term` sans portage, ou si `electron-updater`
refuse l'installeur en P09.

## 10. Plan d'implémentation

Boundary : possède `MyTerm(rust)/` ; ne touche pas `MyTerm(electron)/`
(référence en lecture seule ; P09 modifie uniquement une copie installée dans
un Windows Sandbox).

| ID | Title | Files | Depends on | Effort |
|---|---|---|---|---|
| P01 | Spike gate: 6 `iced_term` panes running pwsh/claude, RAM and startup measured with wgpu vs tiny-skia against the T01 baseline, Ctrl+Shift chords reach the app, Ctrl+C/D/L/R stay in the shell, render screenshots | `MyTerm(rust)/spike/` | brief T01 | M |
| P02 | Pure core: `schema`, `trust`, `responsive-grid`, matching tests; hashes recomputed against the real `preferences.json` | `src/schema/`, `src/trust.rs`, `src/grid.rs`, `tests/` | P01 | L |
| P03 | Shared state: `prefs`, `atomic`, `instances` (merge under lock, heartbeat, cascade), matching tests | `src/prefs.rs`, `src/atomic.rs`, `src/instances.rs` | P02 | M |
| P04 | Terminal pane: `term` + `status` (palettes, bindings, copy, Ctrl+Enter, last-command capture, Bell/ChildExit/silence) | `src/term/`, `src/status.rs` | P01 | L |
| P05 | Workspace window: open flow, trust dialog, responsive grid, focus/zoom, collapsed bar, watcher and reload banner, autosave | `src/workspace.rs`, `src/ui/grid.rs`, `src/ui/trust.rs` | P02, P03, P04 | L |
| P06 | Chrome: home screen, layout editor, theme, pane and instance colours, `identity` (ICO + per-window AUMID), `editor` | `src/ui/`, `src/identity.rs`, `src/editor.rs` | P05 | L |
| P07 | Status bar: `usage` (Claude, Codex, backoff, 15-min degradation, anti-bot retry), `load`; tokens never logged | `src/usage/`, `src/load.rs`, `src/ui/status_bar.rs` | P05 | M |
| P08 | Distribution: NSIS script (0.5.0 identity, old-version uninstall, Chromium cleanup, `--updated/--force-run`), `latest.yml` generation, CI release with guardrails, Rust `updater` + banner | `installer/`, `.github/workflows/`, `src/updater.rs` | P06, P07 | L |
| P09 | Switch-over test: 0.5.0 installed in Windows Sandbox → `generic` provider → update to 0.6.0; AC14 checklist; final measurements | `docs/brief/migration-rust/` (report) | P08 | M |

Vérification : P02 et P03 en tests unitaires, avec les mêmes cas que Vitest.
P01, P04 à P07 et P09 se vérifient manuellement sur la vraie application, avec
les mesures du protocole T01 : ils dépendent de l'affichage et de ConPTY, que
les tests unitaires n'atteignent pas. P08 se vérifie par une installation, une
mise à jour et une désinstallation dans un Windows Sandbox.
