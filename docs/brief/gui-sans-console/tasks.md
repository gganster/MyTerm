---
type: tasks
slug: gui-sans-console
source_brief: docs/brief/gui-sans-console/brief.md
---

# Tasks: GUI sans console compagnon

## Relevant Files

- `src/main.rs` - point d'entrée, où poser l'attribut de sous-système.
- `src/external_editor.rs` - lance un processus enfant (`Command::new`).
- `src/updater.rs` - lance l'installeur (`Command::new`).

## Tasks

Ordered. Each task closes the acceptance criteria it names.

## T01 - Plus de console au lancement [#1](https://github.com/gganster/MyTerm/issues/1)

Closes: AC1, AC2, AC3

- [x] Le build release lancé par double-clic n'ouvre aucune console.
- [x] Les processus enfants (éditeur externe, installeur) ne montrent pas de console.
- [x] `myterm` lancé depuis un terminal ouvre toujours la fenêtre et Ctrl+C reste celui par défaut pour les shells.
- [x] Le build debug garde sa console.
