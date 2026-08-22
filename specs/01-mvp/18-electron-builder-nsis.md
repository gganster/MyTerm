# Task 18 : Installeur NSIS et installation du CLI dans le PATH

## Context

Première fois que l'application quitte l'environnement de développement. Deux pièges connus, tous deux documentés dans ARCHI : un module natif ne se charge pas depuis une archive asar, et la modification du `PATH` doit rester au niveau **utilisateur** pour ne pas exiger de droits administrateur ni polluer la machine.

## Scope

Un `.exe` d'installation qui produit une application fonctionnelle sur une machine propre, avec `myterm` disponible dans le terminal.

## Implementation Details

### Files to Create/Modify

- `electron-builder.yml` — configuration de build
- `build/installer.nsh` — script NSIS personnalisé (`PATH` + shim)
- `build/icon.ico` — icône multi-résolutions
- `package.json` — scripts `dist` et `pack`
- `resources/myterm.cmd` — shim de Task 14, empaqueté

### Key Functionality

- Cible **NSIS x64** uniquement (Windows 11, cf. PRD).
- **`asarUnpack: ["**/node_modules/node-pty/**"]`** — un fichier `.node` ne se charge pas depuis une archive asar. C'est l'erreur la plus fréquente de cette étape ; elle ne se manifeste **qu'en build packagé**, jamais en dev.
- `extraResources` pour `myterm.cmd`.
- `installer.nsh` : à l'installation, créer `%LOCALAPPDATA%\MyTerm\bin`, y copier le shim, et ajouter ce dossier au `PATH` **utilisateur** (`HKCU\Environment`), en diffusant `WM_SETTINGCHANGE` pour que les nouveaux terminaux le voient sans redémarrage de session. À la désinstallation, retirer l'entrée — **sans détruire le reste du `PATH`**, ce qui est le risque majeur d'un script NSIS mal écrit.
- Installeur par utilisateur (`perMachine: false` **et `allowElevation: false`**) : pas d'élévation UAC, désinstallation propre. Les deux sont nécessaires : `perMachine: false` seul laisse la page de mode d'installation et son option « Tous les utilisateurs » active, et une installation élevée par ce biais pose `$INSTDIR` dans *Program Files* pendant qu'`installer.nsh` continue d'écrire dans le `HKCU` et le `%LOCALAPPDATA%` de l'**administrateur** — l'utilisateur qui a demandé MyTerm n'a alors ni `PATH`, ni menu contextuel.
- **Menu contextuel de l'explorateur** (ajouté après coup) : deux verbes en `HKCU\Software\Classes`, `Directory\shell\MyTerm` (« Ouvrir dans MyTerm ») et `Directory\Background\shell\MyTerm` (« Ouvrir MyTerm ici »), commande `"$INSTDIR\MyTerm.exe" "%V"`, retirés à la désinstallation. Détails et pièges dans ARCHI § Le menu contextuel de l'explorateur.
- **Le démontage est sauté pendant une mise à jour** (`${ifNot} ${isUpdated}`) : electron-builder lance l'ancien désinstalleur avant de copier les nouveaux fichiers, et une copie qui échoue laisse une application fonctionnelle mais privée de son `PATH`, de son shim et de ses verbes.
- Le shim doit résoudre l'exécutable installé, pas un chemin de développement.
- Numéro de version issu du `package.json`, nom d'artefact incluant la version.
- Icône déclinée en 16/32/48/256 px dans le `.ico`.

### Technologies Used

- **electron-builder** — cible NSIS (ARCHI § electron-builder)
- **NSIS** — script d'installation personnalisé

### Architectural Patterns

L'application n'est **pas signée** au MVP : SmartScreen affichera un avertissement. C'est un choix assumé pour un usage personnel (ARCHI § Cost Estimation), à traiter avant la diffusion publique — la piste retenue est SignPath Foundation, gratuite pour les projets open-source.

## Success Criteria

- [ ] `npm run dist` produit un `.exe` d'installation
- [ ] L'installation réussit **sans élévation UAC**
- [ ] L'application installée démarre et **les terminaux fonctionnent** — c'est le test qui valide l'`asarUnpack`
- [ ] Ouvrir un nouveau terminal après installation : `myterm --help` ou `myterm .` est reconnu
- [ ] `myterm .` depuis un projet ouvre bien l'application installée
- [ ] Clic droit **sur** un dossier : *Ouvrir dans MyTerm* (sous « Afficher plus d'options » en Windows 11) ouvre ce dossier
- [ ] Clic droit **dans le vide** d'un dossier ouvert : *Ouvrir MyTerm ici* ouvre ce dossier — y compris à la racine d'un lecteur (`C:\`), le cas où `%V` garde son antislash final
- [ ] Plusieurs dossiers sélectionnés : l'entrée **n'apparaît pas** (une seule fenêtre, pas six lancements)
- [ ] Installation par-dessus une version existante **dans un autre dossier** : les deux verbes pointent vers le nouveau `$INSTDIR`
- [ ] La désinstallation retire l'application, le shim, l'entrée de `PATH` et **les deux verbes** — **et le reste du `PATH` est intact** (comparer avant/après), et les verbes des autres applications sous `Directory\shell` aussi
- [ ] L'icône est correcte dans la barre des tâches, le menu Démarrer et l'explorateur
- [ ] Le test est fait sur une machine (ou un compte utilisateur) **sans environnement de développement**
- [ ] La taille de l'installeur est cohérente (~80–120 Mo)

## Testing & Validation

### Manual Testing Steps

1. `npm run dist`, installer sur la machine de développement.
2. **Sauvegarder la valeur du `PATH` utilisateur avant installation** (`[Environment]::GetEnvironmentVariable('Path','User')`).
3. Lancer l'app installée, ouvrir un projet réel : les six panes doivent démarrer. Si les terminaux restent vides, l'`asarUnpack` est en cause.
4. Ouvrir un nouveau PowerShell, taper `myterm .` depuis un projet.
5. Désinstaller, comparer le `PATH` avec la valeur sauvegardée.
6. Réinstaller sur un compte utilisateur Windows vierge, sans Node ni VS Build Tools — c'est le vrai test de portabilité.

### Edge Cases

- `PATH` utilisateur proche de la limite de longueur : ne pas le tronquer.
- Installation par-dessus une version existante : mise à jour propre, pas de doublon dans le `PATH`.
- Nom d'utilisateur Windows contenant des accents (le `%LOCALAPPDATA%` en hérite).
- SmartScreen bloque le lancement : documenter la procédure de contournement dans le README (« Informations complémentaires » → « Exécuter quand même »).

## Dependencies

**Must complete first** :
- Task 14 : CLI et instance unique
- Task 12 : Trust prompt — **ne pas distribuer un binaire sans ce contrôle**

**Blocks** :
- Task 19 : Auto-update et CI de release

## Related Documentation

- **ARCHI** : § electron-builder ; § Cost Estimation (signature de code)
- **PRD** : jalon M5

---
**Estimated Time** : 2-3 h
**Phase** : Polish
