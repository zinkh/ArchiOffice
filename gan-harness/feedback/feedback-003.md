# Évaluation : itération 003 (commit 50d91d2, design Tabler)

Mode atteint : playwright-core pilotant Chromium (390, 768, 1024, 1440 ; clair et sombre ; clavier ; `?failwrite=1`, `?empty`, `?admin=0`, `?error=1`, `?lang=en`). Captures : `gan-harness/screenshots/iter3-*.png`.

| Critère | Note | Poids | Pondéré |
|---|---|---|---|
| Design Quality | 8,0 | 0,35 | 2,80 |
| Originality | 8,0 | 0,30 | 2,40 |
| Craft | 7,5 | 0,25 | 1,88 |
| Functionality | 9,0 | 0,10 | 0,90 |

TOTAL: 8.0

Verdict : RÉUSSITE (seuil 7,5).

## Fidélité à Tabler et aux tokens
- Recherche de couleurs en dur dans `src/components/team` et `Team.tsx` (classes `blue-*`, `red-*`, hex, rgba) : aucune occurrence. Tout passe par `var(--tblr-primary|primary-lt|success|warning|danger|border|surface|text|muted|shadow|radius)`, plus `.btn`, `.btn-primary|secondary|ghost`, `.tblr-input`, `.tblr-badge`, `.card`. Même mécanique que Projects (`var(--tblr-primary)` + `primary-lt` en style en ligne).
- Rendu clair (#206bc4 sur fond #f4f6fb) et sombre (#4d9de0 sur #182433) cohérents avec index.css, boutons principaux bleus, rayons 4 px.
- La planche d'architecte (trame de points, cotes, hachures, repères de coupe) est conservée en teintes Tabler. Les rôles gardent glyphe, hachure et libellé : la couleur ne porte pas seule le sens.

## Défauts du feedback-002 : état
1. Cote décorative : corrigé. Chaque segment est un bouton (`aria-label` « Manager : 2 (filtrer) »), un clic filtre le registre (2 lignes), les autres segments s'estompent (iter3-cote-filter).
2. Fiches mobiles hautes : corrigé. Cartes compactes dépliables (`aria-expanded`, 9 cartes), ≈ 2000 px à 390 px (iter3-light-390, iter3-expanded-390). Libellé renommé « Responsable ».
3. Confirmation : corrigé pour l'approbation et le refus (`role=status`, « Demande de … approuvée/refusée », bandeau vert, iter3-refused). Pas d'annulation (limite API, assumée).
4. Erreurs courtes : corrigé. Le bandeau d'erreur `?failwrite=1` reste affiché après 9 s (1 `role=alert`) alors que le succès disparaît à 7 s.
5. Gris secondaires : relevés, un seul texte gris mesuré à 4,46:1 (limite).

## Contrôles
- `npm run lint` : sans erreur. Aucun tiret quadratin (src/components/team, Team.tsx, clés team_*). Plus d'`alert(`.
- Console : uniquement les erreurs volontaires de `?error=1` et `?failwrite=1`.
- 13 configurations (4 largeurs × 2 thèmes, plus empty, non admin, erreur, EN, `?member`) : `scrollWidth` égale la largeur de fenêtre, aucun débordement.
- Clavier : focus visible partout (anneau bleu primaire de 2 px, 1 px pour les champs), ordre logique. Échap ferme la modale.

## Défauts restants (priorisés)
1. Collision sémantique de l'orange : `--tblr-warning` signifie à la fois « en attente » (pastille, « 03 » géant, bande de la file) et le rôle Manager (glyphe, hachure, segment). Un coup d'œil ne distingue pas une demande en attente d'un Manager. Réserver le warning à l'état « en attente » et prendre une autre teinte Tabler (info/primaire clair, ou gris) pour Manager.
2. Contraste : le « 03 » de la file en `--tblr-warning` (#f76707, 60 px) mesure 2,8:1 sur fond clair, sous 3:1 même en grand corps. Les libellés « Refuser » en `--tblr-danger` mesurent 4,3:1 (< 4,5:1 en 14 px). Passer le chiffre en `--tblr-text` avec un filet orange, et assombrir le texte du bouton Refuser.
3. Cote et bande hachurée trop chargées : trois hachures colorées (orange, vert, bleu) en barre de 12 px plus quatre puces de filtre juste dessous font doublon (les deux filtrent). Garder un seul des deux, ou donner à la cote un rôle de lecture seule avec libellés directement sous chaque segment.
4. Date « Mise à jour » : `toLocaleDateString(undefined, …)` suit la langue du navigateur, pas celle de l'application. Mesuré « 10/01/26 » (format américain) sur une page française, alors que l'itération 2 affichait 01/10/26. Utiliser `i18n.language`. Le libellé « Mise à jour » est de plus un simple « aujourd'hui », donc trompeur.
5. Fiche mobile dépliée : le rôle est répété trois fois (glyphe, pastille grise « Collaborateur » dans le détail, select). Supprimer la pastille. Le glyphe de rôle de la fiche fermée sans libellé reste ambigu pour un nouvel utilisateur (la légende n'existe que sur bureau).

## Pistes pour l'itération suivante
1. Rationaliser la palette sémantique : succès = Chef de projet, danger = refus uniquement, warning = attente uniquement, primaire = Administrateur, gris = les autres rôles.
2. Fusionner cote et puces de filtre en un seul composant cliquable, légendé, à hauteur de ligne de cote.
3. Ajouter à la fiche déroulée un résumé utile (dernière activité, nombre de projets) à la place de la pastille de rôle redondante, et formater les dates par la langue de l'app.
