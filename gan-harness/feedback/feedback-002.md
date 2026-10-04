# Évaluation : itération 002 (commit 2d18c30)

Mode atteint : playwright-core pilotant Chromium (390, 768, 1024, 1440 ; clair et sombre ; clavier ; `?failwrite=1`). Captures : `gan-harness/screenshots/iter2-*.png`.

| Critère | Note | Poids | Pondéré |
|---|---|---|---|
| Design Quality | 8,0 | 0,35 | 2,80 |
| Originality | 8,0 | 0,30 | 2,40 |
| Craft | 7,0 | 0,25 | 1,75 |
| Functionality | 9,0 | 0,10 | 0,90 |

TOTAL: 7.9

Verdict : RÉUSSITE (seuil 7,5).

## Vérification des 6 défauts du feedback-001
1. Tablette 768 : corrigé. `scrollWidth` = 768, Fiches en deux colonnes (iter2-light-768, iter2-dark-768). Registre à partir de 1024 px, aucun débordement à 1024 et 1440.
2. Organigramme 390 : corrigé. 390/390, indentation réduite, noms tronqués avec points de suspension (iter2-org-390). Idem 768 et 1440.
3. Puces de filtre mobile : corrigé. Elles passent à la ligne, les 5 sont visibles (iter2-org-390).
4. File de décisions mobile : corrigé. Le « 03 » est compact en ligne, le titre tient sur une ligne.
5. Focus : corrigé en partie. Anneau décalé (+2 px) pour boutons et onglets, filet intérieur (-1 px) pour champs et selects, ordre de tabulation logique. Flèche de profil plus lisible en sombre. Légende des glyphes présente sur bureau (iter2-light-1440).
6. `alert()` : corrigé. Plus aucun `alert(` dans Team.tsx. Le bandeau `TeamNotice` s'affiche (`?failwrite=1`, role=alert, « Échec de la mise à jour du rôle. », bord rouge, bouton de fermeture) à 1440 et 390 (iter2-failwrite, iter2-failwrite-390).
Bonus : tiret quadratin retiré de `team_schedule_empty` (grep : plus aucune occurrence dans team_* ni dans src/components/team).

## Contrôles
- `npm run lint` : sans erreur.
- Console : seulement les erreurs voulues des paramètres `?error=1` et `?failwrite=1`, aucune erreur applicative.
- Texte inférieur à 11 px : 0 élément.
- Modale : focus initial dans le champ nom, Échap la ferme (après l'animation de sortie, environ 1 s mesuré à 0 dialogue), focus rendu à la page.
- Aucun débordement horizontal sur 10 configurations testées.

## Défauts restants (priorisés)
1. Originalité du Registre : à 1440 px c'est toujours un tableau standard avec selects. La cote de répartition (barre hachurée sous « 09 ») est décorative : pas de légende lisible, pas interactive. La rendre cliquable (segment = filtre de rôle) et légendée.
2. Fiches mobile et tablette : 9 cartes de 250 px ou plus, soit environ 2000 px de défilement à 768 px et plus de 4500 px à 390 px. L'étiquette de rôle verticale à 11 px est peu lisible, et le libellé « Manager rattaché » prête à confusion (le rôle « Manager » existe aussi). Proposer une carte compacte (une ligne, détails dépliables) et renommer en « Responsable ».
3. Retour d'action : l'approbation d'une demande ne produit aucun message de confirmation (`role=status` vide après clic), la ligne disparaît simplement. Ajouter une confirmation brève (ou une annulation de 5 s) pour une décision d'accès sensible. Le bandeau est positionné en bas de fenêtre, il peut masquer le contenu (ici une carte de demande sur mobile).
4. Le bandeau n'a pas été vérifié avec un lecteur d'écran, et il se ferme seul au bout de 7 s, ce qui est court pour un message d'erreur. Garder l'erreur affichée jusqu'à fermeture manuelle.
5. Contraste des textes secondaires gris (`zinc-500` sur fond clair, `Fonction non renseignée`, étiquettes mono 11 px) : correct mais limite, à relever d'un cran. Police Inter non chargée dans le banc, donc typographie jugée sur repli.

## Pistes pour l'itération suivante
1. Rendre la cote de répartition interactive et légendée (filtre par segment) et tracer au survol d'une ligne le lien vers le responsable dans le Registre.
2. Carte compacte sur mobile, avec détails déroulants, pour raccourcir fortement la page.
3. Confirmation et annulation après approbation ou refus, et erreurs persistantes.
