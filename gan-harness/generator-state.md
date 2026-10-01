# Generator State : Iteration 001

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
