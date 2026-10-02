# Grille d'évaluation (design) : gestion des utilisateurs

Seuil de réussite : 7,5 / 10 (note pondérée). Question directrice : « Cet écran gagnerait-il un prix de design ? »
Contrainte transversale (révisée itération 3) : l'écran respecte le code couleur de l'application et le design Tabler
(couleur primaire, couleurs sémantiques, composants et rayons existants, cohérence avec les pages voisines). Le noir et
blanc ne concerne que les PDF et DOCX générés, pas l'écran. Français accentué, aucun tiret quadratin. Toute
incohérence avec le design de l'app (couleur inventée, composant hors Tabler) plafonne Design Quality à 6.

### Design Quality (poids 0,35)
Cohérence visuelle, hiérarchie typographique, espacement, rythme, contraste, lisibilité en clair ET sombre,
fidélité au design Tabler et au code couleur de l'app, qualité du responsive téléphone et bureau.

### Originality (poids 0,30)
Choix créatifs propres à un cabinet d'architecture (références au plan, au trait, à la trame), évite le gabarit
générique « grille de cartes + select ». Aucun effet gratuit : la nouveauté doit servir la lecture.

### Craft (poids 0,25)
Finition : alignements, états (survol, focus, actif, désactivé, chargement, vide, erreur), accessibilité (clavier,
focus visible, aria, contrastes), mouvement par ressort et réduction des animations, absence de débordement.

### Functionality (poids 0,10)
Toute la logique de `Team.tsx` conservée et opérationnelle (rôles, responsable, ajout, demandes, mise en évidence),
`npm run lint` sans erreur, traductions FR/EN présentes.

## Format du retour
Écrire `gan-harness/feedback/feedback-NNN.md` avec : note par critère (0 à 10) et justification avec preuves
(captures dans `gan-harness/screenshots/`), note pondérée `TOTAL: X.X`, liste priorisée des défauts, et 3 pistes
concrètes pour l'itération suivante.
