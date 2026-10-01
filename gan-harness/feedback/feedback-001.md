# Évaluation : itération 001 (gestion des utilisateurs)

Mode atteint : playwright-core pilotant Chromium (clics, clavier, largeurs 390, 768 et 1440, clair et sombre). Captures : `gan-harness/screenshots/iter1-*.png`.

| Critère | Note | Poids | Pondéré |
|---|---|---|---|
| Design Quality | 7,0 | 0,35 | 2,45 |
| Originality | 8,0 | 0,30 | 2,40 |
| Craft | 6,0 | 0,25 | 1,50 |
| Functionality | 8,0 | 0,10 | 0,80 |

TOTAL: 7.2

Verdict : ÉCHEC (seuil 7,5).

## Justifications avec preuves
- Design 7 : à 1440 px le rendu est net en clair et en sombre (iter1-light-desktop, iter1-dark-desktop). Hiérarchie forte (titre, cartouche, file D-01, cote hachurée, glyphes de rôle), charte N&B respectée (seule couleur : pastille ambre « En attente », bordure rouge de l'erreur, tous deux de la donnée). Pénalisé par le responsive intermédiaire et mobile (voir défauts).
- Originality 8 : planche d'architecte cohérente (repères de coupe, trame de points, cote de répartition, glyphes de rôle repris dans filtres, select, modale et organigramme). L'organigramme en arbre à traits est le meilleur écran. Le tableau reste un tableau classique, et la cote hachurée est un peu décorative (sa légende n'est pas lisible).
- Craft 6 : débordements réels à 768 px et en organigramme mobile, puces de filtre tronquées sur mobile, `alert()` conservés, focus identique partout. Modale propre : focus initial sur le nom, Échap la ferme, `role=dialog` présent.
- Functionality 8 : `npm run lint` passe sans erreur. Vues, recherche, approbation, modale, `?member`, `?admin=0`, `?empty=1`, `?error=1` et `?lang=en` fonctionnent. 95 clés `team_` en FR et en EN. Aucune erreur console applicative (seules des erreurs de certificat sur des ressources externes, polices, et la 404 du favicon). Pénalité : `alert()` restants.

## Défauts critiques
1. Tablette 768 px : le tableau Registre déborde horizontalement (`scrollWidth` > largeur de fenêtre). Les colonnes « Responsable » et « Accès » sont coupées ("Collabora", "Au", "RESI"), la fonction est écrasée sur 4 lignes (iter1-tablet). Corriger : basculer en Fiches sous `lg` (1024 px), ou masquer la colonne Fonction, ou enrober le tableau dans `overflow-x-auto` avec `min-w`. Idem pour le sélecteur d'accès, à élargir.
2. Organigramme sur 390 px : la page fait 446 px de large, déborde horizontalement (le nœud « Camille Roux-Delmas » dépasse). Corriger : `overflow-x-auto` sur le conteneur de l'arbre, réduire l'indentation à 12 px par niveau sur mobile, `min-w-0` sur les nœuds avec `truncate`.

## Défauts majeurs
3. Mobile, filtres de rôle : les puces « Manager » et « Administrateur » sont absentes (rognées, sans défilement ni indice) en 390 px (iter1-mobile-org, iter1-light-mobile). Corriger : `overflow-x-auto` avec masque dégradé, ou passer à un `select` sur mobile.
4. Mobile, file de décisions : le gros « 03 » occupe la colonne et force le titre « Demandes de rattachement » à 3 lignes dans une colonne étroite, avec le texte d'aide sur 8 lignes (iter1-mobile-org). Corriger : empiler (« 03 » sous le titre, ou compact en ligne) sous `sm`.
5. Focus : l'anneau est un contour solide de 2 px identique partout (aucune distinction clavier/état), et le `<select>` natif garde l'apparence système (chevron). Sombre : le lien « Voir le profil » (flèche) est très pâle (contraste faible dans iter1-dark-desktop). Renforcer le gris de la flèche.
6. `alert()` natifs conservés pour les erreurs (Team.tsx lignes 94, 106, 116) : rompent la sobriété de l'écran. Remplacer par un bandeau `role=alert` intégré (la logique reste identique).

## Défauts mineurs
7. Charte : `team_schedule_empty` contient un tiret quadratin (fr.ts 1922, en.ts 1777). Il est antérieur à l'itération (présent dans HEAD) et non visible sur cet écran, mais la clé est du périmètre `team_*` : le remplacer par une virgule ou un deux-points.
8. Les cartes mobiles ont une étiquette de rôle verticale à 11 px peu lisible, et les cartes sont hautes (9 cartes ≈ 4500 px de défilement). Envisager une carte compacte avec détails dépliables.
9. Les glyphes de rôle (vide, trait, croisillons, plein) n'ont pas de légende visible, et le cartouche « Mise à jour 01/10/26 » est du remplissage.
10. Inter n'est pas chargée dans le banc, donc la typographie évaluée est un repli sans-serif. Ceci est un artefact du banc.

## Ce qui est réussi
Organigramme à traits, modale (feuille basse sur mobile, cases radio à glyphes), états vide, erreur et lecture seule traités, aucun débordement à 1440 et à 390 hors organigramme, avatars sans photo gérés (initiales hachurées).

## Pistes pour l'itération suivante
1. Corriger tout le responsive intermédiaire : Fiches sous 1024 px, tableau défilant, organigramme défilant, puces de filtre défilantes.
2. Remplacer `alert()` par des messages en ligne ; différencier le focus (anneau décalé, double trait) et ajouter une légende des glyphes (ou info-bulle) pour que le langage visuel soit compréhensible.
3. Pousser l'originalité sur le Registre : cote de répartition interactive (clic sur un segment = filtre de rôle) et ligne du responsable tracée au survol (trait vers le manager), au lieu d'un tableau standard.
