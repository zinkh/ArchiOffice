# Generator State : Iteration 002

## What Was Built
- Refonte de `src/pages/Team.tsx` (conteneur, logique inchangée) + sous-composants dans `src/components/team/`.
- Direction : planche d'architecte. Titre éditorial, cartouche de chiffres, trame de points, ligne de cote avec répartition hachurée des rôles, glyphes de rôle (vide, trait, croisillons, plein), repères de coupe sur les fiches, file de décisions D-01.. avec bande hachurée.
- Vues : Registre (tableau, bureau), Fiches (mobile par défaut), Organigramme (arbre des responsables). Recherche, filtre par rôle, tri.
- États : squelette, vide, aucun résultat, erreur de chargement avec réessai, non administrateur (lecture seule).
- Modale d'ajout : feuille depuis le bas sur mobile, niveau d'accès en cases radio avec glyphes, Échap, focus initial.
- Clés i18n FR/EN ajoutées dans `src/locales/{fr,en}.ts` (après `team_create_user_btn`).

## Known Issues / Reste à faire
- Les `alert()` d'origine sont conservés (spec : aucune régression), à remplacer par des toasts.
- Police Inter non chargée hors ligne dans le banc (repli sans-serif).
- Pas de capture de l'organigramme ni de la modale dans screenshots/.

## Banc d'essai
- `npx vite --config gan-harness/preview/vite.config.ts --port 5199 --host 127.0.0.1`
- Paramètres : `?theme=dark`, `?admin=0`, `?empty=1`, `?lang=en`, `?member=u5`, `?slow=1`, `?error=1`
- URL : http://127.0.0.1:5199/ (en cours d'exécution)

## Iteration 002
- Registre uniquement a partir de 1024 px, Fiches en dessous (plus de debordement a 768 px).
- Organigramme : conteneur defilant, indentation reduite sur mobile, noeuds tronques (aucun debordement a 390 et 768 px).
- Puces de filtre : passage a la ligne. File de decisions : compteur compact en ligne sur mobile.
- `alert()` remplaces par `TeamNotice` (bandeau noir et blanc, role=status ou alert, fermeture auto 7 s).
- Focus differencie : anneau decale pour les boutons, filet interieur pour les champs. Legende des glyphes de role (bureau). Fleche du profil plus contrastee en sombre.
- Tiret quadratin retire de `team_schedule_empty` (FR et EN). Placeholder de recherche raccourci.
- Banc : `?failwrite=1` fait echouer le changement de role (test du bandeau).
- Captures : `gan-harness/screenshots/i2-*.png`.
