---
paths:
  - "src/components/act/**"
  - "src/components/ACT*.tsx"
  - "src/lib/act*.ts"
  - "src/lib/comparatifPrix.ts"
  - "src/lib/accordCadre.ts"
  - "src/lib/marche*.ts"
  - "src/lib/consultationDepot*.ts"
  - "src/lib/qualifications.ts"
  - "src/lib/bpu*.ts"
  - "server/consultationDepot/**"
  - "server/routes/marches*.ts"
  - "server/routes/accordCadre*.ts"
  - "server/routes/consultationDepot*.ts"
  - "server/routes/entreprisesSearch.ts"
  - "server/rgeLookup.ts"
  - "src/pages/DepotOffres.tsx"
---

# ACT, consultation, offres, marchés, qualifications

> Règles extraites du CLAUDE.md racine, sans modification de contenu. Chargées quand Claude lit un fichier correspondant aux chemins ci-dessus.

### Suivi des entreprises consultées (ACT)

Le tableau « Entreprises consultées » de l'onglet ACT vit dans
`src/components/ACTEntreprisesTable.tsx`, sa logique pure dans
`src/lib/actEntreprises.ts` (testée) : aucune nouvelle donnée, tout se déduit
des champs déjà enregistrés dans `consultation.entreprises` (jsonb, aucune
migration).

- **Statut déduit, jamais saisi** (`statutEntreprise`) : « ne répond pas » >
  offre reçue > DCE transmis (« À relancer » dès que `relance_le` est atteinte
  sans offre, sinon « DCE envoyé ») > DCE à envoyer (`envoyer_dce`) > DCE non
  prévu. `relance_le` se lit donc comme la date de relance PRÉVUE. Les deux
  anciennes cases « Envoyer DCE » / « Ne répond pas » sont dans le menu de la
  pastille de statut.
- **Couverture** (`couverture`) : lot sous `MIN_ENTREPRISES_PAR_LOT` (3)
  entreprises (les « ne répond pas » ne comptent pas), entreprises sans lot,
  sans email alors que le DCE reste à envoyer. Un lot sous-couvert propose des
  contacts « Entreprise » dont un corps d'état recoupe l'intitulé du lot
  (`suggererContacts`, rapprochement par radicaux de 5 lettres : une
  suggestion que l'architecte confirme, pas une affectation).
- **Envoi du DCE** : le bouton de ligne ouvre `MailComposeModal` (prop
  `initial`) prérempli avec les lots de l'entreprise et les pièces du DCE qui
  la concernent ; à l'envoi, `dce_transmis_le` est posée. Les pièces du DCE
  ne sont que des intitulés : les fichiers se joignent dans la fenêtre de
  message. Pas d'envoi groupé volontairement (chaque entreprise ne doit voir
  que son propre message).
- **Ajout d'une entreprise** (`EntrepriseAddForm.tsx`, bouton « Ajouter » de l'en-tête) : un mini
  formulaire au-dessus du tableau (entreprise choisie dans les contacts ou créée sur place, email,
  corps d'état, lots, dates, DCE à envoyer) remplace l'ancienne ligne vide ajoutée tout en bas. À
  l'enregistrement la ligne se classe sous son lot (le tableau est regroupé par lot), les filtres sont
  levés, la page défile jusqu'à elle et elle est surlignée (`miseEnAvant`). Sans lot choisi, les lots
  sont PROPOSÉS d'après le corps d'état de la fiche (`lotsCorrespondants`, même rapprochement par
  radicaux que les suggestions de contacts) tant qu'on n'y a pas touché. Une fiche déjà consultée n'est
  jamais dupliquée : les lots choisis s'ajoutent à sa ligne. « Enregistrer et ajouter une autre » garde
  les lots, usage courant en série sur un même lot.
- **Actions groupées** sur la sélection (lots, DCE transmis aujourd'hui,
  relance, ne répond pas, retirer). Sous 768 px le tableau devient une liste
  de cartes (`useMediaQuery`, un seul rendu monté à la fois).
- **Enregistrement automatique** (`ACTModule.tsx`) : toute modification de la
  consultation (ajout d'une entreprise compris) est écrite 1,2 s après la
  dernière frappe, le bouton « Sauvegarder » restant disponible. Trois garde-fous
  à ne pas défaire : rien n'est écrit avant la fin de la lecture (`loaded`),
  sinon une saisie précoce écraserait la consultation enregistrée par une
  consultation vide ; les écritures sont chaînées (`saveChain`) et
  `editVersion` empêche une écriture en vol d'effacer l'état « à enregistrer »
  d'une modification arrivée entre-temps ; un échec relance une tentative
  après 5 s et le dernier état est écrit au démontage.
- `MultiSelectDropdown` (cases à cocher dans un popover) sert aux corps d'état
  et aux lots ; son `triggerContent` en fait aussi le menu de la pastille.

### Saisie des offres au total ou poste par poste, et comparatif des P.U. (ACT)

L'import des offres a quitté l'onglet PRO : le DPGF et le DQE/BPU n'ont plus ni bouton « Importer une offre », ni « Verser au comparatif », ni colonnes d'offres (`ColSet` n'a plus que `bpu` et `dqe`). Tout se fait dans la phase « Collecte des offres » de l'ACT. **Aucune migration** : les offres restent dans `OffreDocument` (`dpgfs.offres`, `bpu_data.offres`, mêmes routes, même remontée des prix vers la bibliothèque), seule l'interface a bougé.

- **Un mode de saisie par couple lot x entreprise** (`consultation.offres[].mode_saisie`, jsonb) : `total` (on tape `montant_base`) ou `postes` (les P.U. sont dans `OffreDocument.prix` et `montant_base` **en est déduit**, jamais saisi). Sans mode enregistré, `modeEffectif` déduit : un montant saisi veut dire « total », des prix reçus (portail de dépôt, ancien import PRO) veulent dire « postes ». Un effet de `ACTModule` recalcule `montant_base` des offres « postes » quand les prix changent ailleurs. Passer en « postes » écrase le montant saisi par le total calculé.
- **Document de référence** : `consultation.document_reference` (`dpgf` par défaut, ou `bpu`) ; le lot du document se retrouve par `Lot.projectLotId`. `useOffresDocument` (`src/hooks/`) lit le document et ses offres et écrit en série.
- **Saisie** (`act/OffrePostesDialog.tsx`) : un P.U. par article en regard de l'estimation et de l'écart, « pour mémoire » (`null`, jamais 0), postes ajoutés par l'entreprise, collage d'une colonne de tableur, Entrée passe à la ligne suivante. `repartirSaisie` (`src/lib/comparatifPrix.ts`, testé) range chaque prix **dans l'offre qui le porte** (la plus récente), les prix nouveaux dans l'offre « Saisie manuelle », un prix effacé disparaît de toutes. Plusieurs fichiers d'une même entreprise se superposent (`prixEntreprise`, le plus récent gagne). L'import d'un bordereau (`OffreImportDialog`) passe en « postes » les lots de l'entreprise qu'il chiffre.
- **Comparatif** (`act/ComparatifPrixUnitaires.tsx`, logique pure `construireLot`) : par lot, colonne **Estimation** (P.U. du document) puis un P.U. par entreprise, médiane, meilleur prix (au moins deux entreprises), écart à l'estimation (rouge au-delà de +15 %, ambre en dessous de -15 %), total du lot calculé (base seulement, options et PSE comparées mais non comptées), classement. Une entreprise au total seul reste dans les totaux et le classement, colonne hachurée sans détail. Filtre « écarts de plus de 10 % ou pour mémoire ». Sous 768 px, une carte par article.
- **`consultation.comparatif` se dérive des offres** pour les lots rattachés au document (`comparatifDepuisOffres`, via `versComparatif`) : l'analyse, la négociation, le RAO et l'export Excel le lisent par `consultationCourante`. Les lots sans lot de document gardent le tableau manuel (« Comparatif manuel »).
- **Pas encore fait** : la négociation travaille toujours sur les totaux et les lignes d'option, pas sur les P.U. ; l'export Excel du comparatif n'a pas de colonnes de P.U. par entreprise (il exporte les montants par article) ; interface non vérifiée dans un navigateur réel.
- Tests : `src/lib/__tests__/comparatifPrix.test.ts`.

### Négociation des offres (ACT) : fiches, options, synthèse économique

Phase « Négociation » du module ACT, entre la collecte et l'analyse. Tout vit
dans la consultation (`act_data.consultation`, jsonb) sous des clés
facultatives : **aucune migration SQL**, une consultation ancienne reste
valide. La logique pure est dans `src/lib/actNegociation.ts` (testée), l'écran
dans `src/components/act/` (`NegociationPhase` : fiches par lot, pièces
reçues, synthèse économique), les exports dans `src/lib/actNegociationExport.ts`.

- **La base reste `Offre.montant_base`** (source unique du prix de base). Les
  options et variantes sont des `LigneOffre` de la négociation du couple
  lot x entreprise (`consultation.negociations`). Une **option s'ajoute au
  total, une variante est une offre de substitution** et n'y entre jamais. Même
  éditeur (`LignesOffreEditor`) à l'ouverture des plis (collecte) et en
  négociation.
- **Trois étages de prix** : ouverture, vérifié (`montants_verifies`, seulement
  quand il diffère), courant (le dernier tour qui a touché la ligne, tours lus
  dans l'ordre des dates). Un tour ne porte que les lignes qui ont bougé.
  Total, gain, reste à obtenir et statut (`à vérifier`, `à négocier`, `en
  négociation`, `offre finale`, `retenue`, `écartée`) se **déduisent**, jamais
  saisis.
- **L'analyse, l'attribution et les exports lisent le prix courant**
  (`offresAuPrixCourant`, `montantAttribution`), pas celui de l'ouverture ; le
  montant d'ouverture reste affiché barré à côté. Une offre sans négociation se
  comporte exactement comme avant.
- **Synthèse économique** (`lignesSynthese`, `totauxOperation`) : estimations
  APD, PRO base et PRO + options par lot (saisies, à défaut l'estimatif du
  sous-total du DPGF versé au comparatif), moins-disant et moyenne, écarts en
  euros et en pourcentage, objectif (saisi, à défaut celui de l'offre
  moins-disante), décision. **Un lot sans offre exploitable est compté à son
  estimation** dans les totaux, sinon le dépassement serait faussé. Une offre
  non conforme ou écartée de la négociation n'entre jamais dans la comparaison.
- **Tolérance du CCAP** (`controleTolerance`) : estimation actualisée par
  `indice connu / indice à la date de l'estimation` (BT01), plafond = estimation
  actualisée x (1 + tolérance), trois niveaux (sous l'estimation, dans la
  tolérance, au-delà). Taux de TVA et de tolérance dans `consultation.parametres`.
- **Pièces reçues** (`pieces_recues`, entreprise -> pièces cochées) : pièces
  administratives de la consultation + pièces d'offre (`PIECES_OFFRE_DEFAUT`).
  « Marquer non conforme » est un geste explicite, jamais automatique.
- **Exports** à la charte (nuances de gris, « P1|2 ») : PV d'ouverture par lot,
  fiche de négociation d'une entreprise, synthèse en PDF et en Excel (feuille
  « Synthèse » avec formules de somme, feuille « Négociation »). Les montants
  des PDF passent par un `euros()` qui remplace l'espace fine U+202F, absente des
  polices de jsPDF (sinon « 31 /210 » : voir la note d'honoraires plus haut).

### Postes ajoutés par une entreprise et import dans un document vierge

Une ligne du fichier d'une offre qui ne correspond à aucun article du marché
(`OffreImportDialog.tsx`, étape de rapprochement) se rattache à la main ou, au
choix dans le menu « Rattacher à… », **devient un poste** (« + Créer un poste »).
Un bouton crée d'un coup un poste pour toutes les lignes non rattachées.

- **Le poste vit dans l'offre, pas dans le document** : `OffreDocument.postesAjoutes`
  (`PosteAjoute`, `src/types/dpgf.ts`, jsonb, aucune migration, les routes
  `/dpgf/offres` et `/bpu/offres` le conservent déjà). Le DPGF/BPU de référence reste celui que toutes les
  entreprises ont chiffré. Le lot du poste se déduit du premier segment de son numéro (« 02.05 » ->
  lot « 02 »), à défaut du lot de la ligne précédente, à défaut du premier lot
  (`src/lib/postesAjoutes.ts`, testé). Sans quantité annoncée, un poste vaut 1 ; son montant entre dans
  `totalOffreHT`, affiché « dont X de postes ajoutés ». Chaque poste laisse aussi une anomalie `ligne_ajoutee`.
- **Marqué dans l'analyse** : `versComparatif` (`src/lib/bpuToAct.ts`) verse ces postes sous une section
  « Postes ajoutés par les entreprises » de leur lot, avec `ComparatifArticle.ajoute_par`, seule l'entreprise
  concernée ayant un prix ; le sous-total du lot les compte. `ACTModule.tsx` colore la ligne (violet, couleur
  de donnée) avec la pastille « Ajouté par … » ; l'export Excel du comparatif (`actAnalysisExport.ts`) ajoute
  « (ajouté par … ) » au libellé, la couleur n'y passant pas. Une offre écartée n'ajoute rien.
- **Même dialogue pour remplir un document vierge** (`mode="document"`) : onglet PRO, menu « Importer un fichier
  (créer les postes) » du DPGF, du DQE/BPU et du CCTP (bouton). Pas d'entreprise ni de prix obligatoire
  (`detectHeader(..., { prixOptionnel })`, un CCTP n'a que des désignations) ; les lignes absentes du document
  sont cochées « à créer » d'office et `ajouterLignesAuDocument` les range lot > chapitre > article (premier
  segment = lot, deuxième = chapitre quand le numéro en compte trois, sinon un chapitre « Articles
  importés »). Un lot ou un chapitre existant est complété, jamais dupliqué, aucun article existant n'est
  modifié. `ProTab` écrit par `setDpgf`/`setBpu` et non `editDpgf`/`editBpu` : ceux-ci enverraient chaque
  nouvelle ligne à la bibliothèque d'ouvrages, que des centaines de lignes tierces n'ont pas à enrichir d'office.

### DQE : chapitres de marché subséquent, sélection, dépôt de fichier

`BPUChapitre.msCode` (« Ms1 », jsonb, aucune migration) rattache un chapitre du bordereau à un marché subséquent ; sans code, le chapitre relève de l'accord-cadre. Un lot porte côte à côte ses chapitres d'accord-cadre et ceux de chaque subséquent. Menu Ajouter > « Chapitre de marché subséquent » (code suivant proposé), actions de sélection « Marché subséquent » / « Accord-cadre », vue filtrable (menu Marché > Afficher). `ExportSelection.marches` (`AC_EXPORT` ou code Ms) isole un marché à l'export (`filtrerPourExport`, `marcheDuChapitre`, `src/lib/exportPerimetre.ts`, testé) ; la fenêtre d'export n'offre la section que si le bordereau en contient. Le lien avec l'émission d'un subséquent de l'onglet RDT n'est pas fait. Le tableau a des cases à cocher et « Tout sélectionner », un crayon pour modifier un chapitre, et reçoit un tableur déposé (`onDropFichier` : bordereau vierge, lignes en articles ; sinon offre à rapprocher). Un PDF est refusé avec un message : seul Excel, ODS et CSV sont lus.

### Accords-cadres et marchés subséquents (onglet RDT)

Un accord-cadre est une ligne de `marches_entreprises` (`type_marche = 'accord_cadre'`) ; chaque marché
subséquent en est une ligne enfant (`type_marche = 'subsequent'`, `parent_marche_id`, `numero_subsequent`). Les
OS, situations et certificats de paiement s'accrochent tous à `marche_id` : un subséquent se paie donc comme
n'importe quel marché, sans code propre. Colonnes dans `supabase/migrate_marches_subsequents.sql`
(`mode_execution`, `montant_mini_ht`, `montant_maxi_ht`, `date_fin_accord_cadre`, `objet`, `lignes_commande`,
`date_notification`) ; toutes facultatives, un marché existant reste un marché ordinaire. Réservé aux affaires
dont le maître d'ouvrage est public (`is_public_client`), à un ou plusieurs titulaires (voir plus bas).

- **Le plafond se contrôle en base, jamais dans le code applicatif** : `enregistrer_marche_subsequent(tenant,
  accord-cadre, ligne, id?)` prend un verrou de ligne sur l'accord-cadre, vérifie signature, fin et maximum,
  numérote (`max + 1` sous ce même verrou, pas `document_sequences`) et écrit dans la même transaction. Deux
  émissions simultanées ne franchissent donc pas le maximum (`tests/marchesSubsequents.test.ts`). Un
  subséquent résilié (`statut = 'resilie'`) ne consomme plus le plafond ; la fonction est réservée au rôle serveur.
- **Le montant d'un subséquent n'est jamais envoyé par le client** : `server/routes/marchesSubsequents.ts` le
  recalcule depuis les lignes (quantité x prix). Quand l'offre de l'accord-cadre est figée (`offre_snapshot.prix`),
  chaque ligne doit être un article du bordereau à un prix inférieur ou égal à celui du bordereau (`validerLignesCommande` : une
  remise en concurrence peut le faire baisser, jamais monter) ; une ligne hors bordereau est refusée, un subséquent ne crée pas de prix. Les postes ajoutés par l'entreprise ne sont pas
  commandables (absents de `offre_snapshot.prix`). Sans offre figée (accord-cadre saisi à la main), lignes libres.
- **Garde-fous des routes génériques** : `COLONNES_ACT` retire les nouvelles colonnes du POST/PUT générique de
  `marches_entreprises`, le PUT retire `montant_ht` d'un subséquent, le DELETE refuse un accord-cadre qui a des
  subséquents et un subséquent signé. Un accord-cadre n'est pas convertible s'il porte déjà des situations ; son
  maximum ne descend pas sous l'émis. Un accord-cadre doit être signé avant toute émission (dialogue de signature
  papier ou électronique, mêmes routes `/signature` que les marchés de l'ACT).
- **Logique pure** `src/lib/accordCadre.ts` (testée) : consommation (`sans_plafond`, `normal`, `proche` à 80 %,
  `atteint`, `depasse`), `verifierEmission`, `validerLignesCommande`, `articlesDuBordereau`, `libelleMarche`
  (« AC lot 02 », « MS n°3 »). Elle sert à l'aperçu à l'écran ; l'autorité reste la base.
- **Écran** : `AccordCadrePanel` (jauge `role="progressbar"`, signature, liste des subséquents), `AccordCadreDialog`
  (conditions), `SubsequentDialog` (lignes composées depuis le bordereau, total et plafond en direct),
  branchés dans `SituationsTravaux.tsx`. Chaque subséquent a aussi son bloc de marché avec ses situations. Le total
  « marchés » de l'onglet RDT exclut le montant de l'accord-cadre lui-même (le subséquent le porte déjà). Textes :
  `accord_cadre_*` (fr et en).
- **PDF** `src/lib/marcheSubsequentPdf.ts` (rendu partagé navigateur et Node, sur les briques de
  `certificatPaiementPdf.ts`) : lignes, totaux, situation du plafond, signatures du titulaire et du pouvoir
  adjudicateur ; téléchargement par `marcheSubsequentExport.ts`. Pas encore joint à une facture Chorus Pro.
- **Ordres de service** : un OS ne vise jamais un accord-cadre (400 à la création comme à la modification) ; les
  sélecteurs de marché n'offrent que les marchés exécutables et préfixent « MS n°N ».
- **Alertes** (`server/agentAlerts.ts`, aucune migration) : `accord_cadre_plafond` (80 %, atteint, dépassé ; seuil
  fixe, la clé d'alerte porte le statut pour que « proche » se referme quand « atteint » s'ouvre) et
  `accord_cadre_echeance` (fin dans 90 jours par défaut, réglable ; seulement s'il reste un minimum à atteindre
  ou du crédit à engager ; reste signalée 90 jours après la fin si le minimum n'est pas atteint). Les accords-cadres non
  signés, résiliés ou d'une affaire terminée sont ignorés.
- **Plusieurs titulaires** (`supabase/migrate_marches_subsequents_multi_titulaires.sql`) : un accord-cadre multi-attributaires
  reste un ensemble de lignes `accord_cadre`, UNE PAR TITULAIRE (son bordereau figé, sa signature, ses subséquents). Une
  ligne « de tête » porte les conditions communes ; les autres pointent sur elle par `accord_cadre_groupe_id` et n'ont aucune
  condition propre (409 si on tente de les régler). `POST .../accord-cadre` avec `groupe_avec: <tête>` fait rejoindre un marché
  ordinaire du même projet. `enregistrer_marche_subsequent` verrouille la tête PUIS le titulaire (même ordre partout, pas
  d'interblocage), cumule et numérote sur TOUT le groupe : le plafond est partagé. La tête ne se défait pas tant que des
  titulaires lui sont rattachés. `GET .../subsequents` rend `tete`, `titulaires`, tous les subséquents du groupe.
- **Remise en concurrence** (`accord_cadre_consultations`, `server/routes/accordCadreConsultations.ts`,
  `ConsultationsSection.tsx`, au moins deux titulaires) : lignes à commander (articles du bordereau + quantités), offre par titulaire
  (`prix` par article, jamais au-dessus du bordereau du titulaire, `verifierOffre`), classement du moins-disant (`classerOffres`,
  offres complètes seulement). `POST .../attribuer` réserve la consultation (`en_cours` -> `attribuee`, mise à jour
  conditionnelle), émet le subséquent sous le titulaire retenu AUX PRIX DE SON OFFRE par la même `executerEmission` (donc le même
  verrou et les mêmes refus, plafond compris) et rend la consultation à `en_cours` si l'émission échoue. Retenir une offre qui n'est
  pas la moins-disante exige un motif. Une consultation attribuée ne se supprime pas. Instance non migrée : lecture vide, 503 à l'écriture.
- **Alertes** : un groupe compte pour UN accord-cadre (plafond de la tête, subséquents de tous les titulaires). Le cycle d'alertes
  est hebdomadaire (`AGENT_ALERTS_INTERVAL_HOURS`) ; pas de carte de tableau de bord, le blocage à l'émission reste immédiat.
- **Agents et MCP** : `manage_accord_cadre` (`businessTools.ts`, scope `marches_entreprises`) : `list`, `emit` (confirmation en
  deux temps avec montant et reste disponible), et la remise en concurrence (`consult_list|create|offers|award|abandon`, attribution
  et abandon confirmés). Il ne crée pas l'accord-cadre ni ses conditions et ne signe rien : cela reste à l'écran.
- **Chorus Pro et SuperPDP** : la pièce jointe d'une facture cite l'accord-cadre d'un subséquent (`mentionMarche`).
- **Pas encore fait** : libellé propre aux bons de commande.

### Espace public de dépôt des offres (ACT)

Une entreprise consultée reçoit un **lien personnel, sans compte** (`/depot/<jeton>`,
`src/pages/DepotOffres.tsx`, route publique hors `ProtectedLayout`) et y remet son offre
par **saisie en ligne** (montant de base HT, options, variantes, délai, observations),
**bordereau chiffré** (Excel ou ODS) ou **fichiers**. Génération du lien, panneau
« Dépôts des entreprises » (phase Offres) et réglages vivent dans le module ACT
(`src/components/act/{InviterDepotDialog,DepotsRecusPanel,DepotSettingsDialog,DepotIntegration}.tsx`,
`src/hooks/useConsultationDepot.ts`). Migration : `supabase/migrate_consultation_depots.sql`
(`consultation_depot_settings`, `consultation_depot_invites`, `consultation_depots`, hors
`SYNC_TABLES`).

**Trois conditions, revérifiées à CHAQUE appel** (`server/consultationDepot/eligibility.ts`,
côté cabinet comme côté portail) : plan **Enterprise** ; **marché privé** (`is_public_client`
faux : en marché public la remise dématérialisée passe par un profil acheteur, que ce portail
ne remplace pas) ; **espace de stockage externe actif** (`external_storage_connections`).
Perdre l'une d'elles ferme les liens déjà émis (503 neutre côté entreprise, qui ne
voit jamais ni le plan ni la configuration) sans rien supprimer ; les remises déjà reçues
restent lisibles par le cabinet.

- **Aucun octet d'offre dans Supabase.** `server/consultationDepot/storeDepotFile.ts` reprend la
  mécanique de `storeBusinessFile` SANS sa branche Supabase : un drive en panne fait échouer
  le dépôt en 502, jamais de repli. Rangement :
  `<racine>/<code> - <affaire>/Consultation/<Lot xx - titre | Tous lots>/<entreprise>/<AAAA-MM-JJ> - <fichier>`.
  Le fichier transite par le serveur (mémoire, `multer`), le fournisseur n'acceptant qu'un `Buffer`.
- **Formats** : PDF, Word (`.docx`), Excel (`.xlsx`), ODS et ODT, **rien d'autre** (ni DWG ni DXF,
  ni formats à macros, ni anciens binaires). Plafonds : 25 Mo par fichier, 100 Mo et 10 fichiers par
  dépôt (`src/lib/consultationDepot.ts`, partagé écran / serveur). Le contrôle se fait sur les
  **octets** (`fileRules.ts` : en-tête PDF, annuaire central des archives ZIP, entrées de macros
  ou de programmes refusées, type ODF vérifié), jamais sur le nom ni le type MIME annoncés.
- **Le jeton n'existe que dans le lien** : la base ne garde que son SHA-256 (`tokens.ts`). Il n'est
  donc rendu qu'une fois ; « renvoyer le lien » en crée un nouveau et révoque l'ancien. Un jeton
  mal formé, inconnu, révoqué ou expiré donne la même réponse 404. Expiration = date limite + 14 jours
  (90 jours sans date limite), repoussée si la date limite recule, jamais raccourcie.
- **Un dépôt n'écrase jamais l'offre.** Il arrive dans `consultation_depots` (zone d'attente,
  versionnée, horodatée, empreinte SHA-256, accusé de réception par e-mail) et l'architecte
  l'intègre explicitement, avec aperçu de l'effet : saisie → `src/lib/consultationDepotApply.ts`
  (testé : base dans `Offre.montant_base`, options et variantes en lignes de négociation au prix
  d'ouverture, tours intacts) ; bordereau → l'import existant du DPGF / BPU (`OffreImportDialog`,
  `fichierInitial`) ; acte d'engagement → la lecture existante du formulaire (`RecapActe`,
  `lireActeDepuisBuffer`). L'intégration se fait dans le navigateur (le document de la consultation
  est enregistré par `ACTModule`) ; la route (`POST /api/depots/:id/integrer`) ne fait que constater.
- **Hors délai = signalement, jamais refus.** `hors_delai` est posé à la réception ; le retrait par
  l'entreprise n'est possible qu'avant la date limite.
- **Plis scellés (option)** : tant que `sealed` et que la date limite n'est pas atteinte
  (`plisScelles`), le cabinet voit qu'une remise existe sans nom de fichier ni contenu ; ouvrir,
  intégrer, rejeter et analyser répondent 423 ; le scellement ne peut plus être levé ni la date
  avancée. Un scellement exige une date limite.
- **Statut « Offre déposée »** (`actEntreprises.ts`, `depot_recu_le`) se déduit des remises à
  traiter et n'est JAMAIS enregistré dans la consultation (le tableau lit une vue, `patch` repart
  de la source).
- **Montants probables** (`POST /api/depots/:id/analyser`, `src/lib/depotMontants.ts`,
  `server/consultationDepot/analyse.ts`) : lecture du texte (PDF, Word, tableur, ODT) et repérage
  par règles des montants en euros, sans modèle ni coût ni OCR ; le texte n'est pas tronqué (le total
  d'un devis est à la fin). Une SUGGESTION confirmée d'un clic, jamais appliquée seule.
- **Limiteurs** (`rateLimit.ts`) : `depotReadLimiter` / `depotWriteLimiter` par IP, réglables par
  `DEPOT_READ_LIMIT` / `DEPOT_WRITE_LIMIT` (les tests les relèvent).
- **Pièces du DCE** : le portail propose d'office à chaque entreprise les pièces de
  `consultation.dce_documents` qui la concernent (`tous_lots` ou l'un de SES lots, même règle
  `piecesDeEntreprise` que le message d'envoi du DCE) avec les fichiers de l'affaire rattachés
  (`GET /api/public/depot/:token`, champ `dce`, section « Dossier de consultation (DCE) » de la page).
  Aucune migration, rien à cocher. Le téléchargement (`.../pieces/:docId`) n'accepte qu'un fichier de
  ces pièces ou une pièce complémentaire cochée dans les réglages (`published_document_ids`, visible
  par toutes les entreprises) : un fichier du DCE d'un autre lot est refusé (404).

### Documents du marché (ACT, phase Critères)

Sous les critères et pièces administratives, `MarcheDocumentsPanel.tsx` génère le
règlement de consultation, le CCAP (marché privé, renvoi à la norme NF P 03-001
et non au sigle CCAG, valeurs par défaut de la norme) et l'acte d'engagement.
Réglages dans `consultation.marche` (jsonb, sans migration), contenu pur dans
`src/lib/actMarche.ts`, rendu PDF/Word dans `actMarcheExport.ts`. Un champ vide
reste en pointillés, jamais inventé.

**L'acte d'engagement est un formulaire PDF unique** (`actEngagementForm.ts`,
champs `ae_*` stables : ne pas les renommer sans changer `AE_FORM_VERSION`),
rempli par chaque entreprise. `champsDepuisPdf` (`actEngagementImport.ts`) le
relit, `lireActeFormulaire` l'interprète en signalant les anomalies sans les
corriger, `appliquerActeAuxOffres` (`actEngagementApply.ts`) le verse dans la
consultation : entreprise rapprochée par SIRET (fiche contact) puis par nom,
sinon créée ; offre du couple lot x entreprise mise à jour sans doublon, notes,
conformité et négociations intactes. L'aperçu de l'effet précède l'import.

### Marchés de travaux constitués depuis l'ACT (phase « Marchés »)

Dernière étape d'ACT, après l'attribution : `MarchesPhase.tsx` liste un marché par lot attribué
(`consultation.attributions`) et constitue la ligne `marches_entreprises` correspondante
(`supabase/migrate_marches_act.sql` : `act_lot_id`, `act_entreprise_id`, `contact_id`, `offre_snapshot`,
`statut_signature` `a_constituer | a_signer | signe`, `mode_signature`, `date_signature`,
`acte_signe_document_id`). La création manuelle d'un marché (formulaire d'OS, RDT) reste possible, sans
consultation : ces lignes n'ont pas d'`act_lot_id` et n'apparaissent pas dans la phase.

- **Constitution idempotente** : `POST /api/projects/:projectId/marches-act` (`server/routes/marchesEntreprises.ts`,
  `tests/marchesAct.test.ts`). Un second appel met à jour un marché non signé, ne duplique jamais (index unique
  TOTAL `(project_id, act_lot_id)`, les NULL des marchés manuels restent libres) et **ne touche jamais un marché
  signé** : si l'attribution change ensuite, l'écran signale l'écart sans rien réécrire. Le POST/PUT générique
  retire ces colonnes du corps (`sansColonnesAct`) : seules les routes de l'ACT les écrivent.
- **Quatre pièces, chacune dans son fichier** (`src/lib/marcheAct.ts`, pur et testé). Le CCAP est UN SEUL pour
  l'opération, jamais par entreprise (`construireCCAP`, réglages de la phase « Critères »). Le CCTP est l'extrait
  du lot (sans prix). Le DPGF est celui du lot aux prix de l'offre retenue, **figés** dans `offre_snapshot` à la
  constitution : un DPGF modifié ensuite ne change pas le marché ; un article absent de l'offre vaut zéro (compté,
  jamais complété par l'estimation du cabinet), les postes ajoutés par l'entreprise sont rangés sous un chapitre
  dédié. L'acte d'engagement est le formulaire PDF existant, prérempli (`valeursActe` : rien d'inventé, un champ
  inconnu reste vide). « Les 4 pièces » livre une archive de quatre fichiers séparés.
- **Signature, deux modes** : papier (dépôt du scan) ou électronique (dépôt du PDF signé). Aucun service de
  signature électronique n'est connecté : le mode est enregistré avec le document déposé (catégorie « Marchés »,
  phase ACT). `POST /api/marches-entreprises/:id/signature` puis `.../signature/rouvrir` ; la date, le mode et le
  document sont validés par le serveur.

### Qualifications des entreprises et recherche d'entreprises

`contact_qualifications` (`supabase/migrate_contact_qualifications.sql`) : une ligne par qualification
détenue par une entreprise (Qualibat, Qualifelec, Qualit'EnR, Certibat, RGE, autre), clé d'unicité
(contact, organisme, référence), `source` (`saisie`, `ademe`, `api_entreprise`) et `verified_at`/
`verified_by` pour le contrôle du certificat. Hors `SYNC_TABLES` : rien à propager vers un poste local.
La logique pure (statuts, résumé, SIRET, validation) est dans `src/lib/qualifications.ts`, partagée par
le serveur et l'écran.

**Qualibat n'est PAS interrogé.** Son API (API Entreprise, `certifications_batiment`) est réservée aux
administrations (habilitation DataPass que le cabinet n'a pas), se consulte par SIRET et n'offre aucune
recherche ; l'annuaire de Qualibat n'a pas d'API ouverte et ne doit pas être aspiré. D'où trois sources,
aucune ne valant verdict :

- **Saisie** par l'architecte sur la fiche contact (`ContactQualifications.tsx`), avec « Vérifier sur
  Qualibat » (copie le SIRET, ouvre `QUALIBAT_ANNUAIRE_URL`) puis le bouclier « contrôlée ». **Modifier
  organisme, référence ou dates retire le contrôle** : l'attestation portait sur ce qui était affiché.
- **Import RGE** (`server/rgeLookup.ts`, `POST /api/contacts/:id/qualifications/rge-sync`) depuis les
  données ouvertes de l'ADEME. Il ne couvre QUE les qualifications RGE : une réponse vide veut dire « pas
  de qualification RGE connue », jamais « non qualifiée » (l'écran le dit). Rejouable, jamais d'écrasement
  d'une ligne saisie à la main (seules les lignes `source = 'ademe'` sont mises à jour), cache de 6 h,
  nom du jeu de données surchargeable par `ADEME_RGE_DATASET` (non vérifié contre le service réel).
- **API Entreprise** : prévue dans le modèle (`source = 'api_entreprise'`), non branchée. TODO dans
  ROADMAP.md : demander à Qualibat un accès.

**Statut** (`statutQualification`) : valide, expire bientôt (60 jours), expirée, sans échéance. L'entreprise
est jugée sur sa MEILLEURE qualification (`resumeQualifications`) : une seule en cours de validité suffit
pour attribuer un lot. Pastille dans le tableau ACT (`QualificationBadge`, une lecture groupée
`GET /api/qualifications` par `useQualifications`, jamais une requête par ligne) et règle d'alerte
`qualification_expiree` (`agentAlerts.ts`, délai réglable, 30 jours par défaut) limitée aux entreprises
consultées sur une affaire en cours (`act_data.consultation.entreprises[].contact_id`).

**Recherche d'entreprises** (`GET /api/entreprises/search`, `server/routes/entreprisesSearch.ts`,
`EntrepriseSearchDialog.tsx`, bouton « Rechercher » du tableau ACT) : API publique « Recherche
d'entreprises » (SIRENE) interrogée par le serveur, paramètres validés avant d'être transmis, 30 requêtes
par minute et par personne. Chaque résultat est enrichi, chaque enrichissement étant facultatif (un échec
laisse la liste intacte) : qualifications RGE, libellé NAF (`ref_naf`), fiche contact existante du cabinet
(SIRET normalisé). Ajouter une entreprise crée la fiche (catégorie Entreprise, SIRET, TVA déduite du
SIREN, adresse) puis rejoue l'import RGE ; la consultation n'est modifiée que par « Ajouter à la
consultation », avec un lot facultatif.

### Attestation d'assurance et RGE exigé par un lot

`supabase/migrate_assurance_rge_lots.sql` ajoute l'organisme `assurance` aux qualifications d'une entreprise (`contact_qualifications`, qui porte déjà début et fin de validité, saisie depuis la fiche contact comme Qualibat) et `project_lots.rge_required` (faux par défaut, case « RGE exigé » de `LotsManager`, `PUT /api/lots/:id`). **Une attestation d'assurance n'est pas une qualification professionnelle** : `resumeQualifications` l'ignore, sinon une assurance valide rendrait « valide » une entreprise dont le Qualibat a expiré (pastille de l'ACT, alerte `qualification_expiree`). Lecture dédiée : `resumeAssurance`, et `resumeRge` pour le RGE (`estQualificationRge` : organisme RGE, Qualit'EnR, Certibat, ou « RGE » cité dans le libellé, les domaines ou la référence). Sans date de fin saisie, la validité est inconnue et rien n'est signalé ; une attestation saisie sur la fiche vaut présence pour la règle « sans attestation ». Pour un lot RGE, l'absence de toute qualification RGE EST signalée (c'est le lot qui l'exige) ; l'entreprise vient de la fiche du lot, à défaut du marché du même numéro (`lot_numero`, « 02 » = « 2 »). Instance non migrée : la lecture des lots retombe sur les colonnes d'origine, la règle RGE se tait.

**Valeur de départ de « RGE exigé »** (`rgeExigeParDefaut`, `src/lib/rgeLots.ts`, testé) : coché à la création d'un lot dont le titre cite isolation ou chauffage (hors isolation phonique ou acoustique), par l'application d'un modèle de projet (`TemplateLot.rge_required` l'emporte quand le modèle le porte) et par `POST /api/projects/:id/lots` (sauf valeur envoyée). Même valeur de départ pour les lots importés du CCTP (nouveaux lots par `POST`, lots existants renommés par `PUT /api/lots/:id` : un lot qui passe d'un titre sans RGE à « isolation » ou « chauffage » est coché, une case décochée à la main n'est jamais recochée tant que le titre reste dans la même famille) et pour la liste de lots d'une affaire (`POST` et `PUT /api/projects/:id`, lignes NOUVELLES seulement : `replaceList` reçoit un `forNew`). Toujours modifiable ; un lot existant n'est jamais requalifié autrement que par un renommage. Sans la migration, la création et le renommage retombent sur les colonnes d'origine (`replaceList` a déjà supprimé la liste : il réessaie sans la colonne plutôt que de perdre les lots).
