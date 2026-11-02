---
paths:
  - "src/components/chantier/**"
  - "src/components/projectDetail/situations/**"
  - "src/lib/planningChantier*.ts"
  - "src/lib/crDiffusion.ts"
  - "src/lib/observation*.ts"
  - "src/lib/siteReport*.ts"
  - "src/lib/certificatPaiement*.ts"
  - "src/lib/situation*.ts"
  - "server/routes/siteReport*.ts"
  - "server/routes/situations.ts"
  - "server/routes/ordresDeService.ts"
  - "server/routes/travauxModificatifs.ts"
  - "server/routes/planningChantier.ts"
  - "server/routes/observations.ts"
  - "server/planningSources.ts"
  - "src/pages/Reunions.tsx"
---

# Chantier : DET, RDT, comptes-rendus, planning, observations

> Règles extraites du CLAUDE.md racine, sans modification de contenu. Chargées quand Claude lit un fichier correspondant aux chemins ci-dessus.

### OS multi-entreprises, travaux modificatifs et FTM (onglet DET)

- **Numérotation PAR ENTREPRISE** (`src/lib/numerotationEntreprise.ts`, testé, partagé serveur et écran) : chaque entreprise a sa propre suite d'OS (01-001, 01-002... : lot, puis rang à trois chiffres) et de FTM (FTM-01-01, FTM-01-02... : lot, puis rang dans la suite de l'entreprise pour CE lot). Une entreprise = sa fiche contact, à défaut son nom normalisé (`cleEntreprise`) : deux lots d'une même entreprise n'en font qu'une. Le numéro est attribué par le serveur, sous verrou par affaire, jamais lu dans la requête (`creerOrdreDeService`, `prochainNumeroOs`, `numerosFtm`). Un OS ou une FTM adressé à plusieurs entreprises reçoit un numéro dans la suite de CHACUNE : `numeros_entreprises` (jsonb, `[{ marche_id, lot, cle, entreprise, numero }]`) en garde le détail et `os_number` / `numero` en est le résumé affiché (« 04-002 / 05-001 », « FTM-04-03 / FTM-05-02 », même ordre que les noms). Les OS antérieurs (« 003 », numérotés à l'affaire) comptent pour les entreprises de leurs marchés : la suite continue après leur numéro (`numeroHeriteOs`, `numeroHeriteFtm` lisent le dernier groupe de chiffres). Une FTM sans entreprise a sa propre suite (« FTM-00-01 »). Le numéro d'un OS ou d'une FTM porte le numéro du lot (`lotPourNumero` : « 1 » devient « 01 », absent « 00 ») et sa suite est tenue par entreprise ET par lot (`cleEntrepriseLot`) : FTM-01-01 pour le lot 01, FTM-02-01 pour le lot 02, ce qui rend le numéro unique par affaire malgré l'ancien index. `GET /api/ordres_de_service/next-number?project_id=&marche_ids=a,b` rend l'aperçu par entreprise ; sans marchés, le plus grand numéro de l'affaire + 1. L'index unique `(affaire, numero)` des FTM peut rester en base : le numéro porte le lot, seule une collision de deux marchés sous un même numéro de lot (deux entreprises, même lot) la déclencherait, avec un message clair.
- **Un OS, plusieurs entreprises** : `ordres_de_service.marche_ids` (jsonb), `marche_id` restant le marché principal. Chaque marché est vérifié (cabinet, affaire, pas d'accord-cadre) ; `entreprise`, `lot` et `destinataire_os` résument tous les marchés. Colonnes absentes (instance non migrée) : repli sur le seul marché principal.
- **Pièces jointes d'un OS** : `ResourceAttachments` (`ordres_de_service`), choisies dans le formulaire puis déposées après création (`uploadResourceFiles`), ou depuis le trombone de la ligne.
- **Onglet « Travaux modificatifs »** (`TravauxModificatifsTab.tsx`, `server/routes/travauxModificatifs.ts`, `supabase/migrate_os_multi_entreprises_ftm.sql`) : devis reçus des entreprises (`devis_travaux_modificatifs`, statuts reçu / en analyse / accepté / refusé) et fiches de travaux modificatifs (`ftm`, statuts brouillon / émise / validée / refusée, entreprises concernées, incidences, lien vers l'OS émis). Un devis se rattache à une FTM ; supprimer la FTM détache ses devis. Pièces jointes sur les deux (`ftm`, `devis_travaux_modificatifs` dans `ATTACHABLE_RESOURCE_TYPES`). Instance non migrée : lecture vide, 503 à l'écriture.
- **Export PDF d'une FTM** (`src/lib/ftmPdf.ts`, `buildFtmRows` testé) : charte du cabinet, identification, objet, motif, description, incidences, devis liés avec total, trois cadres de visa (maître d'œuvre, entreprise(s), maître d'ouvrage). Rien n'est inventé : un champ absent s'imprime « — ».
- **OS prérempli depuis une FTM validée** (`POST /api/ftm/:id/ordre-service`) : refusé en 409 tant que la fiche n'est pas « validée » ou si elle a déjà son OS, en 400 sans entreprise. Brouillon d'OS de travaux : objet, description (motif + description), origine (`entreprise` devient `autres`), incidences de délai et de coût, montant = montant accepté de la fiche, à défaut somme des devis acceptés, à défaut estimation. Numéroté par entreprise par `creerOrdreDeService` (même chemin que la création à la main) ; la fiche garde `ordre_service_id`.
- **Cotraitance (deux entreprises sur un même lot)** : pas gérée, voir ROADMAP.md (« Co-contracting »). Les deux entreprises démarrent chacune à `04-001` / `FTM-04-01` ; l'index unique des FTM répond 409 à la seconde fiche.
- **Observations** : deux commandes par ligne (`ObservationsTable.tsx`) : « Nouvelle remarque pour la même entreprise » (même lot, bâtiment et phase) et « Changer d'entreprise ou attribuer à d'autres » (déplace la remarque vers un autre lot, ou en crée une copie par lot coché).

### Situations de travaux et certificats de paiement (onglet RDT)

L'onglet RDT listait les factures de l'AGENCE et en déduisait un « reste à
payer » qui mélangeait marchés de travaux et honoraires. Il porte désormais ce
que le maître d'œuvre traite en DET/RDT : les situations de travaux des
entreprises et les certificats de paiement établis à partir d'elles
(`src/components/projectDetail/situations/`), sans condition `is_chantier`.

- **Un bloc par marché** (`marches_entreprises` : une entreprise, un lot).
  « Reprendre les lots du projet » crée un marché par lot de `lots_list` qui a
  une entreprise (`contact_name`, montant base + options + avenants), sans
  doublon par numéro de lot.
- **Une situation porte le cumul HT** des travaux depuis le début du marché :
  `montant_presente_ht` (ce que facture l'entreprise) et `montant_admis_ht`
  (ce que l'architecte retient ; vide = le présenté est admis), plus
  `reference_entreprise` et `date_certificat`
  (`supabase/migrate_situations_certificats.sql`). Numérotée PAR MARCHÉ.
- **Le certificat se calcule en cumul** (`src/lib/certificatPaiement.ts`,
  testé) : période = cumul admis − cumul admis de la situation précédente DU
  MÊME MARCHÉ ; révision (si prix révisables), TVA, retenue de garantie (sur le
  TTC, nulle sous caution bancaire ou sur une période négative), remboursement
  d'avance, pénalités, net à payer. **Décompte de clôture** : total HT, liste
  des situations, TVA, TTC, puis reste à payer TTC = TTC − pénalités − avance
  versée − nets des certificats établis − retenue (libérable à la fin du délai
  de garantie, annoncée à part).
- **États stockés inchangés** (`Brouillon`, `Validée`, `Payée`), affichés « À
  vérifier », « Certificat établi », « Payée ». « Établir le certificat »
  enregistre `Validée` + `date_certificat` et télécharge le PDF ; les montants
  sont alors verrouillés jusqu'à « Rouvrir la vérification ».
- **Un seul rendu PDF** (`src/lib/certificatPaiementPdf.ts`), appelé par le
  navigateur (`certificatPaiementExport.ts`) ET par le serveur
  (`server/etatAcompte.ts`, logo via `loadAgencyIdentity`) pour la pièce jointe
  déposée sur la facture de l'entreprise chez Chorus Pro (public) ou Super PDP
  (privé) : le maître d'ouvrage reçoit le même document par les deux chemins.
  Charte du cabinet, nuances de gris, « P1|2 », date du certificat en en-tête.
- `POST/PUT /api/situations` (`server/routes/situations.ts`,
  `tests/situationsTravaux.test.ts`) passent par une liste blanche de champs
  (les colonnes Chorus Pro / Super PDP restent à leurs routes) et valident
  montants, dates et état. L'ancien `POST` écrivait `numero`/`statut`, colonnes
  inexistantes : aucune situation n'avait jamais pu être créée.
- **Deux modes de saisie cohabitent** (`situations.mode_saisie`,
  `supabase/migrate_situations_mode_detaille.sql`) : `simple`, le cumul HT se
  saisit directement ; `detaille`, un avancement CUMULÉ (%) se saisit sur
  chaque ligne du DPGF structuré du lot (`/api/projects/:id/dpgf`, jamais
  l'ancienne table `dpgf_items`) et le cumul en découle
  (`src/lib/situationDetaillee.ts`, testé ; `AvancementLignesTable.tsx`). Le
  lot du DPGF se retrouve par numéro (« 2 » = « 02 »), à défaut par intitulé ;
  le prix est celui de l'offre importée de l'entreprise (même nom, non
  écartée), à défaut celui du DPGF. Les lignes sont FIGÉES dans
  `situations.avancement_lignes` (désignation, quantité, prix, %) : un DPGF
  modifié après coup ne change pas une situation déjà saisie, et une ligne
  retirée du DPGF reste comptée. Une nouvelle situation repart de
  l'avancement de la précédente du même marché. **Le serveur recalcule
  `montant_presente_ht` à partir des lignes** (et `montantHt` = quantité × prix)
  sans croire un montant envoyé. Le certificat se calcule ensuite de la même
  façon dans les deux modes ; en mode détaillé, son PDF porte une annexe ligne
  à ligne (précédent, cumul, période).
- Les lignes `detail_situations` (avancement par poste de l'ancienne table
  `dpgf_items`) ne servent plus ; `src/pages/Situations.tsx`, qui les
  saisissait, est supprimé.

### Onglet DET : décisions d'interface

- **En-tête masqué sous 1024 px** (mobile et tablette) : titre, indicateurs et bouton
  disparaissent ; « Nouveau compte-rendu » est repris en tête de la liste des
  comptes-rendus (`lg:hidden`). Les sous-onglets (Comptes-rendus, Observations,
  Entreprises, OS & situations, Photos) passent par `PillTabs` (rôles ARIA, flèches).
- **« Diffuser » envoie un e-mail à chaque entreprise et chaque intervenant** : le PDF du
  compte-rendu en pièce jointe, et dans le corps de CHAQUE message les seules observations
  qui concernent le destinataire. Voir « Diffusion d'un compte-rendu par e-mail » plus bas.
- **La reprise en bloc des observations « à lever » en réserves AOR vit dans l'onglet
  AOR** (`ReprendreObservationsBanner`, au-dessus du suivi des réserves). La reprise
  d'UNE observation reste sur sa ligne du tableau des observations. Règle commune dans
  `src/lib/observationsReserves.ts` (testée).
- **Colonnes masquées du tableau des observations mémorisées par poste**
  (`obsTable:<filtre>:visibility`, localStorage), comme les largeurs de colonnes.
- Les contrôles sans libellé visible portent un `aria-label` (chevrons, météo,
  température) et les chevrons une cible de 44 px.

### Chantier hors ligne, en plusieurs bâtiments et phases

**Comptes-rendus hors ligne.** `GET /api/projects/:id/reports` n'était lu ni mis en
cache : sans réseau la liste restait vide, et un compte-rendu créé sur le chantier
disparaissait au premier rechargement. `siteReportsCache` et `siteReportNotesCache`
(Dexie v8) suivent le patron des autres caches (`cachedListFirst`), et la file
d'écritures est SUPERPOSÉE à la liste (`superposerEcrituresEnAttente`,
`src/lib/chantierDecoupage.ts`, testée) : création en attente ajoutée, modifications en
attente rejouées par-dessus. Toute modification d'un compte-rendu (`persistReport`),
création, édition et suppression de rubrique passent par `queuedJsonRequest`. Deux
pièges : une modification n'a jamais le même id de file que la création (sinon elle
l'écraserait), et le numéro d'un compte-rendu en attente est provisoire, donc jamais
renvoyé dans une modification. `POST /api/reports/:id/notes` accepte un `id` client
(idempotent).

**Bâtiments et phases.** Même registre que le CCTP/DPGF (`DecoupageDocument`) mais porté
par l'affaire : `projects.chantier_decoupage` (jsonb), écrit par sa propre route
`PUT /api/projects/:id/chantier-decoupage` (`server/routes/chantierDecoupage.ts`), jamais
par l'enregistrement automatique de la fiche (qui l'ignore, sa liste blanche ne le
contient pas). « Reprendre ceux du CCTP / DPGF » copie le registre du DPGF en gardant les
identifiants. `site_reports` et `observations` portent `batiment_id` / `phase_id`
(`supabase/migrate_chantier_decoupage.sql`), sans clé étrangère : retirer un bâtiment
du registre ne supprime rien, les lignes repassent « sans bâtiment ». Une observation
relevée dans un compte-rendu hérite de son bâtiment et de sa phase ; la liste des
comptes-rendus et le tableau des observations se filtrent par bâtiment, phase ou
« sans affectation », l'export PDF porte la ligne « Bâtiment / phase ». Rien n'apparaît
tant que le registre est vide.

### Réunions hors ligne : notes et intervenants

- **Les notes ne dépendent plus de la perte de focus.** `Reunions.tsx` garde chaque frappe dans un brouillon local (`meeting-notes-draft:<id>`, synchrone) et écrit 1 s après la dernière frappe, au changement de réunion et à `pagehide`. L'écriture en file a un id STABLE (`notes:<id>`) : les enregistrements successifs se remplacent, un seul PUT part. À la réouverture, brouillon non parti > écriture en file > valeur du serveur (`resolveMeetingNotes`), et un brouillon retrouvé est renvoyé.
- **Reconnexion** : `offlineQueue.ts` traite 401, 502, 503 et 504 comme le réseau absent (écriture gardée, rejeu plus tard), jamais comme un refus définitif. Une session pas encore renouvelée au retour du réseau ne fait plus perdre une saisie.
- **Intervenants hors ligne** (`src/lib/meetingAttendeesOffline.ts`, entité de file `meetingAttendee`, cache Dexie `meetingAttendeesCache`, v9) : ajout d'un contact existant ou d'un nouveau contact, changement de rôle, retrait. Les identifiants (intervenant, fiche contact) sont générés par l'appareil ; `POST /api/meetings/:id/attendees` et `/new-contact` les acceptent et rejouent sans doublon (200 au rejeu). La liste affichée = cache ou serveur + écritures en file rejouées par-dessus (`applyPendingAttendeeWrites`, testé). Les contacts viennent du cache `db.contacts` sans réseau.

### Compte-rendu de chantier au téléphone

`ChantierModule.tsx` (onglet Comptes-rendus) est le premier écran du chantier : ses
pièces vivent dans `src/components/chantier/`. Règles à garder :

- **Une rangée au bureau, une carte sous 768 px**, par `order-*` et `flex-wrap`, jamais
  deux DOM : `RubriqueRow`, `DecisionRow`, `ObservationRow` (`ReportRows.tsx`). L'ordre
  du DOM reste celui de la rangée de bureau, donc celui du clavier. Champs encadrés et
  cibles de 44 px au doigt (`ROW_FIELD`, `TOUCH_TARGET`, `fields.tsx`).
- **« Présence & suivi des lots »** : tableau à partir de 768 px, une carte par lot
  (`LotTrackingCards.tsx`, `useMediaQuery`, un seul rendu monté) en dessous. Même
  `lot_tracking`, mêmes champs ; le premier choix de statut crée la ligne de présence
  AVEC ce statut (il était ignoré, la ligne naissant « Présent »). Chaque carte est
  repliée par défaut sur le lot et son statut (pastille de couleur), avec un résumé de ce
  qui est saisi ; dépliée, effectif, retards, bâtiments, convocation et pénalité. Lieu et
  heure par lot ne se saisissent qu'au bureau : au téléphone, l'heure « Convocation » de
  la section vaut pour tous les lots.
- **Aucune saisie ne part à chaque frappe** : `DraftInput` et `CommitTextarea`
  n'enregistrent qu'à la sortie du champ. Chaque frappe renvoyait le compte-rendu entier
  au serveur, dont la réponse écrasait la saisie en cours (le lieu « se réinitialisait »,
  les décisions aussi).
- **`Section`** est repliable, état mémorisé par section (`chantier:section:<id>`) ; son
  action passe sous le titre quand la largeur manque au lieu de sortir de l'écran.
- **`QuickCaptureBar`** (téléphone seulement) : « Observation » et « Photo » fixés en bas.
  La photo ouvre l'appareil (`capture="environment"`) et crée l'observation qui la porte.
- Libellés : la nature `reserve` s'affiche « À lever » (`chantierConstants.ts`) ; « réserve »
  est réservé à l'AOR.
- **Deux vues d'une même donnée** : l'onglet **Observations** (`ObservationsTable`) est la vue PAR DÉFAUT
  de tout l'historique du chantier (statut, nature, urgence, lot, bâtiment / phase, CR émis et levé, photos,
  reprise en réserve de l'AOR, suppression) ; « Observations par lot » du compte-rendu n'en est qu'un
  EXTRAIT, celui des observations du jour (`observation_reports`), épuré à l'intitulé, au délai (« Pour le »)
  et aux photos. On y saisit sur le chantier, avec le lot choisi avant d'ajouter ; tout le reste se règle dans
  l'onglet Observations. Le badge « N observations non levées sur l'opération » (`countOpenObservations`,
  `src/lib/observationsOpen.ts`, tout ce qui n'est pas « Levée ») ouvre cet onglet sur « Ouverts seulement »
  (`initialOpenOnly`) pour la revue.
- **Ajout et suppression immédiats, sans doublon** (`ObservationsTable.tsx`, `src/lib/observationsLocal.ts`, testé) :
  une observation ajoutée apparaît tout de suite (« en attente ») au lieu d'attendre le serveur, ce qui évitait de
  re-cliquer et d'en créer deux ; une suppression retire la ligne de l'écran ET du cache hors-ligne avant la requête
  (la ligne revient avec un message si le serveur refuse). Une relecture partie avant l'action et revenue après ne
  ressuscite pas une ligne supprimée et ne fait pas disparaître une création (`reconcileRemote`), et un identifiant
  n'est jamais présent deux fois (`upsertById`, aussi dans `ChantierModule`). Après un ajout ou une suppression, le
  tableau prévient le compte-rendu (`onChanged`), dont les listes se relisent.
- **Réponse** : `observations.reponse` (`supabase/migrate_observations_reponse.sql`), texte libre saisi dans la
  ligne dépliée de l'onglet Observations (flèche à gauche, point si une réponse existe). L'export PDF du CR
  l'imprime sous la description, avec la colonne « Bât. / phase » quand le chantier a un registre et
  qu'une observation y est affectée (`opts.decoupage`).

### Planning de chantier (onglet DET > Planning)

Gantt décomposé par lot, entre « OS & situations » et « Photos » (`PlanningChantierTab.tsx`, sous « Plus » sur
téléphone). Table `project_chantier_planning` (`supabase/migrate_chantier_planning.sql`, une ligne par affaire,
jsonb `PlanningChantier`, hors `SYNC_TABLES`) ; routes `server/routes/planningChantier.ts`
(`GET/PUT /api/projects/:id/planning-chantier`, `POST .../generate`, `tests/planningChantier.test.ts`) ; logique pure
partagée écran / PDF / serveur dans `src/lib/planningChantier.ts` (testée). Une instance non migrée lit un planning
vide (`available: false`) et refuse l'écriture en 503.

- **Une tâche** : lot (`project_lots.id`, vide = tâche générale), dates AAAA-MM-JJ calculées en UTC, avancement,
  `source` (`ia` | `manuel`), jalon. L'état (à venir, en cours, terminée, en retard) **se déduit** (`etatTache`), jamais saisi.
- **Génération IA** : le serveur part du **DPGF et du CCTP de l'opération** quand ils existent (`server/planningSources.ts`,
  testé : par lot, chapitres de travaux avec montant et principaux ouvrages, prescriptions `cctpDescription`, bâtiments et
  phases du registre ; option, variante et pour mémoire exclus ; montant du DPGF si le marché n'est pas chiffré ; case
  « Partir du DPGF et du CCTP » de la fenêtre, `depuis_dpgf`, réponse `sources`), puis ajoute lots, entreprise titulaire et
  montant du marché, `duree_mois`, pièces choisies de l'affaire ; le modèle rend des **semaines**, jamais des dates (`planningDepuisReponse` pose
  lundi à vendredi). Un lot inconnu est écarté, le planning ne crée jamais de lot. La route **ne propose qu'une
  proposition** : `appliquerGeneration` remplace les tâches IA des lots générés et garde, au choix, le manuel.
  Modifier une tâche IA la fait passer en `manuel`. Facturé en réserve → exécute → règle, `endpoint_type = 'planning_generation'`.
- **Marchés rapprochés des lots par intitulé, pas par numéro** (`associerMarches`, `server/planningSources.ts`, testé sur les vrais
  lots d'une affaire où le marché 09 « Peinture » répond au lot 07 et les marchés 10 et 11 au lot 09) : chaque marché va au lot
  dont l'intitulé lui ressemble le plus (le numéro identique ne fait que départager, et seul un marché sans intitulé se rapproche
  par son numéro), les marchés d'un même lot s'additionnent, un marché sans lot (installation de chantier) est donné au modèle
  comme tâche générale. `GET .../planning-chantier` rend `entreprises` (lot → titulaires) pour l'écran.
- **Un DPGF peu chiffré reste exploitable** : aucun « (0 € HT) », un groupe de sous-articles compte pour un poste (« Couverture
  métallique (3 postes) »), les lignes « Nouvel article » sont ignorées, et dans le texte du CCTP les prescriptions des ouvrages
  passent avant le texte générique des chapitres réservés au CCTP (que le plafond de 900 caractères coupe en dernier).
- **Enregistrement automatique** (1,2 s, écritures chaînées, rien avant la fin de la lecture), comme la consultation ACT.
- **PDF** (`planningChantierPdf.ts`, charte du cabinet, « P1|2 ») : complet, ou un lot seul à remettre à son entreprise.
- **Pas encore fait** : glisser-déposer des barres, dépendances entre tâches, liaison avec les jalons de mission.

### Documents joints à l'export PDF du compte-rendu

« Joindre un document au PDF » (en-tête du compte-rendu, `ChantierModule.tsx`) ajoute à la suite du
PDF un compte rendu OPC, une notice, un planning... : PDF repris page par page (texte et vecteurs
conservés), image JPEG ou PNG posée sur une page A4. Logique dans `src/lib/pdfAttachments.ts`
(`checkAttachment`, `appendAttachments` sur `pdf-lib`, testée) ; `exportSiteReportToPDF` reçoit
`attachments`. Cinq documents au plus, 15 Mo chacun. Le même PDF fusionné sert au téléchargement et à la
diffusion par e-mail (plafond serveur de 20 Mo vérifié avant l'envoi). Les fichiers sont choisis sur le
poste et gardés pour la session seulement, par compte-rendu : rien n'est enregistré avec lui. Un PDF
protégé ou corrompu fait échouer l'export en nommant le fichier, jamais d'envoi amputé. La pagination
« P1|2 » ne compte que les pages du compte-rendu lui-même.

### Observations : export PDF, impression, menu collant

`src/lib/observationsExport.ts` exporte la liste telle qu'affichée (filtres, regroupement par lot, colonnes visibles) en PDF paysage à la charte (`exportObservationsToPDF`), téléchargé ou imprimé (`telechargerPdf`, `imprimerPdf`) ; seule une échéance dépassée est en rouge. Les boutons « Exporter PDF » et « Imprimer » sont dans la barre d'outils de `ObservationsTable`. Le menu des sections du chantier (`ChantierModule.tsx`) est `sticky top-0` : il reste visible au défilement.

### Observations : plusieurs lots, TCE, anciennes non levées, intervenants des rubriques

- **Attribution** (`supabase/migrate_observations_multi_lots.sql`, `lot_ids` jsonb et `tce` booléen sur `observations`) : un lot (`lot_id`, cas historique), plusieurs lots (`lot_id` = le premier, `lot_ids` = tous) ou tous (`tce = true`, `lot_id` nul, « Tout corps d'état »). Logique pure dans `src/lib/observationLots.ts` (`selectionToFields` : cocher tous les lots revient à TCE ; `observationTargetsLot`, `groupObservationsByLot`, testés). `POST`/`PUT` d'une observation valident chaque lot contre le cabinet (400 sinon) ; un corps sans `lot_ids` ni `tce` ne touche pas aux lots. Instance non migrée : l'écriture retombe sur les colonnes d'origine, et un TCE ou multi-lots est refusé en 503 plutôt qu'enregistré faux.
- **Corriger l'entreprise** : `ObservationLotPicker` (bouton « 03 · Menuiserie » dans chaque ligne d'observation du compte-rendu et dans la colonne Lot de l'onglet Observations) ouvre une fenêtre de choix (case TCE, lots à cocher, recherche). L'observation change de groupe tout de suite, sans recopie. Un seul lot reprend l'entreprise du lot ; plusieurs lots ou TCE effacent `contact_id` (les lots portent les entreprises). Dans l'onglet Observations groupé par lot, une observation multi-lots figure sous chacun de ses lots, une TCE sous son propre groupe en tête.
- **Diffusion** : `buildDiffusionRecipients` adresse une observation à l'entreprise de chacun des lots visés ; une TCE va à toutes les entreprises titulaires d'un lot (pas aux intervenants sans lot) et s'imprime `[TCE]`. Option **« Joindre les anciennes observations non levées »** (case de l'en-tête du CR et de la fenêtre de diffusion, mémorisée par poste sous `chantier:pdf:previousOpen`) : le PDF les imprime après celles du CR sous « Observations antérieures non levées » (sans photos), et le message de chaque destinataire porte une seconde liste de SES anciennes observations. Sont reprises celles de l'opération ni levées ni refusées et absentes du CR ; le serveur les relit (`include_previous`), le client n'envoie jamais leur contenu.
- **Société d'une rubrique** : `IntervenantCombobox` remplace le champ libre. Liste des entreprises des lots puis des intervenants de l'opération, filtrée à la frappe, **TCE** en tête et une ligne « Créer un nouvel intervenant ». Le texte tapé n'est retenu que s'il correspond à une proposition (une valeur libre déjà enregistrée reste affichée). La création (`NewIntervenantDialog`) reprend la fiche contact du cabinet du même nom, sinon la crée (`POST /api/contacts`, catégorie Entreprise), l'ajoute aux intervenants (`PUT /api/projects/:id/stakeholders`, qui remplace la liste : la liste actuelle est renvoyée en entier) puis la choisit pour la rubrique. TCE s'enregistre simplement « TCE » dans `responsible_company`.
- Tests : `src/lib/__tests__/observationLots.test.ts`, `crDiffusion.test.ts`, `tests/observationMultiLots.test.ts`, `tests/siteReportDiffusion.test.ts`. Le rendu PDF des anciennes observations et les fenêtres n'ont pas été vérifiés dans un navigateur.

### Export PDF du compte-rendu : format, W/D, photos de rubriques

`exportSiteReportToPDF` (`src/lib/siteReportExport.ts`) suit ce qui est saisi à l'écran. La
présence d'un lot se lit dans `attendance` (ligne repérée par l'intitulé du lot, « Présent » par
défaut) et non dans `lot_tracking` (`lotPresenceStatus`, `src/lib/siteReportPresence.ts`, testé).

- **Format** : `SiteReport.pageFormat` (`portrait` par défaut, `landscape`), choisi dans l'en-tête du
  CR (« Format PDF »), colonne `site_reports.pageformat`. Toutes les pages d'un PDF ont la même
  orientation ; les planches de vignettes s'adaptent à la largeur (`thumbsPerRow`).
- **W/D** : `lot_tracking[].concerned` (`W`, `D`, `WD`, jsonb, aucune migration), saisi par lot
  (tableau et cartes mobiles) et imprimé en dernière colonne du suivi des lots.
- **Renommer une rubrique** : le nom de la rubrique (catégorie des entrées) se modifie en place dans l'en-tête de son groupe (`renameRubrique`, `ChantierModule.tsx`). Toutes ses entrées du compte-rendu passent sous le nouveau nom (un nom déjà utilisé les fusionne avec cette rubrique) ; une écriture en file par entrée, `PUT /api/notes/:id` n'écrit que les champs fournis et refuse un nom vide (400).
- **Une seule entête pour les rubriques** : l'export PDF dessine l'entête de colonnes (Date, Texte, Société, Échéance, Statut) UNE fois en haut de la section, puis en haut de chaque page suivante de cette section (`drawRubriquesHead`, `willDrawPage`) ; les tableaux de chaque rubrique n'ont pas la leur (`showHead: 'never'`) mais les mêmes largeurs de colonnes.
- **Photos de rubriques** : `site_report_notes.photos` (`supabase/migrate_site_report_note_photos.sql`,
  tableau d'URL du bucket privé `meeting-photos`), `POST /api/notes/:id/photos` (id client
  idempotent, file hors ligne `siteReportNotePhoto`) et `PUT /api/notes/:id/photos` qui ne sait
  que RETIRER des URL. Le réglage « Photos des rubriques dans le PDF » est propre au poste
  (`localStorage`, `chantier:pdf:rubriquePhotos`, coché par défaut) et passe par
  `includeRubriquePhotos`. Les rubriques reportées d'un CR au suivant ne reprennent pas les photos.

### Diffusion d'un compte-rendu par e-mail

`DiffusionDialog.tsx` (bouton « Diffuser », « Rediffuser » une fois diffusé) liste les
destinataires AVANT l'envoi : adresse, rôle, nombre d'observations qui leur sont adressées,
tous cochés par défaut, ceux sans adresse signalés et non cochables. Le PDF est généré dans le
navigateur (`exportSiteReportToPDF(..., { download: false })`, photos comprises) puis envoyé en
multipart à `POST /api/reports/:reportId/diffuse` (`server/routes/siteReportDiffusion.ts`,
`tests/siteReportDiffusion.test.ts`).

- **Qui reçoit quoi** : `src/lib/crDiffusion.ts` (pur, testé, partagé écran et serveur). Les
  destinataires sont les entreprises titulaires d'un lot et les intervenants de l'opération qui
  ont une fiche contact, chacun une fois (une entreprise sur trois lots = un message). Une
  observation va à l'entreprise de son lot (`lot_id`) ou à la personne désignée (`contact_id`).
  Un destinataire sans observation reçoit tout de même le compte-rendu, avec la mention explicite.
- **Le client n'envoie jamais d'adresse** : seulement des identifiants de contacts. Le serveur
  rejoue `buildDiffusionRecipients` depuis l'opération (lots, intervenants, observations du
  compte-rendu) et n'écrit qu'à l'adresse de la fiche ; un identifiant étranger est ignoré.
- **Un message par destinataire**, l'un après l'autre : personne ne voit l'adresse des autres.
  Le PDF doit commencer par `%PDF-` et peser au plus 20 Mo.
- **Transport : le SMTP du cabinet**, comme `POST /api/send-email` avec pièce jointe. Les
  comptes Gmail/Outlook connectés (`sendViaAccount`) n'ont pas encore de chemin d'envoi avec
  pièce jointe. Expéditeur et `Reply-To` : `resolveEmailSender()` (voir « Expéditeur d'un e-mail »).
- **Statut** : le compte-rendu ne passe à `diffuse` que si au moins un message est parti. Un
  échec partiel est rapporté nommément (`failed`) et « Rediffuser » permet de réessayer. Aucun
  suivi des destinataires n'est stocké (pas de migration) : la trace est le journal d'activité.
- Hors ligne ou saisie en attente de synchronisation : la diffusion est refusée, le message
  partirait sans elle.
