# Trace: migration-rust

Pas de dépôt Git dans `MyTerm(rust)/` : aucun commit par unité n'est possible (voir plus bas).

## T01 - fait (2026-10-17)
Référence mesurée et contrat de bascule relevé : `baseline.md`.

## T02 - fait (2026-10-17)
Crate `myterm` (lib) : `schema/` (layout, migration v1, édition, préférences, fusion), `trust`, `atomic`, `cwd`, `workspace`, `collate`.

Preuve : `cargo test` = 36 tests verts.
- `tests/parity.rs` : 9 tests différentiels contre le code Electron 0.5.0 lui-même (`tools/fixtures/gen.mjs` génère `tests/fixtures/*.json` : 703 fichiers `.myterm.json`, 500 éditions, 400 hash de confiance, 2000 comparaisons de collation, 600 fusions de préférences, 144 résolutions de `cwd`). Messages d'erreur Zod compris.
- `tests/ports.rs`, `tests/atomic.rs` : cas Vitest portés (resolve-cwd, trust-hash, workspace-read, atomic-write et verrou).
- `cargo run --example real_data` : le vrai `preferences.json` se relit et se réécrit à l'octet près ; les 4 approbations de projets ayant des commandes sont reconnues.

Écarts connus :
- `malformed-json` : le détail vient de `serde_json`, pas de V8 (le type d'échec est identique, le texte non).
- Un `.myterm.json` contenant un substitut UTF-16 isolé (`"\ud800"`) est refusé comme JSON invalide (`serde_json`) ; 0.5.0 l'acceptait. Refus sûr.
- Collation : exacte pour l'ASCII et les lettres latines accentuées (Latin-1, Latin étendu A). Autres écritures : ordre par code point. Au pire une approbation redemandée.
- `rustc` 1.75 : `tempfile` récent ne se compile pas, d'où l'aide de test maison. À reprendre avec la mise à jour de la chaîne (P01).

## T03 - presque fait (2026-10-17)
Widget terminal copié et corrigé dans `src/term/`, palettes (`src/palette.rs`), `src/platform.rs`. Verdict du spike P01 et liste des correctifs : `spike-p01.md`.
Preuve : `cargo test --lib` (accords clavier, capture de commande, glyphes, 5000 lignes de scrollback et saisie sur vrai ConPTY, sélection) ; `tests/parity.rs` (palettes) ; mesures et captures du spike.
Reste : `codex` à essayer dans l'application réelle, clignotement du curseur, rendu par défaut (tiny-skia proposé) à confirmer.

## T04 - fait (2026-10-17), avec le curseur qui clignote (demande de l'utilisateur)
Application `myterm` (`src/main.rs`, `src/app.rs`) : ouverture (`open.rs`, jeton `Approved`), dialogue de confiance à trois choix, grille responsive (`grid.rs`), en-têtes et badges (`status.rs`), barre des panes réduits, zoom et accords clavier (`chords.rs`, `view_state.rs`), préférences partagées (`prefs_store.rs`), palette chrome (`palette_chrome.rs`, générée).
Preuve : `cargo test` = 148 tests verts (111 lib, 9 verrou/écriture, 10 parité, 18 portés). Vérifié dans la vraie fenêtre, sur un projet de 6 panes (APPDATA isolé) :
- dialogue listant les 5 commandes (cwd, shell → commande, sans ligature) ; Approuver : les 5 commandes tournent dans leur cwd ; Ouvrir sans exécuter : aucune commande, aucune approbation écrite ; Annuler : rien ne s'ouvre, rien n'est écrit.
- colonnes : 3 au-dessus de 1600 px, 2 au-dessus de 1200, 1 en dessous (lignes à 200 px minimum, la zone défile).
- BEL : badge « attend une réponse » ; Ctrl+Shift+←→/5/M/Z et Échap ; pane réduit : le processus tourne (le « tunnel » a imprimé pendant qu'il était dans la barre), survol = nom + dernière commande, clic = retour dans la grille.
- curseur : la couleur du pixel alterne entre le bleu du thème et le blanc, toutes les 600 ms ; seul le pane actif clignote.
Écarts : pas de pulsation du badge « attend une réponse » ; l'écriture des préférences se fait toutes les 500 ms, donc une fermeture dans les 500 ms qui suivent un changement le perd ; thème système lu une fois au démarrage (bascule = T05) ; la géométrie de la fenêtre n'est pas encore restaurée (T06).


## T05 - en cours (2026-10-17)
Écrit : `ui.rs`, `editor.rs`, `home.rs`, `logo_icon.rs`, `identity.rs`, `external_editor.rs`, `platform.rs` (thème système, id de fenêtre, heure locale), `app.rs` (en-tête teinté, thème, autosave 1 s, Ctrl+S, bannière de rechargement, éditeurs externes).
Preuve : `cargo test` vert (121 lib, 9 verrou, 14 parité dont logo pixel à pixel, teinte, ids, éditeurs, 19 portés). Fenêtre réelle : en-tête violet + pastille, panneau Layout, couleur/titre/commande sauvegardés ~1 s après, Redémarrer relance avec la nouvelle commande, + Pane crée et sauvegarde, accueil avec récents.
Reste à voir à l'œil : bouton de barre des tâches par couleur, bannière de rechargement (modif externe), Ctrl+S, supprimer/déplacer, thème sombre, sélecteurs de dossier. Bannière de mise à jour : T08.

### T05 - clos (2026-10-17)
Vérifié en fenêtre réelle (APPDATA isolé) : bannière de rechargement sur modification externe (fichier modifié → bannière → *Recharger* applique le titre sans relancer le pane inchangé), thème sombre (terminaux repeints), Ctrl+S, case « Démarrer réduit » écrite, déplacement d'un pane, confirmation de suppression d'un pane qui tourne. Bouton de barre des tâches : icône teintée violet vue sur la barre.
Non vérifié : sélecteurs de dossier natifs (accueil, cwd « … »), bouton de barre des tâches pour chaque couleur (une seule vue), bannière de mise à jour (T08).

### T06 - clos (2026-10-17)
Ajouts : `src/instances.rs` (registre `instances/<pid>.json`, battement par mtime, entrées mortes ou à pid recyclé balayées, élection de la plus ancienne ; 10 tests dont les 9 cas de `instances.test.ts`), `src/window_geometry.rs` (`visibleBounds`, cascade de 32 px sur 8 pas bornée à la zone de travail ; 6 tests), câblage `main.rs`/`app.rs` (position, taille et état maximisé restaurés et enregistrés, battement toutes les 60 s, fermeture : préférences écrites puis désinscription). Préférences/approbations partagées : fusion déjà portée en T02 (`preferences-merge`), non retouchée.
Vérifié en fenêtre réelle (APPDATA isolé) : 3 instances → (100,80), (132,112), (196,176) ; redémarrage après un déplacement → même position ; fermeture normale → fichier d'instance retiré.
Écart assumé : la 3e instance part de la géométrie enregistrée par la 2e (+32 déjà inclus), comme en 0.5.0, où chaque instance enregistre la sienne.
Limites : état maximisé non vérifié en fenêtre ; un seul facteur d'échelle (DPI système) pour les zones de travail, écart possible en multi-écran à DPI mixtes ; taille enregistrée = zone cliente (0.5.0 : fenêtre entière), sans effet tant que 0.5.0 et Rust ne se partagent pas un fichier de préférences en cours d'usage.

### T07 - clos (2026-10-17)
Ajouts : `src/quota.rs`, `src/system_load.rs`, `src/usage.rs` (lecteurs Claude et Codex, planification, dégradation, un thread de relevé par fournisseur), `src/status_bar.rs` (pied de page dans toutes les vues ; logos Claude et rosace Codex dessinés au canvas), câblage `app.rs` (`BarTick` 2 s). Fixtures : `quotaCases` (gen.ts), 5 tests de parité (fenêtres/dates, textes, charge, charges utiles et jetons, délais et dégradation) tous verts ; 148 tests de lib.
Constat mesuré : avec la pile TLS du système (schannel), chatgpt.com répond 403 `cf-mitigated: challenge` en permanence ; rustls obtient le JSON (200). Retenu : `ureq` + rustls, racines web intégrées (une CA d'entreprise ou un proxy système est ignoré).
Vérifié en fenêtre réelle avec les vrais identifiants : Claude « 5 h 21 % ↻ 3 h 28 │ 7 j 14 % ↻ 21 h 18 » barres orange, Codex « 7 j 0 % ↻ 6 j 23 h » barre verte, CPU et RAM ; dossier utilisateur vide → « Aucune session Claude/Codex sur cette machine » pour chaque barre, sans chemin ni jeton.
Non vérifié à l'œil : barre rouge au-delà de 90 % et `⋯` (logique identique à Electron par les tests de parité, rendu non vu), infobulles, ordre de grandeur CPU contre le Gestionnaire des tâches.

### T08 - en cours (2026-10-17) : 2 cases sur 3
Ajouts : `installer/` (`myterm.nsi`, `paths.nsh`, `build.ps1`, shim `myterm.cmd`, `path-entry.ps1` paramétré, icône, plugin WinShell), `build.rs` (icône dans l'exécutable), `src/updater.rs`, bannière de mise à jour dans `app.rs`, `.github/workflows/{ci,release}.yml`, `tests/installer.rs` (17 tests : contrat de l'installeur, garde-fous du workflow). 158 tests de lib, 9 + 17 + 19 + 19 verts.
Installeur : par utilisateur (`RequestExecutionLevel user`), même dossier (`%LOCALAPPDATA%\Programs\MyTerm`), même `MyTerm.exe`, même clé « Applications installées » (`bb20937c-…`, relevée en lecture seule sur la 0.5.0 installée), mêmes arguments que le 0.5.0 (`/S --updated --force-run`), raccourcis avec l'AppUserModelID. 4,7 Mo.
Vérifié en réel avec la variante SANDBOX (mêmes scripts, clés sous `HKCU\Software\MyTermSandbox`, dossier sous `%TEMP%`, rien de la 0.5.0 touché) : installation silencieuse → fichiers, menu contextuel (2 verbes, `%V`, `Single`), PATH (REG_EXPAND_SZ et entrées existantes conservés), raccourci, entrée de désinstallation ; désinstallation → PATH revenu à l'identique, clés retirées. Mise à jour de bout en bout : dossier local servant `latest.yml` 0.7.0 + installeur, appli en mode dev (`MYTERM_UPDATE_BASE`) → bannière « Version 0.7.0 disponible. Redémarrer fermera les panes… », clic → l'appli se ferme, l'installeur installe, `--force-run` relance. Le nettoyage (clés sandbox, dossier, téléchargement) est fait.
Non fait / non vérifié :
- `release.yml` écrit (port du workflow 0.5.0 : version X.Y.Z, non-régression, brouillon → téléversement → publication, `latest.yml` exigé) et testé statiquement, mais jamais exécuté : il faut GitHub et un dépôt. Le téléversement passe par l'API (`uploads.github.com`) au lieu d'electron-builder : à voir tourner au premier vrai run. Case 2 non cochée.
- L'installeur réel (non sandbox) n'a pas été lancé : il remplacerait l'installation 0.5.0 de cette machine (menu contextuel, PATH, raccourcis). C'est le test de T09.
- Aucune vérification d'élection avec deux fenêtres en réel (logique couverte par `instances.rs`) ; confirmation « autres fenêtres » non vue à l'écran.
- Le nettoyage des fichiers Electron laissés dans le dossier d'installation (AC14, « aucune trace ») est laissé à T09.
- Installeur non signé : SmartScreen avertira, comme la 0.5.0.

### T09 - en cours (2026-10-17) : aucune case cochée
Fait :
- Mesures Rust relevées (baseline.md §5) : installeur, installé, RAM (1 processus, 62 Mo privés), ouverture à 6 shells tiennent ou battent la référence ; **deuxième fenêtre non démontrée** (voir baseline.md). Optimisation : la mesure de police (~300 ms) passe après le lancement des shells.
- Installeur : retrait par nom des fichiers Electron laissés dans le dossier (`removeElectronTraces`, déclenché seulement si `resources\app.asar` existe), clé `HKCU\Software\bb20937c-…` d'electron-builder et cache `%LOCALAPPDATA%\myterm-updater`. Les données utilisateur (`%APPDATA%\MyTerm`) ne sont pas nommées. Vérifié sur la variante SANDBOX contre un faux dossier 0.5.0 (28 fichiers aux noms réels) : il ne reste que les fichiers de la version Rust et le fichier de l'utilisateur. `tests/installer.rs` : 18 tests.
Pas fait, et pourquoi :
- Mise à jour d'une 0.5.0 réelle : elle passe par une release publiée sur `gganster/myterm` (action publique, `latest.yml` lu par la 0.5.0) ou par un installeur réel lancé sur cette machine, qui remplace la 0.5.0 installée (menu contextuel, PATH, raccourci, clé de désinstallation). Demande l'accord de l'utilisateur.
- Relevé exact de la 0.5.0 (deuxième fenêtre) : lance le `MyTerm.exe` installé ; refusé en cours de session, donc non fait.
- Deux semaines d'usage quotidien : ne peut pas se faire en une session.

### T08 - clos (2026-10-18) / T09 - suite
Accord de l'utilisateur (2026-10-18) : installer pour de vrai et publier ; **pas** lancer la 0.5.0 pour la mesure.
Fait :
- Sauvegarde de la 0.5.0 réelle (`backup-0.5.0.ps1` : 233 fichiers, 5 clés, PATH brut, raccourci, `preferences.json` → `..\backup-0.5.0-install`, restauration par `-Restore`).
- Installeur réel lancé en silencieux sur la 0.5.0 : une seule entrée « Applications installées » (clé `bb20937c-…`, `MyTerm 0.6.0`), clé et cache electron-builder retirés, dossier d'installation réduit aux fichiers Rust, menu contextuel (2 verbes, `%V`), raccourci du menu Démarrer conservé, PATH (31 entrées conservées, 1 entrée MyTerm, type `REG_EXPAND_SZ`), `preferences.json` identique octet pour octet, `.updaterId` conservé, une 2e exécution est idempotente. Défaut trouvé et corrigé : l'installeur créait un raccourci Bureau que la 0.5.0 n'avait pas ; il n'en crée plus qu'à la première installation (raccourci retiré à la main).
- Dépôt Git créé (branche orpheline `rust` de `gganster/MyTerm`, 2 commits). CI réelle : un premier échec utile (le test cwd dépendait du lecteur du processus : le runner est sur `D:`), corrigé en épinglant `C:\` dans le test et dans le générateur de fixtures ; puis CI verte (tests + installeur + artefact).
- `release.yml` exécuté pour de vrai : à blanc (vert), puis publication : release `v0.6.0` (Latest), assets `MyTerm-0.6.0-setup.exe` (4 722 473 o) et `latest.yml`, publiée par la promotion du workflow. L'updater Rust interrogé sur le vrai canal GitHub : depuis 0.5.0 → `Ready 0.6.0` (sha512 vérifié), depuis 0.6.0 → rien (`examples/real_update.rs`).
Reste pour T09 :
- La mise à jour par l'updater Electron de la 0.5.0 elle-même n'a pas été exercée (cela demande de restaurer et lancer la 0.5.0 ; non autorisé). Elle est lue dans le code de `electron-updater` (T01) : `latest.yml` au même format, `sha512`, `/S --updated --force-run`, `/D=` accepté.
- Non vérifiés : bouton épinglé de la barre des tâches, géométrie de fenêtre d'une 0.5.0 (fichier lu, pas de fenêtre ouverte).
- Deuxième fenêtre : non démontrée meilleure (voir baseline.md §5) ; mesure exacte de la 0.5.0 non faite.
- Deux semaines d'usage quotidien.

### T04 - codex vérifié (2026-10-18)
`codex --no-daemon` dans un pane : l'interface (gras, vidéo inverse de la sélection, lien souligné, mise en page) s'affiche correctement en thème sombre et clair. `codex` seul répond « start the Windows daemon from a non-elevated terminal » : la session qui lance MyTerm est élevée, ce n'est pas un défaut du terminal. Comparaison avec la 0.5.0 non faite (elle demanderait de la lancer).

### T09 - mise à jour réelle par l'updater de la 0.5.0 (2026-10-18)
Accord de l'utilisateur pour lancer la 0.5.0. Restauration depuis la sauvegarde (script corrigé : un `reg delete` sur une clé absente arrêtait la restauration), puis le `MyTerm.exe` 0.5.0, lancé sur `measure6`, a trouvé la release et affiché « Version 0.6.0 disponible. Redémarrer fermera les panes… » (sha512 vérifié par `electron-updater`).
Défaut trouvé : l'updater de la 0.5.0 lance l'installeur avec `--updated --force-run` **sans `/S`** (`quitAndInstall(false, true)`), la fenêtre de l'installeur s'ouvrait sur la page du dossier et attendait un clic. Corrigé (pages dossier et fin sautées, fermeture automatique, vérifié en 4,6 s sur la variante SANDBOX), publié en `v0.6.1` par le workflow.
Deuxième essai, réel : clic sur « Redémarrer maintenant » dans la 0.5.0 → installation sans interaction → `MyTerm 0.6.1` seule entrée dans « Applications installées », exécutable Rust de 16 Mo, plus de `app.asar`, application relancée depuis le dossier d'installation (`--force-run`), menu contextuel, raccourci (pas de raccourci Bureau), PATH (31 entrées, une MyTerm, `REG_EXPAND_SZ`), `.updaterId` conservés ; `preferences.json` : seul `lastOpenedAt` du projet `measure6` a changé (les lancements d'Electron ignorent `APPDATA`).
Reste visible : le cache `%LOCALAPPDATA%\myterm-updater` (l'installeur tourne depuis ce dossier et ne peut pas le supprimer) : retiré au démarrage de la version suivante (`updater::remove_electron_updater_cache`, 0.6.2).
Non vérifié : le bouton épinglé de la barre des tâches. Deux semaines d'usage : à faire.
