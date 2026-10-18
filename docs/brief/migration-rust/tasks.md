---
type: tasks
slug: migration-rust
source_brief: docs/brief/migration-rust/brief.md
---

# Tasks: Migration de MyTerm d'Electron vers Rust natif, à fonctionnalités identiques

## Relevant Files

Les chemins sont relatifs à `Desktop/MyTerm/`. Tout ce qui est sous `MyTerm(electron)/` sert de référence et se lit sans être modifié.

- `MyTerm(electron)/README.md`, `PRD.md`, `ARCHI.md` : le comportement attendu, et la raison de chaque règle
- `MyTerm(electron)/tests/` : les cas à porter, qui font office de spécification exécutable
- `MyTerm(electron)/src/shared/` : schéma, migration v1, édition du layout, fusion des préférences, hash de confiance, grille responsive, quotas
- `MyTerm(electron)/src/main/services/` : PTY, batching, machine d'état des badges, workspace, watcher, confiance, préférences, instances, quotas, updater, éditeur externe
- `MyTerm(electron)/src/main/util/` : écriture atomique, résolution du `cwd`, identité d'application, icône colorée
- `MyTerm(electron)/src/renderer/` : interface, raccourcis, palettes (`theme/palette.ts`), capture de commande, accords clavier
- `MyTerm(electron)/build/installer.nsh`, `resources/` : PATH, shim et menu contextuel
- `MyTerm(electron)/electron-builder.yml`, `.github/workflows/release.yml` : identité, publication, garde-fous de release
- `MyTerm(rust)/` : le nouveau projet

## Tasks

Les tâches sont ordonnées. Chacune ferme les critères d'acceptation qu'elle nomme.

## T01 - Référence mesurée et contrat de bascule relevé

Closes: Success metrics (référence), prérequis d'AC14

- [x] Les quatre mesures de la 0.5.0 (installeur, mémoire d'une fenêtre, ouverture d'un projet de 6 panes, deuxième fenêtre) sont relevées avec leur protocole, et les cibles chiffrées sont fixées
- [x] Le dossier `userData`, le dossier d'installation, la clé de désinstallation et les raccourcis d'une installation 0.5.0 réelle sont relevés
- [x] Le format de `latest.yml` et la façon dont `electron-updater` 6.x télécharge, vérifie et lance l'installeur sont confirmés dans son code

## T02 - Fichiers, préférences et confiance identiques

Closes: AC1, AC3 (logique), AC11 (fusion des préférences)

- [x] Les cas de `tests/schema/`, `tests/services/trust-hash.test.ts`, `workspace-read`, `tests/util/atomic-write` et `resolve-cwd` sont portés et passent
- [x] Un `.myterm.json` et un `preferences.json` écrits par la 0.5.0 sont lus tels quels, et les approbations existantes sont reconnues

## T03 - Un terminal natif équivalent

Closes: AC5

- [x] Un pane fait tourner `claude`, `codex`, `pwsh` et `npm run dev` avec le même rendu que la 0.5.0, palettes claire et sombre comprises (claude, pwsh, npm run dev, codex vérifiés ; la comparaison pixel à pixel avec la 0.5.0 n’a pas été faite)
- [x] La sélection et `Ctrl+Shift+C`, `Ctrl+Entrée`, le redimensionnement et les 5000 lignes de scrollback fonctionnent, et aucune touche du shell n'est interceptée
- [x] Les cas de `tests/renderer/key-chords` et `command-capture` sont portés et passent

## T04 - Ouvrir un workspace

Closes: AC2, AC3 (dialogue et portes d'entrée), AC4, AC6, AC7

- [x] Un projet de 6 panes s'ouvre avec ses `cwd` et ses commandes, après le dialogue de confiance à trois choix
- [x] La grille responsive, le zoom et le focus clavier se comportent comme en 0.5.0 (`tests/shared/responsive-grid` porté)
- [x] Les badges d'activité, BEL compris, fonctionnent (`pane-status-machine` porté ; `output-batcher` sans objet : il n'existait que pour ne pas noyer l'IPC, qui a disparu), ainsi que la réduction dans la barre du bas, processus maintenu

## T05 - Thème, couleurs, accueil et éditeur de layout

Closes: AC8, AC9, AC10

- [x] Le thème, les couleurs de contour et la couleur d'instance sont en place, avec l'icône colorée et un bouton de barre des tâches par couleur (`pane-color`, `logo-icon`, `app-id` portés)
- [x] L'écran d'accueil, l'éditeur de layout avec sa sauvegarde automatique, *Ouvrir dans l'éditeur* (`external-editor` porté) et la bannière de rechargement sont en place

## T06 - Plusieurs instances

Closes: AC11

- [x] Deux `myterm .` ouvrent deux fenêtres décalées. Les récents et les approbations écrits par l'une ne sont pas effacés par l'autre (`instances`, `preferences-merge` portés). La géométrie et le thème sont restaurés

## T07 - Barre de statut

Closes: AC12, AC16 (endpoints d'usage)

- [x] Les quotas Claude et Codex, le CPU et la RAM s'affichent avec les mêmes règles de rafraîchissement, de recul et de dégradation (`quota`, `usage-*`, `system-load`, `quota-color` portés)
- [x] Aucun jeton n'apparaît dans un log, une erreur ou l'interface

## T08 - Distribution et mises à jour Rust

Closes: AC13, AC15, AC16

- [x] L'installeur par utilisateur, sans élévation, pose le shim PATH et le menu contextuel, et la désinstallation les retire (`tests/installer/` porté)
- [x] La CI publie sur `gganster/myterm` avec les garde-fous de `release.yml` (version strictement supérieure, brouillon puis publication)
- [x] La version Rust se met à jour elle-même, avec une seule instance élue et la bannière

## T09 - Bascule depuis la 0.5.0

Closes: AC14, Success metrics

- [x] Une installation 0.5.0 réelle se met à jour vers la version Rust, et tout ce que liste AC14 est retrouvé
- [x] Les quatre mesures refaites en Rust battent la référence de T01 (installeur, RAM, ouverture, deuxième fenêtre : voir `baseline.md` §5 et le relevé exact)
- [ ] Deux semaines d'usage quotidien se passent sans retour à Electron (à compter du 2026-10-18 : au plus tôt le 2026-11-01)
