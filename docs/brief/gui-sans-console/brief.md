---
type: brief
slug: gui-sans-console
title: GUI sans console compagnon
status: ready
created: 2026-10-18
next_action: Lancer MyTerm ne doit ouvrir que la fenêtre GUI, sans console Windows à côté
resume_cmd: /ship docs/brief/gui-sans-console
base: rust
branch: feat/gui-sans-console
issues: "#1"
---

# GUI sans console compagnon

## Problem

Au lancement de MyTerm (build Rust natif, Windows), une fenêtre de console s'ouvre en même temps que la fenêtre principale. L'utilisateur voit un second terminal parasite qu'il doit fermer ou ignorer (issue #1).

## Users

- Utilisateur de MyTerm sous Windows, qui lance `myterm [folder]` depuis l'explorateur, un raccourci ou l'installeur.

## Goals

- Lancer MyTerm n'affiche que sa fenêtre GUI.

## Acceptance criteria

- AC1 Lancer l'exe release (double-clic, raccourci, ou après installation) n'ouvre aucune fenêtre de console.
- AC2 Les shells et processus enfants lancés par MyTerm (éditeur externe, installeur de mise à jour) n'ouvrent pas non plus de console visible.
- AC3 Lancé depuis un terminal, `myterm` fonctionne toujours (la fenêtre s'ouvre, Ctrl+C par défaut préservé pour les shells).

## Success metrics

Constat visuel : une seule fenêtre apparaît au lancement du build release. Pas de métrique chiffrée.

## Out-of-scope

- Pas de console de debug embarquée ni de fenêtre de logs.
- Pas de changement sur le comportement des builds debug (la console y reste utile).

## Constraints and assumptions

- Hypothèse à vérifier : cause = binaire lié au sous-système console, `src/main.rs` n'a pas de `windows_subsystem` (grep `*.rs` vide).
- Piste : `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]` en tête de `src/main.rs`.
- Sous ce sous-système, `println!`/`eprintln!` n'ont plus de console : vérifier qu'aucun chemin utile ne dépend de stdout/stderr en release.
- Les `Command::new` de `src/external_editor.rs:103` et `src/updater.rs:238` peuvent nécessiter `CREATE_NO_WINDOW`.

## Boundary

Owns:
- `src/main.rs`
- `src/external_editor.rs`
- `src/updater.rs`

Must not touch:
- `src/term/`
- `installer/`
