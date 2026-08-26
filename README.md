# MyTerm

Un multiplexeur de terminaux pour Windows où **chaque projet porte ses propres terminaux**, décrits dans un `.myterm.json` versionnable.

Ouvrir un projet reconstitue l'environnement complet : trois Claude, un `npm run dev` dans `frontend/`, un autre dans `backend/`, un terminal libre. En un clic, en moins de cinq secondes.

Pas de base de données, pas d'historique de sessions, pas d'émulation d'IDE. Un « pane Claude » n'est qu'un terminal dont la commande de démarrage est `claude` — MyTerm marche donc avec n'importe quel agent CLI. Et le **thème clair est un citoyen de première classe**, jusqu'à la palette ANSI du terminal.

> Voir [PRD.md](./PRD.md) pour le produit et [ARCHI.md](./ARCHI.md) pour les décisions techniques.

## Le fichier

```json
{
  "version": 2,
  "name": "mon-projet",
  "theme": "system",
  "defaults": { "shell": "pwsh", "cwd": "." },
  "panes": [
    { "id": "claude-1", "title": "Claude · feature", "command": "claude" },
    { "id": "claude-2", "title": "Claude · review",  "command": "claude" },
    { "id": "claude-3", "title": "Claude · libre",   "command": "claude" },
    { "id": "web",  "title": "frontend", "cwd": "frontend", "command": "npm run dev", "color": "blue" },
    { "id": "api",  "title": "backend",  "cwd": "backend",  "command": "npm run dev", "color": "green" },
    { "id": "free", "title": "scratch" }
  ]
}
```

`theme` vaut `light`, `dark` ou `system`. Un pane sans `command` démarre sur un shell vierge, en attente. Les `cwd` sont relatifs à la racine du projet et ne peuvent pas en sortir. (Le fichier est du JSON strict : pas de commentaires.)

### La couleur d'un pane

`color` peint le contour du pane, pour repérer d'un coup d'œil à quelle partie d'un monorepo un terminal appartient. Huit noms, et rien d'autre :

| | | | | | | | |
|---|---|---|---|---|---|---|---|
| `red` | `orange` | `yellow` | `green` | `cyan` | `blue` | `purple` | `pink` |

Pas de code hexadécimal : chaque nom existe en deux versions, une par thème, choisies pour rester lisibles sur blanc **et** sur noir sans changer de teinte. Un pane bleu reste bleu quand vous basculez le thème — un `#ffe680` choisi à la main sur fond sombre, lui, serait invisible en thème clair.

**Un pane sans `color` suit le thème** : contour discret, clair sur sombre et sombre sur clair, exactement comme avant. La couleur est un marqueur qu'on pose, pas un champ à remplir.

Le contour se choisit aussi depuis l'éditeur intégré (bouton **Layout** → *Couleur du contour*) ; `∅` remet le pane au défaut. Changer une couleur ne redémarre rien : le shell qui tourne dans le pane n'est pas concerné.

**Il n'y a pas de coordonnées à écrire** : l'ordre de la liste est la disposition, et le nombre de terminaux par ligne suit la largeur de la fenêtre.

| Largeur disponible | Terminaux par ligne |
|---|---|
| plus de 1600 px (plein écran) | 3 |
| plus de 1200 px (demi-écran large) | 2 |
| en dessous | 1 |

Les panes suivants passent à la ligne. Quand les lignes ne tiennent plus en hauteur, elles gardent une hauteur lisible et la zone défile — un terminal n'est jamais réduit à trois lignes pour faire de la place. Un `.myterm.json` en `version: 1` (avec `grid` et des `col`/`row`) est lu et converti automatiquement, dans le sens de lecture ; le fichier n'est réécrit que lorsque vous modifiez quelque chose. Ne faites pas la conversion à moitié : un fichier qui déclare `"version": 2` en gardant ses `col`/`row` est refusé avec un message, plutôt qu'ouvert dans un ordre qui n'est pas celui que vous aviez dessiné.

Le fichier se modifie à la main ou depuis l'éditeur intégré (bouton **Layout**). Une sauvegarde depuis l'application réécrit le fichier entier — le JSON est reformaté et les clés inconnues sont perdues — mais rien n'est écrit tant que vous n'avez rien modifié. Une édition externe lève une bannière plutôt que d'être appliquée dans votre dos.

## Installation

Téléchargez `MyTerm-<version>-setup.exe` depuis les [Releases](https://github.com/gganster/myterm/releases).

L'installation se fait **par utilisateur** : aucune élévation, aucune écriture hors de votre profil.

> **SmartScreen.** L'exécutable n'est pas signé, Windows affichera donc un avertissement. Cliquez sur *Informations complémentaires* → *Exécuter quand même*. Un certificat coûte ~300 €/an ; la piste retenue pour un build signé est [SignPath Foundation](https://signpath.org/), gratuite pour l'open source.

## Utilisation

- **Écran d'accueil** : la liste des projets récents, ou *Ouvrir un dossier…*
- **CLI** : `myterm .` depuis le dossier d'un projet. L'installeur dépose le shim dans `%LOCALAPPDATA%\MyTerm\bin` et ajoute ce dossier à la fin de votre `PATH` utilisateur — jamais au `PATH` système, donc sans droits administrateur. Ouvrez un nouveau terminal après l'installation : celui qui tournait déjà a hérité de l'ancien `PATH`.
- **Plusieurs projets à la fois** : chaque `myterm .` ouvre sa propre fenêtre, avec ses propres shells. Les fenêtres sont décalées d'un cran pour ne pas se recouvrir, et se partagent les projets récents et les approbations sans s'écraser mutuellement.

  > Si `myterm` reste introuvable après l'installation, la version installée est antérieure à la 0.3.0 : l'ajout au `PATH` y échouait en silence. Réinstallez depuis la dernière release.
- **Menu contextuel** : clic droit **sur** un dossier → *Ouvrir dans MyTerm*, ou clic droit **dans le vide** d'un dossier déjà ouvert → *Ouvrir MyTerm ici*. L'installeur enregistre les deux entrées ; la désinstallation les retire.

  > **Sous Windows 11, ces entrées sont dans « Afficher plus d'options »** (le menu long), pas dans le menu compact qui apparaît au premier clic droit. `Maj+F10` y va directement. Le menu compact n'accepte que les applications dotées d'une **identité de paquet signée** (MSIX, ou paquet *sparse*) ; MyTerm n'est même pas signé.

Peu importe la porte : le [contrôle de confiance](#sécurité) s'applique à l'identique, et une seule fenêtre existe à la fois.

### Raccourcis

| Raccourci | Action |
|---|---|
| `Ctrl+Shift+C` | copier la sélection du pane focalisé |
| `Ctrl+Entrée` | insérer un saut de ligne **sans** exécuter |
| `Ctrl+Shift+Z` | agrandir / réduire le pane focalisé |
| `Ctrl+Shift+←↑→↓` | déplacer le focus d'un terminal à l'autre |
| `Ctrl+Shift+1..9` | focus direct sur le n-ième pane |
| `Ctrl+S` | forcer la sauvegarde du layout |
| `Échap` | réduire le pane agrandi |

Tout le reste appartient au shell : `Ctrl+C`, `Ctrl+D`, `Ctrl+L`, `Ctrl+R` et `Échap` ne sont jamais interceptés.

**Copier.** `Ctrl+C` ne peut pas être la copie — c'est `SIGINT`, et il appartient au processus en cours ; d'où la variante `Shift`, comme dans tous les émulateurs de terminal. La sélection d'un terminal n'est pas une sélection du document (avec le rendu WebGL le texte est peint sur un canvas et n'est pas dans le DOM), donc la commande de copie du navigateur n'a rien à quoi s'accrocher : c'est pour cela qu'aucun moyen ne fonctionnait avant. Sans rien de sélectionné, le raccourci ne fait rien plutôt que de vider le presse-papier.

**Aller à la ligne.** Un terminal ne sait pas distinguer `Entrée` de `Ctrl+Entrée` : le protocole n'a pas de bits de modificateur pour cette touche, et les deux partent en `\r`. MyTerm intercepte donc `Ctrl+Entrée` et envoie un saut de ligne nu — exactement l'octet que `Ctrl+J` envoie déjà, que Claude Code documente comme le raccourci multiligne fonctionnant partout sans configuration. `Maj+Entrée` est laissé tel quel, c'est-à-dire équivalent à `Entrée`.

### Le badge d'activité

Chaque pane affiche un état : *en cours*, *inactif*, *terminé*, et surtout **en attente d'une réponse** — le seul état mis en avant, pour repérer dans une grille de six terminaux identiques lequel attend une validation.

Le signal principal est la cloche du terminal (`BEL`). Pour que Claude Code l'émette, réglez son canal de notification :

```jsonc
// ~/.claude/settings.json
{ "preferredNotifChannel": "terminal_bell" }
```

Sans cela, MyTerm se rabat sur une heuristique de silence, nettement moins fiable. À noter aussi : avec `"defaultMode": "bypassPermissions"`, Claude Code ne demande presque jamais de permission, et le badge a donc peu d'occasions de se déclencher.

### La barre de statut

En bas de la fenêtre, en permanence et dans les deux vues : le quota Claude consommé sur la session de 5 h et sur la semaine glissante, avec le délai avant réinitialisation, puis la charge CPU et la mémoire vive de la machine.

Le quota est lu sur le même endpoint que `/usage`, avec le jeton de votre session Claude Code locale — si vous n'en avez pas, la barre le dit et n'affiche que le CPU et la RAM. La jauge reste grise jusqu'à 75 % de consommation, passe à l'orange, puis au rouge à 90 % : la couleur ne sert qu'à alerter. Une valeur inconnue s'affiche `—`, jamais `0 %`.

L'endpoint est partagé avec la statusline de Claude Code et tout overlay d'usage que vous faites tourner : MyTerm l'interroge toutes les 2 minutes et recule en cas de limitation. Si un relevé échoue, le dernier connu reste affiché avec un `⋯` pendant 15 minutes plutôt que de vider la barre.

## Sécurité

`.myterm.json` est un fichier **versionné**. Cloner un dépôt et l'ouvrir revient à exécuter les commandes que quelqu'un d'autre y a écrites.

MyTerm demande donc une approbation explicite à la première ouverture d'un projet inconnu, en affichant chaque commande avec son dossier d'exécution. Trois choix : approuver, *ouvrir sans exécuter* (la grille est restaurée, rien ne démarre), ou annuler. Une commande modifiée redemande une approbation ; renommer ou déplacer un pane, non.

Côté application : `contextIsolation`, `sandbox`, `nodeIntegration: false`, aucun contenu distant chargé par le renderer, et la décision de confiance est prise dans le processus principal — compromettre le renderer ne suffit pas à la contourner.

Deux connexions sortantes existent, toutes deux dans le processus principal : GitHub pour les mises à jour, et l'endpoint d'usage d'Anthropic pour la barre de statut. Le jeton OAuth de votre session Claude Code est lu, posé dans un en-tête `Authorization`, puis oublié : il ne franchit jamais la frontière vers le renderer, et un échec de lecture est réduit à un code (`no-credentials`, `token-expired`, `http-429`…) qui n'embarque ni chemin de fichier ni message système.

## Développement

Prérequis : **Node 22+** et npm. Rien d'autre — pas de Visual Studio, pas de Python : `node-pty` livre des binaires N-API qui fonctionnent tels quels sous Node et sous Electron.

```bash
npm install
npm run dev        # HMR sur le renderer, redémarrage à chaud du main
npm test           # Vitest sur la logique pure
npm run typecheck
npm run dist       # installeur NSIS dans release/
```

### Publier une version

La publication est automatique, mais elle n'est pas déclenchée par le fait de
pousser : elle est déclenchée par le **numéro de version**.

```bash
npm version patch   # ou minor / major — écrit package.json et pose le tag local
git push origin main
```

La version doit être un `X.Y.Z` strict et strictement supérieure à la dernière
publiée. Les préversions sont refusées : il n'y a pas de canal de préversion, une
release publiée est marquée « latest » et partirait donc à tout le monde.

Le tag distant n'a pas à être poussé, et le workflow ne se déclenche pas dessus :
le seul juge de la version est le `package.json`. electron-builder ne crée pas de
tag git — il crée une release dont le `tag_name` est `v<version>` — et c'est
GitHub qui pose le tag, sur le commit construit, au moment où la CI la publie.

Pour rejouer une publication (run annulé, échec après coup), lancer `Release`
manuellement depuis l'onglet Actions avec `publish: true`.

Au push sur `main`, le workflow `Release` construit l'installeur, puis :

1. si `v<version>` est **déjà publiée**, il s'arrête et le dit dans le résumé du run ;
2. sinon, il crée la release **en brouillon**, y téléverse `MyTerm-<version>-setup.exe`
   et `latest.yml`, et ne la rend publique qu'une fois les deux en place.

Ce garde-fou n'est pas une précaution de confort. electron-builder, face à une
release publiée existante, écrase ses assets si elle a moins de deux heures et ne
fait rien au-delà — publier à chaque push sans vérifier reviendrait à remplacer
silencieusement un installeur déjà distribué. Et comme electron-updater compare
des semver, republier la même version ne mettrait personne à jour.

Le passage par un brouillon règle le cas symétrique : un run qui échoue en cours
de téléversement laisse un brouillon, invisible pour les clients, que le run
suivant reprend et termine. Sans lui, une release vide et publiée bloquerait
définitivement cette version.

Un push sur `main` sans changement de version est donc un no-op côté release :
c'est voulu.

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
