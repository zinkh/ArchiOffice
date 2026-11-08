---
paths:
  - "src/components/aor/**"
  - "src/components/pro/Reserve*.tsx"
  - "src/components/pro/reserve*.tsx"
  - "src/lib/doe*.ts"
  - "src/lib/opr*.ts"
  - "src/lib/plan*.ts"
  - "src/lib/reserve*.ts"
  - "src/lib/reservesExport.ts"
  - "server/doe/**"
  - "server/routes/receptions.ts"
  - "server/routes/reserves.ts"
  - "server/routes/gpaReserves.ts"
  - "server/routes/plans.ts"
  - "server/reservePhotos.ts"
---

# Chantier : AOR, DOE, OPR, réserves, plans

> Règles extraites du CLAUDE.md racine, sans modification de contenu. Chargées quand Claude lit un fichier correspondant aux chemins ci-dessus.

### Atelier DOE (onglet AOR)

L'ancienne carte « Dossier des ouvrages exécutés » (un tableau de documents, un avis à la main) est remplacée par
`src/components/aor/DoeAtelier.tsx` : le cabinet **sollicite** les entreprises, **relance** automatiquement, **analyse et
valide** les documents reçus, **vise** chaque dossier et **transmet une archive** au maître d'ouvrage. Migration
`supabase/migrate_doe_atelier.sql` (trois tables hors `SYNC_TABLES`, quatre colonnes sur `documents`). Une instance non
migrée lit un atelier vide (`disponible: false`) et refuse l'écriture en 503.

- **Les fichiers restent des lignes de `documents`** (`doc_type = 'DOE'`, `contact_id` = clé de l'entreprise comme avant) :
  même stockage (Supabase ou espace du cabinet via `storeBusinessFile`, rangés sous `<affaire>/AOR/DOE/<entreprise>`), même
  quota, même suppression (`DELETE /api/documents/:id`). Colonnes ajoutées : `doe_piece`, `doe_lot_id`, `doe_request_id`,
  `doe_source` (`entreprise` | `cabinet`). Le visa est un document `DOE_VISA`, l'archive un document `DOE_ARCHIVE` : ils
  n'entrent jamais dans la liste des documents d'une entreprise.
- **Le statut se déduit, il n'est jamais saisi** (`statutEntreprise`, `src/lib/doeAtelier.ts`, testé) : à solliciter,
  sollicitée, incomplet, à analyser, à corriger, conforme, visé. Une entreprise = un `contact_id` (ou nom) des lots du projet,
  lus par `server/doe/dossier.ts` (`chargerDossier`, seule lecture partagée par l'écran, les relances, le visa et l'archive).
  Un visa **défavorable** laisse le dossier « à corriger » ; un document déposé **après** un visa rouvre l'analyse.
- **Pièces attendues** (`DOE_PIECES` : plans conformes à l'exécution, notices, fiches techniques, PV d'essais, attestations,
  garanties) : exigées par défaut sauf attestations, réglables par opération (`doe_settings.required_pieces`).
- **Sollicitation par lien personnel sans compte** (`/doe/:token`, `src/pages/DepotDoe.tsx`, route publique hors
  `ProtectedLayout`), sur le patron du dépôt des offres : jeton `doe_…` dont seul le SHA-256 est stocké, un seul lien actif par
  entreprise (index unique partiel), **renvoyer le lien en crée un nouveau et révoque l'ancien**. Contrairement au dépôt des
  offres, **aucune condition de plan, de marché ou de stockage externe** : un DOE se remet aussi en marché public. Le portail
  contrôle les octets (`server/doe/fileRules.ts` : PDF, Word, Excel, ODS, ODT, plus JPEG et PNG vérifiés à leur signature,
  jamais DWG ni DXF), refuse un lot étranger, accuse réception par e-mail, prévient les personnes de l'affaire, **n'écrit
  que dans `documents`** et **ne refuse jamais un dépôt tardif**. Une entreprise ne retire que ses propres documents non
  encore analysés. Le quota de documents du cabinet s'applique (503 neutre sinon).
- **Relances automatiques** (`server/doe/relances.ts`, `startDoeReminders`, toutes les 6 h, `DOE_REMINDERS_INTERVAL_HOURS`) :
  une relance part quand l'intervalle est écoulé (7 jours par défaut, 2 à 60) depuis la dernière, tant que le dossier attend
  l'entreprise (`sollicitee`, `partiel`, `a_corriger`), dans la limite du plafond (4 par défaut, 10 au plus), et jamais pour une
  demande jamais envoyée, révoquée, expirée, sans adresse, ou d'un cabinet suspendu. Chaque relance **crée un nouveau lien**
  (le jeton n'est pas conservé), cite les pièces encore manquantes et les observations sur les documents refusés. La demande
  est « prise » par une mise à jour conditionnelle (`revoked_at IS NULL`) : deux processus ne l'envoient pas deux fois. **Si le
  message ne part pas, l'ancien lien est rendu valable et rien n'est compté.** L'envoi passe par le SMTP du cabinet
  (`server/doe/mail.ts`), jamais par un compte personnel : une relance part sans session humaine.
- **Analyse = suggestion, jamais avis** (`POST /api/projects/:id/doe/analyser`, sans modèle ni coût, lecture du texte par
  `lireTexteDepot`) : reconnaît la pièce d'après le nom et le texte (`classerPiece`), classe un document **non classé**
  quand la confiance atteint 0,5, signale scan sans texte, texte très court, pièce non reconnue ou différente de celle
  déclarée, plan DWG/DXF et doublon. L'avis par document (favorable, avec observations, défavorable, `validation_status`)
  et ses observations (`validation_comments`, transmises à l'entreprise sur la page de dépôt) restent un geste de
  l'architecte (`PUT /api/doe/documents/:id`).
- **Visa** (`POST /api/projects/:id/doe/visas`) : avis favorable, favorable avec observations ou défavorable. Un visa
  favorable **exige** toutes les pièces exigées et un avis sur chaque document (409 sinon) ; le défavorable est toujours
  possible. Le numéro `DOE-AAAA-NNN` est **réservé par l'insertion de la ligne** (index unique `(tenant_id, numero)`, nouvel essai
  au conflit), pas par `next_document_number` dont la liste de séries est fermée côté SQL ; le numéro réservé est rendu si le PDF
  ou son dépôt échoue. Le PDF (`src/lib/doePdf.ts`, charte du cabinet, « P1|2 ») photographie les pièces et les avis au moment
  du visa, il est déposé comme document de l'affaire, et peut partir par e-mail à l'entreprise (avec, pour un défavorable, un
  nouveau lien de correction qui ne compte pas comme une relance).
- **Archive pour le maître d'ouvrage** (`POST /api/projects/:id/doe/archive`, `server/doe/archive.ts`, `jszip`) :
  `00 - Bordereau de transmission.pdf`, `01 - Plans de la maitrise d'oeuvre/` (plans AOR les plus récents, ou tous : un plan
  remplacé par une version suivante via `parent_id` n'est pas joint), `02 - DOE des entreprises/<lots> - <entreprise>/<pièce>/`
  (jamais un document refusé), `03 - Visas/`. **Seuls les dossiers visés y entrent** ; en joindre d'autres est un choix explicite,
  et transmettre sans eux demande une confirmation (409 `dossiers_non_vises`). Les réserves (dossier non visé, visé avec
  observations, fichier introuvable) sont portées au bordereau. Plafond de 300 Mo en mémoire (413 sinon) ; l'archive est
  enregistrée comme document, téléchargeable, et envoyée en pièce jointe seulement sous 20 Mo, sinon l'écran le dit.
- **Tests** : `src/lib/__tests__/doeAtelier.test.ts` (statuts, relances, classement, archive, messages) et
  `tests/doeAtelier.test.ts` (routes du cabinet et portail public sur un drive en mémoire, nodemailer remplacé).
- **Pas encore fait** : lecture OCR des DOE scannés (ils sont signalés « sans texte », pas lus), pièces attendues propres à
  chaque lot, visa groupé de plusieurs entreprises, envoi du lien par un compte mail personnel.

### PV d'OPR par lot (onglet AOR, bloc Réception)

Un procès-verbal des opérations préalables à la réception **par lot**, en deux régimes qui partagent le même modèle de données. Le régime se déduit de l'affaire (`projects.is_public_client`), jamais de la requête, et se fige à la création. **Étapes livrées** : données et logique (1), PV privé complet (2), EXE4 et EXE5 du marché public (3), EXE6 à EXE9, nature des réserves et export groupé (4). **Pas encore fait** : le passage automatique des réserves au statut « Levée » quand une levée est décidée (la décision reste un geste ; les statuts des réserves se règlent dans le suivi des réserves) et la lecture hors ligne de ces PV.

- **Données** : colonnes ajoutées à `receptions` (`supabase/migrate_opr_pv.sql`, `migrate_opr_pv_reference_signature.sql`) : `regime` (`prive` | `public`, NULL = PV générique d'avant, comportement inchangé), `marche_id`, `lot_id`, `ccag_version`, dates (`date_avis_achevement`, `date_achevement_annoncee`, `date_opr`) et sections jsonb (`presences`, `constats`, `proposition`, `decision`, `levee`, `carence`, `delais`), `signed_at`/`signed_mode`/`signed_document_id`. Les réserves de l'annexe sont les `reserves` du PV (`reception_id`), aucune duplication. `receptions` est dans `TABLES_RATTACHEES` : une affaire archivée est en lecture seule.
- **Logique pure** (`src/lib/oprPv.ts`, `oprPvDelais.ts`, `oprPvSanitize.ts`, testée) : cinq natures de réserves communes à tous les formulaires (épreuves, travaux, malfaçons, installations, pose des équipements) ; **statut déduit** (`statutPv`), jamais saisi ; `formulaireDecision` (EXE7 pour une non-réception, EXE6 sinon) et `formulairesDuPv` (la levée EXE8/EXE9 ne suit qu'une réception) ; `controlerPv` (conditions de réserve, annexes, convocation, dates, réserves ouvertes). `sanitizeOprPayload` revalide tout le corps côté serveur ; `lirePv` lit une ligne sans jamais lever.
- **Délais communs au privé et au public** : OPR sous 20 jours après l'avis d'achèvement (le plus tardif de l'avis et de l'achèvement annoncé), transmission de la levée sous 5 jours, décision du maître d'ouvrage sous 30 jours, carence du maître d'œuvre 30 jours après la lettre recommandée. Valeurs par défaut des notices EXE ; **chaque PV porte les siens** (`delais`) : en privé le contrat fait foi. Une date illisible n'est jamais un retard.
- **Routes** (`server/routes/receptions.ts`) : le PUT d'un PV d'OPR est **partiel** (un champ absent du corps n'est pas effacé) ; le PUT d'un PV générique garde l'ancien comportement (tout réécrit). Le lot d'un PV ne change jamais ; un accord-cadre n'a pas de PV ; marché et lot sont vérifiés contre le cabinet ET l'affaire. Référence `OPR-AAAA-NNN` attribuée par le serveur (index unique partiel `receptions_opr_reference`, nouvel essai au conflit) ; une référence saisie est respectée. `POST /api/receptions/:id/signature` (papier ou électronique) est refusée tant que `controlerPv` signale une erreur ; un PV signé répond 409 `PV_SIGNE` à toute modification jusqu'à `POST .../signature/rouvrir`. Instance non migrée : 503 `OPR_PV_UNAVAILABLE`.
- **Rendu** : le contenu est construit une fois sous forme de blocs neutres (`src/lib/oprPvDocument.ts`, `construirePvPrive`, testé sans navigateur) puis rendu à l'identique en PDF (`oprPvPdf.ts`, charte du cabinet, « P1|2 », cases à cocher **dessinées** : ☐ n'existe pas dans les polices de jsPDF) et en Word (`oprPvDocx.ts`). Le titre d'en-tête est court (`PROCÈS-VERBAL D'OPR`) : le titre complet chevauchait le nom de l'agence. Une donnée absente s'imprime en pointillés, jamais inventée ; l'annexe imprime des lignes vides à compléter à la main quand il n'y a pas de réserve.
- **Écran** : `OprPvSection` (tableau au bureau, cartes sous 768 px ; liste les PV du régime de l'affaire), `OprPvDialog` (trois volets, réserves de l'annexe, échéances, contrôles, signature), `useOprPv`. Branchés dans `ProjectDetail.tsx` par quelques lignes. Le formulaire exporte ce qui est saisi, réserves non enregistrées comprises ; retirer une réserve ne ferme pas la fenêtre.
- **Marché public (EXE4 à EXE9)** : `src/lib/oprPvExe.ts` construit les six cerfas avec les intitulés du ministère (mise à jour du 01/04/2019) : rubriques A à D (pouvoir adjudicateur, titulaire avec SIRET, maître d'œuvre, objet), E et F de l'EXE4 (portée, présences, six constats numérotés, signatures, attestation de refus), E et F de l'EXE5 (numérotation 1, 1.1, 1.2.1, 1.3.1.1, 2). Même rendu PDF/Word que le privé. **Aucune mention inventée** : une donnée absente s'imprime en pointillés, un CCAG non renseigné n'est pas affirmé. Mentions propres au public dans `receptions.public_info` (jsonb : `portee`, `prestations`, `signataire`, `reference_marche`, `supabase/migrate_opr_pv_public_info.sql`) ; le lieu de signature réutilise `receptions.lieu`. L'identité du titulaire et du pouvoir adjudicateur vient des fiches contact (`donneesExe`, `identiteDepuisContact` : raison sociale, adresse de travail avant l'adresse générale), à défaut des noms connus. La référence du marché est rappelée dans l'en-tête de chaque page (la notice l'exige). La proposition a quatre avis : « sous réserve » ne porte que épreuves et travaux, « avec réserve » que malfaçons, repli et pose (contrôlé par `controlerPv`). 
- **Décision et levée** : l'EXE7 (non-réception) ou l'EXE6 (réception) suit la proposition puis la décision (`formulaireDecision`), l'EXE8 et l'EXE9 ne suivent qu'une réception prononcée (`formulairesDuPv`). `levee` (jsonb) porte le PV de levée (ses propres présences et constats, EXE8), la proposition du maître d'œuvre (`rapporter`, `lever_toutes`, `maintenir_toutes`, `lever_partie` + annexe des réserves levées + réserves maintenues avec leur date) et la décision du maître d'ouvrage (mêmes options, plus `accepter`), avec les dates qui portent le délai de transmission. **L'issue retenue** (`optionLeveeRetenue`) est la décision, ou la proposition quand le maître d'ouvrage l'accepte ; elle alimente le statut déduit (`reserves_levees`, `reception_rapportee`). Une levée enregistrée à l'ancienne (deux dates) se relit sans rien perdre. `controlerPv` exige, pour une levée partielle, l'annexe des réserves levées, les réserves maintenues et la date de celles de repli ou de pose ; il signale une levée sans réception avec réserves.
- **Nature des réserves** (`reserves.nature`, `supabase/migrate_reserves_nature.sql`, mêmes cinq natures que les cerfas) : posée à la création d'une réserve du PV, corrigée par `PUT /api/reserves/:id/nature` (le PUT d'une réserve réécrit tous ses champs et ne touche la nature que si le corps la porte). Elle ventile les annexes : un tableau par nature sous le numéro d'annexe que cite le formulaire ; épreuves, travaux et malfaçons sont numérotées, le repli du chantier et la pose des équipements ne le sont pas (leur échéance est dans la condition). Les réserves sans nature sont regroupées à la suite ; sans aucune nature, une annexe unique. L'annexe de l'EXE8 liste les réserves encore ouvertes, celle de l'EXE9 les réserves levées.
- **Export groupé** : « Tout exporter (ZIP) » rassemble un PDF par formulaire et par lot (`telechargerArchivePv`, qui réutilise `livrer` : un seul fichier part tel quel, plusieurs en ZIP) ; le formulaire propose les PDF et Word de chaque formulaire que le PV porte.
- **Points ouverts** : « CCAG applicable » (2009 ou 2021) est porté par le PV et non par le marché (liste blanche de `marches_entreprises` non modifiée) ; les formulaires 2019 citent le CCAG 2009, leur validité avec le CCAG 2021 est à confirmer sur le site de la DAJ. Pas de lecture hors ligne de ces PV.
- Tests : `src/lib/__tests__/oprPv.test.ts`, `oprPvDocument.test.ts`, `oprPvExe.test.ts`, `tests/oprPvReceptions.test.ts`, `tests/oprPvUi.test.ts`, `tests/reserveNature.test.ts`.

### Import de plans AOR en lot et renommage

Bloc Plans de l'onglet AOR : « Importer un plan » ouvre un sélecteur multiple, et le bloc entier accepte un
glisser-déposer de fichiers (`PlansDropZone`, `src/components/aor/PlansImport.tsx`, seulement pour un glisser qui
porte des fichiers). Les fichiers arrivent dans `PlansImportDialog` : un nom modifiable par plan avant l'envoi,
alerte sur les noms en double (dans le lot ou déjà sur l'affaire), retrait d'une ligne, ajout de fichiers. Les
envois partent UN PAR UN vers `POST /api/plans` (index A, version 1, catégorie AOR) ; un échec s'affiche sur sa
ligne et n'arrête pas les suivants, et le bouton relance seulement ceux qui restent. Logique pure et testée dans
`src/lib/planImport.ts` (`nomPlanRetenu` : caractères interdits retirés, extension d'origine rétablie si effacée ;
50 plans au plus par import ; vides et déjà présents écartés). « Nouvel indice » d'un plan garde son sélecteur à
fichier unique (`handlePlanUpload`). Renommer un plan déjà importé : crayon `PlanName` (Entrée enregistre, Échap
annule) puis `PUT /api/plans/:id`, qui ne change que `plans.name` (200 caractères au plus, 404 hors cabinet),
jamais le fichier ni son emplacement. Aucune migration. Tests : `src/lib/__tests__/planImport.test.ts`,
`tests/plansRename.test.ts`. Pas vérifié dans un navigateur réel.

**Ordre des plans.** Chaque plan AOR a une poignée (`PlanGrip`) : glisser à la souris, ou appui long au doigt
(`usePlanReorder`, sur `startPressDrag` comme `LotsManager`). L'ordre se prévisualise pendant le geste et ne part
qu'au relâché, par `PUT /api/plans/order` (`{ project_id, ids }`, liste complète, déclarée avant `/:id`) qui écrit
`plans.sort_order` (`supabase/migrate_plans_sort_order.sql`) ; un plan d'un autre cabinet ou d'une autre affaire,
un doublon ou une liste vide sont refusés en 400 sans rien écrire, une instance non migrée répond 503
`PLAN_ORDER_UNAVAILABLE`. Un échec d'enregistrement remet l'ordre précédent à l'écran. Tri
(`src/lib/planOrder.ts`, testé) : plans jamais rangés d'abord (le plus récent en tête, comme avant), puis les plans
rangés selon leur rang : un plan déposé après un réordonnancement apparaît donc en haut de la liste. Tests :
**Tri par nom** : un bouton de l'en-tête du bloc (visible à partir de deux plans) range les plans A à Z, puis Z à A
au clic suivant (`idsTriesParNom`, `sensProchainTri` : accents et casse ignorés, nombres lus comme des nombres,
« Plan 2 » avant « Plan 10 »). Il écrit l'ordre manuel par la même route `PUT /api/plans/order` : ce n'est pas un
mode permanent, un plan déposé ensuite apparaît en haut et la poignée reste utilisable après le tri.
`planOrder.test.ts`, `tests/plansRename.test.ts`. Pas vérifié dans un navigateur réel.

### Réserves de chantier : fiche, photos, export PDF

`src/components/pro/ReserveTracker.tsx` (les mêmes réserves d'OPR et
réserves GPA, une table chacune, `apiBase` décide) est construit pour le
téléphone d'abord, là où une réserve se relève : une liste de cartes sur
mobile (`md:hidden`, numéro, intitulé, vignette de la première photo,
entreprise en charge, échéance, statut), le tableau groupé par lot au bureau,
et dans les deux cas **un appui sur la réserve ouvre sa fiche**
(`ReserveDetail.tsx`, panneau plein écran sur mobile, modale au bureau).
Plus d'édition en ligne dans le tableau : la fiche est le seul endroit où l'on
modifie une réserve, le statut restant changeable d'une pastille depuis la
liste. Ce que les deux partagent (statuts, pastille, retard, extrait de plan)
vit dans `reserveShared.tsx`.

**Photos.** `reserve_photos` (`supabase/migrate_reserves_photos_recent_views.sql`)
sur le modèle de `meeting_photos`, bucket privé `reserve-photos` lu par URL
signée comme les autres (`PRIVATE_STORAGE_BUCKETS`). Une seule table pour les
deux jeux de réserves, distingués par `reserve_kind` (`'opr' | 'gpa'`) — une
clé étrangère ne peut pas viser deux tables, donc **la suppression en cascade
est faite par `deleteReservePhotos()`** (`server/reservePhotos.ts`) à la
suppression d'une réserve, pas par la base. `GET /api/reserves` et
`GET /api/gpa-reserves` (et la fiche `/api/projects/:id/full`) attachent
`photos: []` à chaque réserve en UNE requête (`attachReservePhotos`), jamais
une par réserve. Dans la fiche, `<input capture="environment">` ouvre
directement l'appareil photo sur un téléphone ; en création, les photos
prises avant l'enregistrement sont mises en file et envoyées une à une une
fois la réserve créée (il faut son id pour les rattacher).

**Photos : la saisie n'attend jamais le réseau** (retour d'un test OPR sur iPad : après une
quinzaine de réserves avec photos, les envois de plusieurs Mo s'empilaient et bloquaient la saisie
suivante). Quatre règles à garder :

- **Réduite sur l'appareil avant tout** (`src/lib/sitePhoto.ts`, `prepareSitePhoto`, réutilise
  `photoToJpeg`) : 1600 px et JPEG 82 %, exactement ce que le serveur stockait déjà
  (`MEETING_PHOTO_MAX_DIMENSION`), pour un dixième du trafic. Une photo ne bloque jamais : un échec de
  décodage renvoie la photo d'origine. Un JPEG de 450 Ko ou moins part tel quel.
- **Mise en file, pas d'envoi dans l'appel** (`enqueueMultipartRequest`, `offlineQueue.ts`) : la photo
  entre dans IndexedDB puis part en arrière-plan, une à la fois, avec reprise et progression (le
  chemin de rejeu existant). La fiche se referme tout de suite, y compris à la création d'une
  réserve ; seul « Préparation… » (la réduction, une demi-seconde par photo) retient le bouton
  Enregistrer. L'événement `OFFLINE_WRITE_SYNCED_EVENT` porte désormais `data` (la ligne
  `reserve_photos` renvoyée par le serveur) pour remplacer l'aperçu local sans relire la liste.
- **Les photos en attente sont superposées à la liste** (`src/lib/reservePhotoQueue.ts`, testé) :
  `GET /api/reserves` ne les connaît pas, elles réapparaissent donc avec leur aperçu après un
  rechargement. La liste enregistrée (`setReserves`, `onSaved`) ne garde JAMAIS une photo
  `pendingSync` : seule la superposition les montre. Retirer une photo en attente la retire de la
  file (`discardPendingWrite`), le serveur ne la connaît pas. Une photo refusée par le serveur reste
  visible « Envoi refusé » avec sa raison (`syncError`).
- **Lecture : URL signées en cache** (`signedStorageUrl.ts`) : gardées 80 % de leur durée de vie,
  demandes simultanées fusionnées, 4 résolutions en parallèle au plus. Avant, chaque rendu redemandait
  une URL différente par photo, donc le navigateur ne retrouvait jamais l'image dans son cache. Les
  miniatures de la liste ne se chargent que lorsqu'elles approchent de l'écran (`deferUntilVisible`).
- **Miniature d'affichage générée par le serveur** (`makeThumbnail`, `server/imageUpload.ts`, 480 px,
  JPEG 78 %) : à l'envoi, `POST .../photos` range `<cabinet>/<réserve>/<photo>-thumb.<ext>` à côté de la
  photo et renseigne `reserve_photos.thumb_url` (`supabase/migrate_reserve_photos_thumb.sql`, colonne
  facultative). **Elle ne sert qu'à l'affichage** (case de liste, grille de la fiche) : la photo
  complète à 1600 px reste la référence, et la fiche (appui sur la photo), l'export PDF
  (`reservesExport.ts` lit `file_url`) et l'impression ne lisent jamais la miniature. Une miniature
  n'est pas créée pour une image déjà plus petite qu'elle ; sa création est au meilleur effort (un
  échec garde la photo). `ReservePhotoImage` (`reserveShared.tsx`, `photoDisplaySrc`) affiche la
  miniature, retombe sur `file_url` pour une photo antérieure ou si la miniature ne se charge pas.
  Instance non migrée : l'insertion est rejouée sans `thumb_url` (et la miniature déposée retirée), la
  lecture ET la suppression utilisent `select('*')` et non `thumb_url` nommée, sans quoi elles
  répondraient 404. Supprimer une photo ou une réserve retire aussi les miniatures. Les photos
  d'avant se rattrapent avec `npx tsx scripts/backfill-reserve-photo-thumbs.ts` (`--dry-run` d'abord,
  relançable). `tests/fakeSupabaseAdmin.ts` sait simuler une colonne absente (`dropColumn`).
- **Pagination progressive de la liste** (`src/lib/reservePagination.ts`, testée) : le suivi n'affiche
  que 50 réserves à la fois (`RESERVE_PAGE_SIZE`), la suite vient au défilement (`ListFooter`,
  IntersectionObserver, `rootMargin` 600 px) avec un bouton « Afficher N de plus » pour le clavier. Le
  tableau groupé par lot est paginé sur l'ENSEMBLE de ses lignes (`paginateGroups`) : un groupe replié
  garde son en-tête sans consommer de lignes, un groupe entièrement au-delà de la fenêtre n'a pas encore
  d'en-tête. **Un seul rendu à la fois** (`useMediaQuery('(min-width: 768px)')`) : la liste mobile ET le
  tableau étaient montés ensemble, l'un masqué par CSS, donc chaque réserve existait deux fois dans le
  DOM. Ce n'est pas `usePagination` (pages numérotées, retour à la page 1 quand le nombre de lignes
  change) : créer une réserve ou changer un statut ne doit pas remonter la liste. Un autre filtre ou une
  autre recherche repart de la première page ; une réserve qu'on vient de créer est révélée même au-delà
  de la fenêtre (`revealId`, `limitToReveal` : par pages entières). **Seul l'affichage est limité** :
  compteurs, repères de plan et export PDF portent toujours sur toute la liste en mémoire.
- **Pas encore fait, volontairement** : pagination des DONNÉES (`GET /api/reserves` rend toutes les
  réserves et leurs photos, et `GET /api/projects/:id/full` aussi). `ProjectDetail` s'appuie sur la liste
  COMPLÈTE (réserves d'un procès-verbal de réception, compteur de l'onglet, prochaine visite), et le cache
  hors ligne (`cachedListFirst`) supprime du cache tout ce que la réponse ne contient plus : paginer la
  réponse sans changer ces usages viderait le cache et fausserait les compteurs. Route groupée d'URL
  signées non faite. Non vérifié sur un iPad réel.

**Onglet GPA et passage d'une réserve AOR en GPA.** Les réserves de garantie de parfait achèvement ont leur onglet `GPA`, juste après `AOR` dans la famille Chantier (`projectTabs.ts` ; masqué comme l'AOR quand la mission `aor` du contrat MOE n'est pas incluse, sauf s'il porte déjà des réserves). L'onglet AOR ne montre plus que les réserves d'OPR, et son compteur aussi. Dans la fiche d'une réserve d'OPR, une icône discrète du pied (`IconArrowsExchange`, « Passer en réserve GPA ») appelle `POST /api/reserves/:id/to-gpa` (`server/routes/reserves.ts`, `tests/reserveToGpa.test.ts`) : la réserve **garde son identifiant**, reçoit le numéro suivant de la série GPA de l'affaire, ses photos changent de jeu (`reserve_photos.reserve_kind`, les objets ne bougent pas) puis la ligne d'OPR est supprimée ; un échec en cours de route défait les étapes déjà faites. La nature (propre aux cerfas d'OPR) n'est pas reprise. Refusé côté écran tant qu'une photo attend son envoi (elle viserait une réserve d'OPR disparue). Pas de chemin inverse, ni de migration SQL.

**Suivi / réponse.** Une réserve peut être faite sans être satisfaisante : `reserves.reponse` et
`gpa_reserves.reponse` (`supabase/migrate_reserves_reponse.sql`, TEXT, 5000 caractères) portent la
réponse de l'entreprise ou la remarque de la maîtrise d'œuvre, comme la réponse d'une observation du
DET. Saisie dans la fiche (`ReserveDetail`, champ « Suivi / réponse », mis en avant quand le statut est
« Levée refusée par le MOE »), vue dans la liste (icône + extrait), cherchée par la recherche et imprimée
dans l'export PDF. `PUT` ne l'écrit que si le corps la porte (`normalizeReponse`,
`server/reservePhotos.ts`) : un changement de statut depuis la liste ne l'efface pas ; une instance non
migrée répond 503. Test : `tests/reserveReponse.test.ts`.

**Couleur par responsable** (`src/lib/reserveCouleurs.ts`, testé). Chaque réserve porte la couleur de son
entreprise en charge, à défaut de son premier lot, gris neutre sans l'un ni l'autre (`responsableDe`). Les
couleurs sont attribuées dans l'ordre alphabétique des responsables de TOUTES les réserves de l'affaire
(`construireLegende`, 12 teintes, distinctes tant qu'il y a moins de douze responsables) : filtrer la liste ne
change donc jamais une couleur, mais l'arrivée d'une nouvelle entreprise peut décaler les suivantes. Affichée
par une légende au-dessus de la liste (une pastille d'entreprise filtre), un liseré à gauche des cartes
mobiles et des lignes du tableau, et un point sur l'en-tête de chaque groupe. Aucune migration. Pas encore
fait : couleur dans la fiche, sur les repères du plan et dans l'export PDF. Pas vérifié dans un navigateur.

**Extrait de plan.** Les repères sont stockés en pourcentage de la première
page du plan (`x`/`y`, PlanAnnotator). `src/lib/planRender.ts` rend cette
page (pdf.js, ou `<img>` pour un plan image) sur un canvas mis en cache par
plan, et en découpe une fenêtre autour du repère (`renderPlanExcerpt`) pour la
fiche et l'export. Le rendu se fait côté navigateur, jamais côté serveur :
c'est le même pdf.js que PlanAnnotator, et le serveur n'a pas à rasteriser
des A0.

**Export PDF** (`src/lib/reservesExport.ts`, bouton « Exporter PDF », porte
sur la liste FILTRÉE à l'écran) : page de garde avec récapitulatif et tableau,
une page par plan avec tous les repères numérotés (paysage si le plan l'est),
puis une fiche par réserve (champs, commentaire, extrait de plan, photos en
vignettes de 42 mm). En-tête, pied et pagination « P1|2 » du cabinet via
`pdfLetterhead.ts`, nuances de gris. Les images passent par
`loadPhotoDataUrl` (réduites à 900 px) : embarquer les originaux ferait un
PDF de plusieurs dizaines de Mo pour rien.

### Onglet AOR : onglets et échelle de texte

- **Une seule barre, pas de doublon** (`AorLayout.tsx`) : Réserves, DOE, Réception, Plans. Sous 1024 px c'est un jeu d'onglets (un seul bloc affiché, le dernier consulté mémorisé sous `aor:tab`) ; au bureau tous les blocs restent affichés et la barre mène au bloc voulu. Les anciens titres repliables par bloc (`aor:section:<id>`) n'existent plus.
- **Échelle de texte des cartes** : titre de carte 16 px (`text-base`), contrôles et texte courant 14 px (`text-sm`, comme `.btn` et les champs), informations secondaires 12 px (`text-xs`), pastilles et étiquettes en capitales 11 px (`text-[0.6875rem]`, jamais en dessous). Un contrôle n'est pas une information secondaire : bouton, champ, sélecteur et filtre restent à 14 px, cibles de 44 px au doigt (`pointer-coarse:min-h-11`).
- **Les fenêtres (`ModalShell`) sont montées à la racine de la page** (portail) : un parent transformé ou filtré devient le repère d'un élément `fixed` et la fenêtre prenait sa taille au lieu de celle de l'écran.
