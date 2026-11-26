---
name: archioffice-pdf-chromium
description: "Documents PDF A0/A4 générés par Chromium (playwright-core) dans ArchiOffice : dossier de références pour marchés publics, panneaux d'affichage de chantier et de permis de construire. À utiliser pour toute modification de server/referencesDossier, server/panneaux, du rendu renderHtmlToPdf, des mentions légales de panneau ou du QR code public du chantier."
---

# ArchiOffice : pdf chromium

> Contenu extrait du CLAUDE.md racine, sans modification.

### Dossier de références pour les marchés publics

Bouton « Dossier de références » de `/references` (`src/components/ReferencesDossierDialog.tsx`) : l'architecte coche les opérations
(affaires ou références manuelles), les réordonne (flèches), choisit les images de chaque fiche (6 au plus, la première est la
principale, téléversement de plusieurs images possible), complète la fiche, retouche le texte du programme **pour cet export
seulement** et génère un PDF A4 **paysage ou portrait** : page de garde (logo, « Références », gérant, mosaïque, coordonnées),
tableau récapitulatif, une fiche par référence.

- **Rendu** : `server/referencesDossier/` ; `template.ts` (HTML/CSS pur, testé) -> `render.ts` (playwright-core, Chromium de l'hôte :
  `CHROMIUM_PATH`, sinon chemin Playwright, sinon `/usr/bin/chromium` ; `printBackground`, `preferCSSPageSize`, aucune requête réseau,
  un rendu à la fois). Le Dockerfile installe `chromium`. Source Sans 3 est embarquée en base64 (`@fontsource/source-sans-3`).
  Route `POST /api/references/dossier/pdf` (`referencesDossierLimiter`, 6 par minute, 60 références au plus).
- **Charte de la fiche** (À NE PAS CHANGER sans l'accord de l'architecte) : marges 11 x 12 mm, titre 13,5 pt gras majuscules
  « Nature — Ville (Dépt) », logo 11 mm, filet 1,2 pt, grille d'infos (Programme, Labels / distinctions, Maître d'ouvrage,
  Maître d'œuvre, Mission, Phase, Surface / Budget), accent unique `#b2242a`, pied « NOM · AAZS · 01 / 01 ». **Toute donnée absente
  s'imprime « NC »** (`nc()`), jamais une valeur inventée. Images : `classeNbImages` (n1 à n6), `.thumbs` seulement à partir de 4
  images ; portrait = une grande image puis les vignettes, paysage = deux grandes puis une rangée de vignettes.
- **Données** : `reference_sheets` (`supabase/migrate_reference_sheets.sql`, une ligne par affaire OU référence manuelle : nature, ville,
  département, labels, maître d'œuvre, mission, phase, texte du budget, images retenues). Sans fiche, les valeurs se déduisent :
  ville/département du code postal de l'adresse (`deriveCityDept`, rien sans code postal), mission du contrat MOE lié, cotraitants
  dans le maître d'œuvre, budget = `construction_cost` (jamais `budget`, ambigu), programme = `projects.programme` seulement (la
  `description` peut porter des honoraires : jamais reprise). Une instance sans la table lit des fiches vides (`42P01`) et refuse l'écriture en 503.
- **Aucune image d'un autre projet** : chaque image est relue en base et n'est acceptée que si elle appartient à la référence ET au
  cabinet (`loadCandidate`, `server/referencesDossier/data.ts`) ; sinon elle est ignorée et signalée (`X-Dossier-Warnings`).
  Les images viennent de la couverture, des documents de l'affaire (images ou catégorie « Références - images ») ou, pour une
  référence manuelle, de sa galerie et des documents `resource_type = 'custom_references'` (ajouté à `ATTACHABLE_RESOURCE_TYPES`).
  Elles sont réduites à 1800 px (JPEG) avant le rendu ; un fichier sur un drive externe n'est pas lu.
- Pagination « 01 / 12 » sur le document entier (couverture comptée, sans pied) : c'est le gabarit de la fiche, qui l'emporte sur « P1|2 ».
- Tests : `tests/referencesDossier.test.ts`. Pas encore de PPTX.

### Panneaux d'affichage : chantier et permis de construire

Deux PDF A0 générés par Chromium (même mécanique que le dossier de références : HTML pur testé, `playwright-core`, aucune requête réseau, une seule file de rendu partagée `renderHtmlToPdf`, `server/referencesDossier/render.ts`). Code dans `server/panneaux/`, routes `server/routes/panneaux.ts`, limiteur `panneauxLimiter` (6 par minute et par personne), migration `supabase/migrate_panneaux.sql`.

**Pas de pied de page, pas de pagination.** Un panneau d'affichage ne porte ni coordonnées de l'agence en bas ni « P1|1 » (dérogation voulue par l'architecte à la charte des documents). Le bas du panneau de chantier porte un **QR code** en bas à droite (`qr.ts`, SVG vectoriel, zone de silence de 4 modules) avec son texte explicatif : il renvoie à `/chantier/<jeton>` (`src/pages/ChantierPublic.tsx`), liste publique et sans compte des entreprises (lot, nom, adresse), servie par `GET /api/public/chantier/:token` (`depotReadLimiter`, exempté d'authentification par le préfixe `/api/public`). Le jeton (`publicLink.ts`) est un HMAC de l'identifiant de l'affaire (clé dérivée de `MAIL_ENCRYPTION_KEY`) : stable, donc le QR imprimé reste valable, sans stockage ni migration ; un jeton falsifié ou une affaire inconnue donnent le même 404. La liste publique est complète (elle ignore les lignes masquées du panneau) et ne porte ni logo ni donnée autre que nom et adresse. Réglage `qrCode` (vrai par défaut). Adresse encodée : `APP_URL`, à défaut l'hôte de la requête. **Sous-traitants** : saisis dans l'onglet RDT, sous le bloc de chaque marché (`SousTraitantsMarche.tsx`, `server/routes/marcheSousTraitants.ts`, table `marche_sous_traitants`, `supabase/migrate_marche_sous_traitants.sql`, nom, prestation, adresse, SIRET). Jamais imprimés sur le panneau ; repris par `loadChantierPanel` (`sousTraitants`) dans la liste publique du QR code, avec leur entreprise et leur lot. Un accord-cadre n'en porte pas (on les ajoute au subséquent). Instance non migrée : lecture vide, 503 à l'écriture. **Pas encore fait** : la base légale exacte (décret n° 2023-452 du 9 juin 2023, article du code du travail visé) n'a pas pu être relue sur Légifrance depuis le serveur et n'est donc pas citée sur le panneau.

**Formats et mise à l'échelle** (`pageSpec.ts`). Les gabarits sont dessinés une fois à la taille d'un A0 (841 mm en portrait, 1189 mm en paysage) puis mis à l'échelle par `zoom` : un A1 est un A0 réduit, pas une autre mise en page. Chantier : A0, A1, A2, A3, portrait ou paysage. Permis : A0, 80 x 120, 100 x 150 (réglementaires) et A3, A4 (aperçu). Chaque rendu mesure le débordement de `.body` et le remonte en avertissement (`X-Panneau-Warnings`), jamais un contenu rogné en silence.

**Panneau de chantier** (`GET/PUT /api/projects/:id/panneau-chantier`, `POST .../pdf`, `PanneauChantierDialog.tsx`, bouton « Panneau de chantier » du plan d'actions de la fiche affaire). Rien n'est ressaisi : maître d'ouvrage (fiche du client), AMO et intervenants (`project_stakeholders`), cotraitants, architecte (réglages du cabinet), lots (`project_lots`, ordre naturel) et entreprises relus à chaque génération. L'entreprise d'un lot vient du marché (`marches_entreprises`), rapproché du lot par intitulé (`associerMarches`, `server/planningSources.ts`, le numéro ne faisant que départager : sur une affaire réelle le marché 09 « Peinture » répond au lot 07), à défaut de la fiche du lot ; un marché subséquent ou résilié est ignoré. Un lot sans entreprise s'affiche « Entreprise à désigner ». Le nombre de colonnes de lots s'adapte (3 jusqu'à 27 lots, 4 jusqu'à 48 en portrait et 40 en paysage, 5 au-delà). Le client n'envoie que des réglages (format, orientation, lignes masquées, image, titre, logos), validés par liste blanche (`sanitizePanelSettings`), mémorisés par affaire dans `project_site_panels` (jsonb). Une instance sans la table lit des réglages vides et refuse l'écriture en 503.

**Logos** : celui de la fiche contact (`contacts.logo`, data URL saisie avec `ContactLogoField`), relu côté serveur par identifiant et jamais pris dans la requête. Validation sur les octets (`logos.ts`) : PNG, JPEG ou WebP, jamais SVG (scripts, références externes), 1,5 Mo au plus. Un logo invalide est ignoré et signalé, il ne fait jamais échouer le rendu. Niveaux de gris par défaut (charte du cabinet), couleur sur option ; masquables par ligne ou en bloc ; une entreprise sans logo ne réserve aucun espace. Avertissement sous 100 dpi à la taille imprimée. Un contact d'un autre cabinet n'est jamais lu (nom, adresse et logo compris).

**Panneau d'affichage du permis** (`GET /api/permits/:id/panneau`, `POST .../panneau/pdf`, `PanneauPermisDialog.tsx`, bouton sur chaque ligne de PC ou de DP). Mentions portées par la fiche du permis (colonnes `nature_projet`, `superficie_terrain_m2`, `surface_plancher_m2`, `nombre_logements`, `hauteur_m`, `mairie_nom`, `mairie_adresse`, `numero_decision`, écrites par `PUT /api/permits/:id` via `panneauExtras`, seulement si présentes dans le corps), préremplies depuis l'affaire sans rien inventer (nature = `projects.programme`, jamais `description` qui peut porter des honoraires). Une autorisation de travaux (AT) n'a pas de gabarit.
- **Textes réglementaires** (`mentionsLegales.ts`, verrouillés par `tests/panneauxPermis.test.ts`) : rédigés SANS accès à Légifrance. `MENTIONS_VERIFIEES_LE` reste `null` tant qu'ils n'ont pas été relus contre le texte officiel (art. R424-15, A424-15 à A424-19, R600-1, R600-2, arrêté du 30 mars 2017). À faire avant tout usage officiel. La fenêtre affiche en permanence « mentions à vérifier par l'architecte ».
- **Dimensions** : les DEUX côtés doivent faire au moins 80 cm (`isRegulatorySize`). Le texte parle de dimensions « supérieures à 80 cm » : le 80 x 120 du commerce est accepté, lecture à confirmer sur Légifrance. Un format plus petit (A1, A2, A3, A4) reçoit le filigrane « Aperçu non réglementaire ».
- **Brouillon et définitif** : l'affichage n'est obligatoire qu'à la délivrance, pas au dépôt. À la création d'un PC, le client génère un brouillon (champs à compléter en pointillés, bandeau « Brouillon, à compléter à la délivrance ») et le rattache au permis (documents `resource_type = 'permits'`, catégorie « Permis »), en meilleur effort. Au passage à `accorde`, un toast propose la version définitive. La version définitive est refusée en 400 (liste `missing`) tant qu'un champ obligatoire manque (bénéficiaire, architecte, numéro, date de délivrance, nature, superficie du terrain, mairie), et en 409 sur un permis refusé. Surface de plancher et hauteur absentes sont signalées sans bloquer (une hauteur absente ou erronée peut empêcher le délai de recours de courir).

**Pas encore fait** : traits de coupe et fond perdu, envoi du panneau d'aperçu par e-mail au maître d'ouvrage depuis la fenêtre, outil d'agent/MCP `generate_site_panel`, extension à la déclaration préalable de lotissement.
