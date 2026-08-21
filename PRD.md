# Product Requirements Document : MyTerm

> Statut : MVP · Windows-first · Outil personnel destiné à être open-sourcé
> Inspiration : [doctly/switchboard](https://github.com/doctly/switchboard) — dont MyTerm est la réponse minimaliste.

---

## Product Vision

**Problem Statement**

Un développeur qui travaille avec des agents CLI (Claude Code, etc.) ouvre les mêmes 5 à 7 terminaux chaque matin : trois instances Claude, un `npm run dev` dans `frontend/`, un autre dans `backend/`, un terminal libre pour les commandes ponctuelles. Ce rituel prend ~2 minutes de `cd`, de commandes retapées et d'onglets réorganisés à la main, et se répète à chaque changement de projet ou redémarrage. Les outils existants résolvent le mauvais problème : Switchboard indexe l'historique des sessions Claude dans une base SQLite avec fork/resume et émulation d'IDE — une machinerie lourde — alors que le vrai besoin est de **rejouer une disposition de travail**. Et il n'a pas de thème clair, ce qui le rend inutilisable pour qui travaille en light mode.

**Solution**

MyTerm est un multiplexeur de terminaux desktop où chaque projet possède un fichier `.myterm.json` versionnable décrivant sa grille de panes : combien, où, dans quel dossier, avec quelle commande lancée automatiquement. Ouvrir un projet reconstitue l'environnement complet en un clic. Aucune base de données, aucun historique, aucune session persistante : les panes sont des process éphémères, un « pane Claude » n'est qu'un terminal dont la commande d'autolaunch est `claude`. Le thème clair est un citoyen de première classe, jusqu'à la palette du terminal lui-même.

**Success Criteria**

- Ouverture d'un projet complet (6 panes, cwd corrects, commandes lancées) en **moins de 5 secondes**, contre ~2 minutes en manuel.
- **Zéro ouverture de Windows Terminal** pour du travail projet pendant 2 semaines consécutives.
- Un layout décrit **entièrement** par un `.myterm.json` lisible et éditable à la main, commitable dans le repo.

---

## Target Users

### Persona primaire : Guilian — développeur full-stack piloté par agents

- **Rôle** : dev solo / lead sur plusieurs projets web (frontend + backend), Windows 11, PowerShell.
- **Contexte** : fait tourner plusieurs agents Claude Code en parallèle sur des sous-tâches, plus les serveurs de dev, plus un terminal libre. Jongle entre 2 et 5 projets dans la semaine.
- **Pain points** :
  - Reconstruire manuellement le même environnement de terminaux à chaque session de travail.
  - Perdre de vue lequel des 3 agents attend une réponse dans une forêt d'onglets identiques.
  - Les outils du domaine imposent un thème sombre et une gestion de sessions complexe dont il n'a pas l'usage.
- **Motivations** : démarrer à travailler en quelques secondes ; garder un état mental clair de « qui fait quoi » ; que la configuration soit du texte, versionnable, pas une base de données opaque.
- **Objectifs** : passer de l'ouverture de l'app au premier prompt tapé en moins de 10 secondes.

### Persona secondaire : le dev qui découvre le repo sur GitHub (post-MVP proche)

- **Rôle** : développeur curieux cherchant une alternative légère aux gestionnaires de sessions d'agents.
- **Pain points** : outils trop lourds pour son besoin, pas de thème clair, config non partageable avec son équipe.
- **Motivations** : cloner un repo, trouver un `.myterm.json` déjà présent et retrouver le setup de l'auteur immédiatement.

---

## Core Features (MVP)

### Must-Have Features

#### 1. Workspace projet déclaratif (`.myterm.json`)

**Description** : Chaque projet porte à sa racine un fichier `.myterm.json` décrivant sa grille : dimensions, et pour chaque pane son titre, sa position, son `cwd` (relatif à la racine du projet), son shell et sa commande d'autolaunch optionnelle. Le fichier est la source de vérité unique, éditable à la main, versionnable dans git. À l'ouverture d'un projet, MyTerm le lit, instancie la grille et exécute les commandes déclarées. Un pane sans commande démarre sur un shell vierge, en attente.

```jsonc
{
  "version": 1,
  "name": "mon-projet",
  "theme": "system",              // "light" | "dark" | "system"
  "grid": { "cols": 3, "rows": 2 },
  "defaults": { "shell": "pwsh", "cwd": "." },
  "panes": [
    { "id": "claude-1", "title": "Claude · feature", "col": 0, "row": 0, "command": "claude" },
    { "id": "claude-2", "title": "Claude · review",  "col": 1, "row": 0, "command": "claude" },
    { "id": "claude-3", "title": "Claude · libre",   "col": 2, "row": 0, "command": "claude" },
    { "id": "web",  "title": "frontend", "col": 0, "row": 1, "cwd": "frontend", "command": "npm run dev" },
    { "id": "api",  "title": "backend",  "col": 1, "row": 1, "cwd": "backend",  "command": "npm run dev" },
    { "id": "free", "title": "scratch",  "col": 2, "row": 1 }
  ]
}
```

**User Value** : le rituel de 2 minutes devient un clic, et le setup d'un projet se transmet avec le code.
**Success Metric** : un projet à 6 panes est entièrement opérationnel en < 5 s après sélection ; le fichier suffit à reproduire le layout à l'identique sur une machine vierge.

#### 2. Grille de terminaux N×M (le multiplexeur)

**Description** : Le cœur applicatif : une grille de terminaux PowerShell réels (PTY complet — couleurs, redimensionnement, saisie interactive, Ctrl+C), disposés en `cols × rows`. Chaque pane est indépendant, avec son propre process et son propre répertoire de travail. Le shell est PowerShell par défaut et surchargeable par pane (`cmd`, `git-bash`). Pas de rattachement à un daemon : fermer la fenêtre termine les process.

**User Value** : un vrai terminal, pas une émulation partielle — Claude Code et les serveurs de dev doivent tourner exactement comme dans Windows Terminal.
**Success Metric** : `claude`, `npm run dev` et une session interactive (`git rebase -i`, prompts de confirmation) fonctionnent sans dégradation visible par rapport à Windows Terminal.

#### 3. Éditeur de layout intégré

**Description** : Ajouter, supprimer, renommer et repositionner un pane depuis l'interface ; modifier son `cwd`, son shell et sa commande d'autolaunch via un panneau de configuration ; changer les dimensions de la grille. Toute modification est écrite dans `.myterm.json`, et une édition externe du fichier est rechargeable depuis l'app.

**User Value** : on construit son layout en travaillant, sans quitter l'app pour éditer du JSON ; le fichier reste néanmoins lisible pour les ajustements manuels.
**Success Metric** : créer de zéro le layout à 6 panes de l'exemple ci-dessus sans jamais ouvrir d'éditeur de texte, en moins de 2 minutes.

#### 4. Lisibilité de la grille : badge d'activité + zoom

**Description** : Chaque pane affiche un indicateur d'état — en cours d'exécution / en attente d'une saisie / terminé — pour repérer d'un coup d'œil, dans une grille de six terminaux visuellement identiques, lequel des agents attend une validation. Un raccourci clavier agrandit le pane focalisé en plein écran et le restaure dans la grille.

**User Value** : supprime le balayage visuel permanent entre panes ; permet de travailler confortablement dans un pane sans casser le layout.
**Success Metric** : un agent qui demande une permission est identifiable sans lire le contenu des panes ; le zoom et le retour se font au clavier en un geste.

#### 5. Thème light / dark / système

**Description** : Trois modes — clair, sombre, suivi du thème Windows — appliqués à l'intégralité de l'interface **et** à la palette du terminal (fond, couleurs ANSI, curseur, sélection). Le thème clair est le cas nominal, conçu et testé en premier, pas un dérivé dégradé du thème sombre.

**User Value** : la raison d'être initiale du projet — travailler en light mode sans compromis de lisibilité.
**Success Metric** : la sortie de Claude Code et les logs colorés d'un serveur de dev restent parfaitement lisibles dans les deux thèmes ; le basculement est instantané et sans rechargement.

### Should-Have Features (Post-MVP)

- **Recherche dans le scrollback** (`Ctrl+F`) au sein d'un pane.
- **Onglets de layouts** : plusieurs vues par projet (« Dev », « Debug »), chacune avec sa grille.
- **Splits redimensionnables** en remplacement de la grille rigide, si la contrainte N×M devient limitante.
- **Support WSL** : cibler une distro dans la définition d'un pane.
- **Portage macOS / Linux.**
- **Templates de layouts** réutilisables entre projets (« Next.js + API »).
- **Notifications système** quand un agent attend une réponse et que l'app n'a pas le focus.

---

## User Flows

### Parcours principal : démarrer une journée de travail

1. L'utilisateur lance MyTerm — écran d'accueil listant les projets récents — ou tape `myterm .` depuis le dossier du projet dans un terminal existant.
2. Il clique sur le projet ; MyTerm lit le `.myterm.json` à sa racine.
3. La grille 3×2 s'affiche : trois panes lancent `claude`, deux lancent `npm run dev` dans `frontend/` et `backend/`, le sixième attend sur un prompt vierge.
4. Moins de 5 secondes après le clic, il tape son premier prompt dans le premier pane Claude.

### Parcours secondaire : créer le layout d'un nouveau projet

1. Depuis l'accueil, « Ouvrir un dossier » → sélection du répertoire du projet.
2. Aucun `.myterm.json` détecté : MyTerm ouvre un pane unique sur la racine.
3. L'utilisateur ajoute des panes, définit pour chacun le `cwd`, la commande d'autolaunch et un titre.
4. La configuration est écrite dans `.myterm.json` ; il la commite pour que son équipe hérite du même environnement.

---

## Out of Scope (v1)

Explicitement non construit dans le MVP :

- **Toute la gestion de sessions de Switchboard** : session browser, indexation de `~/.claude/projects`, base SQLite, recherche full-text, fork/resume, détection de noms de sessions. MyTerm ne connaît rien des conversations Claude.
- **Persistance des process** : pas de daemon, pas de rattachement à des terminaux survivant à la fermeture de la fenêtre.
- **Émulation d'IDE** : pas de serveur MCP, pas de visualisation de diffs, pas d'édition de fichiers, pas de coloration syntaxique, pas de liens OSC 8 cliquables. MyTerm n'écrit jamais dans les fichiers du projet — à la seule exception de `.myterm.json`.
- **Options Claude dédiées** : un pane Claude est un terminal avec `claude` en autolaunch. Aucun champ spécifique (modèle, permission-mode, prompt initial) dans le schéma ; le type de pane ne sert qu'à l'icône et à la couleur. Corollaire : MyTerm fonctionne tel quel avec n'importe quel agent CLI.
- **macOS et Linux** : Windows 11 uniquement. Pas de support WSL au MVP.
- **Notifications système, heatmap d'activité, analytics d'usage** : les badges in-app suffisent.
- **Comptes utilisateurs, synchronisation cloud, monétisation.**

---

## Success Metrics

**Métriques primaires**

- **Temps de restauration d'un workspace** : < 5 s entre le clic sur un projet et la disponibilité du premier pane (contre ~120 s en manuel).
- **Taux de substitution** : 0 ouverture de Windows Terminal pour du travail projet sur 14 jours consécutifs d'usage.

**Métriques secondaires**

- **Couverture déclarative** : 100 % des projets actifs de l'utilisateur possèdent un `.myterm.json` fonctionnel dans les 30 jours suivant le MVP.
- **Fidélité du terminal** : 0 régression fonctionnelle constatée sur `claude`, `npm run dev` et les commandes git interactives par rapport à Windows Terminal.
- **Adoption open-source** (post-MVP) : premiers utilisateurs externes rapportant un usage réel, à mesurer une fois le repo publié.

---

## Open Questions

- Comment détecter de façon fiable qu'un pane « attend une saisie » ? Une heuristique sur l'inactivité de sortie du PTY est simple mais imparfaite ; à valider empiriquement sur le comportement réel de Claude Code avant de figer l'indicateur.
- Faut-il un mécanisme de découverte automatique du layout à la première ouverture (détecter `frontend/` et `backend/` avec un `package.json` et proposer un layout de départ), ou l'éditeur manuel suffit-il ?
- Que faire quand un pane meurt ? Le laisser mort avec un bouton de relance, ou le redémarrer automatiquement ? À trancher pour les serveurs de dev qui crashent.
- Un `.myterm.json` commité mais spécifique à une machine (chemins, ports) risque de créer du bruit git. Prévoir dès la v1 un `.myterm.local.json` en surcharge non versionnée, ou attendre que le problème se manifeste ?

---

## Timeline & Milestones

Pas de deadline : projet personnel développé sur temps disponible. Le PRD fixe le cap, pas le calendrier. Jalons ordonnés :

- **M1 — Le terminal fonctionne** : une fenêtre, un pane PowerShell PTY complet, thème light/dark.
- **M2 — La grille** : N×M panes indépendants, zoom/focus, badges d'activité.
- **M3 — Le fichier** : lecture de `.myterm.json`, autolaunch, `cwd` par pane, projets récents et CLI `myterm .`.
- **M4 — L'édition** : éditeur de layout intégré, écriture du fichier, rechargement à chaud.
- **M5 — Dogfooding** : 2 semaines d'usage exclusif, puis publication du repo sous licence MIT.
