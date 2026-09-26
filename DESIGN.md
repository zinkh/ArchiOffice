---
name: ArchiOffice
description: L'outil de gestion d'un cabinet d'architecture, sobre et précis comme une agence bien tenue.
colors:
  primary: "#206bc4"
  primary-tint: "#e8f0fb"
  canvas: "#f4f6fb"
  surface: "#ffffff"
  surface-sunken: "#f8fafc"
  hairline: "#dce1e7"
  ink: "#1d273b"
  ink-muted: "#6c7a91"
  success: "#2fb344"
  warning: "#f76707"
  danger: "#d63939"
  dark-primary: "#4d9de0"
  dark-primary-tint: "#1a3050"
  dark-canvas: "#182433"
  dark-surface: "#243044"
  dark-surface-sunken: "#1e2d40"
  dark-hairline: "#2d3f55"
  dark-ink: "#c8d3e1"
typography:
  headline:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5715
  nav:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1.4
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0.04em"
  mono:
    fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  control: "4px"
  container: "8px"
  pill: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  card: "20px"
  panel: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "6px 12px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "6px 12px"
  button-secondary-hover:
    backgroundColor: "{colors.surface-sunken}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.control}"
    padding: "6px 12px"
  button-ghost-hover:
    backgroundColor: "{colors.surface-sunken}"
    textColor: "{colors.ink}"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "6px 12px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "6px 10px"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.container}"
    padding: "{spacing.panel}"
  badge:
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "3px 8px"
  nav-item:
    textColor: "{colors.ink-muted}"
    typography: "{typography.nav}"
    rounded: "{rounded.control}"
    padding: "6px 12px"
  nav-item-active:
    backgroundColor: "{colors.primary-tint}"
    textColor: "{colors.primary}"
  table-header:
    backgroundColor: "{colors.surface-sunken}"
    textColor: "{colors.ink-muted}"
    typography: "{typography.label}"
    padding: "8px 12px"
  pill-tabs:
    backgroundColor: "{colors.surface-sunken}"
    rounded: "{rounded.container}"
    padding: "4px"
  pill-tab-active:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "6px"
    padding: "8px 16px"
---

# Design System: ArchiOffice

## Overview

**Creative North Star: "L'Agence bien tenue"**

ArchiOffice ressemble au bureau d'un architecte qui a de l'ordre : chaque pièce à sa place, des surfaces claires séparées par un trait fin, un seul bleu pour dire « c'est ici qu'on agit ». L'interface ne cherche pas à impressionner. Elle inspire une confiance tranquille, celle d'un outil qui tient les comptes justes et ne fait pas de bruit pendant qu'on travaille.

La densité est celle d'un outil de production : sidebar de 224 px, en-tête de 56 px, texte courant à 14 px, tableaux larges et nombreux. Les composants sont sobres et précis : bordures d'un pixel, ombres à peine perceptibles, rayons courts, couleurs d'état réservées à l'état. La marque vit dans le détail (petites capitales espacées des en-têtes, anneau de focus bleu pâle, enfoncement du bouton à l'appui), pas dans le décor.

Le thème sombre est le thème par défaut (`theme-provider.tsx`) et le thème clair son jumeau exact : les deux partagent les mêmes jetons `--tblr-*`, redéfinis sous `.dark`. Les préférences système sont respectées : réduction des animations, réduction de la transparence, contraste renforcé.

**Key Characteristics:**
- Une base Tabler : tous les jetons vivent en variables CSS `--tblr-*` sur `:root` et `.dark` (`src/index.css`).
- Un accent unique, le bleu Tabler, sur fond de neutres bleutés.
- Profondeur par traits et surfaces, presque jamais par ombre.
- Inter partout, JetBrains Mono pour les codes et références.
- Thème sombre par défaut, clair à parité.

## Colors

Une palette de neutres ardoise légèrement bleutés, un seul accent bleu franc, et trois couleurs d'état qui ne servent qu'à signaler.

### Primary
- **Bleu Tabler** (`primary`, sombre `dark-primary`) : bouton principal, élément de navigation actif, lien, anneau et bordure de focus, sélection. C'est la seule couleur qui dit « action » ou « ici ».
- **Voile bleu** (`primary-tint`, sombre `dark-primary-tint`) : fond de l'élément de navigation actif, halo de focus de 3 px autour des champs, puces de sélection multiple.

### Neutral
- **Fond d'agence** (`canvas`, sombre `dark-canvas`) : le fond de page, derrière les cartes.
- **Surface** (`surface`, sombre `dark-surface`) : cartes, en-tête, sidebar, menus, champs.
- **Surface en retrait** (`surface-sunken`, sombre `dark-surface-sunken`) : en-têtes de tableau, survol de ligne, piste des onglets, champ de recherche.
- **Trait** (`hairline`, sombre `dark-hairline`) : toutes les bordures et séparations, toujours à 1 px.
- **Encre** (`ink`, sombre `dark-ink`) : texte courant et titres.
- **Encre atténuée** (`ink-muted`, identique dans les deux thèmes) : libellés, en-têtes de colonnes, texte secondaire, icônes au repos.

### Status
- **Vert réussite** (`success`), **orange attention** (`warning`), **rouge danger** (`danger`) : pastilles de statut, compteurs, bouton de suppression, messages d'erreur. Jamais décoratifs.

### Named Rules
**The Tabler Source Rule.** Une couleur s'écrit `var(--tblr-*)`, jamais en dur. `bg-blue-600`, `bg-zinc-*` et les hex isolés (environ 150 boutons en `bg-blue-600`, plus de 1 000 surfaces en `zinc`) sont une dette héritée à résorber quand on touche le fichier, pas un modèle à imiter.

**The One Blue Rule.** Un seul bleu d'action par thème. Deux bleus voisins à l'écran (Tabler `#206bc4` et Tailwind `#2563eb`) se lisent comme une erreur, pas comme une nuance.

**The Status Is Not Decoration Rule.** Vert, orange et rouge ne portent que de l'état (payé, en retard, erreur). Les tuiles colorées de `StatTile` et les couleurs de données (graphiques, catégories de recherche) sont la seule exception admise.

## Typography

**Display Font:** Inter (repli ui-sans-serif, system-ui)
**Body Font:** Inter
**Label/Mono Font:** JetBrains Mono pour les codes, identifiants et références

**Character:** une seule famille neutre et très lisible, qui laisse les chiffres et le vocabulaire du métier porter la page. La hiérarchie vient du poids et des petites capitales, pas du contraste de polices.

### Hierarchy
- **Headline** (700, 1.5rem, interligne 1.25, -0,02 em) : titre de page et chiffres clés des tuiles de statistiques.
- **Title** (700, 1rem, -0,01 em) : titre de carte (`CardHeader`), titre de modale.
- **Body** (400, 0.875rem, interligne 1.5715) : tout le texte courant, les cellules de tableau, les champs. En `rem` pour suivre la taille choisie dans le navigateur.
- **Nav** (500, 0.8125rem) : éléments de la sidebar.
- **Label** (600, 0.6875rem, 0,04 em, majuscules) : en-têtes de tableau, sous-titres de section (`.subheader`), badges, libellés de tuiles.
- **Mono** (400, 0.8125rem) : numéros d'affaire, codes, jetons.

### Named Rules
**The Eleven Pixel Floor Rule.** Aucun texte sous 0.6875rem (11 px). 10 px n'est toléré que dans une pastille de taille fixe (initiales dans un cercle de 20 px).

**The Rem Rule.** Les tailles arbitraires s'écrivent en `rem` (`text-[0.6875rem]`), jamais en `px`, pour suivre le réglage de l'utilisateur.

**The Small Caps Rule.** Les majuscules espacées sont réservées aux libellés de 11 px (en-têtes, badges, sous-titres). Un titre ou un bouton ne passe jamais en majuscules.

## Layout

Coquille fixe d'application : sidebar de 224 px (`--tblr-sidebar-w`) à gauche, cachée sous 768 px et remplacée par un tiroir (`MobileNavDrawer`) ; en-tête collant de 56 px (`--tblr-navbar-h`) plus l'encart de sécurité du haut ; contenu sur le fond d'agence. Les cartes se rembourrent de 20 à 24 px, les cellules de tableau de 10 × 12 px, les éléments de navigation de 6 × 12 px. Le rythme suit l'échelle de Tailwind (pas de 4 px).

Sur téléphone, le contenu passe en colonne unique et en cartes (`md:hidden`) là où le bureau montre un tableau ; un tableau trop large défile horizontalement (`overflow-x-auto`, `min-w-full`) plutôt que de tasser ses colonnes. Hauteurs d'écran en `dvh` (ou `svh` sur les pages de connexion), jamais `100vh`. Les encarts de sécurité (`env(safe-area-inset-*)`) rembourrent l'en-tête, les côtés et la barre de raccourcis.

## Elevation & Depth

Système presque plat. La profondeur vient de l'empilement de surfaces (fond d'agence, surface, surface en retrait) et des traits de 1 px ; l'ombre n'est qu'un souffle qui décolle la carte du fond.

### Shadow Vocabulary
- **Souffle** (`--tblr-shadow`, clair `0 1px 3px rgba(29,39,59,.06), 0 1px 2px rgba(29,39,59,.04)`, sombre `0 1px 4px rgba(0,0,0,.3), 0 1px 2px rgba(0,0,0,.2)`) : cartes, en-tête, onglet actif, menus déroulants de `react-select`.
- **Flottant** (`0 4px 16px rgba(0,0,0,.12)`) : listes déroulantes et résultats de recherche qui passent au-dessus du contenu.
- **Halo de focus** (`0 0 0 3px var(--tblr-primary-lt)`) : focus des champs, recherche, sélecteurs.

### Named Rules
**The Hairline First Rule.** On sépare par un trait de 1 px avant de penser à une ombre. `shadow-lg`/`shadow-xl` sont réservés à ce qui flotte réellement (modale, menu), jamais à une carte posée dans la page.

## Shapes

Des angles à peine adoucis : l'outil est précis, pas moelleux.

- **Contrôle** (`--tblr-radius`, 4 px) : boutons, champs, badges, éléments de navigation, menus.
- **Conteneur** (8 px) : cartes (`Card`), tuiles de statistiques, piste d'onglets, modales.
- **Pastille** (cercle) : avatars, compteurs, points de statut.

**The Two Radii Rule.** Deux rayons seulement : 4 px pour ce qu'on actionne, 8 px pour ce qui contient. `rounded-xl` et `rounded-2xl` sortent du système.

## Components

Sobres et précis : chaque composant se reconnaît à son trait, pas à sa couleur.

### Buttons
- **Shape:** rayon de contrôle (4 px), 6 × 12 px, texte 14 px en 500, icône de 16 px à 6 px du libellé.
- **Primary:** fond bleu Tabler, texte blanc. Un seul par zone d'action.
- **Hover / Focus:** survol par `brightness(1.08)` sous `@media (hover: hover)` seulement, pour ne pas rester affiché sur tablette. À l'appui, le bouton s'enfonce (`scale(0.97)`, `brightness(0.94)`) en 50 ms, puis revient en 160 ms ; neutralisé si l'utilisateur réduit les animations.
- **Secondary:** fond surface, trait 1 px, texte encre ; survol en surface en retrait.
- **Ghost:** transparent, texte atténué ; survol en surface en retrait et texte encre.
- **Danger:** fond rouge, texte blanc, réservé à la suppression.

### Cards / Containers
- **Corner Style:** rayon de conteneur (8 px).
- **Background:** surface.
- **Shadow Strategy:** souffle (voir Elevation & Depth).
- **Border:** trait 1 px.
- **Internal Padding:** 24 px (`CardHeader`/`CardBody`), 20 px pour la classe `.card`. L'en-tête de carte porte une icône dans un cercle de 40 px en surface en retrait, un titre 16 px gras et une description atténuée.

### Inputs / Fields
- **Style:** fond surface, trait 1 px, rayon de contrôle, 6 × 10 px, texte 14 px ; 16 px sur écran tactile pour qu'iOS ne zoome pas.
- **Focus:** bordure bleu Tabler et halo de 3 px en voile bleu, transition de 150 ms.
- **Placeholder:** encre atténuée.

### Tables
- **En-tête:** surface en retrait, libellé 11 px en petites capitales atténuées, trait inférieur.
- **Lignes:** 10 × 12 px, trait entre les lignes, aucun sur la dernière ; survol en surface en retrait à la souris seulement.

### Navigation
- **Sidebar:** surface, trait à droite. Élément de 6 × 12 px, texte 13 px en 500, icône de 16 px. Au repos atténué ; au survol encre sur surface en retrait ; actif en bleu Tabler sur voile bleu, icône comprise.
- **Header:** surface opaque, trait inférieur, souffle ; titre de page 14 px en 600 à gauche, recherche, synchro, thème, notifications et avatar à droite.
- **Mobile:** tiroir que l'on referme d'un geste, qui suit le doigt et décide sur le point d'arrivée projeté.

### Pill Tabs
- Piste en surface en retrait, rayon 8 px, 4 px de marge intérieure ; onglet actif en surface, texte encre en 600, souffle ; onglets inactifs atténués.

### Badges
- Libellé 11 px en petites capitales, rayon de contrôle, 3 × 8 px ; couleur d'état en fond pâle et texte soutenu.

## Do's and Don'ts

### Do:
- **Do** écrire chaque couleur en `var(--tblr-*)` ; les deux thèmes suivent alors sans rien ajouter.
- **Do** utiliser les classes `.btn-*`, `.tblr-input`, `.tblr-table` et les composants `Card`, `PillTabs`, `StatTile` avant d'écrire un style à la main.
- **Do** séparer par un trait de 1 px (`--tblr-border`) plutôt que par une ombre ou un fond coloré.
- **Do** garder un seul bouton principal bleu par zone d'action ; les autres en secondaire ou ghost.
- **Do** mettre les survols sous `@media (hover: hover)` et donner à chaque contrôle un retour à l'appui.
- **Do** tester chaque écran dans le thème sombre (par défaut) et le thème clair.

### Don't:
- **Don't** introduire `bg-blue-600`, `bg-zinc-*`, `text-gray-*` ni un hex en dur dans du code neuf : c'est la dette que ce système résorbe.
- **Don't** utiliser `rounded-xl`, `rounded-2xl` ou un troisième rayon.
- **Don't** poser `shadow-lg`/`shadow-xl` sur une carte posée dans la page.
- **Don't** écrire un texte sous 11 px ni une taille en `px`.
- **Don't** employer vert, orange ou rouge pour décorer ; ils signalent un état.
- **Don't** faire apparaître en cascade le contenu des pages de travail consultées plusieurs fois par jour.
