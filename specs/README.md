# Tâches d'implémentation — MyTerm

## Résumé du projet

**Depuis le PRD** — Un multiplexeur de terminaux desktop où chaque projet porte un `.myterm.json` versionnable décrivant sa grille de panes : combien, où, dans quel dossier, avec quelle commande lancée automatiquement. Ouvrir un projet reconstitue l'environnement complet en un clic. Aucune base de données, aucun historique : un « pane Claude » n'est qu'un terminal dont la commande d'autolaunch est `claude`. Le thème clair est un citoyen de première classe.

**Stack (depuis ARCHI)** — Electron (`contextIsolation` + `sandbox`) · electron-vite · React 19 + TypeScript strict · Tailwind CSS v4 + shadcn/ui · Zustand · `@xterm/xterm` + addons fit/webgl/canvas · `node-pty` (ConPTY) · Zod · Vitest · electron-builder NSIS + electron-updater.

**État actuel** — Dépôt vierge : `PRD.md`, `ARCHI.md` et un `.git` sans commit. Aucun `package.json`, aucune ligne de code.

- ✅ Déjà implémenté : rien
- 🚧 Partiellement implémenté : rien
- ❌ À construire : la totalité des 19 tâches

## Consignes d'exécution

- Lire la tâche **en entier** avant de commencer, y compris ses cas limites.
- Vérifier que les dépendances amont sont livrées et validées.
- Suivre les patterns d'ARCHI : ils encodent des décisions déjà arbitrées, pas des suggestions.
- Cocher chaque critère de succès par une vérification réelle, pas par lecture du code.
- Trois invariants qu'aucune tâche n'a le droit de contourner :
  1. Les instances xterm ne vont jamais dans un state React (ADR-006).
  2. Le main possède les process et le système de fichiers ; le renderer ne reçoit que des données sérialisables.
  3. Aucun spawn de commande d'autolaunch sans passer par le contrôle de confiance (ADR-004), quelle que soit la porte d'entrée.

## Tâches MVP (`specs/01-mvp/`)

### Phase 1 — Fondations (jalon M1)

- [ ] `01-scaffold-electron-vite.md` — Scaffolder le projet Electron sécurisé · **2 h**
- [ ] `02-node-pty-spike.md` — Faire démarrer un vrai PTY PowerShell (spike de risque) · **2-3 h**
- [ ] `03-ipc-contract-preload.md` — Contrat IPC typé et surface preload · **2 h**
- [ ] `04-single-terminal-pane.md` — Un pane terminal fonctionnel de bout en bout · **3 h**
- [ ] `05-theme-system.md` — Thème light / dark / système, palette unifiée · **2-3 h**

### Phase 2 — Cœur (jalons M2 et M3)

- [ ] `06-grid-multipane.md` — Grille N×M multi-panes et cycle de vie des terminaux · **3 h**
- [ ] `07-output-batcher.md` — Batching de la sortie PTY et contre-pression · **2 h**
- [ ] `08-pane-status-badges.md` — Détection d'état des panes et badges d'activité · **3 h**
- [ ] `09-focus-zoom-shortcuts.md` — Focus clavier, zoom plein écran et raccourcis · **2 h**
- [ ] `10-layout-schema-zod.md` — Schéma Zod, écriture atomique, erreurs lisibles · **2-3 h**
- [ ] `11-workspace-open-autolaunch.md` — Ouvrir un projet et reconstituer sa grille · **3 h**

### Phase 3 — Intégration (jalons M3 et M4)

- [ ] `12-workspace-trust.md` — Approbation des projets inconnus · **2 h**
- [ ] `13-preferences-recent-projects.md` — Préférences globales et projets récents · **2 h**
- [ ] `14-cli-single-instance.md` — CLI `myterm .` et instance unique · **2 h**
- [ ] `15-layout-editor.md` — Éditeur de layout dans l'interface · **3 h**
- [ ] `16-save-watch-reload.md` — Sauvegarde et détection d'édition externe · **2-3 h**

### Phase 4 — Finition et distribution (jalon M5)

- [ ] `17-vitest-pure-logic.md` — Suite Vitest sur la logique pure · **3 h**
- [ ] `18-electron-builder-nsis.md` — Installeur NSIS et CLI dans le `PATH` · **2-3 h**
- [ ] `19-auto-update-release.md` — Auto-update et workflow de release · **2-3 h**

## Carte des dépendances

```
                            01 scaffold
                                 │
                ┌────────────────┼────────────────┐
                │                │                │
           02 node-pty      03 contrat IPC   10 schéma Zod ─┐
                │                │                │         │
                └───────┬────────┘                │   (parallélisable
                        │                         │    dès la Phase 1)
                  04 pane unique                  │
                        │                         │
                  05 thème                        │
                        │                         │
                  06 grille N×M ──────────────────┤
                    │      │                      │
          07 batcher │      └── 09 focus/zoom     │
                │    │                            │
          08 badges  └────────┬───────────────────┘
                              │
                     11 ouverture de projet
                              │
              ┌───────────────┼───────────────┐
              │               │               │
         12 trust        13 préférences   15 éditeur
              │               │               │
              └──────┬────────┘          16 sauvegarde
                     │                      + watch
                 14 CLI
                     │
        ┌────────────┴────────────┐
        │                         │
   17 vitest ──────────────► 18 installeur ────► 19 auto-update
```

**Chemin critique** : 01 → 02 → 04 → 06 → 11 → 18 → 19.

**Parallélisable** : la tâche 10 (schéma Zod) ne dépend que du scaffold et peut être menée en parallèle des tâches 06 à 09. Les tâches 12, 13 et 15 sont indépendantes entre elles une fois la 11 livrée.

**À faire en premier, quoi qu'il arrive** : la tâche 02. C'est le risque technique numéro un du projet (ADR-002) et elle doit être levée avant qu'une seule ligne d'interface ne soit écrite.

## Couverture du PRD

| Feature du PRD | Tâches |
|---|---|
| **1. Workspace projet déclaratif (`.myterm.json`)** | 10, 11, 16 |
| **2. Grille de terminaux N×M** | 02, 04, 06, 07 |
| **3. Éditeur de layout intégré** | 15, 16 |
| **4. Badge d'activité + zoom** | 08, 09 |
| **5. Thème light / dark / système** | 05 |
| Parcours — projets récents | 13 |
| Parcours — CLI `myterm .` | 14 |
| Sécurité (contrepartie du fichier commité, ADR-004) | 12 |
| Jalon M5 — distribution et publication | 17, 18, 19 |

Aucune tâche orpheline : les 19 se rattachent à une feature, un parcours ou un jalon du PRD.

## Décisions ouvertes à trancher pendant l'implémentation

Ces points sont documentés dans les tâches concernées et doivent être arbitrés avec des faits, pas par anticipation.

| Point | Tâche | Quand trancher |
|---|---|---|
| Claude Code émet-il un BEL fiable quand il attend une validation ? | 08 | **Avant** de construire l'UI du badge — protocole de test fourni dans la tâche |
| `electron-rebuild` de `node-pty` tient-il sur cette machine ? | 02 | Immédiatement ; plan B `@lydell/node-pty` documenté |
| Faut-il un `.myterm.local.json` non versionné ? | — | Au premier conflit git réel, pas avant (question ouverte du PRD) |
| Découverte automatique de layout à la première ouverture ? | 11 | Après quelques semaines de dogfooding — l'éditeur manuel suffit peut-être |
| Relance automatique d'un pane mort ? | 06 / 15 | Quand un serveur de dev aura crashé assez souvent pour agacer |

## Charge totale estimée

**44 à 52 heures** de travail focalisé, dont environ **10 h** de fondations (tâches 01 à 05) et **8 h** de distribution (tâches 17 à 19).

Le PRD ne fixe aucune deadline : l'ordre des phases est une contrainte de dépendances, pas un calendrier.
