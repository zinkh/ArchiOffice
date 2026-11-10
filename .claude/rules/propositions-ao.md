---
paths:
  - "src/pages/Proposals.tsx"
  - "src/pages/TenderDetail.tsx"
  - "src/pages/Tenders*.tsx"
  - "src/components/proposal/**"
  - "src/components/Tender*.tsx"
  - "src/lib/proposal*.ts"
  - "src/lib/feasibility*.ts"
  - "src/lib/terrainParcelles.ts"
  - "src/lib/pdfPagination.ts"
  - "server/routes/proposal*.ts"
  - "server/routes/tender*.ts"
  - "server/feasibilitySiteData.ts"
  - "server/tenderAiTriage.ts"
---

# Propositions, appels d'offres, faisabilité

> Règles extraites du CLAUDE.md racine, sans modification de contenu. Chargées quand Claude lit un fichier correspondant aux chemins ci-dessus.

### Pré-tri IA de la veille : propositions avec identifiant AO-IA

Onglet « Propositions IA » de `/appels-offres` (`TenderRssAiProposals.tsx`), à côté de la veille RSS, qui reste
la seule source des annonces (flux RSS, BOAMP, TED : `tender_rss_matches`). L'IA les **note et les propose**, elle ne
change jamais leur statut : écarter, surveiller (puis convertir en appel d'offres) restent des gestes de l'architecte,
avec annulation. Migration `supabase/migrate_tender_rss_ai_triage.sql` (colonnes `ai_*` sur `tender_rss_matches`,
`settings.tender_ai_criteria`) ; une instance non migrée répond 503 au scan et lit des critères vides.

- **Réservé au plan Enterprise**, réserve → exécute → règle comme `tenderAi.ts` (`endpoint_type = 'tender_ai'`), **un
  appel par lot de 12 annonces**, 48 au plus par passage (`more` dit qu'il en reste). Crédit épuisé : le passage s'arrête
  proprement, ce qui est déjà noté reste noté. Route : `POST /api/tender-rss-matches/ai-scan`
  (`server/routes/tenderRssAi.ts`, logique pure dans `server/tenderAiTriage.ts`, `tests/tenderRssAi.test.ts`).
- **Pré-tri sans modèle** : une annonce dont la date limite est dépassée est écartée (note 0) sans appel au modèle ;
  une date absente ou illisible n'écarte jamais.
- **Note 0-100, verdict déduit** (`verdictForScore`) : 70 et plus « pertinent », 40 à 69 « à étudier », en dessous
  « hors cible ». Le modèle rend note, motif et points d'attention, jamais le verdict. Les critères du cabinet (texte
  libre, `settings.tender_ai_criteria`, 2000 caractères, bouton « Mes critères ») sont dans le prompt ; le contenu des
  annonces y est cité comme donnée non fiable.
- **Identifiant `AO-IA-AAAA-NNN`**, attribué seulement à partir de « à étudier », par le serveur (jamais par le
  modèle), à la suite du plus grand numéro de l'année ; unique par cabinet (index partiel, nouvel essai au conflit),
  **stable** : « Tout renoter » (`rescore: true`) change notes et verdicts mais garde les identifiants déjà donnés.
- **Pas encore fait** : scan automatique à chaque relève du poller (coût en jetons non borné par une action humaine),
  notification des annonces « pertinentes ».

### Rédaction assistée de la note méthodologique d'un appel d'offres

Onglet Note méthodologique de `/appels-offres/:id` (`src/pages/TenderDetail.tsx`,
`server/routes/tenderAi.ts`, `server/routes/tenderMethodology.ts`) — réservée
au plan Enterprise comme le reste de l'assistance IA sur les appels d'offres
(`requireEnterprisePlan`). Deux gestes, tous deux sur le patron réserve →
exécute → règle déjà en place pour le chat des agents :

1. **« Préremplir les titres »** (`POST .../methodology/prefill-sections`)
   pose le plan de sections avant toute rédaction. Sans DCE attaché à
   l'appel d'offres, pas d'appel IA : `DEFAULT_METHODOLOGY_TITLES` (une
   structure usuelle de mémoire technique MOE) suffit et ne coûte rien. Un
   DCE attaché fait préférer le sommaire réellement exigé par le règlement
   de consultation quand il en impose un. Les titres déjà présents (comparés
   sans tenir compte de la casse) ne sont jamais dupliqués.
2. **« Rédiger avec IA »** (`POST .../methodology/:noteId/draft-ai`) rédige
   le contenu d'une section en combinant TOUJOURS ce qui est disponible,
   plutôt que de faire choisir entre des sources exclusives (un bouton par
   source avait été essayé, puis abandonné — une note gagne à croiser les
   deux, jamais à choisir) :
   - les spécialités mobilisées ET le nom du cotraitant nommément saisi en
     face de chacune (onglet Partenaires, `tender_specialties.contact_id` →
     `contacts.name`) — sans ce nom, la note ne pouvait citer que des
     intitulés de métier génériques ;
   - le texte des documents DCE de l'affaire (`documents` avec
     `resource_type='tenders'`) — même lecture qu'« Analyser le DCE » ;
   - la bibliothèque documentaire du cabinet (présentation, exemples de
     notes déjà rédigées, présentation des cotraitants habituels...) :
     `documents` avec `resource_type='agency_library'`, une seule ligne
     logique par cabinet — `resource_id` est le `tenant_id` lui-même, pas
     l'id d'une fiche, donc `POST /api/documents` le vérifie par égalité
     directe plutôt que par `assertTenantEntity` (aucune table
     `agency_library` à interroger). Gérée depuis `/settings` (onglet
     Cabinet, `AgencyMethodologyLibraryCard.tsx`) avec le même composant
     `ResourceAttachments` que les autres pièces jointes rattachées
     génériquement.

   Chacune des deux sources documentaires est best-effort et indépendante de
   l'autre : l'absence de l'une n'empêche jamais d'utiliser l'autre, et la
   rédaction reste possible avec le seul contexte de l'affaire si aucune des
   deux n'est disponible. `extractCombinedText()` (`tenderAi.ts`) factorise
   la lecture partagée par ce geste et par « Analyser le DCE »/« Chercher
   dans le DCE ».

### Étude de faisabilité d'une proposition

Volet repliable « Étude de faisabilité » du détail d'une proposition
(`Proposals.tsx`, composant `src/components/proposal/FeasibilityStudy.tsx`),
sur le modèle de la note méthodologique ci-dessus : des rubriques ordonnées
(`proposal_feasibility_sections`, `supabase/migrate_proposal_feasibility.sql`),
une seule étude par proposition (l'étude EST l'ensemble de ses rubriques, sans
table parente). Chaque rubrique porte `content`, `instructions` (consigne libre
pour l'IA, jamais imprimée) et `illustrations` (jsonb, extraits de cartes).

**Seule la rédaction IA est réservée au plan Enterprise.** Rubriques, blocs
d'informations, extraits de cartes, exports et « Préremplir les rubriques »
sans IA restent ouverts à tous (`server/routes/proposalFeasibility.ts`).
`server/routes/proposalFeasibilityAi.ts` porte les deux gestes IA, en réserve
→ exécute → règle (`endpoint_type = 'proposal_ai'`) :

- **Préremplir** pose `DEFAULT_FEASIBILITY_TITLES` sans appel au modèle ; avec
  une pièce jointe à la proposition ET le plan Enterprise, l'IA adapte ce plan
  à l'opération. Jamais de doublon de titre (comparaison sans casse).
- **Rédiger avec IA** combine toujours tout ce qui est disponible : champs de la
  proposition, données publiques du terrain, texte des pièces jointes (les
  images, donc les extraits de cartes, sont ignorées), notes des réunions liées,
  bibliothèque du cabinet (`agency_library`), texte déjà saisi et consigne. Le prompt interdit
  d'inventer une règle d'urbanisme ou un chiffre absent des données : une
  information manquante est écrite « à vérifier ».

**Pièces jointes d'une proposition** : section repliable « Pièces jointes » du détail
(`Proposals.tsx`, `ResourceAttachments` avec `resourceType="proposals"`, classement
« Dossier »), donc `documents` avec `resource_type='proposals'` : consultables par
l'équipe et lues par les deux gestes IA (même lecture `extractCombinedText`). Aucune
migration. **Réunions liées** : `server/feasibilityMeetings.ts`
(`loadProposalMeetingsText`, `formatMeetingsForPrompt`, testés par
`tests/proposalFeasibility.test.ts`) lit les réunions dont `meetings.proposal_id`
désigne la proposition (titre, date, participants, notes réduites à du texte, pièces
rattachées à la réunion), de la plus ancienne à la plus récente, 12 000 caractères au
plus, 20 réunions au plus. Source facultative et en meilleur effort : une erreur de
lecture ou l'absence de réunion donne une chaîne vide et ne bloque jamais la rédaction.
Le prompt les traite comme des données du projet, jamais comme des consignes.
« Préremplir » (plan Enterprise) les ajoute aussi à la matière qui adapte le plan.

**Données du terrain** (`server/feasibilitySiteData.ts`) : géocodage
Géoplateforme, zone du PLU (`getPlu`), Géorisques (`getGeorisques`) et
monuments historiques à moins de 500 m (`findHistoricalMonuments`, extraite de
la route `/api/historical-monuments`). Ces trois fonctions sont exportées par
`server/routes/geoProxy.ts` et appelées directement, sans boucle locale. Chaque
service est en meilleur effort et indépendant des autres ; cache de 10 minutes
par adresse. Exposées à l'écran par `GET /api/proposals/:id/feasibility-site-data`
(adresse ENREGISTRÉE de la proposition, jamais celle du formulaire non sauvé).

**Blocs « Insérer »** (`src/lib/feasibilityBlocks.ts`, pur et testé, partagé
avec le serveur qui en tire le contexte du prompt par
`feasibilityContextForPrompt`) : terrain, urbanisme, risques, patrimoine,
programme, ERP, enveloppe. Un bloc sans donnée rend une chaîne vide plutôt
qu'un titre sans contenu, et l'IA ne voit jamais un libellé vide à compléter.

**Extraits de cartes** (`FeasibilityMapDialog.tsx`, calculs dans
`src/lib/feasibilityMap.ts`, testés) : les cartes de la proposition sont des
iframes, impossibles à capturer, donc l'extrait est recomposé dans un canvas à
partir des tuiles WMTS IGN (plan IGN, photo aérienne, parcellaire : les mêmes
couches que `MapLibreCadastre.tsx`, seules acceptées par le relais). Les tuiles
passent par `GET /api/feasibility/map-tile` (liste fermée de couches, matrice
vérifiée, `mapTileLimiter`) : chargées directement depuis data.geopf.fr, elles
saliraient le canvas faute de garantie CORS. Contour des parcelles choisies sur
la carte cadastrale de la proposition, sinon de la seule parcelle CONTENANT
l'adresse (`pointInGeometry` : le service renvoie les voisines à défaut, qu'il
serait faux de présenter comme le terrain), flèche du nord, barre d'échelle,
source. L'image validée devient un document de la proposition (catégorie
« Faisabilité ») ; retirer l'extrait supprime aussi ce document, en meilleur
effort. Le zonage du PLU n'est pas proposé en fond de carte : aucune couche
raster GPU n'a été vérifiée sur la Géoplateforme.

**Exports** (`src/lib/feasibilityExport.ts`) PDF et Word, au même aspect : logo et
repère « référence | Étude de faisabilité | Indice X » sur la première page
seulement (repère seul ensuite), titre en majuscules, champs en lignes (pas de
tableau de garde) avec indice et date de diffusion, sommaire, rubriques à la
suite sous un titre majuscule souligné, extraits de cartes avec légende,
pagination « P1|2 ». Indice et date vivent dans `proposals.feasibility_indice` /
`feasibility_issue_date` (`supabase/migrate_proposal_feasibility_meta.sql`),
écrits par `PUT /api/proposals/:id/feasibility-meta` ; sans valeur, l'export
prend « A » et la date du jour. Le Word reste modifiable (texte, puces, images).

### Export PDF d'une proposition : mise en page continue

`ProposalExportModal.tsx` ne fabrique plus « une section = une page fixe » (tout ce qui dépassait
une page était tronqué : fin du tableau des caractéristiques, missions proposées). Le document est UN
bloc `[data-pdf-flow]`, haut d'un nombre entier de pages A4, capturé par `jsPDF.html()` en une fois.
`src/lib/pdfPagination.ts` (`paginateFlow`, appelée après chaque rendu et par l'export) repousse sur la
page suivante chaque bloc qui ne tient pas : la coupure de jsPDF, tous les 297 mm, tombe donc toujours
dans une marge. La partie pure (`pageShiftMm`, `pageCountForHeight`) est testée
(`src/lib/__tests__/pdfPagination.test.ts`) ; la partie DOM ne se teste qu'en navigateur.

- **Géométrie** : bande haute de 26 mm (en-tête), bande basse de 20 mm (pied et « P1|N »), contenu entre
  les deux. En-tête, pied et pagination sont du HTML posé par-dessus, page après page (`PageChrome`) ; les
  repères de coupure de l'aperçu portent `data-pdf-screen-only` et sont masqués à l'export. La page de
  garde est une page entière à part (`data-pdf-cover`), hors pagination.
- **Ce qu'on ne coupe pas** : tout bloc `data-pdf-keep`, chaque ligne de tableau (`tbody > tr`,
  `tfoot > tr`), chaque `<P>`. Un titre (`data-pdf-heading`) suit le premier vrai bloc qui le suit (les
  autres titres et les blocs vides sont traversés), une ligne `data-pdf-keep-next` suit sa voisine. Un
  tableau coupé répète son en-tête sur la page suivante. Un bloc plus haut qu'une page entière n'est pas
  déplacé. Le nombre de pages se lit sur le bas du DERNIER contenu, jamais sur la marge basse du corps
  (page blanche sinon). Un espaceur est un `div` (ou une `tr`) `data-pdf-spacer` retiré à chaque
  repagination : ne jamais en garder de référence.
- **Trois réglages** (`ProposalTemplate.layout`, `localStorage['proposalTemplate']`, panneau « Mise en
  page » ; un modèle déjà enregistré reçoit les valeurs par défaut par fusion) : `sectionBreaks` (une
  section s'ouvre sur une page neuve ; vrai par défaut, la première section s'ouvre toujours sur une page
  neuve), `tableDensity` (`normal` | `compact` | `dense`, **compact par défaut**, `DENSITY_TOKENS` :
  marges et corps des cellules, interlignes, espacements des titres) et `cotraitantIdentity` (vrai par
  défaut).
- **Identité des cotraitants** : `loadCotraitantIdentities` / `identityFromContact`
  (`src/lib/pdfLetterhead.ts`, testés) lisent la fiche contact (raison sociale, personne, adresse de
  travail à défaut l'adresse générale, téléphone, e-mail, SIRET, logo) sans rien inventer. La section 05
  devient un tableau Logo / Spécialité / Société et contact / Coordonnées ; les logos de la page de garde
  suivent le même réglage. Les logos sont réduits à 600 x 300 px (`compressProposalLogo`) : jsPDF
  embarque les images à leur résolution native.
- **Tableaux** : « Calcul des honoraires » n'a plus de colonne « Catégorie » (vide sur chaque ligne de
  mission, elle écrasait la désignation) : la catégorie est une ligne de titre. Le tableau de répartition
  est en mise en page automatique, ses montants ne se coupent pas, et ses marges se resserrent dès trois
  intervenants.
- **Pièges propres à jsPDF, à ne pas défaire** : l'espace fine (U+202F) que `Intl` met dans les milliers
  s'imprime « / » et l'insécable avant « € » sans largeur (« 46 /000,00€ ») : `formatCurrency` et
  `formatPercent` n'emploient que des espaces ordinaires, et les cellules de montant portent
  `white-space: nowrap`. Le texte est imprimé environ 1 mm plus bas que sa boîte : les marges de cellule
  sont plus grandes en bas qu'en haut, et aucun texte ne porte `overflow: hidden` (il serait rogné).
  Les SVG sont masqués à l'export (ce sont les icônes), donc le diagramme de Gantt est dessiné en HTML ;
  ☑ et ☐ n'existent pas dans la police du PDF (ils sortaient en « & ») : ce sont des carrés dessinés.
  L'export repagine après avoir masqué ces éléments et après les avoir rétablis.

### Terrain d'une proposition : carte sous l'adresse, parcelles enregistrées, ERP conditionnel

Section 04 de la modale (`Proposals.tsx`, composant `src/components/proposal/TerrainParcelles.tsx`) : la carte cadastrale est juste sous l'adresse du terrain (elle était en section 06). Logique pure dans `src/lib/terrainParcelles.ts` (testée).

- **Parcelles persistantes** : `proposals.parcelles_selection` (TEXT, JSON de `StoredParcel[]` avec géométrie, 50 au plus, `supabase/migrate_proposal_parcelles_erp.sql`). L'écran en dérive la sélection (`parseStoredParcels`, jamais d'exception) et la renvoie à la carte par la prop `selection` de `MapLibreCadastre`, reportée sans rappeler `onSelectionChange` (comparaison par identifiant : pas de boucle). `GeoportailMap` ne démonte plus la carte pendant un nouveau géocodage (`loading && !coords`), sinon la sélection se perdait. Quand l'écran hôte tient la sélection, la carte ne la vide plus d'elle-même au recentrage ; l'écran la vide si une adresse choisie dans l'autocomplétion (`lon`/`lat` ajoutés à `onSelect`) tombe hors des parcelles.
- **Adresse issue de la parcelle** : à la première parcelle cochée, `GET /api/address-reverse` (Géoplateforme puis BAN, `distance` en mètres, rien au-delà de 250 m) donne l'adresse du centre de la parcelle. Si elle diffère de l'adresse saisie (`sameAddress` : casse, accents, ponctuation ignorés), une bannière `role="alert"` propose « Changer l'adresse » ou « Garder l'adresse saisie ». Rien n'est appliqué sans accord ; l'adresse reste modifiable à la main.
- **Tableau** : parcelle, commune, surface, retrait, total (« partielle » si une contenance est inconnue). Retirer une ligne la retire aussi de la carte. `ref_cadastrale` et `surface_parcelle` restent remplis depuis la sélection (modifiables).
- **ERP conditionnel** : `proposals.is_erp` (BOOLEAN, NULL = non renseigné). `isErpOperation` (`src/lib/erp.ts`) : le choix explicite l'emporte, sinon l'opération est ERP dès qu'un champ ERP est déjà saisi (une donnée existante n'est jamais cachée). Type et catégorie, surfaces ERP/ERT et effectifs ne s'affichent que pour un ERP ; à l'enregistrement d'une opération non ERP ces champs sont vidés.

### Proposition : nature de l'opération, surfaces, ERP, indice, envoi au client

- **Nature de l'opération** (`proposals.operation_nature` `neuf` | `rehabilitation`, `surface_existante`, `surface_rehabilitee`, `supabase/migrate_proposal_surfaces_nature.sql`) : logique pure dans `src/lib/proposalSurfaces.ts` (testée). Neuf : une surface de plancher, montant des travaux = surface x ratio de construction neuve (`ratio_extension`). Réhabilitation : surface existante, surface réhabilitée (à défaut toute l'existante), surface d'extension ; la surface de plancher (`surface_plancher`, lue par la MAF et les exports) est recalculée = existante + extension, et le montant = réhabilitée x ratio réhab + extension x ratio extension. Une proposition antérieure sans nature la déduit (`operationNature`) et relit `surface_plancher` comme surface existante tant que rien n'est saisi à son nom.
- **Champs ERP** (nom de l'établissement, avant/après travaux, type et catégorie ERP, surfaces ERP/ERT, effectifs) : visibles et exportés seulement pour une opération ERP, vidés à l'enregistrement sinon. « Type de projet » et « Catégorie de projet » restent visibles (ils alimentent la MAF, les exports et la déduction neuf/réhabilitation).
- **Indice** : démarre à `A` et se change à la main ; « Date de modification » n'est plus saisie.
- **MAF** : le calcul est affiché sous le calcul des honoraires (TVA/TTC), selon le type de mission choisi en section 04.
- **Envoyer au client** (action de la liste) : `ProposalExportModal` (`intent: 'send'`) génère le PDF sans le télécharger (`exportProposalPdf(..., { download: false })`) et ouvre `SendProposalMail` (`MailComposeModal` avec `initialFiles`) ; une proposition en brouillon passe à « Envoyée » une fois le message parti.

### Honoraires d'une proposition : arrondi, remise, PC seul

Logique pure dans `src/lib/proposalFees.ts` (testée, `__tests__/proposalFees.test.ts`), migration `supabase/migrate_proposal_fees_discount.sql`.
`proposals.amount` reste le **net HT** (lu par la MAF, les factures et les exports) ; `fee_gross` porte le brut avant remise.
Ordre fixe : brut = coût x % de base x complexité x part du périmètre, arrondi du brut (`fee_rounding` : centime, euro, dizaine,
centaine), remise (`discount_mode` pourcentage ou montant, plafonnée au brut), arrondi du net, remise affichée = brut - net (les lignes
s'additionnent toujours), TVA au centime. **PC seul** (`mission_scope = 'pc'`) : les honoraires sont la part `scope_share_pct`
(36 % par défaut, corrigeable) de ceux d'une mission complète ; la répartition ne garde alors esquisse, APS et APD (parts ramenées à
100 %). L'écran détaille le calcul ligne à ligne ; l'export PDF imprime brut et remise quand il y en a une.

### Planning d'une proposition : un seul modèle pour l'écran et l'export

L'écran (`ProposalGantt.tsx`) et l'export PDF lisent le même calcul, `planifierCalendrier` (`proposalExport.ts`), avec les réglages
manuels de `proposals.planning` (`src/lib/proposalPlanning.ts`, migration `migrate_proposal_planning.sql` : durée et jour de début par
mission, option des flèches de dépendance). Les anciens jalons de proposition (`MilestoneGantt`, tous à 30 jours, sans enchaînement,
jamais enregistrés) ne pilotent plus le planning. Barres déplaçables (début) et étirables (durée) ; une mission décalée à la main ne
dépend plus de la précédente. Les flèches ne figurent pas dans le PDF (les SVG y sont masqués).

### Jalons datés (fiches affaires, appels d'offres) : même diagramme, mêmes réglages

`MilestoneGantt.tsx` s'appuie sur `src/lib/milestoneSchedule.ts` (pur, testé) : un jalon part de sa `due_date`, ou de la fin du jalon dont
il dépend (`dependencies[0]`), au plus tôt à sa propre date ; durée `duration_days` (1 jour à défaut). L'ancien calcul ignorait `due_date`
et faisait partir tous les jalons sans dépendance à la même date. Barres déplaçables (la date change, la dépendance est détachée, l'heure
éventuelle est conservée) et étirables (durée), flèches de dépendance activables (préférence `localStorage['ganttShowDependencies']`),
lecture seule sans `onUpdate`. Fiche affaire : chaque jalon modifié est réenregistré (`PUT /api/milestones/:id`, `changedMilestones` +
`persistMilestones`). Appel d'offres : le diagramme édite la liste du formulaire, enregistrée avec l'appel d'offres ; le serveur
(`milestonesForInsert`, `server/routes/tenders.ts`) garde désormais durée et dépendances, reprend l'identifiant d'un jalon seulement s'il
appartenait déjà à l'appel d'offres et réécrit les dépendances vers les identifiants enregistrés.

### Tranches fermes et conditionnelles (propositions et appels d'offres)

Même moteur pour les deux : `HonorairesSection.tsx` et `FeeDistributionGrid.tsx` (la grille de répartition des
honoraires). **Aucune migration** : les tranches vivent dans le JSON `fee_distribution` déjà porté par `proposals` et
`tenders` : `{ tranches: [{ id, label, type: 'ferme' | 'conditionnelle', condition? }], contrat_tranches?, missions: [{ ..., tranche_id }] }`.
Logique pure et testée dans `src/lib/tranches.ts` (`src/lib/__tests__/tranches.test.ts`).

- **Optionnel et rétrocompatible** : sans liste `tranches`, tout se comporte comme avant (tranche ferme implicite,
  `listeTranches`). L'interrupteur « Découper en tranches » de la section Honoraires active le mode ; il ne se
  désactive que sans tranche conditionnelle. Il reste toujours au moins une tranche ferme (`modifierTranche`,
  `supprimerTranche` refusent sinon) ; supprimer une tranche renvoie ses missions dans la première tranche ferme.
- **Répartir une mission sur plusieurs tranches** : duplication de la ligne (`dupliquerMissionSurTranche`, id
  `<mission>__<tranche>`, montant à saisir, parts d'intervenants copiées). Le sélecteur ⇄ déplace la ligne, ⧉ la
  duplique. Une mission à `tranche_id` absent ou inconnu compte en tranche ferme (`trancheDeMission`).
- **Montants** : `proposals.amount` reste le **total toutes tranches** (lu par la MAF et les factures) ; `totauxParTranche`
  donne le ferme, le conditionnel et le global, affichés dans la grille, l'Excel et le PDF.
- **Planning** : `planifierCalendrierParTranches` (`proposalExport.ts`, utilisé par l'écran `ProposalGantt` et le PDF)
  planifie chaque tranche comme un planning complet, la suivante démarrant à la fin de la précédente (la conditionnelle
  après la ferme). Un jour de début réglé à la main (`proposals.planning`) reste absolu.
- **Contrat MOE à l'acceptation** (`PUT /api/proposals/:id`) : `contrat_tranches` (`'ferme'` ou `'toutes'`, défaut
  `toutes`, choisi sous la grille quand une conditionnelle existe) décide si le contrat reprend la tranche ferme seule
  (montant du contrat = total ferme) ou toutes les tranches. Chaque mission du contrat porte sa `tranche` (libellé).
- **Validation serveur** : `validerTranches` / `erreurTranchesJson` à l'enregistrement d'une proposition et d'un appel
  d'offres (400 si type invalide, identifiants en double, mission rattachée à une tranche inconnue, aucune tranche
  ferme). `tests/proposalTranches.test.ts`.
- **Exports** : PDF de proposition groupé par tranche (titre, condition d'affermissement, total par tranche, totaux
  ferme et conditionnel ; la liste des phases confiées ne répète pas une mission répartie sur plusieurs tranches) ;
  Excel : un groupe par tranche et les lignes « TOTAL TRANCHES FERMES / CONDITIONNELLES HT » (formules).

