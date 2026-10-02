# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

(Application React servie en web, installable en PWA, et emballée dans un client de bureau Electron pour le travail hors ligne. Le client Electron reprend la même interface web : il ne change pas le langage visuel. Le sous-paquet `packages/archioffice-agents` fournit le chat des agents IA et fait partie du même produit, il n'a pas de fiche produit distincte.)

## Users

Tous les rôles d'un cabinet d'architecture français, principalement de petite taille :

- **L'architecte gérant**, qui pilote les affaires, les honoraires, les contrats de maîtrise d'œuvre et la facturation, souvent en assurant lui-même l'administratif.
- **Les collaborateurs du cabinet** (architectes salariés, chefs de projet), qui rédigent CCTP et DPGF, préparent les DCE, tiennent les comptes rendus et saisissent leurs temps.
- **L'assistante administrative**, qui suit facturation, relances, contacts et courrier.
- **L'architecte sur le chantier, au téléphone**, qui relève les réserves, prend des photos et rédige le compte rendu de réunion sur place.

Un même architecte peut exercer dans plusieurs cabinets (le sien, une SCPA, un groupement) avec un rôle différent dans chacun.

## Product Purpose

Réunir dans un seul outil toute la vie d'une affaire d'architecture, de la proposition d'honoraires à la dernière facture : propositions et contrats MOE, appels d'offres, CCTP, DPGF et BPU, comparatif ACT, planning, réunions et réserves de chantier, ordres de service, situations, notes d'honoraires, facturation Factur-X, données d'urbanisme (cadastre, PLU, risques, monuments), GED, messagerie et agenda. Le succès : le cabinet ne jongle plus entre plusieurs logiciels et tableurs, et chaque pièce produite (facture, CCTP, compte rendu) est juste du premier coup.

## Positioning

- **Conçu par un architecte en exercice** (Khaldoun Sektaoui, Atelier d'Architecture Zoméno Sektaoui), à partir de la pratique réelle d'un cabinet et avec le vocabulaire du métier (missions MOP, ESQ, APS, APD, DCE, ACT, DET, AOR, lots, MOA/MOE).
- **Tout en un** : du devis à la facture, en passant par les pièces techniques, le chantier, l'urbanisme et les connecteurs comptables (Zoho, Odoo, Chorus Pro, SuperPDP).
- **Des agents IA qui travaillent dans les données du cabinet** (courrier, CCTP, bibliothèque d'ouvrages, alertes métier), toujours avec les droits de la personne qui leur parle, jamais plus.
- **Souveraineté des données** : fonctionnement hors ligne sur le poste, documents stockés sur l'espace du cabinet (Nextcloud, kDrive, Google Drive, Dropbox), fournisseurs européens possibles (Mistral).

## Operating Context

- Au bureau, sur poste de travail : rédaction longue (CCTP, DPGF, notes méthodologiques), tableaux financiers larges (ventilation des honoraires par mission et par membre du groupement), plans PDF de grand format annotés.
- Sur le chantier, au téléphone, souvent d'une main, en extérieur : réserves d'OPR et de GPA, photos prises directement depuis l'appareil, repères sur plan, comptes rendus.
- Pièces produites et envoyées à des tiers (maître d'ouvrage, entreprises, administrations) : factures, notes d'honoraires, CCTP, comptes rendus, exports de réserves, en PDF et Word.
- Rituels du métier : phases de mission MOP, réunions de chantier hebdomadaires, consultation des entreprises et analyse des offres, réception des travaux et levée des réserves.

## Capabilities and Constraints

- **Français d'abord.** Toute l'interface est en français avec le vocabulaire MOP ; l'anglais est une langue secondaire (i18next). Accents systématiques, jamais de tiret cadratin dans les textes.
- **Mobile impératif pour le chantier.** Les écrans utilisés sur place (réserves, réunions, photos, comptes rendus) doivent être parfaitement utilisables au téléphone ; les écrans de rédaction et de tableaux peuvent privilégier le poste de travail.
- **Exports PDF et Word** : en-tête avec le logo du cabinet, pied de page avec l'adresse et les mentions légales, pagination en bas à droite au format « P1|2 ». La charte vient des réglages du cabinet (`server/agencyIdentity.ts`, `src/lib/pdfLetterhead.ts`), jamais d'une identité ArchiOffice.
- **Multi-cabinets** : chaque cabinet est un tenant ; ses documents portent sa propre identité.
- **Offres** : Starter, Pro et Enterprise (`src/lib/billing.ts`) ; certaines fonctions IA sont réservées à Enterprise.
- **Non décidé** : l'identité visuelle de l'application elle-même (base Tabler actuelle) n'a pas été confirmée comme contrainte durable.

## Brand Commitments

- Nom du produit : **ArchiOffice**.
- Voix : professionnelle, précise, dans la langue du métier ; pas de jargon marketing, pas d'anglicismes quand un terme français du métier existe.
- Les documents produits appartiennent au cabinet et portent son identité (logo, coordonnées, SIRET, numéro d'inscription à l'Ordre), pas celle d'ArchiOffice.

## Evidence on Hand

- Icônes de l'application : `public/icon-192.png`, `public/icon-512.png`, `public/apple-touch-icon.png`, favicons.
- Page d'accueil existante : `src/pages/Landing.tsx`.
- Documentation fonctionnelle : `README.md`, `ROADMAP.md`, `API.md`, `CLAUDE.md`.
- **Absents, à ne pas inventer** : aucune capture d'écran, aucun témoignage client, aucun chiffre d'usage, aucune étude de cas, aucun logo de client ni article de presse.

## Product Principles

1. **La pièce fait foi.** Ce que produit l'outil (facture, contrat, CCTP, note d'honoraires) doit être juste et conforme ; l'interface sert l'exactitude avant la vitesse.
2. **Le vocabulaire du métier, pas celui du logiciel.** Nommer les choses comme un architecte les nomme.
3. **Un seul outil, un seul geste.** Une information saisie une fois se retrouve partout où elle sert ; pas de double saisie.
4. **Le chantier est un lieu de travail à part entière.** Ce qui se fait sur place doit se faire d'une main, au téléphone, sans compromis.
5. **Les données restent au cabinet.** Hors ligne, stockage chez lui, agents qui n'ont jamais plus de droits que l'utilisateur.

## Accessibility & Inclusion

- Usage en extérieur et d'une main sur chantier : cibles tactiles confortables, lisibilité en plein jour.
- Préférences système déjà respectées dans l'application : réduction des animations, réduction de la transparence, contraste renforcé, tailles de texte en `rem` avec 11 px minimum (voir `CLAUDE.md`, « Mouvement, gestes et préférences d'accessibilité »).
