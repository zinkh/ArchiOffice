# Croquis de réunion : prototype et consigne de portage

Prototype autonome : [`croquis-reunion.html`](croquis-reunion.html) (un seul fichier,
Rough.js 4.6.6 chargé depuis jsDelivr). Il sert de référence fonctionnelle et
visuelle, pas de code à livrer tel quel.

> **Statut : porté dans ArchiOffice.** Les sept points de « Portage attendu » ci-dessous sont
> réalisés (éditeur, table `croquis`, routes, enregistrement automatique et hors ligne, exports
> PDF et Word, fond tiré de l'affaire, tests). Le détail, les pièges et ce qui reste à vérifier
> sont dans `.claude/rules/chantier-det-rdt.md`, section « Croquis de réunion et de
> compte-rendu ». Ce fichier reste la consigne d'origine et la référence du prototype.

## Objectif

Offrir dans les réunions et les comptes-rendus de chantier un espace simple pour
dessiner un croquis rapide, soit sur feuille blanche, soit par-dessus un plan ou
une photo dont on règle l'opacité.

## Ce que fait le prototype (à conserver)

- Outils : sélection (déplacer, redimensionner), main, crayon, ligne, flèche,
  rectangle, ellipse, texte, gomme. Raccourcis V, H, P, L, A, R, O, T, E.
- Style : trait main levée ou net, cinq couleurs, trois épaisseurs, remplissage
  (aucun, hachures, hachures croisées, zigzag, points, plein), angle et
  espacement des hachures.
- Hachures types en un clic : existant, à démolir (jaune), à construire (rouge),
  béton, isolant.
- Fond : image importée (réduite à 2600 px de côté), opacité réglable, ou feuille
  blanche.
- Annuler et rétablir, zoom et déplacement à deux doigts ou à la molette,
  recadrage, export de la vue en PNG.
- Interface minimale : barre d'outils flottante en bas, panneaux « Fond » et
  « Style » repliables, noir et nuances de gris.

Points techniques à reprendre :

- Modèle : liste d'éléments sérialisables. Chaque élément porte un `seed`
  (sans lui Rough.js redessine un tracé différent à chaque rendu) et un facteur
  `k` (échelle de l'écran à la création, pour que trait, hachures et texte
  gardent leur taille quel que soit le zoom).
- Rendu : un seul `<canvas>`, formes générées par `rough.generator` et mises en
  cache par élément, crayon libre tracé en courbes quadratiques.
- Saisie : Pointer Events, `touch-action: none`, geste à deux doigts qui annule
  le tracé en cours.

## Ce qu'il faut réécrire

La sauvegarde du prototype repose sur l'hébergement de la page publiée
(`claude.use("db")`, `claude.use("assets")`, `claude.use("downloads")`). Ces
appels n'existent pas dans ArchiOffice : les remplacer entièrement.

## Portage attendu dans ArchiOffice

1. Composant React/TypeScript/Tailwind, icônes Tabler, textes via i18next
   (FR et EN), dans le respect de `CLAUDE.md` et de
   `.claude/rules/chantier-det-rdt.md`.
2. Points d'entrée : une réunion (`Reunions.tsx`) et un compte-rendu de chantier
   (`ChantierModule.tsx`, onglet Comptes-rendus). Plusieurs croquis par réunion
   ou compte-rendu : liste, nouveau, renommer, supprimer.
3. Persistance Supabase : table `croquis` scopée par `tenant_id` (rattachement
   à l'affaire, puis à la réunion ou au compte-rendu, titre, scène en `jsonb`,
   chemin du fond, opacité, dates), RLS alignée sur les tables voisines, fond
   et aperçu PNG stockés par le mécanisme de fichiers du cabinet (skill
   `archioffice-stockage-fichiers`). Migration dans `supabase/migrate_*.sql`,
   appliquée avec le MCP Supabase, `schema.sql` et `src/types.ts` tenus à jour.
4. Enregistrement automatique après une pause de frappe, sur le modèle des
   notes de réunion, et fonctionnement hors ligne cohérent avec la file
   d'écritures existante (Dexie).
5. Aperçu PNG du croquis inséré dans les exports du compte-rendu (PDF et Word),
   selon la charte du cabinet (`.claude/rules/exports-charte.md`).
6. Fond : permettre aussi de choisir un plan ou une photo déjà présents sur
   l'affaire, en plus de l'import.
7. Tests Vitest pour la logique pure (sérialisation de la scène, test
   d'appartenance d'un point, historique) et pour les routes serveur ajoutées.
   `npm run lint`, `npm test` et `npm run build` doivent passer.

## Limites connues du prototype

- Un seul croquis par page, historique d'annulation perdu au rechargement.
- Pas de fond PDF (image uniquement).
- Un texte posé ne se modifie plus, il se déplace ou se supprime.
- Vérifié sur un rendu et à la souris ; le doigt et le stylet restent à tester
  sur tablette.

## Consigne à donner à Claude Code

```
Lis docs/prototypes/croquis-reunion.md et docs/prototypes/croquis-reunion.html.
Propose d'abord un plan de portage par étapes (modèle de données, composant,
persistance, hors ligne, exports), attends ma validation, puis implémente.
```
