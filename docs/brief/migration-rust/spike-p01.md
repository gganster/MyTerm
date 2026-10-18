# Spike P01 : verdict (2026-10-17)

6 panes `pwsh` dans iced 0.14 + `iced_term` 0.8 (copié dans `src/term/`), mesurés avec le protocole de `baseline.md`.
`spike/` est jetable ; le widget copié et ses correctifs sont du code produit.

## Verdict : la pile tient. Rendu par défaut proposé : tiny-skia (logiciel).

| Mesure (6 panes) | 0.5.0 Electron | iced + wgpu | iced + tiny-skia |
|---|---|---|---|
| RAM, working set | 517 Mo | 214 Mo | **51 à 53 Mo** |
| RAM, mémoire privée | 354 Mo | 294 Mo | **58 Mo** |
| `myterm .` → 6 shells | 2,85 à 3,84 s | 1,5 à 1,8 s | 1,6 à 2,2 s |
| CPU au repos (20 s) | non mesuré | 0,06 s | 0,00 s |
| Rafale 6 × 30 000 lignes : CPU / pic RAM | 8,1 s / 603 Mo | 7,5 s / 272 Mo | **4,5 s / 101 Mo** |

Les deux rendus battent la 0.5.0 sur la RAM et l'ouverture. Cibles de `baseline.md` (≤ 250 Mo WS, ≤ 180 Mo privé) : tiny-skia les tient ; wgpu tient le WS mais pas le privé.
Le rendu se choisit à l'exécution (`ICED_BACKEND=tiny-skia`). Décision à confirmer par l'utilisateur.

Un premier jeu de chiffres de rafale était faux : la commande n'était pas exécutée (mauvais échappement `SendKeys`). Les chiffres ci-dessus viennent de la seconde mesure, avec un script de rafale et une capture qui montre `FIN-BURST` dans les 6 panes. Électron mesuré avec le même script.

## Accords clavier (clavier AZERTY de l'utilisateur, vraies frappes)

- `Ctrl+Shift+←↑→↓ / 1 / 5 / 9 / Z / M / C` : l'application les reçoit, le shell ne reçoit rien.
- `Ctrl+C`, `Ctrl+D`, `Ctrl+L`, `Ctrl+R`, `Échap`, `Entrée` : atteignent le shell. `Ctrl+Entrée` envoie `\n`.
- Piège AZERTY : la touche logique de la rangée des chiffres est le symbole non décalé (`&` pour 1, `ç` pour 9). Les chiffres se reconnaissent donc par la touche **physique** (`Code::Digit1..9`), les lettres par la touche logique.
- `Ctrl+Shift+C` copie la sélection et ne touche pas au presse-papiers quand rien n'est sélectionné.

## Ce que `iced_term` 0.8 ne faisait pas, corrigé dans `src/term/`

1. Ses liaisons par défaut avalent `Ctrl+Shift+←↑→↓/Z/M…` et les envoient au shell : ajout d'un filtre `reserved` (événement complet).
2. Scrollback fixé à 10 000 : 5000, comme la 0.5.0.
3. Chaque morceau de sortie clonait tout le scrollback, et chaque repaint re-mesurait la police : copie supprimée, mesure faite une fois.
4. Chaque repaint prévenait le shell d'un redimensionnement, ce qui lui faisait redessiner son prompt, donc produisait une sortie, donc un repaint : boucle sans fin qui effaçait aussi toute sélection. Le shell n'est prévenu que si la grille change.
5. Cellules arrondies au pixel entier (7 px pour une police de 7,8 px) : les lignes débordaient. Cellules en flottant, texte groupé par séries.
6. Pas de limite de repaint : un repaint au plus toutes les 33 ms, plus un repaint final.
7. Cadres et blocs (`─│┌┐╭` `▀▄█▌░▒▓` …) dessinés en rectangles (la police laisse des trous entre les lignes) ; barré ; soulignement dans la cellule ; sélection et curseur aux couleurs de la palette, curseur creux hors focus.
8. `Ctrl+Entrée` → `\n` ; copie vide sans effet.
9. Un parent qui ignore Ctrl+C le transmet à tous les shells : `restore_default_ctrl_c()` (`src/platform.rs`). Sans lui `npm run dev` ne s'interrompait pas dans l'environnement de test, alors qu'Electron s'interrompait.

## Vérifié

- `claude` (dialogue de confiance), `pwsh`, `npm run dev` (sortie colorée, `Ctrl+C` l'interrompt) : rendu correct. Couleurs 16/256/truecolor, gras, italique, souligné, barré, inversé, Unicode, emoji.
- Palettes claire et sombre : valeurs identiques à `palette.ts` (test différentiel) ; rendu clair et sombre contrôlé sur capture.
- Redimensionnement : fenêtre réduite, les shells voient `69x31` puis `38x17` dans les 6 panes.
- Rafale de 6 × 30 000 lignes : les 6 panes finissent et affichent la dernière ligne.

## Non vérifié

- `codex` : refuse de démarrer dans l'environnement de test (« start the Windows daemon from a non-elevated terminal »). À essayer dans l'application réelle.
- Clignotement du curseur (0.5.0 : `cursorBlink: true`) : non implémenté.
- Chrome (bordures de panes, barre de titre) : T04/T05.
