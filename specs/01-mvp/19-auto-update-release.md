# Task 19 : Auto-update et workflow de release

## Context

Dernière tâche du MVP, préalable à la publication open-source (jalon M5 du PRD). L'auto-update n'a d'intérêt qu'une fois le projet distribué, mais la plomberie doit exister avant la première release publique — la rétrofitter obligerait les premiers utilisateurs à réinstaller à la main.

Une réserve d'ARCHI encadre cette tâche : **une mise à jour ne doit jamais s'appliquer pendant qu'un pane tourne.** Redémarrer l'application sous les pieds de l'utilisateur tuerait ses serveurs de dev et ses sessions Claude.

## Scope

Intégration d'`electron-updater`, workflow GitHub Actions de release, et documentation de publication.

## Implementation Details

### Files to Create/Modify

- `package.json` — `electron-updater`
- `electron-builder.yml` — bloc `publish` vers GitHub
- `src/main/services/updater.ts` — nouveau
- `src/renderer/components/UpdateBanner.tsx` — nouveau
- `.github/workflows/release.yml` — nouveau
- `README.md` — installation, avertissement SmartScreen, procédure de release
- `LICENSE` — MIT (cf. PRD)

### Key Functionality

- Vérification des mises à jour au démarrage, puis toutes les 4 h. Jamais de vérification bloquante au lancement — l'ouverture d'un projet en moins de 5 s est une métrique du PRD.
- Téléchargement en arrière-plan, puis bannière discrète « Version X.Y.Z disponible · Redémarrer maintenant · Plus tard ».
- **`autoInstallOnAppQuit` désactivé si des panes tournent.** Interroger le `PtyManager` : s'il reste des PTY vivants, ne jamais installer sans confirmation explicite. C'est la règle la plus importante de cette tâche.
- Échec de vérification (hors ligne, quota GitHub) : silencieux. Une erreur réseau n'a pas à interrompre le travail.
- Auto-update **désactivé en développement** (`app.isPackaged`), sinon `electron-updater` lève une erreur à chaque `npm run dev`.
- Workflow GitHub Actions : déclenché sur un tag `v*`, `runs-on: windows-latest`, `npm ci` (avec la toolchain de build native disponible sur les runners Windows), `npm test`, `npm run dist`, publication en release GitHub.
- README : installation, avertissement SmartScreen assumé, prérequis de développement (VS Build Tools, Python), et procédure de release.

### Technologies Used

- **electron-updater** — mises à jour via GitHub Releases (ARCHI § electron-updater)
- **GitHub Actions** — runner `windows-latest`, gratuit pour un dépôt public

### Architectural Patterns

Le dépôt doit être **public** pour que les releases soient téléchargeables sans jeton. C'est cohérent avec la trajectoire du PRD (perso puis open-source), mais cela signifie que la publication de la première release est aussi la publication du code.

Rappel d'ARCHI : sans signature de code, chaque mise à jour hérite du même avertissement SmartScreen que l'installation initiale. La demande auprès de SignPath Foundation devrait être lancée **avant** la première release publique — le traitement prend du temps.

## Success Criteria

- [ ] Un tag `v0.1.0` poussé déclenche le workflow et produit une release GitHub avec l'installeur et son `latest.yml`
- [ ] Le workflow échoue si `npm test` échoue
- [ ] Une version installée détecte une release plus récente et affiche la bannière
- [ ] « Redémarrer maintenant » installe et relance l'application sur la nouvelle version
- [ ] « Plus tard » masque la bannière sans réinstaller au prochain redémarrage tant que des panes tournent
- [ ] **Aucune mise à jour ne s'installe automatiquement pendant que des panes sont actifs** — à tester explicitement
- [ ] Hors ligne : aucune erreur visible pour l'utilisateur
- [ ] En développement, `npm run dev` ne produit aucune erreur d'updater
- [ ] Le README permet à quelqu'un d'autre d'installer et de builder le projet
- [ ] `LICENSE` MIT présent

## Testing & Validation

### Manual Testing Steps

1. Publier `v0.1.0`, l'installer.
2. Publier `v0.1.1`, relancer la `v0.1.0` installée → bannière attendue.
3. Ouvrir un projet avec des panes actifs, accepter la mise à jour → confirmation explicite requise avant de tuer les process.
4. Refuser, fermer l'application avec des panes actifs → aucune installation silencieuse.
5. Couper le réseau et relancer → aucune erreur visible.
6. Faire tester l'installation par quelqu'un d'autre en suivant uniquement le README.

### Edge Cases

- Release publiée sans `latest.yml` (mauvaise configuration `publish`) : l'updater ne détecte rien — vérifier la présence du fichier dans les assets de la release.
- Downgrade : `electron-updater` ne le gère pas ; ne pas publier de tag antérieur.
- Deux instances impossibles grâce au single-instance lock (Task 14), donc pas de conflit d'installation.
- Runner GitHub échouant à compiler `node-pty` → basculer sur `@lydell/node-pty` (ADR-002), ce qui supprime aussi cette contrainte de CI.

## Dependencies

**Must complete first** :
- Task 18 : Installeur NSIS
- Task 17 : Suite Vitest (la CI l'exécute)
- Task 12 : Trust prompt — **prérequis absolu de toute distribution publique**

**Blocks** : aucune. **Clôture le MVP.**

## Related Documentation

- **ARCHI** : § electron-updater ; § Cost Estimation
- **PRD** : jalon M5 « Dogfooding puis publication MIT »

---
**Estimated Time** : 2-3 h
**Phase** : Polish
