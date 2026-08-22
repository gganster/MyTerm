# MyTerm

Un multiplexeur de terminaux pour Windows où **chaque projet porte sa propre grille**, décrite dans un `.myterm.json` versionnable.

Ouvrir un projet reconstitue l'environnement complet : trois Claude, un `npm run dev` dans `frontend/`, un autre dans `backend/`, un terminal libre. En un clic, en moins de cinq secondes.

Pas de base de données, pas d'historique de sessions, pas d'émulation d'IDE. Un « pane Claude » n'est qu'un terminal dont la commande de démarrage est `claude` — MyTerm marche donc avec n'importe quel agent CLI. Et le **thème clair est un citoyen de première classe**, jusqu'à la palette ANSI du terminal.

> Voir [PRD.md](./PRD.md) pour le produit et [ARCHI.md](./ARCHI.md) pour les décisions techniques.

## Le fichier

```jsonc
{
  "version": 1,
  "name": "mon-projet",
  "theme": "system",                 // "light" | "dark" | "system"
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

Un pane sans `command` démarre sur un shell vierge, en attente. Les `cwd` sont relatifs à la racine du projet et ne peuvent pas en sortir.

Le fichier se modifie à la main ou depuis l'éditeur intégré (bouton **Layout**) ; l'application le réécrit sans jamais reformater ce qu'elle n'a pas changé, et une édition externe lève une bannière plutôt que d'être appliquée dans votre dos.

## Installation

Téléchargez `MyTerm-<version>-setup.exe` depuis les [Releases](https://github.com/gganster/myterm/releases).

L'installation se fait **par utilisateur** : aucune élévation, aucune écriture hors de votre profil.

> **SmartScreen.** L'exécutable n'est pas signé, Windows affichera donc un avertissement. Cliquez sur *Informations complémentaires* → *Exécuter quand même*. Un certificat coûte ~300 €/an ; la piste retenue pour un build signé est [SignPath Foundation](https://signpath.org/), gratuite pour l'open source.

## Utilisation

- **Écran d'accueil** : la liste des projets récents, ou *Ouvrir un dossier…*
- **CLI** : `myterm .` depuis le dossier d'un projet. L'installeur ajoute le shim à votre `PATH` utilisateur. Si MyTerm tourne déjà, la fenêtre existante ouvre le projet — jamais une seconde instance.

### Raccourcis

| Raccourci | Action |
|---|---|
| `Ctrl+Shift+Z` | agrandir / réduire le pane focalisé |
| `Ctrl+Shift+←↑→↓` | déplacer le focus dans la grille |
| `Ctrl+Shift+1..9` | focus direct sur le n-ième pane |
| `Ctrl+S` | forcer la sauvegarde du layout |
| `Échap` | réduire le pane agrandi |

Tout le reste appartient au shell : `Ctrl+C`, `Ctrl+D`, `Ctrl+L`, `Ctrl+R` et `Échap` ne sont jamais interceptés.

### Le badge d'activité

Chaque pane affiche un état : *en cours*, *inactif*, *terminé*, et surtout **en attente d'une réponse** — le seul état mis en avant, pour repérer dans une grille de six terminaux identiques lequel attend une validation.

Le signal principal est la cloche du terminal (`BEL`). Pour que Claude Code l'émette, réglez son canal de notification :

```jsonc
// ~/.claude/settings.json
{ "preferredNotifChannel": "terminal_bell" }
```

Sans cela, MyTerm se rabat sur une heuristique de silence, nettement moins fiable. À noter aussi : avec `"defaultMode": "bypassPermissions"`, Claude Code ne demande presque jamais de permission, et le badge a donc peu d'occasions de se déclencher.

## Sécurité

`.myterm.json` est un fichier **versionné**. Cloner un dépôt et l'ouvrir revient à exécuter les commandes que quelqu'un d'autre y a écrites.

MyTerm demande donc une approbation explicite à la première ouverture d'un projet inconnu, en affichant chaque commande avec son dossier d'exécution. Trois choix : approuver, *ouvrir sans exécuter* (la grille est restaurée, rien ne démarre), ou annuler. Une commande modifiée redemande une approbation ; renommer ou déplacer un pane, non.

Côté application : `contextIsolation`, `sandbox`, `nodeIntegration: false`, aucun contenu distant, et la décision de confiance est prise dans le processus principal — compromettre le renderer ne suffit pas à la contourner.

## Développement

Prérequis : **Node 22+** et npm. Rien d'autre — pas de Visual Studio, pas de Python : `node-pty` livre des binaires N-API qui fonctionnent tels quels sous Node et sous Electron.

```bash
npm install
npm run dev        # HMR sur le renderer, redémarrage à chaud du main
npm test           # Vitest sur la logique pure
npm run typecheck
npm run dist       # installeur NSIS dans release/
```

### Structure

```
src/shared/     schéma Zod, contrat IPC, logique pure — importé des deux côtés
src/main/       PTY, système de fichiers, préférences, confiance
src/preload/    contextBridge, unique surface exposée au renderer
src/renderer/   React, xterm, store Zustand
tests/          Vitest, uniquement sur ce qui casse silencieusement
```

Trois invariants à ne pas casser :

1. **Les instances xterm ne vont jamais dans un state React** — elles vivent dans `src/renderer/terminal/registry.ts`. Sinon : scrollback perdu et contextes WebGL fuités.
2. **Le main possède les process et le disque** ; le renderer ne reçoit que des données sérialisables.
3. **Aucune commande d'autolaunch ne démarre sans passer par le contrôle de confiance**, quelle que soit la porte d'entrée.

## Licence

MIT — voir [LICENSE](./LICENSE).
