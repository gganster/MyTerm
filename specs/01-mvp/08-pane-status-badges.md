# Task 08 : Détection d'état des panes et badges d'activité

## Context

Feature 4 du PRD : repérer d'un coup d'œil, dans une grille de six terminaux visuellement identiques, lequel des agents attend une validation.

Le PRD laissait ouverte la question du *comment*. ARCHI la tranche : le signal primaire est le **caractère BEL (`\x07`)** que Claude Code émet quand il attend une réponse. L'heuristique de silence, seule, produirait un faux positif à chaque pause de réflexion d'un agent.

⚠️ **Cette tâche porte un risque produit identifié** (ARCHI § Risques ouverts) : si Claude Code n'émet pas le BEL de façon fiable, la valeur de la feature s'effondre. **Valider le signal empiriquement avant de construire l'UI par-dessus** — c'est l'étape 1 du plan de test.

## Scope

La machine d'état côté main, sa diffusion via `pane:status`, et l'indicateur visuel dans `PaneHeader`.

## Implementation Details

### Files to Create/Modify

- `src/shared/pane-status.ts` — enum et transitions (créé en Task 03, complété ici)
- `src/main/services/pane-status-machine.ts` — nouveau
- `src/main/services/output-batcher.ts` — inspection du flux avant émission
- `src/renderer/store/runtime-slice.ts` — `Map<paneId, PaneRuntime>`
- `src/renderer/components/Grid/PaneBadge.tsx` — nouveau
- `src/renderer/components/Grid/PaneHeader.tsx` — intégration du badge

### Key Functionality

Quatre états et leurs déclencheurs, par ordre de fiabilité décroissante :

| État | Déclencheur | Fiabilité |
|---|---|---|
| `attention` | `\x07` détecté dans le flux de sortie | élevée |
| `idle` | marqueur OSC 133 de fin de commande, **ou** silence > 800 ms avec process vivant | élevée si OSC 133, faible sinon |
| `running` | sortie reçue dans les 800 dernières ms | — |
| `exited` | événement `onExit` du PTY, avec le code | certaine |

- La détection du BEL se fait **dans le main, au moment du batching**, avant émission — pas dans le renderer. Cela évite de dépendre du `bellStyle` d'xterm et fait remonter l'état même pour un pane non visible.
- `attention` retombe à `running` dès la première saisie de l'utilisateur dans ce pane (`pane:write`).
- La détection OSC 133 est **optionnelle** : si les marqueurs sont présents dans le flux on les utilise, sinon on se rabat sur le silence. Ne pas exiger de configuration du profil PowerShell au MVP.
- Émission de `pane:status` uniquement **lors d'un changement** d'état, jamais en continu.
- Le badge est un point coloré + un `title` accessible : `attention` doit être le seul état visuellement saillant (les autres restent discrets, sinon la grille devient un sapin de Noël).

### Technologies Used

- Machine d'état TypeScript pure, sans dépendance — testable en Task 17
- **Zustand** `runtime-slice`, lu par sélecteur ciblé sur un seul `paneId`

### Architectural Patterns

La machine d'état est une fonction pure `(state, event) => state`. Le service main l'appelle, le rendu s'y abonne. Aucune logique d'état dans un composant React.

## Success Criteria

- [ ] **Préalable validé** : `claude` émet bien un BEL lors d'une demande de permission (voir le protocole de test)
- [ ] Un pane exécutant `claude` en attente de validation passe visiblement en `attention`
- [ ] Le badge revient à `running` dès qu'on tape dans le pane
- [ ] Un pane qui exécute une commande longue affiche `running`, pas `attention` — aucun faux positif
- [ ] Un pane inactif au prompt affiche `idle`
- [ ] Un process terminé affiche `exited` avec son code de sortie
- [ ] Un pane en `attention` est repérable dans une grille 3×2 **sans lire le contenu** des panes (critère de succès du PRD)
- [ ] Les transitions d'état ne provoquent que le re-render du badge concerné

## Testing & Validation

### Manual Testing Steps

1. **D'abord, valider le signal** : dans Windows Terminal, lancer `claude`, déclencher une demande de permission, et vérifier qu'un BEL est bien émis (`claude 2>&1 | Format-Hex` ou un simple pane instrumenté journalisant tout `\x07` reçu). **Ne pas continuer avant d'avoir tranché.**
2. Reproduire dans MyTerm et observer le badge.
3. Lancer `ping -t localhost` (sortie continue) → doit rester `running`, jamais `attention`.
4. Laisser un pane au prompt 5 s → `idle`.
5. `exit` dans un pane → `exited` avec le code.
6. Grille 3×2, cinq panes actifs, un en attente : le repérer sans lire les contenus.

### Edge Cases

- **Le signal BEL est absent ou peu fiable** → replier sur l'heuristique de silence en documentant la dégradation dans ARCHI, et prévenir avant d'investir dans le polish visuel du badge.
- BEL émis par autre chose (complétion PowerShell, erreur de saisie) → faux positif ; l'acquittement à la frappe le rend inoffensif.
- Pane démarré sans commande (shell nu) : état initial `idle`, pas `running`.
- Un `\x07` scindé à cheval sur deux chunks est impossible (c'est un octet unique), mais une séquence OSC 133 peut l'être — l'analyseur doit conserver un petit état résiduel entre chunks.

## Dependencies

**Must complete first** :
- Task 07 : Batching de la sortie PTY (le point d'inspection du flux)
- Task 06 : Grille N×M (le `PaneHeader` où loger le badge)

**Blocks** : aucune tâche techniquement, mais valide la Feature 4 du PRD.

## Related Documentation

- **ARCHI** : § Détection d'état des panes — la question ouverte du PRD, tranchée ; § Risques ouverts (ligne 2)
- **PRD** : Feature 4 « Lisibilité de la grille » ; Open Questions (question 1)

---
**Estimated Time** : 3 h
**Phase** : Core
