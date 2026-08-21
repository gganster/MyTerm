# Task 17 : Suite Vitest sur la logique pure

## Context

Décision d'ARCHI : tester ce qui casse silencieusement, laisser le terminal se vérifier à la main. Pas de Playwright au MVP — le rapport coût/valeur d'un E2E Electron est mauvais tant que l'application est utilisée quotidiennement par son auteur.

Les cinq domaines ciblés partagent une propriété : ce sont des fonctions pures, sans Electron, sans système de fichiers, sans PTY. C'est précisément pour cela qu'elles ont été conçues ainsi dans les tâches précédentes.

## Scope

Configuration Vitest et couverture des cinq zones désignées par ARCHI. Aucun test d'interface, aucun test de PTY.

## Implementation Details

### Files to Create/Modify

- `package.json` — `vitest`, scripts `test` et `test:watch`
- `vitest.config.ts`
- `tests/schema/layout.test.ts`
- `tests/util/resolve-cwd.test.ts`
- `tests/services/pane-status-machine.test.ts`
- `tests/services/output-batcher.test.ts`
- `tests/services/trust-hash.test.ts`
- `tests/fixtures/layouts/*.json`

### Key Functionality

**1. Validation du layout** (Task 10) — layout valide, valeurs par défaut appliquées, `id` dupliqués, `col`/`row` hors grille, deux panes sur la même cellule, `version: 2`, JSON malformé, fichier vide, BOM UTF-8. Vérifier aussi le **contenu** des messages d'erreur, pas seulement le fait qu'une erreur survienne : un message illisible est un bug.

**2. Résolution des `cwd`** (Task 10) — chemins relatifs simples et imbriqués, `.`, séparateurs mixtes `/` et `\`, rejet de `..` sortant, casse Windows (`C:\Proj` vs `c:\proj`), et le piège du préfixe : `C:\proj2` ne doit **pas** être considéré comme enfant de `C:\proj`.

**3. Machine d'état des panes** (Task 08) — `\x07` → `attention` ; saisie utilisateur → retour à `running` ; sortie continue → jamais `attention` ; silence prolongé → `idle` ; `onExit` → `exited` avec le code ; séquence OSC 133 scindée entre deux chunks.

**4. `OutputBatcher`** (Task 07) — coalescence de N chunks en un message ; ordre strictement préservé ; contre-pression au-delà du seuil avec marqueur de troncature ; séquence ANSI coupée entre deux chunks reconstituée ; pane tué pendant qu'un flush est programmé ; caractère UTF-8 multi-octets scindé. Le batcher étant construit avec un callback d'émission injecté, il se teste sans Electron ; utiliser les faux timers de Vitest.

**5. Hash de confiance** (Task 12) — hash stable pour deux layouts identiques d'ordre différent ; hash **inchangé** si seul le titre ou la position change ; hash **modifié** si `command`, `cwd` ou `shell` change ; normalisation des chemins Windows.

### Technologies Used

- **Vitest** — même moteur Vite que le build, aucune configuration supplémentaire
- Faux timers de Vitest pour le batcher et les délais d'inactivité

### Architectural Patterns

Aucun mock d'Electron, aucun mock de `node-pty`. Si un test en exige un, c'est le signe que la fonction testée n'est pas pure et doit être refactorisée — les tâches 07, 08, 10 et 12 ont explicitement prévu cette séparation.

## Success Criteria

- [ ] `npm test` exécute la suite en moins de 5 s
- [ ] Les cinq domaines sont couverts, avec au moins un cas nominal et tous les cas limites listés ci-dessus
- [ ] Les tests d'erreur vérifient le contenu du message, pas seulement le fait qu'une erreur soit levée
- [ ] Aucun mock d'Electron ni de `node-pty` dans la suite
- [ ] La suite passe au vert sur un `git clone` propre suivi d'un `npm install`
- [ ] Un test échoue effectivement si l'on introduit volontairement une régression (vérifier au moins une fois par domaine)

## Testing & Validation

### Manual Testing Steps

1. `npm test` → tout au vert.
2. Casser volontairement `resolveCwd` en supprimant la vérification du `..` → le test correspondant doit échouer.
3. Inverser l'ordre de concaténation dans le batcher → le test d'ordre doit échouer.
4. Retirer la vérification d'unicité des `id` du `superRefine` → le test doit échouer.
5. `npm test` depuis un clone frais.

### Edge Cases

- Les tests dépendant du temps doivent utiliser des faux timers, jamais de `sleep` réel — sinon la suite devient lente et instable.
- Les tests de chemins doivent être écrits pour Windows (séparateurs `\`, lettres de lecteur) puisque c'est la seule plateforme cible du MVP.

## Dependencies

**Must complete first** :
- Task 07, Task 08, Task 10, Task 12 (le code à tester)

**Blocks** : aucune, mais devrait précéder la publication.

## Related Documentation

- **ARCHI** : § Tests
- **PRD** : critères de fiabilité (couverture déclarative, fidélité du terminal)

---
**Estimated Time** : 3 h
**Phase** : Polish
