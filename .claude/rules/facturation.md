---
paths:
  - "server/routes/invoices*.ts"
  - "server/invoice*.ts"
  - "server/zoho*.ts"
  - "server/routes/zoho*.ts"
  - "server/routes/odoo.ts"
  - "server/routes/notesHonoraires*.ts"
  - "server/documentSequence.ts"
  - "src/pages/Invoices.tsx"
  - "src/components/InvoiceGenerator.tsx"
  - "src/lib/noteHonoraires*.ts"
  - "src/lib/invoice*.ts"
  - "src/lib/facturX.ts"
  - "src/lib/profitability.ts"
  - "src/pages/Contrats.tsx"
  - "src/pages/ProjectDetail.tsx"
---

# Facturation, honoraires et connecteurs comptables

> Règles extraites du CLAUDE.md racine, sans modification de contenu. Chargées quand Claude lit un fichier correspondant aux chemins ci-dessus.

### Numérotation des factures et connecteurs comptables (Zoho / Odoo)

Deux modes, jamais mélangés sur une même facture :

| | Autonome | Synchronisé |
|---|---|---|
| Numérotation | Locale (`getNextDocNumber`, PREFIX-ANNÉE-SEQ) | Attribuée par le connecteur (Zoho Invoice, Zoho Books, Odoo) |
| Choisi par | Rien à faire (défaut) | `settings.accounting_sync_provider` |
| Quand | Aucun connecteur actif, ou choisi puis déconnecté | Un connecteur est choisi ET connecté |

`getActiveAccountingProvider()` (`server/invoiceAccountingSync.ts`) décide lequel
s'applique à CHAQUE création : `accounting_sync_provider` seul ne suffit pas, il
faut aussi que le jeton/la clé du connecteur soit encore présent en base — un
connecteur choisi puis déconnecté retombe en mode autonome plutôt que de
laisser toute nouvelle facture sans numéro indéfiniment.

**En mode synchronisé, `POST /api/invoices` n'invente jamais de numéro** — ni
localement, ni depuis un `invoice_number` fourni par le client (qui gagnait
auparavant sans condition : `invoice_number || getNextDocNumber(...)`). La
facture est créée en brouillon, sans numéro, puis `syncInvoiceToAccounting()`
pousse son contenu au connecteur et ne renseigne `invoice_number` qu'une fois
celui-ci confirmé — jamais avant. Un échec (connecteur injoignable, quota)
laisse la facture sans numéro plutôt que d'improviser une valeur locale ;
`POST /api/invoices/:id/sync-retry` rejoue l'envoi.

**Idempotence.** Chaque paire (facture locale, connecteur) a un enregistrement
dans `invoice_accounting_sync` (`local_invoice_id`, `provider`,
`external_invoice_id`, `invoice_number`, `sync_status`, `last_synced_at`),
créé par un `upsert(..., { onConflict: 'local_invoice_id,provider' })` — un
retry ne duplique jamais cet enregistrement. Ça ne suffit pas à empêcher un
doublon CÔTÉ CONNECTEUR si l'appel réseau a réussi mais que la réponse s'est
perdue : chaque fonction de poussée (`pushInvoiceToZohoInvoice`/`Books`/`Odoo`,
`server/routes/{zohoInvoice,zohoBooks,odoo}.ts`) recherche donc d'abord une
facture déjà marquée avec sa propre clé d'idempotence (`reference_number` chez
Zoho, `ref` chez Odoo, préfixé `archioffice:`) avant d'en créer une — un retry
après coupure réseau retrouve et adopte la facture déjà créée au lieu d'en
produire une seconde.

**Un numéro confirmé par le connecteur est gelé**, même si la facture est
encore au statut local `Draft` (fraîchement synchronisée, pas encore envoyée
au client) : `PUT /api/invoices/:id` refuse toute modification du contenu
légal dès qu'une ligne `invoice_accounting_sync.sync_status = 'synced'`
existe pour cette facture, en plus du verrou déjà existant sur le statut
`!= 'Draft'`.

**Le verrou structurel reste la base**, pas le code applicatif : un index
unique partiel `(tenant_id, invoice_number) WHERE invoice_number IS NOT NULL`
(`supabase/migrate_accounting_sync.sql`) empêche deux factures du même
cabinet de porter le même numéro, quelle que soit la cause (course locale,
numéro fourni par un client, import).

**Le numéro local vient d'une séquence atomique, plus d'un comptage.** `getNextDocNumber`
(devis, factures, notes d'honoraires) et `getNextAffaireInvoiceNumber` (référence
`CODE-ACO-NN` d'un acompte) appellent `nextDocumentSequence()` (`server/documentSequence.ts`),
donc la fonction SQL `next_document_number(cabinet, série)`
(`supabase/migrate_atomic_document_numbering.sql`) : un `UPDATE ... RETURNING` sur
`document_sequences`, sous verrou de ligne Postgres. L'ancien « nombre de lignes + 1 » donnait le
même numéro à deux créations simultanées (trois notes d'honoraires d'un cabinet portent déjà
« NH-01 » en production). Séries : `invoice`, `proposal`, `note_honoraires`, `acompte:<projet>`.
Quatre règles à garder :

- **Remise à zéro chaque année** : la clé d'une séquence est (cabinet, série, année) ; la
  numérotation repart de 001 au 1er janvier. Les références d'acompte d'une affaire
  (`acompte:<projet>`) ignorent l'année (année 0).
- **Amorçage sur l'existant**, à la première demande d'une série pour une année : le plus grand
  suffixe d'un numéro de la forme `…-AAAA-NNN` de CETTE année (001 s'il n'y en a pas ; pour un
  acompte, le nombre d'acomptes déjà émis sur l'affaire). Une référence saisie à la
  main (« 2626 », « NH-01 ») n'est volontairement pas lue comme un suffixe, sinon elle ferait sauter
  la numérotation. Un numéro réservé par une création qui échoue ensuite n'est pas rendu : la suite
  peut avoir un trou, jamais un doublon.
- **Repli sans la migration** (poste Electron, hébergement en retard) : seule l'absence de la
  fonction (`PGRST202`, `42883`) ramène à l'ancien calcul ; toute autre erreur est remontée, jamais
  remplacée par un numéro approximatif.
- **Fonctions réservées au rôle serveur** (`REVOKE` pour `PUBLIC`, `anon`, `authenticated`) : un
  compte connecté ne peut pas faire avancer la séquence d'un autre cabinet par l'API REST.

Tests : `tests/documentSequences.test.ts` (faux Supabase avec latence d'écriture, qui donne des
doublons avec l'ancien calcul) et `tests/documentSequences.pg.test.ts` (vrai Postgres, vraies
connexions parallèles, exécuté par la CI). Les index uniques `(tenant_id, numero)` des devis et des
notes d'honoraires ne sont PAS posés : des doublons existent déjà en production et feraient échouer
la migration.

### Contact d'envoi d'une facture, mentions légales, lignes

Le Maître d'Ouvrage d'une facture rattachée à une affaire est celui de l'affaire (l'éditeur ne le laisse choisir que sans affaire) ; `src/lib/invoiceLegalMentions.ts` (testé) signale les mentions de l'acheteur absentes de sa fiche (nom, adresse complète, SIRET à 14 chiffres). `invoices.billing_contact_id` (`supabase/migrate_invoice_billing_contact.sql`) désigne un autre destinataire (comptabilité, finances) : modifiable même sur une facture envoyée, écrit à part de l'UPDATE principal (instance non migrée tolérée), proposé en premier dans la fenêtre d'envoi. **Les lignes (`invoice_items`) reçoivent toujours un nouvel UUID côté serveur** : l'éditeur envoyait l'id « 1 » en dur et la clé primaire est globale (`invoice_items_pkey`). L'export PDF de l'éditeur utilise `html2canvas-pro`, car Tailwind 4 écrit ses couleurs en oklch() que `html2canvas` ne lit pas. Suppression d'une affaire : réservée aux administrateurs, dans Réglages (`DeleteProjectCard`) ; la fiche et la liste n'offrent que « Archiver » (plan d'actions de l'onglet Infos).

### Délai de paiement et date d'échéance

Une facture sans date d'échéance explicite (typiquement la facture brouillon
générée depuis une note d'honoraires, `POST /api/notes_honoraires/:id/
facture`) était insérée avec `due_date: null` — affiché à l'écran comme
« 01/01/1970 » (`new Date(null)` vaut l'epoch, que `toLocaleDateString` formate
sans se plaindre plutôt que d'échouer).

`settings.invoice_payment_terms_days` (`supabase/migrate_invoice_payment_terms.sql`,
réglable depuis `/settings` → Cabinet, « Facturation — Délai de paiement »,
NULL valant 30 jours) fixe désormais le nombre de jours ajoutés à la date
d'émission pour calculer l'échéance chaque fois qu'elle n'est pas fournie
explicitement — `server/invoiceDueDate.ts::computeInvoiceDueDate()`, appelé
par `POST /api/invoices` et `POST /api/notes_honoraires/:id/facture`. Une
échéance explicitement fournie par l'appelant continue de gagner : ce réglage
ne fait que combler l'absence, jamais l'écraser.

**Se synchronise avec Zoho et Odoo sans code supplémentaire.** Les trois
connecteurs (`pushInvoiceToZohoInvoice`/`Books`, `pushInvoiceToOdoo`) lisent
déjà `invoices.due_date` de la ligne locale au moment du push — l'échéance
calculée à la création part donc avec la facture dès le premier envoi, sans
notion de délai de paiement à répliquer côté connecteur.

Les écrans qui affichaient `new Date(invoice.due_date).toLocaleDateString()`
sans garde (`Invoices.tsx`, `InvoiceGenerator.tsx`) sont corrigés pour rendre
« --- » plutôt que l'epoch sur une facture antérieure à ce changement, dont
`due_date` reste `null` tant qu'elle n'est pas rouverte et resauvegardée. Le
formulaire de création de facture et `InvoiceGenerator` préremplissent
désormais l'échéance par défaut à partir de ce même réglage plutôt que 14 ou
30 jours codés en dur.

### Le Maître d'Ouvrage d'une facture (`invoices.client_id`)

Jusqu'ici `invoices` n'avait aucun lien vers `contacts` : le « client » d'une
facture se déduisait toujours de son projet (`project_id` → `projects` →
`client`), donc une facture sans projet — facture générale, ou importée d'un
connecteur comptable — n'avait aucune identité de Maître d'Ouvrage : ni nom,
ni SIRET, ni adresse, ni téléphone, alors qu'une facture française doit
porter ces mentions pour l'acheteur comme pour le vendeur (`seller_*` existe
déjà sur cette table). `invoices.client_id`
(`supabase/migrate_invoice_client_link.sql`, FK vers `contacts`) ferme ce
trou : rempli depuis `projects.client_id` à la création quand les deux
existent, toujours modifiable ensuite — même principe que `project_id` :
corriger le rattachement n'est pas modifier le contenu légal déjà envoyé,
et c'est exactement ce qui permet de corriger après coup un contact que le
connecteur a créé à la volée sans toutes ses mentions.

`server/invoiceClientContact.ts` centralise la résolution :

- **`resolveInvoiceClientId`** — `client_id` de la facture, sinon celui de
  son projet, sinon aucun. Lecture seule.
- **`loadInvoiceClientContact`** — la fiche complète du contact (nom, SIRET,
  TVA, adresse, téléphone, email), jointe par `GET /api/invoices/:id`
  uniquement (jamais la liste — voir « Pagination et fan-out sur les
  listes » plus haut) et exposée en lecture seule sous `invoice.client`.
- **`resolveOrCreateContactFromExternal`** — utilisée seulement au PULL
  Zoho (Invoice/Books) : retrouve un contact existant par email puis par nom
  exact, sinon en crée un avec les informations renvoyées par Zoho. Odoo
  n'en a pas besoin : sa propre synchro de contacts (`server/routes/
  odoo.ts`) pull déjà chaque `res.partner` dans `contacts` par `odoo_id`
  avant que les factures ne soient traitées dans le même appel.

**Push (ArchiOffice → connecteur), les trois connecteurs :**

`pushInvoiceToZohoInvoice`/`pushInvoiceToZohoBooks` (et l'envoi en masse des
deux routes `/sync`) recherchent désormais un contact Zoho par nom réel du
Maître d'Ouvrage (plus par nom de projet) et, faute de correspondance, en
créent un avec nom, email, téléphone et adresse de facturation — Zoho
Invoice/Books n'ayant pas de champ SIRET natif, celui-ci est écrit dans
`notes` (`SIRET : <valeur>`), relu au pull via une regex sur ce même
format. `pushInvoiceToOdoo` résout (ou pousse pour la première fois) le
`res.partner` du contact et pose enfin `partner_id` sur la facture — cette
colonne n'était jamais renseignée avant, qu'une facture soit créée à
l'unité ou par la synchro `/api/odoo/sync` : la ligne de vente Odoo n'avait
alors aucun acheteur, malgré une synchro de contacts déjà complète (SIRET
dans `ref`, TVA dans `vat`) tournant à côté sans être exploitée par les
factures.

**Pull (connecteur → ArchiOffice) :** un import Zoho sans correspondance
locale (`zohoInvoiceToLocalRow`) résout maintenant le client — un appel
`GET /contacts/:id` de plus, mais seulement pour un client réellement
nouveau, jamais par facture déjà connue. Côté Odoo, `client_id` se déduit
d'une recherche `contacts.odoo_id = partner_id` : ne JAMAIS écraser un
`client_id` existant avec `null` quand cette recherche ne trouve rien (une
facture déjà rattachée à la main ne doit pas perdre son contact au pull
suivant) — seule une correspondance trouvée peut mettre à jour la ligne.

**Factur-X / EN16931 (`src/lib/facturX.ts`)** portait déjà `FacturXParty`
avec `siret`/`vatNumber`/`email`, mais seul le vendeur les utilisait : le
XML CII n'émettait ni `SpecifiedLegalOrganization` ni
`SpecifiedTaxRegistration` pour l'acheteur, et `EnInvoiceJson.buyer` n'avait
même pas de type pour les porter — une facture envoyée à SuperPDP (`server/
routes/superpdp.ts`) n'a donc jamais transmis le SIRET/l'adresse/la TVA du
Maître d'Ouvrage, quelle que soit la donnée disponible côté ArchiOffice.
Les deux lisent maintenant `invoice.client_id` via `loadInvoiceClientContact`
(`InvoiceGenerator.tsx` pour l'export local, `buildEnInvoice` pour l'envoi
SuperPDP) ; Chorus Pro (B2G, identifié par SIRET seul) gagne le même repli
en plus de celui déjà existant sur `projects.client_siret`.

### Groupement vs agence dans les notes d'honoraires

Une note d'honoraires (`src/pages/ProjectDetail.tsx`, section « Notes
d'honoraires » de la fiche projet) porte la ventilation par mission de TOUT
le groupement de maîtrise d'œuvre — agence, cotraitants, sous-traitants —
alors que la facture brouillon qu'elle génère (`POST /api/notes_honoraires/
:id/facture`) ne porte, elle, que la part de l'agence : les montants
cotraitants/sous-traitants restent hors comptabilité agence par
construction (voir le commentaire du schéma sur `cotraitants_facturation`/
`sous_traitants_facturation`). Le tableau de ventilation portait pourtant
une colonne « Agence » générique et aucun total d'ensemble, laissant croire
que la note se limitait à cette seule colonne.

Deux corrections dans le même tableau :

1. **Colonne « Groupement »**, avant la colonne agence : le total, par
   mission, de l'agence + tous les cotraitants + tous les sous-traitants —
   ce que la note facture réellement à l'ensemble de l'équipe. La colonne
   agence garde son propre total (celui qui alimente la facture brouillon)
   juste à côté, pour que les deux échelles restent visibles l'une contre
   l'autre plutôt que noyées dans le même total.
2. **« Agence » remplacé par le nom réel du cabinet**
   (`settings.agencyName`, déjà chargé par `useSettings()`) : la colonne
   nommée génériquement pouvait laisser croire à une entité distincte du
   cabinet plutôt qu'au cabinet lui-même.

**Noms de cotraitants/sous-traitants désormais dynamiques.** Chaque entrée
de `cotraitants_facturation`/`sous_traitants_facturation` fige un `nom` au
moment où la note est créée (`ct.contact_name || ct.specialty`, voir
`initNoteForm`) — un renommage ultérieur dans le contrat
(`ContactAutocomplete`, `Contrats.tsx`) ne se répercutait donc jamais dans
l'en-tête du tableau, y compris pour une note encore en cours d'édition ou
tout juste rouverte. Les en-têtes (`ctDisplayName`/`stDisplayName` dans
`ProjectDetail.tsx`, `liveName` dans `src/lib/noteHonorairesExport.ts` pour
l'export PDF) relisent désormais le nom courant du contrat par
`contact_id`, et ne retombent sur le `nom` figé que si l'intervenant a
depuis été retiré du contrat (pas de ligne à relire). Le calcul des
montants (bases, plafonds) continue, lui, de faire cette même résolution
par `contact_id` — seul l'affichage du nom manquait ce fil.

### Le contrat MOE fait foi pour les montants du projet

Trois changements qui tiennent au même principe : le contrat est la pièce, la
fiche projet n'en est qu'une lecture.

1. **Répartition par mission dans le contrat.** L'onglet Missions de la modale
   de contrat (`src/pages/Contrats.tsx`) n'est plus une liste de cases à cocher
   sur dix missions figées mais une répartition sur le modèle de celle des
   propositions (`FeeDistributionGrid`, `Proposals.tsx`) : missions renommables,
   supprimables (les missions de base comprises — le découpage MOP ne convient
   pas à un diagnostic ou à une AMO) et créables, groupées par catégorie avec
   un sous-total, et le montant HT déduit de la part appliquée au total des
   honoraires du contrat. `ContratMOEMission.category`
   (`'base' | 'exe' | 'complementaire'`, facultative, une mission sans
   catégorie étant rattachée aux missions de base) porte ce classement dans le
   jsonb `contrats_moe.missions_list` : **aucune migration SQL**, la colonne
   étant déjà du jsonb et `server/routes/contratsMoe.ts` persistant le corps de
   requête sans liste blanche de colonnes. Les deux préréglages visent
   désormais des CATÉGORIES et non plus une liste d'ids figée, qui ne décrivait
   plus le contenu réel d'un contrat dont les missions sont libres.
   `server/routes/proposals.ts` traduit au passage les catégories de la
   proposition acceptée (libellés d'affichage) vers ce vocabulaire fermé.
2. **Les chiffres de l'onglet HONOS ne se saisissent plus** dès qu'un contrat
   est lié à l'affaire (`src/pages/ProjectDetail.tsx`) : honoraires initiaux et
   coût travaux prévisionnel passent en lecture seule, avec un renvoi vers le
   contrat pour les corriger, et la synchronisation depuis le contrat devient
   **inconditionnelle** — elle ne se limitait jusqu'ici qu'aux champs restés
   vides côté projet, ce qui laissait une valeur saisie à la main diverger
   indéfiniment de la pièce contractuelle. Les avenants continuent de
   s'ajouter par-dessus (`honRevises`) sans toucher au montant initial, et
   les deux champs redeviennent saisissables si aucun contrat n'est lié.
3. **Taux d'honoraires à 10 décimales.** `step={0.1}` faisait refuser par la
   validation du navigateur un taux issu d'une fraction (9,166667 % pour 55/6) :
   `step="any"`, et `fmtPct()` affiche jusqu'à dix décimales sans jamais en
   forcer (un taux rond reste écrit « 12 % »).

**TVA par membre du groupement.** Tous les cotraitants ne sont pas assujettis
(micro-entreprise, franchise en base) : `ContratMembreTVA`
(`tva_applicable?`, `tva_rate?`), dont héritent `ContratCotraitant` et
`ContratSousTraitant`, porte donc le régime de chacun plutôt qu'un taux unique
au contrat. Absent vaut « assujetti au taux de droit commun » (20 %), le cas
courant, donc aucun contrat déjà enregistré ne change de comportement. Un
membre dé-assujetti garde son taux en base plutôt que de le perdre si
l'assujettissement est rétabli — c'est `tvaRateOf()` qui le neutralise à
l'affichage et dans le calcul du TTC.

**Cliquer un contrat ouvre l'affaire liée** (liste de `/contrats`), avec
`stopPropagation` sur la rangée d'actions de la carte : elles ne doivent pas
naviguer. Une carte sans `project_id` reste inerte (ni curseur, ni handler)
plutôt que de mener à une route `/projects/undefined`.

**Colonne « Groupement » en deux parties** dans la ventilation d'une note
d'honoraires : le pourcentage de la mission facturé par l'ensemble de l'équipe
dans cette note, puis son montant. L'agence et les cotraitants passent sous une
entête commune « Mandataire et cotraitants » (« Mandataire » seul s'il n'y a
pas de cotraitant) : ce sont les titulaires du marché de maîtrise d'œuvre, par
opposition aux sous-traitants regroupés à leur droite. L'export PDF
(`src/lib/noteHonorairesExport.ts`) rend le même pourcentage dans sa cellule
Groupement, au format « % · € » déjà utilisé par les colonnes d'intervenants,
plutôt qu'en ajoutant une colonne à un tableau déjà large.

### L'avancement se saisit une fois, au niveau du groupement

Le tableau de ventilation d'une note faisait saisir un avancement PAR
intervenant, et en déduisait le total du groupement par addition. C'était le
bon calcul pour personne : une mission s'avance pour toute l'équipe (« sur
cette note je facture 100 % de l'esquisse et 50 % de l'APS »), et ce qui
distingue les membres n'est pas leur avancement mais leur QUOTE-PART de ce
montant (l'agence 60 % de l'esquisse, un cotraitant 40 %).

Trois valeurs seulement sont désormais saisies, tout le reste en découle :

| Saisi | Où | Champ |
|---|---|---|
| Avancement de la mission pour tout le groupement | colonne Groupement | `NoteHonorairePhase.avancement_pct` sur `note.phases` |
| Quote-part d'un membre dans ce montant | colonne du membre | `NoteHonorairePhase.part_pct` (nouveau) |
| Montant réglé à un sous-traitant | colonne du sous-traitant | `montant_phase` |

`recalcNote()` (`src/pages/ProjectDetail.tsx`) recalcule TOUTE la note à chaque
frappe plutôt que la cellule touchée : changer l'avancement du groupement
déplace les montants de tous les membres de la ligne, et un montant de
sous-traitant déplace ceux de tous les membres aussi — un recalcul local serait
faux dans les deux cas.

**La sous-traitance sort de l'enveloppe de la mission, jamais en supplément**,
et c'est ce qui décide de tout le reste du calcul :

```
montant groupement (mission)  = base contractuelle × avancement_pct / 100   ← invariant
reste à partager              = montant groupement − TOUS les sous-traitants de la mission
part nette d'un membre        = reste à partager × part_pct / 100
montant facturé par un membre = sa part nette + ce qu'il reverse à SES sous-traitants
```

Trois conséquences, toutes voulues :

- **Le montant du groupement ne bouge pas** quand on saisit des sous-traitants :
  seul change qui l'encaisse. Le total du pied de tableau est donc la somme des
  montants de mission (base × avancement), **pas** la somme des colonnes — les
  additionner compterait deux fois ce qu'un payeur reverse.
- **Le membre qui règle un sous-traitant voit son montant AUGMENTER** de ce
  qu'il reverse (affiché « dont … ST »), et celui des autres baisser d'autant :
  c'est la seule façon que chacun touche réellement son pourcentage une fois la
  sous-traitance payée. Le contraire — déduire le sous-traitant de la part de
  son payeur — le faisait payer seul une prestation commune.
- **La somme des colonnes des MEMBRES vaut 100 % du montant de la mission**, les
  colonnes sous-traitants n'en étant que le détail. Seul un sous-traitant réglé
  en direct par le maître d'ouvrage (`payeur = 'moa'`) ne revient à aucun membre :
  il sort de l'enveloppe sans être refacturé par personne, et la somme des
  membres vaut alors le montant du groupement moins sa part.

Un sous-traitant est donc plafonné deux fois : par son montant global au contrat
(`cumulStTotal` + ses autres missions) et par l'enveloppe de la mission qu'il
ne peut pas dépasser.

**Tout cela repose sur l'identification du payeur, donc `payeurEffectif()` le
relit sur le CONTRAT** (par `contact_id`), exactement comme les noms
d'intervenants plus haut, et non depuis la valeur figée dans la note à sa
création : désigner ou changer le payeur dans le contrat doit se répercuter
immédiatement, y compris sur une note déjà ouverte. Il rend une clé canonique
(`'agence'`, `'moa'`, ou l'`id` du cotraitant payeur) et accepte aussi bien
l'`id` de contrat que le `contact_id` d'un cotraitant, qu'une note ancienne ou
un import peuvent porter. Un payeur désigné mais introuvable revient à l'agence
(le mandataire) : sans ce repli, le montant du sous-traitant sortait de
l'enveloppe de la mission **sans revenir à personne**, et les montants de TOUS
les membres baissaient — le symptôme exact qui a motivé ce correctif.
`recalcNote()` réécrit `payeur` avec cette valeur résolue, pour que la note
enregistrée, l'export PDF et la facture brouillon lisent la même imputation que
l'écran.

Le pourcentage réellement facturé par chaque membre (montant ÷ montant
groupement) s'affiche sous son montant dès qu'une ligne porte de la
sous-traitance : la quote-part saisie porte sur ce qui reste après
sous-traitance, donc le payeur facture un pourcentage plus élevé que sa part
contractuelle et les autres un plus faible — sans cette mention, la ligne
semblerait contredire le 50/50 du contrat sans dire pourquoi.

Deux conséquences à ne pas défaire :

1. **`groupementPhaseBase()` n'additionne plus les parts des cotraitants.**
   C'est `honRevises × pct de mission / 100` — les honoraires révisés étant le
   montant du contrat pour toute l'équipe (cf. section précédente), la part
   d'un cotraitant en est une FRACTION et l'y ajouter comptait deux fois le
   même argent. Les plafonds par intervenant (`agenceCap`/`ctCap`) disparaissent
   avec ce changement : une part est bornée par le montant groupement lui-même.
   Le plafond qui reste est en pourcentage (`cumulGroupementPct`, 100 % d'une
   mission toutes notes confondues) plus celui du montant global d'un
   sous-traitant (`stCap`).
2. **Une note enregistrée avant ce changement est migrée à l'ouverture**
   (`noteFormFromSaved`), jamais recalculée telle quelle : sans `part_pct`, un
   recalcul direct ramènerait tous ses montants à zéro. Les montants des membres
   sont repris tels quels et les valeurs saisissables déduites à l'envers — le
   reste à partager est la somme des membres moins ce qu'ils reversent, la
   quote-part d'un membre son montant facturé moins ce qu'il reverse, rapporté à
   ce reste, et l'avancement du groupement ce reste plus TOUS les sous-traitants
   (ceux réglés en direct par le maître d'ouvrage compris), rapporté à la base
   contractuelle. La note rouvre ainsi sur exactement les mêmes montants.
   Aucune migration SQL : `phases` est du jsonb.

Les parts d'une mission doivent totaliser 100 % ; l'écart est signalé sous le
montant groupement (« répartition : 80 % ») plutôt que redistribué d'office, et
un bouton « Répartir » remet la ligne sur la répartition du contrat
(`fee_pct` par cotraitant, le solde à l'agence) — qui sert aussi de valeur par
défaut à la création d'une note.

### Tableau de ventilation responsive et export PDF corrigé

Deux défauts distincts repérés sur le même tableau (« Ventilation par
mission » d'une note d'honoraires) : l'un dans l'écran, l'autre dans son
export PDF.

**Écran (`src/pages/ProjectDetail.tsx`).** Le tableau a désormais deux
colonnes par membre (% et €) au lieu d'une, et dépasse vite la largeur de
l'écran dès qu'il y a un cotraitant et plusieurs sous-traitants. `w-full` sur
la balise `<table>` devient `min-w-full` : le tableau garde sa largeur
naturelle sans jamais la plafonner à celle de son conteneur, pour que le
débordement se traduise par le défilement horizontal de
`overflow-x-auto` plutôt que par des colonnes tassées. Le bouton
« Répartir » de la colonne Mission (sticky, donc de largeur fixe pendant le
défilement) devient une icône (`IconRefresh`) plutôt qu'un libellé texte :
chaque caractère de moins sur cette colonne laisse une part de plus aux
colonnes financières sur un écran étroit.

**Export PDF (`src/lib/noteHonorairesExport.ts`).** Deux bugs, une seule
cause commune :

1. **Chevauchement du libellé et de la valeur** sur la page de garde (ex. :
   « Coût prévisionnel des travaux HT : » par-dessus « 190 262,00 € ») — la
   colonne des valeurs démarrait à un x fixe (60 mm) sans rapport avec la
   largeur réelle du libellé le plus long (~52 mm à 9 pt gras, pour 46 mm
   disponibles). La position de cette colonne est désormais dérivée du
   libellé le plus large RÉELLEMENT affiché parmi les champs de la note
   (`champs.filter(([, v]) => v)`) — un projet sans coût prévisionnel
   n'affiche pas cette ligne et ne réserve donc pas sa place.
2. **Un « / » à la place de l'espace des milliers**, partout où un montant
   est affiché (page de garde et annexe), qui donnait par endroits
   l'impression d'un texte tronqué (« 100% · 4/896 » au lieu de
   « 100 % · 4 896,44 € »). Cause : `Intl.NumberFormat('fr-FR', …)` sépare
   les milliers par une espace fine insécable (U+202F) que les polices
   standard de jsPDF (Helvetica/WinAnsi) ne savent pas placer — vérifié sur
   le flux PDF généré, l'opérateur `Tj` porte littéralement le caractère
   "/" à la place de cette espace. `fmt()` la remplace (ainsi que l'espace
   insécable classique, U+00A0, par précaution) par une espace normale,
   un caractère WinAnsi ordinaire correctement mesuré et rendu.

### Chaque ligne facturée devient un article dans Zoho

`server/zohoSync.ts::zohoLineItems()` ne construisait que des lignes libres
sur la facture Zoho (`name`/`rate`/`quantity`), jamais rattachées au
catalogue d'articles (Items) de Zoho : une ligne facturée n'apparaissait
donc nulle part en dehors de CETTE facture, et deux factures portant la
même prestation ne se retrouvaient jamais reliées à un article commun.

**`zohoItemIdentity(lineDescription, affaire)`** (pure, `zohoSync.ts`) décide
du nom et de la description de l'article correspondant à une ligne :

- Le **numéro et le nom d'affaire** vont dans le **nom** de l'article
  (`"Honoraires ESQ — 26014 Villa Martin"`), pas seulement dans sa
  description : Zoho impose un nom d'article unique par organisation, et
  c'est ce nom qui doit rendre l'affaire repérable d'un coup d'œil dans la
  liste des articles — pas seulement en ouvrant la fiche. Sans le numéro/nom
  d'affaire dans le nom, deux affaires portant la même ligne générique
  (« Honoraires ») auraient sinon partagé le même article, et donc le même
  historique de facturation.
- **L'adresse de l'affaire** va dans la **description** de l'article — une
  information complémentaire, pas un repère d'identification.
- Une facture sans affaire (facture générale, ou antérieure à
  `invoices.client_id`) garde le seul intitulé de la ligne, comme avant
  l'introduction des articles.

**`getOrCreateZohoItem`/`getOrCreateZohoBooksItem`** (respectivement
`zohoInvoice.ts` et `zohoBooks.ts`, dupliqués comme le reste des helpers
Contacts de ces deux fichiers plutôt que partagés — même rationale que
`buildZohoContactPayload`) recherchent l'article par **nom exact** avant
d'en créer un, exactement comme `getOrCreateZohoCustomer` : une même ligne
refacturée sur la MÊME affaire (un second acompte, par exemple) retrouve et
réutilise le même article plutôt que d'en créer un nouveau à chaque facture.
**Best-effort à dessein** : un article est un ajout, jamais une condition à
la facturation — un échec (réseau, quota Zoho) laisse la ligne repartir
libre, sans `item_id`, exactement comme avant l'introduction des articles ;
il ne fait jamais échouer la facture elle-même.

`item_id` fixe l'article facturé, il ne fige pas son prix : `rate`,
`quantity` et `tax_percentage` restent portés par la ligne elle-même, pas
par l'article — Zoho les respecte comme un prix ajusté pour cette facture
précise, exactement comme dans son interface (choisir un article puis
modifier son prix pour cette ligne).

**Avancement par phase d'un acompte.** `zohoPhasesText()` (`zohoSync.ts`) reprend
le bloc « Avancement par phase » de l'aperçu de la facture (une ligne par phase :
`Esquisse (ESQ) : 100% d'avancement, 1 074,45 €`, montants à espace ordinaire car
l'espace fine de fr-FR s'affiche mal chez Zoho). `zohoLineItems(inv, affaire)` en
fait la DESCRIPTION de la première ligne, après l'intitulé de l'opération
(`projects.name`) et son adresse, une information par ligne ; l'intitulé de la
ligne de facture n'y est pas répété, il reste dans son `name`. Pour Zoho Invoice
comme pour Zoho Books. Jamais dans le `name` : c'est lui qui identifie l'article,
donc `buildZohoLineItemsWithArticles` appelle `zohoItemIdentity(line.name, ...)` et
non plus `line.description`, sans quoi chaque avancement créerait un article
distinct. Seules les factures `invoice_type = 'acompte'` portent ce détail
(`phases`, à défaut la phase unique `mission_name`/`advancement_pct` des factures
antérieures) ; les autres gardent leur description.

Le numéro et l'adresse de l'affaire remontent jusqu'à ces fonctions par le
même chemin que `project_name` déjà en place : `server/routes/invoices.ts`
étend son `SELECT` sur `projects` (`name, project_code, address`) à la
création d'une facture, au retry de synchro (`POST
/api/invoices/:id/sync-retry`) et dans la synchro en masse
(`/api/zoho/sync`, `/api/zoho-books/sync`), et les transmet dans l'objet
`ZohoAffaireInfo` (`projectCode`/`projectName`/`projectAddress`) donné au
connecteur actif.

### Facturation IA atomique (réserve → exécute → règle)

Le solde IA prépayé (`tenants.ai_credit_balance_eur_cents`) était jusqu'ici lu
une fois avant l'appel au modèle — potentiellement long, plusieurs secondes,
surtout sur une boucle d'appel d'outils (`POST /api/agents/:id/chat` peut
enchaîner jusqu'à six appels au modèle : initial, jusqu'à
`MAX_FUNCTION_ROUNDS` tours d'outils, un tour de clarification) — puis déduit
une seule fois à la toute fin, plafonné à zéro. Une rafale de requêtes
concurrentes contre un solde faible passait donc toutes le contrôle initial
et déclenchait chacune un vrai appel, facturé par le fournisseur, avant
qu'aucune déduction n'ait eu lieu.

**`server.ts` : `reserveAiCredit()` / `settleAiCredit()` / `refundAiCredit()`**
remplacent ce lire-puis-écrire par réserve → exécute → règle, câblés dans
`timedChat()` (`packages/archioffice-agents/src/server/routes.ts`) : CHAQUE
appel au modèle, pas la requête entière, réserve un coût pessimiste avant de
s'exécuter et règle contre l'usage réel juste après.

- **`reserve_ai_credit(tenant_id, montant)`** (SQL,
  `supabase/migrate_ai_billing_atomicity.sql`) fait le contrôle ET l'écriture
  dans la même instruction — sous verrou de ligne Postgres, deux appels
  concurrents contre un solde qui ne couvre pas les deux ne peuvent plus tous
  les deux réussir. Renvoie faux sans jamais avoir appelé le modèle.
- Le montant réservé est pessimiste : `RESERVE_MAX_OUTPUT_TOKENS` (16000,
  aligné sur le `max_tokens` déjà imposé aux adaptateurs Anthropic/Mistral —
  Gemini n'a pas d'équivalent en code, donc c'est ici une hypothèse pour le
  calcul de réserve, jamais une limite réellement appliquée à cet appel) et
  une estimation grossière des jetons d'entrée (longueur des messages / 4).
- **`settle_ai_credit(tenant_id, delta)`** régularise ensuite contre le coût
  réel une fois l'usage connu : remboursement du surplus réservé (le cas
  courant), ou complément si le réel dépasse la réservation — toujours
  plafonné à zéro.
- Un appel qui échoue (réseau, timeout) est intégralement remboursé via
  `refundAiCredit()`, volontairement distinct de `settleAiCredit()` : cette
  dernière passe par `priceEurCents()`, qui plancher même un appel à zéro
  jeton à 1 centime — l'utiliser pour un remboursement aurait laissé un
  centime fantôme sur un appel qui n'a jamais réellement eu lieu.

**Recharge mensuelle du forfait**, même faille : l'ancien
`maybeRefreshMonthlyCredits()` lisait `ai_credit_last_refresh`, puis créditait
si absent/périmé — deux premiers appels du mois exécutés en même temps
lisaient tous les deux l'ancienne date et créditaient tous les deux le
montant mensuel. **`refresh_monthly_ai_credits(tenant_id, montant)`** fait la
vérification et l'écriture dans la même instruction, remplaçant le
lire-puis-écrire.

**Le mode postpaid n'a pas ce garde-fou** — sans solde à protéger contre un
dépassement, `POST /api/agents/:id/chat` y garde l'ancienne comptabilité
globale a posteriori (`deductAiCredit()`, inchangée) plutôt que de réserver
par appel. `POST /api/agents/transcribe`, `POST /api/agents/speak` et
`POST /api/ai/suggest-articles` ne sont pas passés au modèle réserve/règle :
leur coût dépend d'un volume audio dont la conversion en jetons avant l'appel
n'a pas de formule fiable à documenter honnêtement (contrairement au texte,
où `chars/4` est une approximation usuelle) — plutôt que d'inventer un
facteur de conversion, ils gardent le lire-puis-déduire existant, dont
l'exposition financière par appel reste bornée (audio ≤ 10 Mo, texte de
synthèse ≤ `MAX_SPEECH_CHARS`).

### Chef de projet (`pm`) : voit les montants de ses affaires, ne facture pas

Le chef de projet voit les factures et les notes d'honoraires **des affaires
dont il est membre** (`project_members`) et rien d'autre ; il prépare des notes
d'honoraires mais **ne crée, ne modifie ni ne supprime aucune facture** ni ne
génère la facture d'une note. L'administrateur et le manager facturent.
`server/invoiceAccess.ts` porte la règle : `visibleProjectIds()` (lecture,
`GET /api/invoices`, `GET /api/invoices/:id`, notes d'honoraires) et
`ensureCanWriteInvoices()` (403 `INVOICE_WRITE_FORBIDDEN` sur `POST`/`PUT`/
`DELETE /api/invoices`, `sync-retry`, `POST /api/notes_honoraires/:id/facture`).
Le rôle `user` n'est **pas** restreint (c'est le rôle par défaut d'un membre : le restreindre casserait les cabinets existants). **Un rôle inconnu ou absent
n'est jamais restreint** (instance non migrée, mode local) : on ne ferme un
accès qu'à un rôle explicitement limité. Un rôle limité sans affaire voit une
liste vide, jamais « tout ». `src/lib/invoicePermissions.ts` masque côté écran
les boutons correspondants ; le serveur reste la barrière.

Son tableau de bord (`ResponsibleDashboard`) porte une trésorerie « mes
affaires » (`TreasuryKpis`, `computeTreasury`) et son panneau d'accueil parle
des montants de ses affaires, avec un bouton vers ses affaires et non vers le
traitement des retards. Les autres intégrations qui écrivent des factures
(SuperPDP, Chorus Pro, Zoho) n'ont pas encore ce garde-fou.

### Temps par phase, coût horaire et rentabilité par phase

`time_entries` porte désormais `phase` (code de la mission : ESQ, APS, APD, PC, PRO, DCE, ACT, VISA, DET, AOR, `NULL` = non imputé) et `billable` (vrai par défaut : tout le temps déjà saisi reste facturable), `supabase/migrate_time_phase_cost.sql`. Le pointage, la saisie manuelle et la modification les acceptent (`readPhaseAndBillable`, `server/routes/timeTracking.ts`) : une phase hors liste est refusée en 400, un champ absent d'un `PUT` laisse la valeur enregistrée.

**Le coût horaire est une donnée de gestion, tenue par cabinet** : `tenant_memberships.hourly_cost_cents` (centimes, `NULL` = non renseigné), jamais sur `profiles` qui suit la personne d'un cabinet à l'autre. `GET /api/hourly-costs` et `PUT /api/hourly-costs/:userId` sont réservés aux administrateurs (saisi en euros, stocké en centimes, membre d'un autre cabinet refusé en 404) ; l'écran est `HourlyCostsCard` dans l'onglet admin du suivi du temps. Une instance non migrée lit `available: false` et refuse l'écriture en 503, sans casser le reste.

`src/lib/profitability.ts` (pur, partagé serveur et écran, `src/lib/__tests__/profitability.test.ts`) fait le calcul : budget d'une phase = honoraires révisés x part de la mission du contrat MOE (`MISSION_ID_TO_PHASE`, déplacé hors de `ProjectDetail.tsx`), coût = heures x coût horaire de chaque membre, marge = budget - coût. `GET /api/projects/:projectId/time-by-phase` (administrateurs et managers seulement : le coût du temps ne se lit pas à tous) renvoie heures, heures facturables et coût par phase, et **la liste des membres ayant saisi du temps sans coût horaire** : l'écran (`ProjectProfitability.tsx`, onglet HONOS) le signale au lieu de présenter une marge flatteuse. Les missions qui ne sont pas une phase (OPC...) n'ont pas de budget ; leur temps se saisit sans phase et apparaît sur une ligne « Sans phase ». Tests : `tests/timePhaseCost.test.ts`.

Pas encore couvert, voir ROADMAP.md : plan de charge prévisionnel (table d'affectations reliée aux congés), export FEC, notes de frais et factures fournisseurs.
