---
type: brief
slug: migration-rust
title: Migration de MyTerm d'Electron vers Rust natif, à fonctionnalités identiques
status: ready
created: 2026-10-17
next_action: Livre MyTerm en Rust natif, sans webview, qui remplace la 0.5.0 Electron par sa mise à jour automatique sans rien perdre
resume_cmd: /ship docs/brief/migration-rust
---

# Migration de MyTerm d'Electron vers Rust natif, à fonctionnalités identiques

Les chemins sont relatifs à `Desktop/MyTerm/`. La référence fonctionnelle est
MyTerm Electron 0.5.0 (`MyTerm(electron)/`, commit `4b26d25`) : son
`README.md`, son `PRD.md`, son `ARCHI.md` et ses tests décrivent le
comportement à reproduire.

## Problem

MyTerm ouvre une fenêtre par projet, et chaque fenêtre est un processus
Electron complet, avec son Chromium. Avec 2 à 5 projets ouverts dans la
semaine, l'utilisateur paie en mémoire et en temps d'ouverture pour une
application qui n'affiche que des terminaux. L'installeur embarque lui aussi
un navigateur entier. Aujourd'hui, ces coûts n'ont pas été mesurés : la
première tâche les relève.

## Users

- Guilian, utilisateur principal : 3 agents Claude, plus les serveurs de dev, sur 2 à 5 projets ouverts en parallèle, Windows 11, PowerShell.
- Les utilisateurs déjà installés en 0.5.0, mis à jour automatiquement, qui ne doivent rien remarquer à part la vitesse.
- Le développeur qui découvre le dépôt et clone un projet qui contient un `.myterm.json`.

## Goals

- Une fenêtre MyTerm coûte nettement moins de mémoire et s'ouvre plus vite qu'en Electron.
- Rien de ce que fait la 0.5.0 ne disparaît, et rien ne change de comportement.
- La bascule se fait par la mise à jour automatique, sans réinstallation et sans perte de données.

## Acceptance criteria

Chaque critère se vérifie en utilisant l'application. Le comportement attendu
est celui de la 0.5.0, détaillé dans `MyTerm(electron)/README.md`.

- AC1 **Le fichier `.myterm.json`** est lu exactement comme en 0.5.0 : JSON strict, version 2, un fichier `version: 1` converti dans le sens de lecture, un `version: 2` qui garde des `col`/`row` refusé avec un message, des `cwd` qui ne peuvent pas sortir de la racine du projet, et les mêmes messages d'erreur pour un fichier invalide. Une sauvegarde réécrit le fichier entier, et seulement après une modification. Une édition faite en dehors de l'application lève une bannière de rechargement au lieu d'être appliquée sans prévenir.
- AC2 **Ouvrir un projet** de 6 panes démarre chaque shell (`pwsh` par défaut, ou celui qui est déclaré) dans son `cwd`, et lance chaque commande d'autolaunch. Un pane sans `command` démarre sur un shell vierge.
- AC3 **Contrôle de confiance** : à la première ouverture d'un projet inconnu, un dialogue liste chaque commande avec son dossier et propose trois choix : approuver, ouvrir sans exécuter, annuler. Modifier une commande redemande l'approbation, renommer ou déplacer un pane ne la redemande pas. Les approbations données en 0.5.0 sont reconnues. Aucune porte d'entrée (CLI, menu contextuel, projets récents, rechargement) ne lance une commande sans passer par ce contrôle.
- AC4 **Grille** : 3 terminaux par ligne au-delà de 1600 px de large, 2 au-delà de 1200 px, 1 en dessous. Les lignes gardent une hauteur lisible et la zone défile. `Ctrl+Shift+Z` agrandit le pane et `Échap` le réduit, `Ctrl+Shift+←↑→↓` déplace le focus, `Ctrl+Shift+1..9` donne le focus au n-ième pane, même réduit.
- AC5 **Terminal** : `claude`, `codex`, `pwsh`, `npm run dev` et les TUI courants s'affichent et réagissent comme dans la 0.5.0 (couleurs, curseur, redimensionnement transmis au processus, 5000 lignes de scrollback). Les palettes ANSI claire et sombre sont les mêmes. `Ctrl+Shift+C` copie la sélection et ne fait rien quand rien n'est sélectionné. `Ctrl+Entrée` envoie un saut de ligne nu. `Ctrl+C`, `Ctrl+D`, `Ctrl+L`, `Ctrl+R` et `Échap` ne sont jamais interceptés.
- AC6 **Badge d'activité** : chaque pane affiche en cours, inactif, terminé ou en attente. L'état « en attente » se déclenche sur `BEL`, et à défaut sur l'heuristique de silence. C'est le seul état mis en avant.
- AC7 **Réduire un pane** : le bouton `⤓` ou `Ctrl+Shift+M` envoie le pane dans la barre du bas, et son processus continue de tourner. Le survol de l'onglet montre le nom du pane et sa dernière commande lancée. Un pane terminé y passe en rouge. `"collapsed": true` ouvre le pane réduit, mais réduire ou déplier ensuite ne marque pas le workspace comme modifié.
- AC8 **Thème et couleurs** : `light`, `dark` et `system` sont gérés, avec la bascule de thème. Les 8 couleurs de contour de pane ont deux variantes, une par thème. La couleur d'instance teinte la barre du haut, affiche le nom du projet sur une pastille, colore l'icône de la barre des tâches et donne à la fenêtre son propre bouton (un bouton partagé par couleur). Sans couleur, la fenêtre est regroupée avec les autres.
- AC9 **Éditeur de layout intégré** : il édite tout ce que l'éditeur de la 0.5.0 édite (panes, ordre, titre, `cwd`, commande, couleur, *Démarrer réduit*, couleur d'instance, `∅`). La sauvegarde automatique se fait environ une seconde après la modification, et `Ctrl+S` force la sauvegarde. Un changement de couleur ne redémarre aucun shell.
- AC10 **Accueil et outils** : l'écran d'accueil montre les projets récents et propose *Ouvrir un dossier…*. *Ouvrir dans l'éditeur* propose les mêmes éditeurs, cherchés dans leurs emplacements d'installation connus, et lancés sans shell. La bannière de mise à jour se comporte comme en 0.5.0.
- AC11 **Plusieurs instances** : chaque `myterm .` ouvre son propre processus et sa propre fenêtre, en cascade. Les projets récents et les approbations sont partagés entre instances sans qu'une instance efface ce qu'une autre a écrit. La géométrie de la fenêtre et le thème sont restaurés.
- AC12 **Barre de statut** : elle affiche les quotas Claude (logo et barres orange) et Codex (logo et barres vertes) par fenêtre glissante, avec le délai avant réinitialisation, et une barre rouge au-delà de 90 %. Les jetons sont lus dans `~/.claude/.credentials.json` et `~/.codex/auth.json`. Une CLI non connectée est signalée sans masquer l'autre. Le relevé a lieu toutes les 2 minutes, avec un recul en cas de limitation. Le dernier relevé reste affiché avec `⋯` pendant 15 minutes. Un refus anti-bot est réessayé sous 20 secondes. La barre montre aussi le CPU et la RAM. Un jeton n'apparaît jamais dans un log, un message d'erreur ou l'interface.
- AC13 **Intégration Windows** : l'installeur est par utilisateur, sans élévation, et ne laisse pas choisir une installation pour tous les utilisateurs. Le shim `myterm` est ajouté à la fin du `PATH` utilisateur. Les deux entrées du menu contextuel sont présentes (*Ouvrir dans MyTerm*, *Ouvrir MyTerm ici*). La désinstallation retire tout cela.
- AC14 **Bascule transparente** : une installation 0.5.0 réelle détecte la version Rust par sa mise à jour automatique, l'installe et redémarre dessus. L'utilisateur retrouve ensuite une seule entrée dans *Applications installées*, les raccourcis existants et le bouton épinglé qui lancent la version Rust, le shim PATH, le menu contextuel, les projets récents, les approbations et la géométrie de la fenêtre. Aucune trace de l'installation Electron ne subsiste.
- AC15 **Mises à jour suivantes** : la version Rust se met à jour depuis les Releases GitHub. Une seule instance vérifie, l'installation passe par la bannière, et elle ferme toutes les fenêtres.
- AC16 **Surface réseau et sécurité** : l'application ne fait que deux types de connexions sortantes, vers GitHub pour les mises à jour et vers les endpoints d'usage Claude et Codex. Elle ne charge aucun contenu distant.

## Success metrics

Les mesures se font sur la même machine, avec le même projet de 6 panes et le
même protocole, en 0.5.0 Electron (relevé de référence en T01) puis en Rust :

- taille de l'installeur ;
- mémoire d'une fenêtre ouverte sur ce projet (processus de l'application, sans les shells ni leurs enfants) ;
- temps entre `myterm .` et 6 panes affichés avec leurs commandes lancées. Le PRD exige déjà moins de 5 secondes ;
- temps d'ouverture d'une deuxième fenêtre.

La version Rust doit faire mieux sur chacun de ces quatre chiffres. Des cibles
chiffrées seront fixées après le relevé de référence. Côté parité, il faut
deux semaines d'usage quotidien sans retour à la version Electron, et tous les
cas de test portés depuis `MyTerm(electron)/tests/` doivent passer.

## Out-of-scope

- Toute nouvelle fonctionnalité, et toute modification du format de `.myterm.json` ou de `preferences.json`.
- Une refonte visuelle. L'interface reprend la disposition, les libellés et les couleurs de la 0.5.0.
- macOS et Linux.
- La signature de code, MSIX, et les entrées dans le menu contextuel compact de Windows 11.
- Une webview ou Tauri. L'utilisateur a choisi le 100 % natif.
- Les évolutions de la version Electron, gelée pendant la migration.

## Constraints and assumptions

- **100 % natif Rust, sans webview** (décision de l'utilisateur, 2026-10-17). Quatre choix restent ouverts et relèvent d'une proposition technique, pas de ce brief : le framework d'interface, l'émulateur VT, l'accès à ConPTY et le moteur de rendu. C'est là que se joue AC5.
- **Les formats ne changent pas** : le schéma `.myterm.json` (`MyTerm(electron)/src/shared/schema/`), `preferences.json`, et l'empreinte de confiance (`src/shared/trust-hash.ts`) doivent être identiques bit pour bit. Sinon, les approbations de la 0.5.0 seraient perdues (AC3, AC14).
- **Le dossier de données** est celui d'Electron (`app.getPath('userData')`, qui contient `preferences.json`, `instances/` et `instance-icons/`). Hypothèse : `%APPDATA%\MyTerm`. Le chemin exact est à relever sur une installation 0.5.0 en T01.
- **L'identité Windows** reste `appId` / AppUserModelID `dev.gganster.myterm` (`MyTerm(electron)/src/main/util/app-id.ts`, `electron-builder.yml`), pour que les boutons épinglés et les raccourcis continuent de pointer vers l'application.
- **Le canal de mise à jour** : la 0.5.0 interroge les Releases de `gganster/myterm` avec `electron-updater` 6.x (`latest.yml`, installeur NSIS). La première version Rust doit y être publiée en `X.Y.Z` strictement supérieur à `0.5.0`, avec un `latest.yml` et un installeur que cet updater accepte et sait lancer. Non vérifié, à confirmer en T01 dans le code d'`electron-updater` : son format de `latest.yml`, la vérification sha512, les arguments passés à l'installeur, et la clé de désinstallation dérivée de l'`appId` que le nouvel installeur doit reprendre ou nettoyer.
- **Plateforme** : Windows 11 x64, installation par utilisateur, aucune élévation.
- **L'Electron est gelé** : il ne reçoit que des correctifs jusqu'à la bascule.
- À la bascule, `MyTerm(rust)/` remplace le contenu de `main` sur `gganster/myterm` (décision du 2026-10-17). L'Electron reste figé au tag `v0.5.0`. La pile retenue est décrite dans `docs/proposals/0001-stack-rust-natif/PROPOSAL.md`.

## Boundary

Owns:
- `MyTerm(rust)/`

Must not touch:
- `MyTerm(electron)/` (référence en lecture seule ; ses correctifs éventuels se font hors de ce brief)
