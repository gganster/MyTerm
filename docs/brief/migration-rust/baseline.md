# Référence 0.5.0 et contrat de bascule (T01)

Relevé le 2026-10-17 sur la machine de développement (Windows 11, 0.5.0 installée).

## 1. Mesures de référence

Protocole (script `measure.ps1`, reproduit ci-dessous) : projet de 6 panes sans
`command` (pas de dialogue de confiance), `MyTerm.exe <dossier>` lancé après
arrêt de toute instance, 3 essais.

- Temps = du lancement jusqu'à ce que 6 processus `pwsh` descendent du processus lancé (sondage toutes les 100 ms).
- Mémoire = `WorkingSet64` / `PrivateMemorySize64` des seuls processus `MyTerm.exe` de l'arbre, mesurés 5 s après l'apparition des 6 shells. Shells et enfants exclus.
- Deuxième fenêtre = une première fenêtre ouverte depuis 12 s, puis un second `MyTerm.exe` sur un autre dossier identique.

| Mesure | 0.5.0 Electron | Cible Rust (strictement mieux) |
|---|---|---|
| Installeur `MyTerm-0.5.0-setup.exe` (asset GitHub) | 107 538 812 o (≈ 102,6 Mio) | ≤ 40 Mio |
| Installé (`EstimatedSize`) | 378 110 Kio (≈ 369 Mio) ; 384 238 043 o mesurés sur disque | ≤ 80 Mio |
| RAM d'une fenêtre, working set (4 processus) | 517 / 519 / 515 Mo | ≤ 250 Mo |
| RAM d'une fenêtre, mémoire privée | 354 / 359 / 353 Mo | ≤ 180 Mo |
| `myterm .` → 6 shells lancés | 3,84 / 3,00 / 2,85 s | ≤ 2,0 s |
| Deuxième fenêtre → 6 shells | 1,59 s (une mesure) | ≤ 1,2 s |
| Deux fenêtres, 8 processus, working set | ≈ 1 110 Mo | — |

Limites : « 6 shells lancés » n'est pas « 6 panes affichés » (l'affichage n'est
pas observable sans capture) ; il sous-estime donc légèrement le temps réel,
pour la 0.5.0 comme pour la version Rust, qui devra être mesurée de la même façon.
Le deuxième temps n'a qu'un essai. Les cibles sont une proposition à valider
par l'utilisateur ; le brief demande seulement « mieux » sur les quatre chiffres.

## 2. Identité Windows relevée

- Installation : `%LOCALAPPDATA%\Programs\MyTerm\` (`MyTerm.exe`, `Uninstall MyTerm.exe`).
- Désinstallation : `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\bb20937c-569f-5a89-9956-bcc0a0242b0b` — `DisplayName` « MyTerm 0.5.0 », `UninstallString` `"…\Uninstall MyTerm.exe" /currentuser`, `QuietUninstallString` (…`/S`), `DisplayIcon` `MyTerm.exe,0`, `Publisher` gganster, `NoModify`/`NoRepair` 1, `EstimatedSize`.
- `HKCU\Software\bb20937c-569f-5a89-9956-bcc0a0242b0b` : `InstallLocation`, `KeepShortcuts` = true, `ShortcutName` = MyTerm.
- `HKCU\Software\MyTerm\InstallDir` : lu par le shim `myterm.cmd`.
- Raccourci : `Start Menu\Programs\MyTerm.lnk` → `MyTerm.exe` (aucun raccourci sur le Bureau).
- `resources/app-update.yml` : `provider: github`, `owner: gganster`, `repo: myterm`, `releaseType: draft`, `updaterCacheDirName: myterm-updater`.
- `userData` = `%APPDATA%\MyTerm` (hypothèse du brief confirmée) : `preferences.json`, `instances/`, `.updaterId`, plus les dossiers Chromium. **`instance-icons/` n'existe pas ici** (créé à la demande) ; **`.updaterId`** n'était pas dans la proposition : à conserver.

## 3. `electron-updater` 6.8.9 (code lu)

- `NsisUpdater.doInstall` lance l'exe avec `--updated`, `/S` si silencieux, `--force-run` si relance, **`/D=<dossier>` si `installDirectory` est défini**, et `--package-file=…` seulement pour un installeur web. Le NSIS maison doit donc accepter `/D=` (natif en NSIS).
- Le checksum est obligatoire : sans `sha512` ni `sha2`, `ERR_UPDATER_NO_CHECKSUM` (`providers/Provider.js:127`). Le `latest.yml` actuel (341 o) est le gabarit.
- La signature n'est vérifiée que si `publisherName` figure dans `app-update.yml` ; ce n'est pas le cas, donc un installeur non signé passe.
- `isUpdateAvailable` compare en semver (`gt`) : 0.6.0 > 0.5.0 suffit.
- `.blockmap` : la release 0.5.0 en publie un (113 536 o). Son absence provoque un téléchargement complet (à confirmer en P09).
- La 0.5.0 appelle `quitAndInstall(false, true)` (`src/main/services/updater.ts:108`) avec `autoInstallOnAppQuit = false` : l'installeur n'est lancé que sur clic de la bannière.

## 4. Découvertes pour la suite

- `rustc`/`cargo` locaux : **1.75.0** (2023-11). iced 0.14 et `iced_term` 0.8 demanderont presque certainement une version plus récente : `rustup update` est le premier geste de P01 (version minimale exigée à vérifier).
- Le dépôt `MyTerm(rust)/` n'est pas un dépôt Git : le brief prévoit une bascule vers `main` de `gganster/myterm`, donc aucun commit par unité n'est possible tant que ce n'est pas réglé.

## 5. Mesures Rust (T09, 2026-10-17, même machine, `measure-rust.ps1`)

Même protocole que la section 1 (projet de 6 panes sans `command`, 3 essais), sans arrêt de processus par
nom (le `myterm.exe` de dev et le `MyTerm.exe` installé portent le même nom sous Windows). Fenêtres lancées
avec un `%APPDATA%` isolé.

| Mesure | 0.5.0 Electron | Rust | Cible | Verdict |
|---|---|---|---|---|
| Installeur | 107 538 812 o | 4 721 023 o (`MyTerm-0.6.0-setup.exe`) | ≤ 40 Mio | tenue |
| Installé | ≈ 369 Mio | `myterm.exe` 16,7 Mo + shim | ≤ 80 Mio | tenue |
| RAM d'une fenêtre, working set | 517 / 519 / 515 Mo (4 processus) | 60 / 60 / 60 Mo (1 processus) | ≤ 250 Mo | tenue |
| RAM d'une fenêtre, privée | 354 / 359 / 353 Mo | 62 / 62 / 62 Mo | ≤ 180 Mo | tenue |
| `myterm .` → 6 shells (sondage CIM) | 3,84 / 3,00 / 2,85 s | 2,90 / 1,79 / 1,72 s | ≤ 2,0 s | meilleure à chaque essai ; cible tenue sur 2 essais sur 3 (le premier est à froid) |
| Deuxième fenêtre → 6 shells (sondage CIM) | 1,59 s (1 essai) | 1,72 s (1 essai ; 1,65 à 2,6 s sur 4 essais d'un autre relevé) | ≤ 1,2 s | **non démontrée** |
| Deux fenêtres, working set | ≈ 1 110 Mo | 122 Mo | — | — |

Ce que montre l'horodatage exact (`StartTime` de chaque `pwsh`, sans sondage) : en Rust les 6 shells sont
lancés entre 0,28 s et 0,67 s après le lancement. Le « 1,7 s » du protocole est donc surtout la latence du
sondage `Get-CimInstance` (~0,3 à 1 s par passe), la même que celle qui a produit les chiffres Electron.
Comparer exactement exigerait la même mesure sur la 0.5.0 (horodatage exact et plusieurs essais pour la
deuxième fenêtre), non faite : cela lance le `MyTerm.exe` installé.

Optimisation faite pendant la mesure : la première mesure de police charge toutes les polices installées
(~300 ms) et précédait le lancement des shells ; elle passe après (`Terminal::measure_font`).
