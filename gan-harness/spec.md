# Brief : gestion des utilisateurs

Refonte visuelle de la page « Équipe » d'ArchiOffice (`src/pages/Team.tsx`, route de gestion des utilisateurs du cabinet).
Hypothèse retenue : l'écran existant EST la gestion des utilisateurs. Aucune nouvelle route.

## Objectif
Un écran de gestion d'équipe digne d'un cabinet d'architecture : lisible, dense, précis, qui donne envie de
l'ouvrir. L'objectif PRINCIPAL est l'excellence visuelle. Un écran superbe et partiel vaut mieux qu'un écran
fonctionnel et banal. Viser des choix créatifs (mise en page éditoriale, hiérarchie typographique, détails de
tracé façon plan d'architecte) tout en restant sobre.

## Contraintes de charte (révisées à l'itération 3)
- La règle « noir et blanc » ne concerne QUE les documents PDF et DOCX générés. Elle ne s'applique PAS à l'écran.
- L'écran doit respecter le code couleur de l'application et le design Tabler (voir CLAUDE.md, section Mouvement,
  `src/index.css`, `@theme`, classes `.btn`, `.btn-*`, `.card`, badges, et les pages voisines comme Projects, Contacts,
  Settings). Reprendre la couleur primaire de l'app (bleu des boutons principaux), les couleurs sémantiques Tabler
  (succès, avertissement, danger, info) pour les états et les rôles, les gris zinc, les rayons et bordures Tabler.
  Aucune couleur inventée : utiliser les tokens et classes existants.
- Textes en français avec TOUS les accents. Jamais de tiret quadratin. Mode clair ET sombre.
- Tabler Icons uniquement, Tailwind uniquement, `clsx`/`cn`, `motion/react` pour le mouvement.
- Mouvement : ressorts (`DEFAULT_SPRING`), pas d'apparition en cascade, `prefers-reduced-motion`. Texte en rem, 11 px minimum.
- Responsive téléphone d'abord, hauteurs en `dvh`.
- Le sens ne doit jamais reposer sur la seule couleur (garder glyphes et libellés pour les rôles).

## Fonctionnalités à conserver (aucune régression de logique)
Reprendre tel quel le comportement de `Team.tsx` : chargement `getAllUsers`, droits `isAdmin`, mise en évidence
`?member=<id>` avec défilement, changement de rôle système (user, pm, manager, admin), changement de responsable
(`manager_id`), modale d'ajout (nom, e-mail, fonction, niveau d'accès) avec `createUser`, demandes de rattachement
(`getJoinRequests`, `decideJoinRequest`, événement `JOIN_REQUESTS_CHANGED`), lien « Voir le profil » vers
`/profile/:id`. Les chaînes passent par i18next : ajouter les nouvelles clés FR et EN dans `src/i18n.ts`.

## Idées bienvenues (si elles servent le design)
- Recherche et filtre par rôle, bascule vue tableau / vue cartes, tri.
- Organigramme discret (responsable hiérarchique) ou indicateur de rôle sous forme de glyphe.
- Demandes de rattachement mises en avant comme une file de décisions, états vides soignés, squelette de chargement.

## Hors périmètre
Aucun changement serveur, aucune migration SQL.

## Évaluation sans backend
L'application complète exige Supabase (absent de cette session). Le générateur doit fournir un banc d'essai
autonome dans `gan-harness/preview/` (entrée Vite + `index.html`) qui monte `Team` avec un `MemoryRouter`, des
données fictives (8 à 10 membres, 3 demandes de rattachement, rôles variés, un membre sans avatar) et des
substitutions (alias) de `../services/userService`, `../UserContext` et `../components/Sidebar`. Le banc doit
démarrer avec `npx vite --config gan-harness/preview/vite.config.ts --port 5199` et permettre `?theme=dark`,
`?admin=0` (non admin) et `?empty=1` (équipe vide).
