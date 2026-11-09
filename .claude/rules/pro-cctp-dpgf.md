---
paths:
  - "src/components/pro/**"
  - "src/components/projectDetail/ProjectNoticesTab.tsx"
  - "src/lib/cctp*.ts"
  - "src/lib/lotsOrder.ts"
  - "src/lib/chapitresParDefaut.ts"
  - "src/lib/bibliotheque*.ts"
  - "src/lib/exportDossier.ts"
  - "src/lib/batimentsArticles.ts"
  - "src/lib/projectTemplates.ts"
  - "src/types/dpgf.ts"
  - "server/dpgfLignes.ts"
  - "server/routes/dpgf.ts"
  - "server/routes/priceLibrary.ts"
  - "server/routes/cctp*.ts"
  - "server/routes/projectTemplates.ts"
  - "server/projectTemplate*.ts"
  - "server/articlePrices.ts"
---

# Onglet PRO : CCTP, DPGF, bibliothèque d'ouvrages, lots, modèles

> Règles extraites du CLAUDE.md racine, sans modification de contenu. Chargées quand Claude lit un fichier correspondant aux chemins ci-dessus.

### Notices d’études et réglementaires

L’onglet projet **Études > NOTICES** (`src/components/projectDetail/ProjectNoticesTab.tsx`) conserve des brouillons distincts dans `project_notices` (`supabase/migrate_project_notices.sql`) : notice architecturale par phase ESQ / APS / APD / PC / PRO / DCE, plus notices Accessibilité et Sécurité incendie portées par le dossier PC. L’édition, les trames et les exports PDF/Word sont disponibles sans IA ; la rédaction assistée Enterprise passe par `server/routes/projectNotices.ts` et reprend la fiche affaire, le journal de phase, la notice architecturale précédente et les pièces jointes exploitables.

Les prompts réglementaires interdisent d’inventer catégories ERP, effectifs, dimensions, classements feu, SSI, références d’articles ou dérogations absentes des données. Une inconnue doit rester explicitement « à vérifier / à confirmer » et la sortie n’est jamais déclarée conforme de manière générale. Une notice rédigée est exposée comme **preuve suggérée** dans les contrôles de changement de phase via `server/phaseControls.ts` ; cette présence ne valide jamais automatiquement le contrôle.

### Onglet PRO : une barre au lieu du ruban

Le ruban (`ProRibbon`, supprimé) et les boutons Enregistrer ont disparu. La
ligne des sous-onglets de `ProTab` porte tout : les sous-onglets en casse
normale, l'état d'enregistrement (`AutosaveIndicator`, Ctrl+S enregistre tout
de suite), les actions du document affiché, puis un menu « ⋯ » pour le dossier
(contrôle, figer, historique, comparaison avec une autre affaire, structure,
impression).

- **Chaque atelier déclare ses actions** par `useProToolbar(items)`
  (`src/components/pro/toolbar/toolbarState.ts`) : boutons, menus déroulants,
  sélecteurs. ProTab ne se re-rend que si leur apparence change
  (`toolbarSignature`) et exécute toujours la DERNIÈRE version d'une action
  (`invokeToolbarAction`) : une fermeture périmée exporterait un document
  périmé. Sur téléphone, seules les entrées `mobile` restent dans la ligne, le
  reste passe dans « ⋯ » (`foldForMobile`).
- **Menus** (`ToolbarMenu.tsx`) : motif ARIA « menu button », posés en position
  fixe dans `<body>` pour qu'un tableau à défilement ne les coupe pas.
- **Barre de sélection** (`SelectionBar.tsx`) : n'existe que tant que quelque
  chose est sélectionné ; flotte au bas du tableau au bureau, se fixe au bas de
  l'écran sur téléphone. Le DPGF et le BPU/DQE ont une vraie sélection multiple
  (cases à cocher, Ctrl+clic, Maj+clic) ; monter, descendre, changer de niveau
  et dupliquer restent à une ligne à la fois. Chaque ligne du DPGF a aussi son
  menu « ⋯ » avec les mêmes actions.
- **Raccourcis du DPGF** (tableau focalisé) : Alt+↑/↓, Tab/Maj+Tab (seulement
  depuis le tableau lui-même, Échap désélectionne et rend Tab à la
  navigation), Ctrl+D, Ctrl+C, Ctrl+V, Suppr.
- **Suppression annulable** : « Annuler » dans le toast pendant 6 s, refusé si
  le document a changé depuis (on écraserait la saisie faite entre-temps).
- **Opérations sur la sélection** (`selectionOps.ts`, testé) : les clés de
  ligne sont positionnelles, d'où une suppression du dernier élément vers le
  premier ; un article collé sous un article trop profond remonte au premier
  niveau du chapitre.
- **Totaux recalculés depuis les articles** (`totauxDocument`) dans le DPGF,
  l'estimation et le DQE, jamais lus tels qu'enregistrés. L'estimation
  comptait les parents à plat et ignorait les sous-articles.
- **Téléphone** : le DPGF devient une liste de cartes (`DpgfMobileList.tsx`),
  un appui modifie désignation, quantité ou prix ; la bibliothèque passe en
  plein écran.
- Tableaux à la charte : en-têtes et lignes de lot sur `--tblr-surface-2`,
  plus aucun bandeau bleu figé. L'encre atténuée claire passe à `#5f6d84`
  (contraste 4,5:1 sur blanc, cf. DESIGN.md).

### PRO : description, quantité et validation avant suppression (issue #609)

- **Quantité, unité et prix dans le CCTP** (`CctpQuantiteUnite.tsx`, fiche d'un article) : champs modifiables, enregistrés en quittant le champ ou par Entrée (Échap annule : `annulation`, sans quoi la perte de focus enregistrait l'ancien brouillon), la quantité et le prix acceptent un calcul (`=12*3,5`), le prix aussi « PM ». Mêmes règles que le DPGF, dans UN seul module pur, `src/lib/quantites.ts` : `quantitePatch`, `prixPatch` et `appliquerMetre` rendent le correctif à fusionner dans l'article (quantité, prix total = quantité x P.U., 0 pour mémoire ; le lot et les totaux sont recalculés par l'appelant, `CCTPEditor.appliquerALigne` ou `DPGFWorkspace.appliquerMetre`). Un correctif `null` (saisie invalide, quantité qui ne se saisit pas là) ne change RIEN : la saisie reste à l'écran avec son erreur. Un article réservé au CCTP (`cctpOnly`) n'a pas de prix.
- **Calcul invalide ≠ 0** : `evalFormula` (`treeOps.ts`) renvoie 0 en cas d'échec, ce qui est une quantité comme une autre. Les saisies de quantité et de prix passent par `calculerSaisie` (`quantites.ts`), un petit analyseur (pas d'`eval`) qui signale l'erreur. `evalFormula` reste pour les autres cellules (bâtiments, estimation hors quantité, BPU).
- **Formule mémorisée** (`Ligne.quantiteFormule`) : taper `=10+20` dans la quantité garde la formule, réaffichée à la modification (`texteSaisieQuantite`, `EditableCell.editValue`, infobulle). Elle ne vaut que tant qu'elle donne encore la quantité (`formuleCourante`) : une quantité changée par un autre chemin (métré, bâtiments, import) la rend périmée sans rien à nettoyer.
- **Métré** (`MetreDialog.tsx`, bouton « Détailler le métré » du CCTP, icône à côté de la description dans le DPGF, Estimation) : une ligne par façade, niveau ou local, avec son libellé et son calcul gardé (`QuantiteDetail.libelle`, `expression`) ; les déductions sont des valeurs négatives, le total doit rester positif ou nul (`validerMetre`, 200 lignes, 1e9). La quantité de l'article est la somme (`quantiteDetails`, déjà utilisé par l'Estimation, aucune migration) et ne se saisit plus dans sa case ; un article sans métré repart de sa quantité, formule comprise, en première ligne. Les champs d'une ventilation d'avant (bâtiment, phase, niveau, local, note) ne sont JAMAIS effacés. Sans aucune ligne, le métré est retiré et la quantité reste. Un article réparti par bâtiment (`quantitesBatiments`) a aussi son métré : chaque ligne porte un bâtiment (`QuantiteDetail.batimentId`, fenêtre en ARBRE : une branche repliable par bâtiment avec son total et son bouton « Ajouter une ligne à DX », liste « Ajouter un bâtiment » pour les autres, sélecteur seulement sur une ligne sans bâtiment ; `batimentsDuMetre`), la quantité d'un bâtiment est la somme de ses lignes, celle de l'article la somme des bâtiments, et le total de CHAQUE bâtiment doit rester positif ou nul (`validerMetre(..., {parBatiment})`, `totauxParBatiment`). Un bâtiment affecté sans ligne reste à 0, un bâtiment utilisé par une ligne est ajouté. Avec un métré, les cellules par bâtiment du DPGF passent en lecture seule. Dans le DPGF, l'icône du métré est à côté de celle de la description (cerclée si l'article a un métré) et l'entrée « Détailler le métré » est dans le menu « ⋯ » ; le CCTP garde son bouton pour tous les articles. Un article qui porte des sous-articles n'a pas de quantité propre. Limite connue : décocher un bâtiment qui a des lignes les laisse dans le métré (rien n'est perdu, « Appliquer » le réaffecte). Unités déjà utilisées dans le document proposées en tête.
- **Description d'un ouvrage depuis le DPGF** (`LigneDescriptionDialog.tsx`) : icône à côté de la désignation (bleue si un texte existe) et entrée « Description de l'ouvrage » du menu « ⋯ ». C'est le même texte que le CCTP (`cctpDescription`), Ctrl+Entrée enregistre, fermer avec une saisie non enregistrée demande confirmation. **Le titre de l'article (sa désignation) se modifie dans la même fenêtre** ; un titre vide est refusé, `onSave(texte, désignation)`.
- **Validation avant suppression** (`useConfirmerSuppression.tsx`, `resumeSuppression` dans `selectionOps.ts`, testé) : CCTP, DPGF, BPU/DQE, estimation et panneau Bâtiments et phases. La fenêtre dit ce que la suppression emporte (lots, chapitres, articles, sous-articles compris), le focus part sur « Annuler ». Le DPGF et le BPU gardent aussi « Annuler » dans le toast.
- **Quantités liées** (`src/lib/quantitesLiees.ts`, `LienQuantiteDialog.tsx`, `src/lib/__tests__/quantitesLiees.test.ts`, `tests/lienQuantiteDialog.test.ts`, `tests/projectShareQuantiteLiee.test.ts`) : un article suit la quantité d'un autre (menuiserie et volets roulants, doublage et peinture) par `Ligne.quantiteLiee { sourceId, coefficient? }`, posé sur le SUIVEUR (un seul sens, la source ne porte rien) et désignant la source par son `id` (stable aux déplacements, renumérotations et copies, ce qu'une clé positionnelle n'est pas). `propagerLiens(lots)` est le SEUL endroit où une quantité liée se calcule : appelé à chaque enregistrement (`DPGFWorkspace.commitLots`, `BPUWorkspace.recomputeBPU`, `EstimationEditor.recomputeDPGF`, `CCTPEditor.mutateDPGF`) et côté serveur après l'approbation d'une proposition (`recomputeAfterNumericChange`, sinon une quantité approuvée laisserait ses suiveurs périmés). Quantité = quantité de la source x coefficient (1 par défaut), le prix total suit (0 pour mémoire), en cascade (la peinture suit le doublage, qui suit les cloisons) et d'un lot à l'autre ; rend le même tableau si rien ne change. **Un lien qui ne tient plus est RETIRÉ et l'article garde sa dernière quantité** (jamais remise à 0, jamais une valeur périmée qui se ferait passer pour calculée) : source supprimée, boucle (données importées ou écrites par un outil), suiveur devenu parent, à métré ou par bâtiment, source devenue parent. `peutSuivre` refuse soi-même, une boucle (directe ou par la chaîne), une source qui n'est pas un ouvrage chiffrable ou qui porte des sous-articles, un suiveur parent, à métré ou à quantités par bâtiment ; une SOURCE peut avoir un métré ou des bâtiments (son total compte). La quantité d'un suiveur ne se saisit plus (`quantitePatch` rend `null`, cellule du DPGF, du DQE et de la liste mobile en lecture seule avec l'icône chaîne, case de la fiche CCTP remplacée par le texte du lien), et il n'a pas de métré. Où lier : entrée « Lier la quantité à un poste » du menu « ⋯ » du DPGF, bouton de la fiche d'un article du CCTP, action de la barre du DQE (colonne Quantité seulement) ; la cellule d'un suiveur rouvre la fenêtre (changer de poste, de coefficient, ou « Détacher » qui garde la quantité). Les unités différentes sont signalées sans conversion. **Suppression** : `liensRompus` (`selectionOps.ts`) liste les suiveurs d'une source supprimée (elle-même, ou emportée avec son chapitre, son lot, son parent) et `useConfirmerSuppression` les nomme dans la fenêtre de confirmation ; supprimer un suiveur seul ne demande rien de plus. **Confrère** : `blockedEdit` refuse la quantité et le métré d'un suiveur (on propose sur le poste suivi), son prix et son unité restent proposables ; `quantiteLiee` n'est pas dans les listes blanches de `documentView.ts`, le confrère ne voit donc pas le lien. **Par bâtiment** : un suiveur réparti par bâtiment (`quantitesBatiments`) suit sa source bâtiment par bâtiment, sur les SEULS bâtiments qu'il porte (un bâtiment que la source n'a pas vaut 0), et son total est la somme de ses parts ; la source doit l'être aussi (`peutSuivre` refuse `batiments_incompatibles`, la fenêtre ne lui propose que des sources par bâtiment), et si elle ne l'est plus le lien est retiré et les parts sont gardées. Un suiveur sans répartition suit le total d'une source par bâtiment. Ses cellules par bâtiment sont en lecture seule, la cellule de total ouvre le lien. **Copie** (`liensDeCopie`, `adapterLiensCopie`, `ModeLiens`, `useChoisirLiensCopie`) : coller et dupliquer (DPGF, CCTP, BPU/DQE ; `pasteLignes`, `duplicateHierarchy` et `dupliquerSelection` prennent un paramètre `liens`) ouvrent une fenêtre quand des articles copiés en suivent d'autres : « conserver » (`tout` : le lien vers un article copié aussi suit la COPIE, le lien vers un article resté en place est gardé), « conserver entre copies seulement » (`internes`, proposé quand les deux cas coexistent) ou « rompre » (`rompre` : chaque copie garde sa quantité du moment et redevient modifiable). Sans fenêtre, le défaut est `tout` : avant la phase 2 un lien entre deux articles copiés pointait encore vers l'ORIGINAL. Une duplication de plusieurs éléments juge les liens élément par élément. Il n'y a pas de copie entre affaires (le presse-papier est celui de l'atelier). **Supprimer aussi les postes liés** : `confirmerSuppressionAvecLiens` (DPGF, BPU/DQE) propose « Supprimer et figer les quantités » (choix par défaut) ou « Supprimer aussi les N postes liés » (`suiveursEnCascade` : les suiveurs, puis les suiveurs des suiveurs, d'un lot à l'autre) et rend les clés à supprimer ; le CCTP et l'estimation gardent la fenêtre d'information (figer seulement : le CCTP ne supprime que ses éléments propres, il n'emporte pas d'articles du DPGF). `useConfirmDialog` gagne `choose()` et des `alternatives` (trois boutons ou plus) ; `confirm()` reste oui ou non. `DPGFWorkspace.removeSelection` propage avant d'enregistrer, car « Annuler » compare à ce qui est enregistré (sans cela, annuler la suppression d'une source se déclarait indisponible). **Postes associés** (`articles_type.associes`, `supabase/migrate_articles_associes.sql`, `src/lib/postesAssocies.ts`, `PostesAssociesEditor.tsx`, `tests/priceLibraryAssocies.test.ts`) : un article de la bibliothèque porte une liste `[{articleId, coefficient?}]` (20 au plus, sans doublon ni lui-même, nettoyée par `nettoyerAssocies` côté serveur ; un PUT sans `associes` les laisse). Saisie sur la fiche de la page Bibliothèque d'ouvrages. À l'insertion (`PriceLibraryPanel.inserer`, ouvrages seulement), `idsAssocies` liste les associés non choisis, le panneau lit leurs fiches (`GET /api/price-library?ids=`) et demande « Insérer avec les associés », « Insérer seulement la sélection » ou « Annuler » ; un associé supprimé est ignoré. Le coefficient est conservé mais **pas encore appliqué** : l'insertion ne crée pas le lien de quantité, on le pose ensuite par « Lier la quantité à un poste ». **Pas encore fait** : lien de quantité posé à l'insertion d'un associé (avec son coefficient), références dans les formules, mention « quantité recalculée depuis » dans le journal (il n'y a pas de journal dans l'onglet PRO). Pas vérifié dans un navigateur : la fenêtre de suggestion et la saisie des associés. Pas vérifié dans un navigateur : les fenêtres, les cellules en lecture seule, l'entrée de menu.
- **Pas encore fait** : description et métré depuis la liste mobile du DPGF (`DpgfMobileList`), mise en forme riche dans la fenêtre de description. Côté confrère (partage, voir `equipe-tenants.md`) : le prix dans la vue CCTP, la proposition de prix et de métré (par bâtiment compris), et l'unification des droits CCTP et DPGF par lot. Tests : `src/lib/__tests__/quantites.test.ts`, `tests/metreDialog.test.ts`, `tests/cctpQuantiteUnite.test.ts`. Pas vérifié dans un navigateur : la fenêtre du métré, la cellule de quantité du DPGF.

### Ordre des lots : la liste des lots du projet fait foi

`LotsManager.tsx` (onglet PRO > Lots) se réorganise par glisser-déposer au
pointeur (`startPressDrag`, poignée à gauche de chaque ligne). Pas de colonne
de rang : le numéro EST l'ordre (`GET` trie par numéro naturel). **Le numéro
est libre et modifiable en place** (`LotNumberInput`) : « 00 », « 01 », « 01A »
et « 01B » pour scinder un lot, « 01.1 » et « 01.2 », jusqu'à 12 caractères, sans
espace, unique dans le projet sans tenir compte de la casse (409 sinon ;
`validerNumeroDeLot`, `numeroDeLotPris`, `src/lib/lotsOrder.ts`, partagés écran /
serveur). Monter ou descendre un lot (`PUT /api/projects/:projectId/lots/order`,
`numerosPourOrdre`) : numérotation **automatique** tant que la série est standard
(que des nombres, le premier numéro est gardé : « 00 » reste premier, les suivants
suivent sans trou) ; dès qu'un numéro est personnalisé (« 01A », « 01.2 »), la
série existante est redistribuée telle quelle, jamais écrasée. Série incomplète ou
en double : retour à « 01 », « 02 »... Aucune migration SQL.

**Chapitres : « 1 », « 2 », « 3 » dans chaque lot**, jamais préfixés par le numéro du
lot (`numeroDeChapitre`, `src/lib/chapitresParDefaut.ts`) ; les articles suivent
(« 1.1 », « 1.1.1 »). C'est ce qui rend le point admis dans un numéro de lot.
`appliquerOrdreLots` ramène un document ancien (« 01.1 ») à cette forme, articles
compris. Contrepartie : un numéro d'article n'est plus unique dans le document, donc
l'import d'une offre rapproche plus souvent par intitulé que par numéro (la passe
« numéro » exige l'unicité) ; les références `#...` des classeurs exportés ne changent pas.
**Trois chapitres par défaut dans chaque lot créé** du CCTP / DPGF (`chapitresParDefaut`,
option `chapitresParDefaut` d'`appliquerOrdreLots`, aussi à la création d'un lot dans
le DPGF, pas dans le bordereau) : « PRESCRIPTIONS GENERALES » et « PRESCRIPTIONS
TECHNIQUES » (`cctpOnly`, donc masqués du DPGF) et « DESCRIPTION DES OUVRAGES ». Tous
modifiables ; la case « Visible dans le DPGF » de l'éditeur du CCTP lève le masquage.
Les lots déjà existants ne reçoivent pas ces chapitres.
`src/lib/lotsOrder.ts::appliquerOrdreLots()` reporte ensuite cet ordre et ces
numéros sur le DPGF (donc le CCTP, même document) et le bordereau, chapitres
et articles compris (seul le préfixe « ancien. » est remplacé, un code de
bibliothèque n'est jamais touché). Rattachement par `projectLotId`, à défaut par
intitulé, et le lien est alors posé ; un lot du document absent du projet garde
son numéro et passe en dernier. `ProTab.synchroniserLots` fait cette
propagation, l'autosauvegarde enregistre.

**Numéros et intitulés de lots strictement identiques partout** (liste, CCTP,
DPGF, estimation, BPU/DQE). Deux sens, jamais de suppression silencieuse :

- **Liste → documents** (cas normal : on crée d'abord les lots) :
  `appliquerOrdreLots()` donne à chaque lot du document le numéro et l'intitulé
  EXACTS du projet et crée les lots manquants (vides). Appliqué à chaque
  modification de la vue LOTS et une fois à l'ouverture, mais seulement si le
  document ne diverge pas (`lotsDivergent()` : aucun lot du document sans
  rattachement `projectLotId` à un lot existant).
- **Document → liste** (CCTP rédigé avant les lots) : si le document diverge, un
  bandeau (ProTab) propose « Remplir la liste des lots depuis le CCTP »
  (`planImportLots()` + `PUT /api/lots/:id` / `POST`, les lots existants
  rapprochés par intitulé identique puis proche prennent numéro et intitulé du
  document) ou « Aligner le CCTP sur la liste » (retire les lots hors liste,
  après confirmation qui cite ceux qui portent du contenu).

Un projet sans lot ne touche jamais aux documents.

### Modèles de projet : une trame d'affaire, pas un préremplissage

Un modèle (`project_templates`, `/templates`) ne se limitait à quatre valeurs
de formulaire (nom, statut, budget, description) : il ne créait ni lots, ni
jalons, ni tâches, donc rien de ce qu'il faut réellement ressaisir à chaque
affaire. `supabase/migrate_project_templates_structure.sql` lui ajoute
`operation_type` (`neuf`, `rehabilitation`, `extension`, `maison_individuelle`,
`permis_seul`, `autre`), `marche_type` (`prive`, `public`), trois listes jsonb
(`default_lots`, `default_milestones`, `default_tasks`) et `catalog_key`.

**Application : `POST /api/projects` reçoit `template_id`, rien d'autre.**
`server/projectTemplateApply.ts` relit le modèle en base (vérifié dans le
cabinet, 400 sinon) et crée lots, jalons et tâches APRÈS l'affaire, en
meilleur effort : un échec est rapporté dans `template_applied.failed`, jamais
au prix de l'affaire déjà créée. Un modèle `public` pose `is_public_client`,
et `type_projet` se déduit du type d'opération quand le corps n'en porte pas.
Le client ne fait que désigner le modèle : il ne peut pas faire écrire autre
chose que ce que le cabinet a enregistré.

**Délais relatifs, jamais de dates.** Jalons et tâches portent des décalages en
jours depuis `start_date` (`addDaysIso`, `src/lib/projectTemplates.ts`). Les
listes sont assainies à l'écriture (`sanitizeLots/Milestones/Tasks`,
`server/routes/projectTemplates.ts`) : bornées, typées, priorités filtrées.

**Trois origines.** Saisi à la main ; installé depuis le catalogue de démarrage
(`server/projectTemplateCatalog.ts`, huit trames : neuf, réhabilitation,
extension en privé et en public, maison individuelle, permis de construire
seul) ; ou tiré d'une affaire (`POST /api/project-templates/from-project/:id`,
lots, jalons et tâches en décalages, sans montants). `catalog_key` sous index
unique partiel `(tenant_id, catalog_key)` empêche d'installer deux fois la même
entrée, sans dépendre du nom que le cabinet a pu changer. Le catalogue n'est
qu'une copie de départ : une fois installé, le modèle appartient au cabinet.

**À ne pas défaire.** Les jalons du catalogue portent des intitulés
d'événements (« Dépôt du permis », « Réception des travaux »), jamais le nom
d'une mission du contrat MOE (« Esquisse (ESQ) ») : `ProjectDetail.tsx` crée un
jalon par mission incluse et apparie par titre, un doublon de nom serait fusionné
avec lui (verrouillé par un test). Le public diffère du privé par la procédure
de passation (publication de l'avis, commission d'analyse, notification) et non
par le fond des lots. Les délais d'instruction d'un permis suivent le Code de
l'urbanisme (1 mois DP, 2 mois PC de maison individuelle, 3 mois les autres).

**Les missions MOE suivent le modèle jusque dans les contrats et les
propositions** (`default_missions`, jsonb, `supabase/migrate_project_templates_missions.sql`).
La liste a la forme de `contrats_moe.missions_list` (id, name, pct, incluse,
category) : un contrat MOE la reprend TELLE QUELLE (`contratDefaultsFromTemplate`,
`src/lib/projectTemplates.ts`, avec le type de contrat et le type de maître
d'ouvrage), et une proposition la CONVERTIT en répartition d'honoraires
(`feeDistributionFromTemplate`). Deux conversions à ne pas défaire :

- **Base ET exécution partent sous « Mission base »** dans la proposition : c'est
  la seule catégorie dont le montant suit le total des honoraires (effet de
  synchronisation de `Proposals.tsx`), et c'est déjà ce que fait la répartition
  par défaut des propositions. Seules les missions complémentaires restent à
  part, à chiffrer à la main. L'id `pro` devient `projet`, comme dans
  `feeDistribution.ts`.
- **Un modèle n'invente pas de type de contrat** : extension et maison
  individuelle sont des constructions neuves au contrat, un permis seul aussi
  (c'est sa répartition, esquisse + avant-projet + dossier de permis, qui en
  porte la portée réelle).

La synchronisation de `Proposals.tsx` lit désormais le `default_pct` propre à la
mission avant celui de `DEFAULT_MISSIONS` : sans cela, une mission hors MOP
(diagnostic, dossier de permis) retombait sur une part égale. Le sélecteur de
modèle n'apparaît qu'à la CRÉATION d'un contrat ou d'une proposition, jamais sur
un document existant : le choisir remplace sa répartition. Un modèle tiré d'une
affaire reprend les missions de son contrat MOE principal.

### Bibliothèque d'ouvrages

`/specifications` (« Bibliothèque d'ouvrages ») n'est plus un éditeur de
documents mais le fonds d'articles réutilisables du cabinet : la base dans
laquelle les CCTP, DPGF et DQE viennent puiser. `articles_type`, qui servait
déjà de bibliothèque de prix alimentée par les BPU, en est le support.

Un article se classe sur trois nomenclatures publiques, servies ensemble par
`GET /api/referentiels` (`server/routes/referentiels.ts`, mises en cache 1 h
car elles ne bougent qu'à la révision d'une norme) :

| Table | Nomenclature | Rôle sur l'article |
|---|---|---|
| `ref_sfb_elements` | EU SfB plus, août 2024 (32 éléments, 284 sous-éléments) | où se situe l'ouvrage dans le bâtiment |
| `ref_corps_etat` + `ref_dtu` | NF DTU par métiers, BNTEC/FFB, janvier 2026 (23 métiers, 115 normes) | quel métier l'exécute, sous quelle norme |
| `ref_naf` | NAF rév. 2, INSEE, section F et connexes (141 codes) | quelle activité d'entreprise le réalise |

Ces tables sont **globales**, pas multi-tenant : une nomenclature publique est
la même pour tous les cabinets, et la dupliquer par tenant multiplierait une
donnée qui ne change qu'une fois par an. Elles portent une RLS en lecture
seule ; seule la service role écrit. `ref_dtu_corps_etat` est une liaison N-N
parce qu'un même DTU relève parfois de deux métiers (NF DTU 26.1 : façades et
enduits intérieurs).

Deux invariants :

1. **`origine` est le repère de provenance**, avec un vocabulaire fermé
   (`reference`, `saisie`, `bpu`, `offre`, `import`). C'est lui qui distingue
   un article créé par le cabinet du fonds de référence, et qui le signalera
   comme tel une fois injecté dans un CCTP ou un DPGF. Il n'est posé **qu'à la
   création** : un article saisi à la main puis re-remonté par un BPU garde sa
   provenance, sinon le repère s'effacerait au premier import. La colonne
   `source`, plus ancienne, garde le détail libre (« projet:&lt;id&gt; »).
2. **Le prix courant et les prix observés sont deux choses.**
   `articles_type.prix_unitaire` est le prix qu'on injecte dans un DPGF ;
   `article_prix_observations` garde chaque prix constaté sans l'écraser, avec
   son entreprise et sa date. C'est cette table que les réponses des
   entreprises aux appels d'offres viendront alimenter. Reprendre une
   observation comme prix courant reste un geste explicite
   (`definir_comme_courant`) : une offre isolée ne redéfinit pas d'office le
   prix de référence du cabinet. Les statistiques renvoient une **médiane**, pas
   une moyenne, qu'une offre anormalement basse fausserait.

**Pas de brouillons dans la bibliothèque.** Une ligne créée dans le DPGF ou le BPU/DQE n'y entre d'elle-même que si elle est renseignée : vraie désignation (pas « Nouvel article » ni « Nouvel ouvrage ») ET un prix ou une unité (`lignesPourBibliotheque`, `treeOps.ts`, appelée par `ProTab.editDpgf` / `editBpu`). `POST /api/price-library/bulk` refuse la même chose côté serveur pour tout envoi sans `explicite: true` (la réponse porte alors `ecartes`) ; « Envoyer vers la bibliothèque » (`envoyerVersBibliotheque`) est un geste explicite et garde l'article tel quel. Avant ce garde, chaque ligne créée (à la main, copiée, générée par l'IA) partait à 0 €, sans unité ni description : environ 130 articles `origine = 'bpu'` dont près de 80 totalement vides sur l'instance du cabinet. `PUT /api/price-library/:id` refuse d'effacer la désignation. **Nettoyage des articles vides déjà présents : à la main** (voir l'écran `/specifications`) ; un article repris dans un document porte `articleTypeId`, le supprimer laisse ce lien orphelin (le badge « BIB » ne s'affiche plus, la remontée de prix ne se rattache plus).

**Auto-complétion des articles** (`src/lib/bibliothequeAutocompletion.ts`, `useRechercheArticles`, `ListeArticlesBibliotheque`, `TitreArticleCctp`, `tests/bibliothequeAutocompletion.test.ts`) : pendant la saisie de la désignation d'un article du DPGF (`CellInput`, prop `articles`) et du titre d'un article du CCTP, les ouvrages de la bibliothèque qui contiennent le texte sont proposés (`GET /api/price-library?dossier=ouvrages&q=`, 8 au plus, 2 caractères, 200 ms ; jamais les clauses). Rien n'est cherché tant que le texte n'a pas été modifié. Flèches puis Entrée (ou clic) choisissent ; Entrée sans proposition surlignée valide le texte tapé. Choisir pose la désignation et `articleTypeId` (badge « BIB », remontée de prix) et reprend l'unité, le prix et la description technique **seulement s'ils sont vides** sur la ligne (`patchDepuisArticle` : « u » compte pour vide, un article à sous-articles ou réservé au CCTP ne reçoit ni prix ni unité), le montant et le lot sont recalculés, l'usage de l'article est compté. Le BPU et le DQE (même atelier, `BPUWorkspace.appliquerArticleBibliotheque`) l'ont aussi, avec la cellule partagée `EditableCell`. La liste mobile du DPGF (`DpgfMobileList`, prop `onChoisirArticle`) l'a aussi. **Titres de chapitre** (DPGF de bureau et CCTP) : ce sont les CLAUSES générales (`dossier=clauses`, `patchChapitreDepuisClause`) qui sont proposées ; choisir pose le titre et le texte du chapitre seulement s'il est vide. Les titres de lot, eux, n'ont pas d'auto-complétion (ils viennent de la liste des lots). Pas vérifié dans un navigateur ; aucun test ne monte `BPUWorkspace` (la logique est celle, testée, de `patchDepuisArticle` et de `CellInput`).

#### La boucle : bibliothèque → documents → offres → bibliothèque

`PriceLibraryPanel` sert les **trois** éditeurs (CCTP, DPGF, BPU/DQE). Il rend
les articles bruts et non des lignes déjà formées : un article devient une
ligne de DPGF (avec quantité), une ligne de BPU (sans quantité, avec nature)
ou un article de CCTP (dont `description` amorce le texte technique). Chaque
éditeur fait sa propre conversion — la centraliser obligerait le panneau à
connaître les trois formes.

`Ligne.articleTypeId` (`src/types/dpgf.ts`, donc partagé par le CCTP et le BPU
qui étendent ce type) est le fil qui referme la boucle. Il sert deux choses à
la fois, et c'est pour cela qu'il vit sur `Ligne` et non sur le seul
`BPULigne` :

1. **Le repère** demandé dans les documents : un badge « BIB » marque dans le
   DPGF et le CCTP les articles issus du fonds du cabinet.
2. **La remontée des prix.** Quand une entreprise renvoie un bordereau chiffré,
   `OffreBPU.prix` est une table `id de ligne -> P.U.` ; `articleTypeId` dit à
   quel article de la bibliothèque chaque prix se rapporte.
   `server/articlePrices.ts` verse alors une observation par ligne. Sans ce
   champ, un prix reçu ne se rattache à rien et la boucle ne se referme pas.

La remontée est **automatique** : `POST` et `PUT` sur les offres du BPU
l'appellent, en meilleur effort (l'offre est déjà enregistrée, un échec de la
remontée ne doit pas la faire perdre) ; `POST
/api/projects/:id/bpu/offres/:offreId/vers-bibliotheque` permet de la rejouer.
Une offre `ecartee` est ignorée, et un prix `null` aussi — dans une offre,
`null` veut dire « non chiffré », surtout pas zéro, qui est un prix.

L'idempotence tient à `article_prix_observations.source_ref`, une clé stable
(« bpu:&lt;offreId&gt;:&lt;ligneId&gt; », « bulk:&lt;source&gt;:&lt;clé&gt; ») sous index unique,
sur laquelle l'écriture se fait en **upsert**. Sans elle, une offre corrigée
puis réimportée ajouterait un doublon et la médiane d'un article finirait par
mesurer le nombre d'imports plutôt que le nombre d'entreprises consultées.
Deux points à ne pas défaire :

- **L'index est total, pas partiel.** Un `WHERE source_ref IS NOT NULL` aurait
  semblé plus propre, mais PostgREST n'émet pas le prédicat de l'index dans son
  `ON CONFLICT` et Postgres refuse alors d'inférer une contrainte partielle.
  Le prédicat est inutile : Postgres tient les NULL pour distincts, donc les
  observations saisies à la main restent libres de se répéter.
- **Un même lot d'upsert ne peut pas porter deux fois la même clé** — Postgres
  répond « ON CONFLICT DO UPDATE command cannot affect row a second time ».
  D'où le garde-fou par `source_ref` dans `remonterPrixOffre()`.

### Bâtiments, phases, localisation et offres DPGF

Une opération porte parfois plusieurs bâtiments et se mène en plusieurs
phases. `DecoupageDocument` (`src/types/dpgf.ts`) porte ce découpage — deux
registres au niveau du document (`batiments: Batiment[]`, `phases:
PhaseOperation[]`, chacun activable par un booléen `multiBatiments`/
`multiPhases`) plus un attribut `batimentId`/`phaseId` (`DecoupageNoeud`)
hérité en cascade lot → chapitre → article, résolu par `batimentEffectif()`
et `phaseEffective()`. C'est le même principe que les tranches du BPU
(`Tranche`/`trancheId`) : un registre partagé plutôt qu'un quatrième niveau
d'arbre, pour ne pas toucher `FlatRow`/`rowKey`/`MAX_ARTICLE_DEPTH` et
l'aplatissement de `treeOps.ts`, communs aux trois éditeurs. `DPGF`, `BPU` et
le CCTP (qui édite le même `DPGF`) étendent tous `DecoupageDocument` ; le
panneau qui gère les deux registres (`DecoupagePanel.tsx`) et le couple de
`<select>` compacts qui identifient bâtiment/phase sur une ligne
(`SelecteursDecoupage`) sont donc partagés par les trois. `Ligne` porte en
plus `localisation?: string` (pièce ou ouvrage, texte libre — la
nomenclature des pièces varie trop d'un projet à l'autre pour un vocabulaire
fermé), disponible sur chaque article dans les trois éditeurs.

Le classement du DPGF (`GroupementDpgf = 'lot' | 'batiment' | 'phase' |
'batiment-phase'`) reste par défaut « par lot » — la seule vue éditable, le
sélecteur de classement n'apparaissant que si `multiBatiments` ou
`multiPhases` est actif. Les trois autres classements sont rendus par
`DpgfGroupedView.tsx`, une vue de LECTURE qui réordonne les mêmes articles
sans dupliquer l'arbre éditable : exactement le même principe que le
comparatif ACT, qui lit le BPU sans jamais y réécrire. Un article sans
bâtiment ou sans phase identifiés tombe dans un groupe « sans affectation »,
volontairement affiché en dernier — une exception à régulariser, pas le
premier chiffre qu'on veut voir.

**Un article peut concerner un ou plusieurs bâtiments**
(`src/lib/batimentsArticles.ts`, testé dans `tests/batimentsArticles.test.ts`) :
un bardage vertical pour le préau ET le bâtiment A, un bardage horizontal pour
le seul bâtiment A. L'article porte alors `quantitesBatiments` (une quantité
par bâtiment coché) ; sa quantité DPGF en est la somme et son montant la somme
× P.U. Sans `quantitesBatiments`, l'ancien régime vaut toujours : un seul
bâtiment par `batimentId`, hérité du chapitre puis du lot ; `batimentId: ''`
veut dire « aucun bâtiment », sans héritage.

- **Saisie** : dans le DPGF, une colonne « Bâtiments » (liste à cases à cocher,
  `ToolbarMenu` avec `keepOpen` et l'état « mixed ») puis une colonne de
  quantité par bâtiment et la quantité totale. Sur une ligne de lot, de
  chapitre ou d'article à sous-articles, la liste coche ou décoche le bâtiment
  sur tous les articles qu'elle contient. La barre de sélection a la même liste
  pour plusieurs articles à la fois (`basculerBatimentEnMasse`). Le CCTP
  l'offre aussi dans la fiche de l'élément sélectionné.
- **Cocher** garde les quantités déjà saisies ; un nouveau bâtiment part à 0,
  sauf si l'article n'en avait aucun : sa quantité va alors au premier coché.
  Tout décocher rend une quantité simple, sans bâtiment.
- **Export du CCTP** (`src/lib/cctpExport.ts`, menu Exporter de l'onglet CCTP,
  PDF et Word à la charte, **jamais de quantité ni de prix**) : l'opération
  complète, où chaque article dit « Bâtiments concernés : … », ou un CCTP par
  bâtiment (`cctpPourBatiment`) qui ne garde que ses articles. Dans ce dernier,
  un chapitre sans article (généralités) et un texte propre au CCTP sans
  bâtiment valent pour tous ; un article chiffrable sans bâtiment n'entre dans
  aucun, et l'export par bâtiment le signale.
- **Un seul bouton « Exporter » pour tout le dossier PRO** (barre des sous-onglets de
  `ProTab`, `ProExportDialog.tsx`) ; les menus d'export du CCTP, du DPGF, du BPU/DQE et
  de l'estimation sont supprimés. La fenêtre choisit les documents (CCTP, DPGF, DQE, BPU,
  avec raccourcis « CCTP seul », « CCTP + DPGF », « Dossier de consultation »), un format
  par document (PDF, Word ou Excel, ou les deux), le périmètre (tout, ou lots, bâtiments et
  phases) et l'option « Inclure les prix », **décochée par défaut** : DPGF, DQE et BPU sortent
  alors sans P.U., montant ni total (le bordereau est « vierge »). L'**estimation** est à part
  (« document interne ») et porte toujours ses prix. Orchestration dans
  `src/lib/exportDossier.ts` (`produireDossier`), qui donne à chaque exporteur une `Sortie`
  (`exportSortie.ts`) collectant les fichiers au lieu de les télécharger ; `livrer()` envoie un
  fichier tel quel, **plusieurs dans un ZIP** (jszip). Sans `sortie`, les exporteurs
  téléchargent comme avant.
- **Orientation A4 et export par lot** (`src/lib/exportOrientation.ts`, testé dans
  `exportDossier.test.ts`) : la fenêtre propose, pour le CCTP et le DPGF, vertical ou
  horizontal, en PDF, Word et Excel (`orientations` de `DemandeDossier`). Par défaut : vertical
  pour le CCTP, horizontal pour le DPGF, comme avant. Le Word passe par `docxSectionChrome`
  (`orientation`, taille de page et tabulation de l'en-tête réduit). Le DPGF PDF en vertical
  réduit colonnes et corps de texte (`w()`). L'option « Un fichier par lot » (`parLot`)
  produit un fichier par lot du périmètre (`documentsParLot`), nommé d'après le lot
  (`suffixeLot`), combinable avec « un CCTP par bâtiment » ; les fichiers partent dans le ZIP.
  Le BPU, le DQE et l'estimation ne sont pas concernés.
- **Périmètre commun** (`src/lib/exportPerimetre.ts`, testé) : lots désignés par leur
  NUMÉRO, bâtiments et phases par leur CODE, car le CCTP/DPGF et le bordereau ont chacun
  leur registre aux identifiants distincts. Un critère de bâtiment ou de phase est ignoré par
  un document qui n'a pas activé ce découpage. Pour le CCTP (`{ cctp: true }`), les textes
  réservés au CCTP et les chapitres sans article sont gardés, et une sélection de bâtiments
  produit **un CCTP par bâtiment retenu** (`cctpPourBatiment`) ; la case « un fichier par
  bâtiment » le fait aussi sans sélection. Un document sans article dans le périmètre est
  ignoré avec un avertissement. Le BPU Excel garde ses intitulés, références et feuille
  `_meta` (aller-retour de l'import), prix vides comme avant (`vierge`).

**Le DPGF verse maintenant lui aussi ses offres au comparatif ACT.** L'ACT
récupère les offres des entreprises sur la base du DPGF ou du BPU selon le
document utilisé pour consulter — jusqu'ici seul le BPU avait cette notion.
`OffreDocument` (`src/types/dpgf.ts`, ex-`OffreBPU`, conservé comme alias
dans `types/bpu.ts` pour ne pas casser les call sites existants) et
`DocumentAvecArticles` (`src/lib/bpuImport.ts`) généralisent le
rapprochement de fichier d'offre, `OffreImportDialog.tsx` (ex-
`BPUImportDialog`) et `versComparatif()` (`src/lib/bpuToAct.ts`, avec les
alias `bpuVersComparatif`/`dpgfVersComparatif`) pour que le même moteur et la
même boîte de dialogue servent les deux documents. Comme pour le BPU, les
offres du DPGF vivent dans une colonne séparée du document
(`dpgfs.offres` JSONB, routes sous `/api/projects/:id/dpgf/offres`) pour que
l'autosave du document n'efface pas un import fait entre-temps.
`article_prix_observations.source_ref` est préfixé par la provenance
(`` `dpgf:<offreId>:<ligneId>` `` vs `` `bpu:<offreId>:<ligneId>` ``, porté
par `sourceKind` dans `remonterPrixOffre()`) pour que les deux documents ne
se marchent pas dessus dans le même index d'idempotence.

### Localisations et illustrations des articles de CCTP

Deux aides de la fiche d'un article (`CCTPEditor.tsx`), qui s'enrichissent à mesure
qu'on renseigne le document, sans migration (tout vit dans le jsonb du DPGF) :

- **Localisation** : le champ reste du texte libre, mais propose les localisations déjà
  saisies dans tout le document (`localisationsConnues`, `src/lib/cctpImages.ts`, testé :
  les plus fréquentes d'abord, casse et espaces fusionnés, sous-articles compris), par un
  `<datalist>`. Plus on en saisit, plus la liste est riche.
- **Illustrations** : `Ligne.images` (`ImageArticle` : `documentId`, `fileUrl`, `legende`).
  Chaque image est réduite côté navigateur (JPEG, 1600 px) puis déposée comme document de
  l'affaire, catégorie « CCTP - illustrations » (`cctpImagesUpload.ts`, `POST /api/documents`) ;
  l'article n'en garde que la référence, lue par `SignedImage`. La légende d'une nouvelle image
  reprend la localisation de l'article. Retirer une image la détache de l'article **sans
  supprimer le document** : une duplication d'article partage la même référence, la supprimer
  casserait la copie. Les exports PDF et Word du CCTP (`cctpExport.ts`) impriment les images
  sous le texte de l'article, avec leur légende, y compris dans l'export par bâtiment ;
  `planRender` (pdf.js) n'est chargé que si une image existe.

### Mise en forme du texte technique du CCTP (gras, italique, souligné, couleur)

`cctpDescription` reste une chaîne, sans migration : la mise en forme y est portée par quatre balises, `[b]…[/b]`, `[i]…[/i]`, `[u]…[/u]` et `[c=#rrggbb]…[/c]` (`src/lib/cctpRichText.ts`, testé). Une balise inconnue, mal formée, sans ouverture, ou une couleur autre que `#rrggbb` reste du texte ordinaire : rien n'est perdu ni interprété en silence. Les variables `{{…}}` ne sont pas touchées.

- **Édition** (`CctpRichText.tsx`, branchée dans `CCTPEditor`) : le champ reste un `<textarea>`. La barre (B, I, U, palette de six couleurs dont le noir et le gris, « Aucune ») et Ctrl/⌘ + B, I, U posent ou retirent les balises autour de la sélection (`basculerBalise`, `appliquerCouleur`), la sélection est rétablie ensuite. Un aperçu rendu n'apparaît que si le texte est mis en forme.
- **Export** (`cctpExport.ts`) : PDF mis en lignes mot par mot (`mettreEnLignes`, car `splitTextToSize` ne change pas de police), gras/italique/gras italique en Helvetica, souligné tracé, couleur par segment ; Word par `TextRun` (`bold`, `italics`, `underline`, `color`). Les titres, mentions et légendes restent sans mise en forme. La couleur n'est pas imposée : un texte non coloré garde les gris de la charte.
- **Les autres consommateurs lisent `texteBrut()`** : recherche du PRO (`proRecherche.ts`) et planning de chantier (`server/planningSources.ts`). Les agents (`packages/archioffice-agents`, qui n'importent rien de `src/`) voient les balises telles quelles. **Tout nouveau consommateur de `cctpDescription` qui affiche ou analyse le texte doit passer par `texteBrut()`.**
- **Pas encore fait** : listes à puces mises en forme dans l'aperçu, mise en forme du texte généré par l'IA (il arrive sans balises), vérification dans un navigateur et sur un PDF réellement ouvert.

### Éditeur CCTP : liste des lots, arbre mémorisé, sélection multiple, IA, bibliothèque

Aucune migration SQL. Tout vit dans `CCTPEditor.tsx` et des modules purs testés.

- **Variable `{{liste_lots}}`** (`cctpVariables.ts`, groupe « Opération ») : une puce « Lot 01 · Gros œuvre » par lot du document EXPORTÉ (`libellesLots`, calculée dans `cctpBlocs` quand le contexte ne la fournit pas) : un CCTP par bâtiment ne liste que ses lots. Sans lot : « [liste des lots à renseigner] ».
- **Arbre mémorisé** (`src/lib/cctpTreeState.ts`) : on enregistre ce qui est REPLIÉ (localStorage `cctp:tree:<projet>`), pas ce qui est ouvert, pour qu'un lot ou un chapitre créé ailleurs (DPGF, import, IA) arrive ouvert. Les déplacements ne rouvrent plus tout l'arbre : seul le chemin de l'élément déplacé s'ouvre.
- **Sélection multiple** : Ctrl/⌘ + clic, Maj + clic (plage sur les lignes VISIBLES de l'arbre) et cases à cocher (toujours visibles au doigt). `selection` reste l'élément affiché dans l'éditeur, `multiKeys` la sélection groupée : elle ne vaut que tant que l'élément affiché en fait partie, et elle est abandonnée à tout changement de structure (`signatureArbre`), les clés étant positionnelles (cf. `treeOps.rowKey`). Une sélection groupée remplace l'éditeur par un récapitulatif.
- **Copier / coller / dupliquer** : Ctrl+C, V, D dans l'arbre (focalisé) et dans la barre de sélection. Copier et coller ne portent que des ARTICLES, comme le DPGF (`collectSelectedLignes`, `pasteLignes`) ; dupliquer vaut aussi pour lots et chapitres (`dupliquerSelection`, du dernier au premier, un parent sélectionné avec ses enfants n'est copié qu'une fois). La sélection est vidée après une duplication groupée (les positions ont bougé). Suppression groupée : seulement des éléments propres au CCTP.
- **Modifier en masse** (`cctpBulkOps.ts`, `CctpBulkEditDialog.tsx`) : texte (début, fin, rechercher/remplacer littéral), visibilité DPGF, localisation, unité (articles), phase, bâtiments (ajouter/retirer). Une rubrique non cochée n'est jamais touchée ; effacer une localisation ou une phase est un choix explicite. S'applique aux éléments sélectionnés eux-mêmes, pas à leurs descendants ; ne compte que ce qui change réellement.
- **Rédaction IA d'un poste** (`POST /api/projects/:id/cctp/draft-poste`, `CctpDraftPosteDialog.tsx`) : titre, position (lot, chapitre), postes voisins, unité, localisation et, sur demande, le texte actuel à améliorer. Réserve → exécute → règle comme `generate-lot` (`endpoint_type = 'cctp_generation'`, un appel par demande, aucune pièce lue). La route ne rend qu'une PROPOSITION (`nettoyerTextePoste` : markdown vers texte brut et balises `[b]`, 8 000 caractères au plus) ; l'écran la montre modifiable et l'architecte choisit remplacer, ajouter ou abandonner. Un article ainsi rédigé reçoit le repère « IA » de l'arbre. Le texte actuel n'est envoyé que si « Reprendre et améliorer » est coché.
- **Bibliothèque : export et clauses générales** (`src/lib/bibliothequeClauses.ts`) : un article s'exporte comme OUVRAGE (désignation, unité, prix, description) ou comme CLAUSE ; un lot ou un chapitre seulement comme clause. L'ouvrage exporté est lié à son article (`articleTypeId`, qui sert à la remontée de prix). Le dossier « Clauses générales » n'est PAS une table ni une colonne : c'est la catégorie réservée `articles_type.categorie = 'clauses_generales'` (aucune migration). `GET /api/price-library?dossier=ouvrages|clauses` (sans paramètre : tout, comme avant ; `ouvrages` exclut les clauses, catégorie vide comprise) ; `repartition` rend `total` (ouvrages) et `clauses` ; `POST` refuse une clause au titre déjà pris (409 `existing_id`, casse, accents et espaces ignorés). Dans le panneau du CCTP (`avecClauses`), insérer une clause AJOUTE son texte à l'élément sélectionné (`ajouterClause`, jamais deux fois) ; le DPGF et le BPU ne voient que des ouvrages. Si un jour un vrai dossier est nécessaire (sous-dossiers, droits), une colonne remplacera cette catégorie.
- **Export vers la bibliothèque sans ressaisie** (`cctpExportOps.ts`, `CctpExportLibraryDialog.tsx`, `tests/cctpExportOps.test.ts`) : la fenêtre liste les lots, chapitres et articles SÉLECTIONNÉS et reprend leur contenu. Un lot ou un chapitre devient une clause dont le texte réunit le sien et celui de ses sous-éléments (chacun sous son intitulé en gras, case « avec les sous-éléments » cochée par défaut) ; un article devient un ouvrage. Sont décochés d'office : une clause sans texte, un article déjà lié à la bibliothèque. Un titre de clause déjà pris est signalé sans bloquer les autres. Rien n'est modifié dans le CCTP, hors le lien `articleTypeId` des ouvrages créés.
- **Marqueur de rédaction « incomplet / en cours d'édition »** (jsonb du DPGF, aucune migration) : `marqueur {statut, par?, le?, note?}` sur `Lot`, `Chapitre` et `Ligne` (`src/lib/marqueurRedaction.ts`, testé). Pour l'équipe : pastille dans l'arbre du CCTP et menu « Rédaction » dans la fiche de l'élément (`MarqueurRedaction.tsx`, auteur = personne connectée via `ProTab`). Pour les agents : `read_cctp` et `read_dpgf` rapportent le marqueur et les compteurs `nb_incomplets` / `nb_en_cours_d_edition` ; `manage_dpgf` pose ou lève un marqueur (`marqueur`, `note_marqueur`) et **refuse en 409 de modifier, supprimer ou écraser un élément « en cours d'édition » par quelqu'un d'autre**, sauf `forcer: true` sur demande explicite de la personne. L'auteur d'un marqueur d'agent est fixé par le serveur (« Agent IA »), jamais lu dans la requête. Un « en cours » de plus de 24 h est signalé comme probablement oublié. **Pas encore fait** : modification en masse du marqueur, avertissement à l'export du dossier PRO, compteur « à finir » dans l'en-tête.
- **Tests** : `src/lib/__tests__/{cctpTreeState,cctpVariables,bibliothequeClauses,marqueurRedaction}.test.ts`, `tests/{cctpBulkOps,cctpDraftPoste,priceLibraryClauses,cctpExportOps}.test.ts`. `tests/proDemoteDialog.test.ts` monte `CCTPEditor` : il mocke chaque dialogue (ils tirent `lib/api`, donc le client Supabase) ; tout nouveau dialogue de l'éditeur s'y ajoute.
- **Pas vérifié dans un navigateur** : barre de sélection, cases à cocher de l'arbre, fenêtres, raccourcis clavier (Ctrl+C dans l'arbre n'est pas capturé si le focus est dans un champ de texte). **Pas encore fait** : copier/coller de chapitres entre lots, sélection de l'arbre au clavier (flèches), choix des pièces de l'affaire pour la rédaction IA d'un poste, export groupé de plusieurs articles vers la bibliothèque.

### Le CCTP n'est pas un document séparé

Le codebase a longtemps porté trois chemins parallèles pour le CCTP, dont
deux morts ou cassés :

1. **Le vrai** : `CCTPEditor.tsx` édite le même arbre que le DPGF
   (`lots > chapitres > lignes`, `GET/POST /api/projects/:projectId/dpgf`,
   `server/routes/dpgf.ts`) — chaque lot, chapitre et article porte un champ
   `cctpDescription` (le texte technique) et un booléen `cctpOnly` (masqué du
   DPGF). C'est la seule table réellement écrite en production.
2. **Une table `cctps` séparée**, avec sa propre route
   `GET/POST /api/projects/:projectId/cctp` (`server/routes/cctps.ts`, aussi
   `PUT/DELETE /api/cctps/:id`, colonnes qui n'existaient même pas sur la
   table) et son propre hook frontend (`src/hooks/useCCTP.ts`,
   `src/types/cctp.ts`) — inutilisé par tout composant en production
   (`CCTPEditor.tsx` ne l'importe pas), sauf UN outil d'agent : `read_cctp`
   (`packages/archioffice-agents/src/server/projectDocTools.ts`) lisait
   cette route morte et rapportait donc systématiquement qu'aucun CCTP
   n'existait, quel que soit le projet demandé — un bug utilisateur réel,
   pas seulement du code mort.
3. **L'ancienne table `specifications`** (depuis retirée du système, voir
   plus bas), qui servait de CCTP avant que `/specifications` ne devienne la
   bibliothèque d'ouvrages (voir plus bas) ; `packages/archioffice-agents/
   src/server/context.ts`'s `firmKnowledge` (scope `firm_knowledge`) y
   puisait encore ses `cctpExcerpts` — du contenu qui ne recevait plus
   d'écriture depuis ce changement, donc de plus en plus périmé au fil du
   temps.

**Correction : `read_cctp` lit maintenant la même route que `read_dpgf`**
(`/api/projects/:projectId/dpgf`) et `summarizeCctp()` en extrait le texte
`cctpDescription` au lieu des champs `description`/`prescriptionsTechniques`
d'un type `Article` qui ne correspondait à aucune donnée réelle.
`firmKnowledge.cctpExcerpts` lit désormais `dpgfs` de la même façon (une
fonction dédiée, `extractCctpExcerpt()`, rejoue la même marche que
`summarizeCctp()` en miniature) plutôt que la table `specifications`.

**Le code mort a été supprimé** : `server/routes/cctps.ts` (et son
enregistrement dans `server.ts`), `src/hooks/useCCTP.ts`, `src/types/cctp.ts`,
et le code CCTP inatteignable de `ProjectDetail.tsx`
(`fetchSpecifications`/`handleCreateSpec`, jamais appelés depuis un rendu, et
l'état `specifications`/`isAddingSpec`/`newSpecTitle` qui allait avec).

Les routes historiques ligne-à-ligne `/api/dpgf/:projectId` et `/api/dpgf`
adossées à `dpgf_items` restent temporairement disponibles pour les situations
et marchés existants, mais renvoient les en-têtes HTTP `Deprecation`, `Sunset`,
`Link` et `Warning`. Tout nouveau code doit utiliser le document structuré
`/api/projects/:projectId/dpgf`, seule source du CCTP, de la DPGF et de
l'estimation. La date cible de retrait est le 31 mars 2027.

**La table `cctps` elle-même n'a pas été supprimée**, à dessein : une
instance de production en porte une ligne, écrite par l'ancien hook mort —
la retirer sans savoir si un cabinet compte dessus serait une perte de
données pour gagner une ligne dans `schema.sql`. Elle reste donc dans
`server/syncTables.ts` et `supabase/migrate_add_sync_infra.sql`, vide de
toute route qui l'écrit ou la lit désormais.

**La table `specifications`, elle, a fini par être retirée du système
entier** — route (`server/routes/specifications.ts`), entrée
`AGENT_RESOURCES`, place dans `server/syncTables.ts` et table elle-même
(`supabase/migrate_drop_specifications.sql`) — sur demande explicite de
l'architecte, malgré les quelques lignes qu'elle portait encore : à la
différence de `cctps` ci-dessus, la perte a été assumée plutôt que
préservée par précaution.

### Fiches techniques des postes, contrôle de cohérence, IA

- **Fiches techniques** (`Ligne.fichesTechniques`, `FicheTechnique { id, documentId?, fileUrl, nom }`, jsonb du DPGF, aucune
  migration) : un poste porte jusqu'à 20 fiches (fiche produit, avis technique, PV d'essai). Une fiche est un DOCUMENT de
  l'affaire (catégorie « Fiches techniques », `POST /api/documents`) ou un document déjà présent, rattaché par sa
  référence ; retirer une fiche ne supprime JAMAIS le document. `FichesTechniquesEditor.tsx` (fiche d'un article du CCTP et
  fenêtre de description du DPGF), `src/lib/fichesTechniques.ts` (pur sauf l'envoi). L'export du CCTP rappelle « Fiches
  techniques : … » sous l'article (noms seulement, `cctpExport.ts` n'importe volontairement pas `fichesTechniques.ts`, qui
  tire le client Supabase). Absentes de la vue d'un confrère (liste blanche de `documentView.ts`).
- **L'IA se sert des fiches** : `POST /api/projects/:id/cctp/draft-poste` accepte `fiche_document_ids` (5 au plus, articles
  seulement). Seuls les documents de CETTE affaire sont lus (`extractKnowledgeDocText`), 8 000 caractères par fiche et
  20 000 au total, injectés comme source prioritaire (« ne reprends que ce qui y figure »). La réponse porte
  `fiches_ignorees` (illisibles). Case « Utiliser les fiches techniques du poste » cochée par défaut dans
  `CctpDraftPosteDialog`.
- **Poste réservé au CCTP** (`cctpOnly`, ou sous un chapitre `cctpOnly`) : aucune unité, quantité ni prix dans la fiche du
  CCTP (`CctpQuantiteUnite` n'est pas rendu), et le contrôle de cohérence ne les exige pas. Les valeurs déjà saisies ne sont
  jamais effacées.
- **Contrôle de cohérence** (`validateProDocument`, `ProControlPanel`) : « bâtiment non affecté » suit la même règle que
  `articlesSansBatiment` (liste `quantitesBatiments`, `batimentId` hérité de l'article parent, du chapitre puis du lot,
  `batimentsIds` d'un lot ou chapitre, `''` = aucun sans héritage) ; seuls les articles feuilles chiffrables sont
  contrôlés. Le rapport se replie **lot par lot** (« Tout replier / Tout déplier »). **Corrections IA** :
  `POST /api/projects/:id/pro/control/suggest` (`server/proControlSuggest.ts`, testé via `tests/cctpTextes.test.ts` voisin)
  propose seulement `unite`, `designation` et `cctpDescription`, jamais prix, quantité, bâtiment ni phase ; l'écran montre
  avant/après et l'architecte applique ou écarte (`src/lib/proCorrections.ts`). Facturé comme `cctp_generation`.
