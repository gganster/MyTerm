# Task 12 : Approbation des projets inconnus (Workspace Trust)

## Context

ADR-004. Le PRD choisit de **commiter le `.myterm.json` dans le dépôt** pour que le setup se partage avec l'équipe. Conséquence directe : cloner un dépôt hostile et l'ouvrir dans MyTerm exécuterait ses commandes d'autolaunch sans confirmation. C'est exactement le problème que VS Code résout avec son Workspace Trust, pour exactement la même raison.

Cette tâche est **la contrepartie non négociable** de la décision produit prise dans le PRD. Elle doit être livrée avant toute publication.

## Scope

Approbation explicite à la première ouverture d'un chemin inconnu, mode dégradé « panes vierges », persistance des projets approuvés, et ré-approbation lorsque les commandes changent.

## Implementation Details

### Files to Create/Modify

- `src/main/services/trust.ts` — nouveau
- `src/main/services/workspace.ts` — vérification du trust avant tout spawn
- `src/main/services/preferences.ts` — champ `trustedProjects`
- `src/renderer/components/TrustDialog/TrustDialog.tsx` — nouveau
- `src/shared/ipc-contract.ts` — canal `workspace:trust-request`

### Key Functionality

- Avant tout spawn : si le chemin du projet est absent de `trustedProjects`, ou si le hash de ses commandes diffère de celui mémorisé, l'ouverture est suspendue et la boîte de dialogue s'affiche.
- **Contenu de la dialog** : chemin du projet, et **la liste exhaustive des commandes qui vont s'exécuter, avec leur `cwd`**. C'est l'information qui permet la décision ; ne pas la résumer.
- Trois issues : *Approuver et ouvrir* (mémorise le chemin + le hash) · *Ouvrir sans exécuter* (grille restaurée, aucune commande lancée, rien de mémorisé) · *Annuler*.
- **Hash des commandes** : SHA-256 sur la liste normalisée `[{id, cwd, shell, command}]` triée par `id`. Un simple changement de titre ou de position ne doit **pas** redéclencher l'approbation ; un changement de commande, de shell ou de `cwd`, oui.
- Un projet sans aucune commande d'autolaunch n'a rien à approuver : ouverture directe.
- Le mode « ouvrir sans exécuter » doit rester accessible ensuite depuis l'interface (un projet approuvé par erreur doit pouvoir être révoqué) — a minima via un bouton dans les préférences.

### Technologies Used

- **`node:crypto`** — `createHash('sha256')`
- **shadcn/ui `Dialog`** — focus trap et navigation clavier corrects par défaut
- Persistance dans `preferences.json` (Task 13 ; en attendant, un fichier dédié fera l'affaire)

### Architectural Patterns

La décision de confiance est prise **dans le main**, jamais dans le renderer : ce dernier affiche une dialog et renvoie un choix, mais c'est le main qui refuse de spawner. Une compromission du renderer ne doit pas suffire à contourner le contrôle (ARCHI § Sécurité).

Comparaison de chemins Windows : normaliser (casse, séparateurs, slash final) avant de chercher dans `trustedProjects`, sinon `C:\Proj` et `c:/proj/` seraient traités comme deux projets distincts.

## Success Criteria

- [ ] Ouvrir un projet inconnu comportant des commandes affiche la dialog **avant** tout spawn
- [ ] La dialog liste chaque commande avec son `cwd`
- [ ] « Approuver » ouvre le projet et exécute les commandes ; une réouverture ultérieure ne redemande rien
- [ ] « Ouvrir sans exécuter » restaure la grille avec des shells nus et ne mémorise rien
- [ ] Modifier une `command` dans un projet approuvé redéclenche la dialog
- [ ] Modifier un `title` ou déplacer un pane ne la redéclenche **pas**
- [ ] Un projet sans commande s'ouvre sans dialog
- [ ] `C:\Proj`, `c:\proj` et `C:\Proj\` sont reconnus comme le même projet
- [ ] Un projet approuvé peut être révoqué

## Testing & Validation

### Manual Testing Steps

1. Ouvrir un projet neuf avec autolaunch → dialog attendue ; vérifier qu'aucun process n'a démarré avant la réponse (gestionnaire des tâches).
2. Approuver, fermer, rouvrir → pas de dialog.
3. Modifier une commande dans le fichier, rouvrir → dialog.
4. Renommer un pane, rouvrir → pas de dialog.
5. Choisir « ouvrir sans exécuter » : la grille est là, les panes sont des shells vierges.
6. Simuler un dépôt hostile : `.myterm.json` avec `command: "echo COMPROMIS > pwned.txt"`, vérifier que le fichier n'est créé qu'après approbation.

### Edge Cases

- Projet approuvé puis déplacé sur le disque : traité comme un nouveau projet — correct, le chemin fait partie de l'identité.
- Commande contenant des variables d'environnement : afficher la chaîne brute telle qu'écrite dans le fichier, sans expansion (une expansion trompeuse serait pire que pas d'expansion du tout).
- Liste de `trustedProjects` très longue : borner (par exemple 200 entrées, les plus anciennes évincées).
- L'utilisateur ferme la fenêtre pendant que la dialog est ouverte : aucun spawn ne doit se déclencher.

## Dependencies

**Must complete first** :
- Task 11 : Ouvrir un projet et reconstituer sa grille

**Blocks** :
- Task 19 (distribution) — **ne pas publier sans cette tâche**

## Related Documentation

- **ARCHI** : ADR-004 ; § Sécurité — le vrai enjeu de ce produit
- **PRD** : Feature 1 (fichier commité, partage d'équipe)

---
**Estimated Time** : 2 h
**Phase** : Integration
