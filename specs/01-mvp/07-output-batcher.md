# Task 07 : Batching de la sortie PTY et contre-pression

## Context

ARCHI ADR-005 désigne le débit PTY comme le principal risque de performance de l'application. Un `npm run dev` verbeux émet des centaines de petits chunks par seconde ; à raison d'un message IPC par chunk et de six panes, le thread renderer sature en sérialisation.

Le remède : accumuler dans le main et n'émettre qu'une fois par frame.

## Scope

Un `OutputBatcher` dans le main, inséré entre `PtyManager.onData` et l'envoi IPC. Purement invisible pour l'utilisateur — sauf que l'application cesse de ramer.

## Implementation Details

### Files to Create/Modify

- `src/main/services/output-batcher.ts` — nouveau
- `src/main/services/pty-manager.ts` — `onData` alimente le batcher au lieu d'émettre directement
- `src/main/ipc/handlers.ts` — le flush émet `pane:data`

### Key Functionality

- Un buffer de chaînes par pane. Chaque `onData` pousse son chunk et programme un flush s'il n'y en a pas déjà un en attente.
- Flush toutes les **16 ms** (une frame) : pour chaque pane non vide, concaténer et envoyer **un** message `pane:data`. Au pire six messages par frame, quel que soit le débit.
- **Contre-pression** : si le buffer d'un pane dépasse ~1 Mo entre deux flushes, ne conserver que la queue (le dernier Mo) et préfixer le flush d'un marqueur de troncature visible, du type `\r\n[… sortie tronquée …]\r\n`.
- **L'ordre est sacré** : les chunks d'un même pane doivent être concaténés dans leur ordre d'arrivée. Une inversion corrompt les séquences d'échappement ANSI et casse l'affichage.
- Un flush programmé doit être annulé quand le pane meurt, et le buffer vidé — sinon on émet vers un `paneId` disparu.
- Vérifier `webContents.isDestroyed()` avant chaque envoi.

### Technologies Used

- **Node.js `setTimeout`** — un timer unique global partagé par tous les panes, pas un timer par pane
- **Electron `webContents.send`**

### Architectural Patterns

ADR-005 : batching plutôt que `MessageChannel` par pane. Le seuil de migration documenté est d'environ **15 panes simultanément verbeux** ; le noter en commentaire en tête du fichier pour le futur lecteur.

Le batcher est une classe pure sans dépendance à Electron (l'émission est injectée en callback) : c'est ce qui la rend testable en Task 17.

## Success Criteria

- [ ] `Get-ChildItem -Recurse C:\Windows -ErrorAction SilentlyContinue` dans un pane laisse l'interface réactive (les autres panes acceptent la frappe)
- [ ] Six panes produisant de la sortie en continu maintiennent une UI fluide
- [ ] La latence de frappe reste imperceptible (le délai ajouté de 16 ms ne se sent pas)
- [ ] La sortie affichée est **identique** à celle du même shell dans Windows Terminal — aucun caractère perdu, aucune séquence ANSI cassée
- [ ] Un `cat` sur un fichier de 50 Mo déclenche la troncature avec son marqueur, sans figer l'application
- [ ] Tuer un pane pendant une sortie intense ne produit ni erreur ni envoi vers un pane mort
- [ ] Le nombre de messages IPC par seconde est plafonné (mesurable par un compteur temporaire)

## Testing & Validation

### Manual Testing Steps

1. Instrumenter temporairement un compteur de messages `pane:data` par seconde ; sans batcher on observe des centaines, avec batcher au maximum ~60 par pane.
2. Lancer une sortie massive dans un pane et taper simultanément dans un autre.
3. Comparer la sortie d'une commande colorée complexe (`git log --graph --oneline --all --decorate`) avec celle de Windows Terminal, côte à côte.
4. Fermer un pane en pleine sortie.

### Edge Cases

- Chunk contenant une séquence ANSI **coupée en deux** entre deux `onData` : la concaténation la reconstitue naturellement — ne jamais traiter les chunks individuellement.
- Contenu UTF-8 multi-octets scindé entre deux chunks : conserver les données en `Buffer` ou en chaîne cohérente de bout en bout et ne pas décoder chunk par chunk.
- Pane créé puis détruit dans le même intervalle de 16 ms.

## Dependencies

**Must complete first** :
- Task 06 : Grille N×M multi-panes

**Blocks** :
- Task 08 (la détection du BEL s'insère dans le batcher)

## Related Documentation

- **ARCHI** : ADR-005 ; § Le batching de sortie (le point chaud)
- **PRD** : Feature 2, critère « sans dégradation visible par rapport à Windows Terminal »

---
**Estimated Time** : 2 h
**Phase** : Core
