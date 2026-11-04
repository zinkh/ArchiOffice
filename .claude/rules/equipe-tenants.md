---
paths:
  - "server/routes/team.ts"
  - "server/tenant*.ts"
  - "server/assertTenantEntity.ts"
  - "server/routes/contact*.ts"
  - "server/contact*.ts"
  - "server/archive*.ts"
  - "server/projectArchive*.ts"
  - "server/routes/projects.ts"
  - "server/routes/phoneCalls.ts"
  - "src/UserContext.tsx"
  - "src/lib/activeTenant.ts"
  - "src/pages/Contacts.tsx"
  - "src/pages/PhoneCalls.tsx"
  - "src/components/Contact*.tsx"
  - "src/components/TenantSwitcher.tsx"
  - "server/guestAccessGuard.ts"
  - "server/projectShares/**"
  - "server/routes/projectShares.ts"
  - "server/routes/projectShareDocuments.ts"
  - "src/components/ProjectSharesPanel.tsx"
  - "src/components/SharedDocument.tsx"
  - "src/components/ShareCommentsInbox.tsx"
  - "server/routes/projectShareProposals.ts"
  - "src/components/ShareProposalsInbox.tsx"
  - "src/pages/SharedProjects.tsx"
---

# Équipe, cabinets, contacts, archivage, sécurité

> Règles extraites du CLAUDE.md racine, sans modification de contenu. Chargées quand Claude lit un fichier correspondant aux chemins ci-dessus.

### Invitation d'un nouveau membre d'équipe

`POST /api/team` (`server/routes/team.ts`) n'a jamais généré ni envoyé de mot
de passe : `supabaseAdmin.auth.admin.generateLink({ type: 'invite', ... })`
crée le compte Supabase Auth **sans** mot de passe et renvoie un lien à usage
unique, envoyé par e-mail (SMTP du cabinet, repli sur le SMTP plateforme comme
le reste de cette route). `/reset-password` (`src/pages/ResetPassword.tsx`)
détecte la session temporaire que ce lien établit — le même mécanisme que la
récupération de mot de passe classique — et laisse la personne choisir
elle-même son mot de passe avant d'entrer. Aucun secret ne transite donc en
clair par e-mail ni ne reste dans les journaux d'un serveur SMTP.

`POST /api/team` retrouve un compte déjà existant via `profiles.eq('email',
email)` — ce qui suppose que `profiles.email` est fiable. Ce n'était pas
toujours le cas : le trigger `handle_new_user()` (`supabase/schema.sql`) ne
copiait que le nom depuis `auth.users` à la création d'un compte, jamais
l'email. Un compte né d'une connexion Google (qui ne passe par aucune route
applicative avant que ce trigger s'exécute) se retrouvait donc avec
`profiles.email` vide alors que l'adresse existe bien côté Supabase Auth —
`server/routes/agencySetup.ts::adminRecipients()` contournait déjà ce trou,
mais pour un seul appelant (les notifications de demande de rattachement),
pas pour toute recherche de compte par e-mail.

`supabase/migrate_backfill_profile_email.sql` ferme ça à la source plutôt que
d'ajouter un repli à chaque appelant : le trigger copie désormais
`NEW.email`, avec `ON CONFLICT (id) DO UPDATE SET email = COALESCE(profiles
.email, EXCLUDED.email)` — jamais `DO NOTHING`, pour qu'un profil déjà
upserté plus richement par une route applicative avant l'exécution du
trigger garde ses valeurs ; seul un email resté NULL est complété. La même
migration corrige aussi les comptes déjà créés avant ce correctif.

### Références inter-locataires non validées

`tenantScopedFrom.ts` empêche une requête d'écrire une ligne dans le mauvais
tenant, mais ne dit rien des identifiants qu'un payload se contente de
RÉFÉRENCER — un `project_id` accepté tel quel dans le corps d'une requête peut
pointer vers un projet d'un autre cabinet, tant que rien ne vérifie son
appartenance avant l'écriture. `server/assertTenantEntity.ts` est le helper
générique introduit pour ça (`assertTenantEntity(supabaseAdmin, table, id,
tenantId): Promise<boolean>`).

Balayage complet effectué sur `server/routes/*.ts` : tout `POST`/`PUT` qui
acceptait un identifiant de clé étrangère depuis le corps de la requête
(`project_id`, `contact_id`/`client_id`, `tender_id`, `proposal_id`,
`reception_id`, `plan_id`, `situation_id`, `dpgf_item_id`, `dpgf_id`,
`marche_id`, `assignee_id`/`user_id`) vérifie désormais son appartenance au
cabinet avant l'écriture — `invoices.ts`, `proposals.ts`, `tenders.ts`,
`timeTracking.ts`, `meetings.ts`, `observations.ts`, `visas.ts`,
`tasks.ts`, `reserves.ts`, `rfis.ts`, `situations.ts`,
`projects.ts`, `receptions.ts`, `plans.ts`, `priceLibrary.ts`,
`projectMembers.ts`, `ordresDeService.ts`, `permits.ts`, `maf.ts`,
`marchesEntreprises.ts`, `meetingAttendees.ts`, `milestones.ts`,
`gpaReserves.ts`, `documents.ts`, `dpgf.ts`. `assignee_id`/`user_id` (une
personne, pas une ligne `tenant_id`-scopée comme les autres) se vérifie via
`findMembership()` (`server/tenantMemberships.ts`), pas `assertTenantEntity`.

Volontairement laissés de côté : les intégrations de synchro externe
(`odoo.ts`, `zohoBooks.ts`, `zohoInvoice.ts`, `ragic.ts`, `gmailSync.ts`,
`googleCalendarSync.ts`, `outlookSync.ts`) qui écrivent des FK à partir de
leurs propres lignes locales déjà tenant-scopées — un risque différent, pas
un oubli — et les cas où `project_id` vient d'un paramètre d'URL déjà validé
en amont (routes imbriquées sous `/api/projects/:projectId/...`), qui ne
sont pas la même faille : c'est l'identifiant RÉFÉRENCÉ depuis le corps
d'une requête qui manquait de contrôle, pas celui de la ressource visée par
l'URL elle-même.

### Plusieurs cabinets pour une même personne

Un architecte exerce parfois dans deux structures (la sienne et une SCPA, un
groupement, une agence associée). `profiles` porte une ligne par personne, clé
primaire = compte auth, donc un seul `tenant_id` : il fallait jusqu'ici un
second compte, avec une autre adresse, pour le second cabinet — deux
identités, deux mots de passe, deux boîtes mail connectées pour une seule
personne.

`tenant_memberships` (`supabase/migrate_tenant_memberships.sql`) sépare
**l'identité** (`profiles`, une ligne par personne) de **l'appartenance** (une
ligne par couple personne × cabinet), avec le rôle tenu DANS ce cabinet : on
est souvent gérant du sien et simple collaborateur de l'autre, et
`system_role` ne peut donc plus être une colonne de `profiles`. Même principe
d'`is_default` + index unique **partiel** que `document_templates` et
`email_connections` : au plus un cabinet par défaut, sans en imposer un.

**`profiles.tenant_id` reste, et n'est pas décoratif** : c'est le cabinet par
défaut, celui sur lequel une session s'ouvre, et c'est le **repli complet** de
`server/tenantMemberships.ts` — une instance dont la base n'a pas encore joué
la migration fonctionne à l'identique. C'est ce repli, pas la migration, qui
rend la mise à jour du code sûre ; il est verrouillé par un test
(`tests/tenantMemberships.test.ts`, « instances non migrées »).

**Le cabinet actif voyage par en-tête.** Le jeton dit qui parle, plus où :
chaque requête `/api` porte `X-Tenant-Id` (`src/lib/activeTenant.ts`, posé par
l'intercepteur `window.fetch` ET par `apiFetch`, qui le court-circuite). Le
middleware d'authentification le valide contre les adhésions — un cabinet dont
on n'est pas membre est refusé en `403 TENANT_NOT_MEMBER`, jamais remplacé en
silence par un autre — puis le dépose dans un `AsyncLocalStorage`
(`server/tenantContext.ts`) que `getTenantId()` relit. C'est ce détour qui
évite de propager un paramètre de plus dans les quelque soixante fichiers de
routes qui appellent tous `getTenantId(req.user.id)`.

Trois conséquences à ne pas défaire :

1. **Le rôle se lit sur l'adhésion, jamais sur `profiles`** pour un autre
   cabinet que le sien (`getMemberRole`). Sinon un collaborateur d'un cabinet
   y hériterait de son rôle d'administrateur de l'autre.
2. **« Les gens du cabinet » se listent sur les adhésions**
   (`listTenantMemberIds` / `listTenantProfiles`), pas par
   `.eq('tenant_id', …)` sur `profiles` : ce filtre ne voit que ceux dont
   c'est le cabinet PAR DÉFAUT, et faisait disparaître des listes (équipe,
   mentions, notifications, congés, quotas) quiconque exerce aussi ailleurs.
3. **Fermer un cabinet ne supprime que les comptes qui n'en ont pas d'autre**
   (`listUsersOnlyIn`, utilisé par `server/tenantPurge.ts` et le back-office).
   La boucle « supprimer l'auth user de chaque profil du tenant » d'avant
   aurait effacé le compte d'une personne encore en activité dans l'autre
   structure.

Les appels internes des agents portent le même en-tête
(`packages/archioffice-agents/src/server/internalApi.ts`) : les outils
rappellent l'API en boucle locale avec le jeton de l'utilisateur, et sans lui
un agent sollicité depuis le second cabinet écrirait dans le premier.

Côté client, `switchTenant()` (`src/UserContext.tsx`) enregistre le choix,
appelle `POST /api/tenants/switch` (qui n'a qu'un rôle : fixer le cabinet par
défaut, pour qu'un autre poste rouvre au même endroit), **vide le cache
Dexie** puis recharge sur `/`. Le rechargement n'est pas une facilité : chaque
écran garde en mémoire les affaires, contacts et réglages du cabinet quitté,
et l'adresse courante vise souvent une affaire qui n'existe pas dans l'autre.
Le sélecteur (`src/components/TenantSwitcher.tsx`) n'apparaît qu'à partir de
deux cabinets ; un compte à cabinet unique ne voit rien changer, hormis
l'entrée « Rejoindre ou créer un cabinet » qui mène à `/agency-setup?add=1`.

### Partage d'une affaire avec un confrère (collaborateur externe)

Un confrère est invité sur UNE affaire sans devenir membre du cabinet. Le
partage (`project_shares`, une ligne par affaire × personne, statut `active` ou
`revoked`) porte des droits par type de ressource (`project_share_grants`,
`read` ou `write`). **Aucun droit par défaut** : ce qui n'est pas accordé est
invisible. `supabase/migrate_project_shares.sql`, idempotente, RLS posée.

**Gratuité avec limites** (`SHARE_LIMITS`, `server/projectShares/access.ts`) : 3
invités actifs par affaire, 10 personnes distinctes par cabinet, refus en 402
(`SHARE_LIMIT_PROJECT`, `SHARE_LIMIT_TENANT`) **avant** toute création de compte.
Pas d'IA (coût au cabinet), pas de facturation, pas de création d'affaire. Un
invité n'est ni de l'équipe, ni mentionnable, ni compté dans le quota
d'utilisateurs : `listTenantMemberIds` exclut le rôle `guest`. À ne pas défaire,
la gratuité tient à ce filtre.

**Deux cas, un seul modèle.**

- Une personne SANS cabinet reçoit une adhésion `system_role = 'guest'` au
  cabinet qui l'invite (sinon elle serait « sans agence » et ne pourrait pas
  entrer). Compte créé par le même lien d'invitation que `POST /api/team`.
- Une personne qui a DÉJÀ un cabinet ne reçoit aucune adhésion : elle reste dans
  son cabinet et ouvre l'affaire par `/partages`. Son sélecteur de cabinet n'est
  pas pollué, et ses droits chez elle ne bougent pas.

**Le serveur fait barrière, en refusant par défaut.** `guestAccessGuard`
(`server/guestAccessGuard.ts`, monté avant toutes les routes) ne laisse passer
un invité `guest` que sur `/api/shared`, `/api/me` et `/api/health` ; tout le
reste répond 403 `GUEST_FORBIDDEN`. Refuser par défaut plutôt qu'énumérer les
routes interdites : une route ajoutée demain ne s'ouvre pas à un invité par
oubli. Le garde FERME l'accès s'il tombe (503), il ne l'ouvre pas. Le rôle est
mis en cache 10 s ; `invalidateGuestRoleCache` à chaque invitation ou retrait.

**Routes `/api/shared` (invité)** : indépendantes du cabinet actif, le cabinet
vient du partage. Une affaire non partagée répond 404, jamais 403. Chaque
réponse est construite champ par champ (`PROJECT_FIELDS`, `LOT_FIELDS`,
`TASK_FIELDS`) : une colonne ajoutée demain (`assignee_id`, `contact_id`) ne
fuit pas. Écrire une tâche exige le droit `write`, une affaire non archivée, et
laisse une trace dans le journal d'activité (« confrère externe »). Le corps de
la requête ne choisit jamais `tenant_id` ni `project_id`.

**Routes `/api/projects/:id/shares` (cabinet)** : inviter, régler les droits,
retirer. Réservé aux administrateurs et managers (`requireSharer`), contrôle
d'appartenance de l'affaire par `assertTenantEntity`. Retirer vide les droits
d'abord (un échec laisse un partage fermé), puis supprime l'adhésion `guest`
devenue inutile ; l'adhésion d'un vrai membre n'est jamais touchée.

**Droits branchés aujourd'hui** : `lots` (lecture, sans le contact de
l'entreprise), `tasks` (lecture ou écriture), `documents` (lecture seule), `cctp`
et `dpgf` (par lot : lecture, commentaire, ou « écriture » qui signifie PROPOSER,
voir « Écriture par proposition » plus bas). Autres types : voir ROADMAP.md.

**Documents** : le droit couvre les documents de l'affaire (`resource_type =
'projects'`), pas les pièces de devis, d'appel d'offres ou de bibliothèque
d'agent qui vivent dans la même table. La liste ne rend jamais `file_url`,
`uploaded_by` ni les contacts. Le fichier ne s'obtient que par
`GET /api/shared/projects/:id/documents/:docId/download`, qui revérifie le
partage, le droit et le rattachement à l'affaire, puis délègue à
`linkForTenantFile` (`server/projectShares/fileAccess.ts`) : même mécanisme que
`/api/storage/signed-url`, mais l'appartenance du fichier se vérifie contre le
cabinet DU PARTAGE (préfixe `${tenantId}/` ou connexion de stockage du cabinet),
jamais contre un cabinet désigné par la requête. Chaque téléchargement est tracé.
Le panneau laisse ce droit désactivé par défaut : l'onglet Documents peut
contenir des contrats ou des pièces d'honoraires, et c'est au cabinet de le
décider. Pas de dépôt par l'invité (pas de droit `write` pour ce type).

**CCTP et DPGF, lot par lot** (`supabase/migrate_project_share_lots_comments.sql`).
Le CCTP et le DPGF sont UN document (`dpgfs.data`, arbre lots > chapitres >
lignes) dont chaque lot porte le texte du CCTP (`cctpDescription`) ET les prix.
Le droit sur `cctp` ou `dpgf` se donne donc **par lot** (`project_share_grants
.project_lot_id`, clé `project_lots.id`, rattachement `Lot.projectLotId`) : un
droit de ce type sans lot n'existe pas (`normalizeGrants` le refuse,
`loadGrants` l'ignore), pour qu'un lot n'ouvre jamais les prix des autres. Les
lots désignés doivent appartenir à l'affaire (`lotsBelong`, à l'invitation et à
la modification). Niveaux : lire < commenter < écrire, chacun comprenant les
précédents (`allows(grants, kind, access, lotId)`).

`GET /api/shared/projects/:id/cctp` et `/dpgf` rendent les seuls lots accordés,
**construits champ par champ** (`guestDocumentView`,
`server/projectShares/documentView.ts`, pur et testé) : la vue CCTP n'a aucune
quantité ni aucun prix ; la vue DPGF a quantités et prix mais ni textes, ni
lignes ou chapitres `cctpOnly`. Jamais : totaux du document (ils additionnent
tous les lots), `marqueur`, `images.fileUrl`, `articleTypeId`, `genereParIa`.
Un lot du document sans `projectLotId` ne peut jamais être accordé. Les titres
de lot passent par `withProjectLotTitles`, comme la route du cabinet.

**Commentaires** (`project_share_comments`, `server/routes/projectShareDocuments.ts`).
Un confrère commente un lot, un chapitre ou un article qu'il VOIT : l'élément doit
exister dans la vue de CE lot pour CE type de document (`visibleNodes`), sinon 404,
si bien qu'un identifiant deviné ne sert pas à sonder le document. Un fil
appartient à UN partage, un confrère ne lit jamais ceux d'un autre ; retirer le
droit de lecture d'un lot masque aussi ses commentaires. Une réponse reste dans le
fil du même partage, sur le même élément. Le cabinet (administrateurs et
managers) lit tous les fils avec le libellé de l'élément visé (`nodeLabels`,
jamais rendu à un invité), répond et marque « traité ». Pas de suppression en
v1. Écrans : `SharedDocument.tsx` (invité), `ShareCommentsInbox.tsx` et éditeur
de droits par lot dans `ProjectSharesPanel.tsx` (cabinet).

**À ne pas défaire** : la vue d'un invité se construit TOUJOURS à partir des
listes blanches de `documentView.ts`, jamais en copiant le document ni en
retirant des champs d'une copie. Une colonne ou un champ ajouté demain doit être
ajouté à la liste pour apparaître, jamais l'inverse.

Écrans : `ProjectSharesPanel.tsx` (fiche affaire, masqué pour qui n'est pas
administrateur ou manager), `SharedProjects.tsx` (`/partages`), entrée de menu
« Affaires partagées ». `ProtectedLayout` ramène un `guest` sur `/partages`.
Tests : `tests/projectShares.test.ts`.

**Écriture par proposition** (`project_share_proposals`,
`supabase/migrate_project_share_proposals.sql`, `server/routes/projectShareProposals.ts`).
Un confrère n'écrit JAMAIS dans le document : le droit `write` sur le CCTP ou le DPGF,
lot par lot, signifie « proposer ». Le document est un seul bloc JSON que l'autosauvegarde
de l'éditeur PRO réécrit en entier : une écriture directe d'un invité pourrait effacer le
travail du cabinet. Champs proposables, **liste fermée** (`PROPOSABLE_FIELDS`,
`documentView.ts`) : texte, désignation, quantité, prix unitaire et unité d'un article ;
texte et titre d'un chapitre ; titre d'un lot (qui vit dans `project_lots`, pas dans le
document). Le droit se donne par lot et par type (`FIELD_KIND`) : `cctp` pour les textes et
les titres, `dpgf` pour la quantité, le prix et l'unité. Un champ ajouté demain n'est jamais
proposable tant qu'il n'est pas ajouté à cette liste.

- **On ne propose que sur ce qu'on voit**, dans la vue du type de droit : une ligne `cctpOnly`
  n'a ni quantité ni prix, elle n'existe pas dans la vue DPGF (404).
- **Refusés comme dans l'éditeur** (`blockedEdit`) : un article à sous-articles (il porte la
  somme de ses enfants), à quantité répartie par bâtiment (`quantitesBatiments`) ou ventilée
  par local (`quantiteDetails`), ou qui n'est pas un ouvrage ; un nombre négatif, non numérique,
  à plus de 4 décimales ou au-delà de 1e9 (`parseNumberValue`, virgule admise).
- **Article « pour mémoire »** : il PEUT recevoir une quantité, une unité et un prix. La
  quantité et l'unité le laissent « pour mémoire » (montant à 0, comme dans l'éditeur). Un
  prix unitaire supérieur à 0 le CHIFFRE : `applyFieldToNode` retire `pourMemoire` et l'article
  entre dans le total du lot (`leftPourMemoire`). Un prix à 0 ne change rien (refusé comme
  inchangé). Le résultat ne dépend pas de l'ordre d'approbation de la quantité, de l'unité et
  du prix. Le cabinet le voit AVANT d'approuver (`leavesPourMemoire`, avertissement dans
  `ShareProposalsInbox`), le journal d'activité le dit, et l'instantané d'avant garde l'article
  « pour mémoire » : rien n'est perdu.
- **Approuver est le seul moment où le document est écrit**, avec trois garde-fous : (1) la
  valeur actuelle doit être celle que l'invité a vue (`base_value`), sinon la proposition passe
  à `outdated` et rien n'est écrit ; (2) un instantané du document est pris avant
  (`dpgf_versions`, restaurable depuis l'historique du DPGF) ; (3) l'écriture est conditionnelle
  à l'état exact lu (`.eq('data', raw)`, et `.eq('lot_title', base_value)` pour un titre de
  lot) : un enregistrement concurrent donne 409 `PROPOSAL_CONFLICT`, jamais un écrasement.
- **Une quantité ou un prix recalcule** l'article, le sous-total du lot et les totaux avec
  `recomputeLot` (`recomputeAfterNumericChange`), la fonction même de
  `CCTPEditor.updateQuantiteUnite` : `prixTotal = pourMemoire ? 0 : quantité x P.U.`, sans
  arrondi. Aucun total enregistré ne doit contredire ses lignes.
- **Aucune perte de donnée, par construction** : une ligne de proposition n'est JAMAIS
  supprimée (remplacée, retirée, refusée ou périmée, elle garde `base_value` et
  `proposed_value`) ; l'instantané est CONSERVÉ même quand l'écriture échoue (ne pas le
  supprimer) ; une proposition appliquée dont le champ ne vaut plus la valeur proposée est
  signalée au cabinet (`drifted`).
- **La limite de 50 propositions en attente par confrère déclenche une alerte**
  (`MAX_PENDING_PER_SHARE`, `alertLimitReached`) : refus 409 `PROPOSAL_LIMIT` explicite à
  l'invité (sa saisie reste dans le formulaire), notification système aux administrateurs et
  managers (`notifyUsers`, étiquette `share-limit:<partage>`, qui remplace au lieu d'empiler),
  ligne dans le journal d'activité, au plus une fois par heure et par partage (mémoire du
  processus, au mieux), alerte `limitReached` dans le panneau du cabinet. Remplacer une
  proposition sur le même champ libère sa propre place.
- **Limite connue** : un onglet PRO ouvert avant l'approbation garde l'ancien contenu en
  mémoire, et sa prochaine frappe le réenregistrerait. Le serveur ne peut pas l'empêcher ;
  l'écran invite à recharger l'onglet PRO et `drifted` le signale. Une vraie solution demande
  que l'éditeur détecte une version stockée plus récente avant d'enregistrer.

Écrans : `ProposeEdit` dans `SharedDocument.tsx` (invité), `ShareProposalsInbox.tsx`
(cabinet : actuel face à proposé, approuver, refuser avec motif, alerte de limite, historique)
et niveau « propositions » du choix des droits par lot dans `ProjectSharesPanel.tsx`. Tests :
`tests/projectShareProposals.test.ts`, `tests/projectShareProposalsPrices.test.ts`.

### Fusion de contacts et vue détaillée de `/contacts`

**Fusion** (`POST /api/contacts/merge`, `server/routes/contactMerge.ts`, administrateurs et managers). Tout le travail est la fonction SQL
`merge_contacts(tenant, conservé, doublons[], patch, acteur)` (`supabase/migrate_merge_contacts.sql`), **en une seule transaction** : elle rattache
les colonnes qui référencent un contact (liste `v_refs`), les liens polymorphes (`email_links`, `email_folder_links`, `documents` en
`resource_type = 'contacts'`) et les références jsonb, retire d'abord les lignes qui violeraient une contrainte d'unicité
(`contact_merge_dedupe`), hérite des identifiants de synchro (Ragic, Odoo, Google), cumule `ca_amount`, applique le patch, supprime les doublons et
journalise dans `contact_merge_log`. Réservée au rôle serveur (`REVOKE` pour `PUBLIC`, `anon`, `authenticated`).

- **Le client n'envoie que des CHOIX** (`picks` : champ vers fiche) et le mot `FUSIONNER` ; les valeurs écrites sont recalculées côté serveur depuis
  les fiches lues en base (`resolveMergePatch`, `src/lib/contactMerge.ts`, partagé écran et serveur). Onze fiches au plus par fusion ; un contact
  personnel d'un autre utilisateur ou mélangé à un contact partagé est refusé (403, 409).
- **Garde-fou** : `tests/contactMergeReferences.test.ts` lit les migrations et exige que toute colonne `…contact_id` / `…client_id` / `REFERENCES contacts(id)`
  figure dans `v_refs`. **Une nouvelle colonne qui référence un contact s'ajoute à la fonction**, sinon ses lignes resteraient accrochées à une fiche supprimée.
  Test réel : `tests/contactMerge.pg.test.ts` (Postgres, ignoré sans `PGHOST`).
- **Écran** : `ContactMergeDialog.tsx` (choix de la fiche conservée et des valeurs en conflit, vérification, confirmation par saisie de FUSIONNER).
  Cases à cocher dans le tableau, bouton « Fusionner (N) » et bandeau des doublons possibles (`findDuplicateGroups` : même SIRET, même e-mail, même nom).
- **Vue détaillée** (`ContactsDetailView.tsx`) : liste compacte et fiche à onglets (vue d'ensemble, affaires, facturation, échanges). **Le tableau reste la vue
  par défaut** ; le choix est mémorisé (`localStorage` `contacts:view`) et `?vue=detail|table` l'emporte.
- **Société et interlocuteurs, suivi de relation** (`supabase/migrate_contact_relations.sql`) : `contacts.company_contact_id` (société de rattachement, `ON DELETE SET NULL`,
  une seule profondeur : la société choisie ne doit pas être elle-même rattachée), `relation_status` (prospect, en_discussion, client, partenaire, inactif),
  `relation_reminder_on` / `relation_reminder_note`. Validés par `normalizeRelation` (`server/routes/contacts.ts`, `tests/contactRelations.test.ts`) ; une instance non migrée
  retombe sur l'enregistrement sans ces colonnes. Se modifient dans l'onglet « Vue d'ensemble » de la vue détaillée. `merge_contacts` rattache `contacts.company_contact_id`.
- **Fusion automatique des doublons sûrs** (`POST /api/contacts/merge-safe`, `planSafeMerges` / `isSafeDuplicateGroup` dans `src/lib/contactMerge.ts`, `SafeMergeDialog.tsx`, bouton du bandeau des doublons, administrateurs et managers) : un groupe est sûr quand toutes les fiches ont la même clé de nom ET qu'aucune colonne à choix n'a deux valeurs différentes (les vides se complètent, les listes se cumulent). Les groupes réunis par e-mail ou SIRET sous des noms différents, ou en conflit, restent à la main. `dry_run: true` rend l'aperçu (groupes, fiches en double, groupes laissés de côté) ; sinon le mot FUSIONNER est exigé et le serveur fusionne 25 groupes par appel via la même fonction `merge_contacts` (fiche conservée = `suggestPrimary`), l'écran rappelant la route jusqu'à épuisement. Tests : `tests/contactMergeRoute.test.ts`, `src/lib/__tests__/contactMerge.test.ts`.
- **Import Google Contacts et CardDAV : jamais de doublon à la resynchronisation** (`server/contactSyncMatch.ts`, `tests/contactSyncMatch.test.ts`). Un contact importé est rapproché d'une fiche par identifiant Google (`google_resource_name`), puis e-mail (les trois champs, sans tenir compte de la casse), puis nom (`nameKey`) ; la fiche la plus ancienne l'emporte, un contact personnel n'est jamais rapproché, une valeur importée vide n'efface rien. L'ancien code cherchait par e-mail avec `.maybeSingle()` : une société sans e-mail était recréée à chaque synchro, et dès que deux fiches partageaient un e-mail l'erreur ignorée en faisait créer une de plus. Les doublons déjà créés se traitent avec la fusion.
- **Relances** : filtre par statut ou « Relances à faire » dans le tableau ; règle d'alerte `contact_relance_echue` (`server/agentAlerts.ts`, seuil en jours de retard, 0 par défaut, contacts personnels exclus, colonne absente = aucune alerte).

### Visibilité des contacts personnels

`contacts.is_personal` (`migrate_contacts_is_personal.sql`) existait déjà
pour exclure un contact de la synchro Google Contacts, mais rien ne
distinguait AUPRÈS DE QUI il restait visible dans l'application elle-même :
un contact personnel (un proche, une référence saisie pour un rappel
d'anniversaire) apparaissait dans la liste de tout le cabinet au même titre
qu'un contact « pro ». `migrate_contacts_personal_visibility.sql` ferme ce
trou avec deux colonnes distinctes, une par moitié du problème :

- **`contacts.owner_user_id`** — à qui appartient un contact personnel.
  Jamais `contacts.created_by` : ce champ texte libre sert déjà à d'autres
  valeurs (`'odoo'`, `'ragic'`, la source d'un import) et n'a jamais été un
  identifiant fiable. Server-side only — absent de `CONTACT_COLUMNS`
  (`server/routes/contacts.ts`), donc jamais accepté depuis le corps d'une
  requête : posé à `req.user.id` à la création d'un contact personnel, à
  `null` sur un contact « pro » (partagé, sans propriétaire).
- **`profiles.show_personal_contacts`** — préférence personnelle, pas par
  cabinet (même principe que `notification_prefs`) : afficher ou non SES
  PROPRES contacts personnels dans sa liste. Réglée depuis `/settings`, lue
  et écrite comme le reste du profil (`GET /api/me` /
  `PUT /api/team/:id`, camelCase `showPersonalContacts`). Un contact
  personnel appartenant à quelqu'un d'autre reste invisible quel que soit ce
  réglage — il ne joue que sur les siens.

`GET /api/contacts` filtre en mémoire (`is_personal` faux → toujours visible ;
vrai → visible seulement si `owner_user_id === req.user.id` ET que la
préférence est active) plutôt que via un `.or()` PostgREST imbriqué : la
liste d'un cabinet reste petite, et ça évite de dépendre de la syntaxe
`and()` dans un `.or()`. `PUT`/`DELETE /api/contacts/:id` refusent en 403
la modification d'un contact personnel appartenant à quelqu'un d'autre —
la liste seule ne suffit pas, l'id peut fuiter ailleurs (un journal
d'activité, un lien partagé entre collègues). Un contact personnel créé
avant l'existence d'`owner_user_id` (`owner_user_id` NULL) est réclamé par
la première personne qui l'édite, plutôt que de rester invisible pour tout
le monde indéfiniment ; basculer un contact de personnel à pro efface
`owner_user_id` (plus de propriétaire à avoir, une fois partagé).

### Archivage des affaires

« Terminée » dit où en est l'affaire, « archivée » dit qu'elle est rangée et en lecture seule. Colonnes
`projects.archived_at`, `archived_by`, `archive_reason`, `retention_until`, `settings.archive_retention_years`
(NULL = 10 ans) et journal `project_archive_log` (`supabase/migrate_project_archive.sql`, additive : `archived_at`
NULL = affaire active). Une instance non migrée garde le comportement d'avant : le garde de lecture seule se tait
(`isProjectArchived` vaut faux sur erreur), l'archivage répond 503, le journal se lit vide.

- **Clôture indicative** (`src/lib/projectArchive.ts`, testé) : statut terminé, factures soldées, réserves levées,
  tâches terminées, DOE visé. Un contrôle en alerte n'interdit rien : `POST /api/projects/:id/archive` répond 409
  `CHECKLIST_OVERRIDE_REQUIRED` (avec la liste) tant qu'aucun `override_reason` n'est fourni, puis archive et journalise
  les contrôles passés outre. Un DOE illisible (atelier absent) est « inconnu », jamais « non visé ».
- **Droits** : archiver, administrateurs et managers ; rouvrir (`POST .../unarchive`, motif obligatoire), administrateurs.
- **Lecture seule** : `PUT /api/projects/:id` répond 409 `PROJECT_ARCHIVED`. Les autres routes d'écriture rattachées à
  l'affaire (documents, tâches, factures...) ne sont PAS encore gardées.
- **Conservation** : `retention_until` = date d'archivage + durée du cabinet (10 ans par défaut, 1 à 50). Aucune purge
  automatique.
- **Écran** : `/projects` masque les archivées par défaut (bascule « Archivées ») ; les autres écrans qui lisent
  `GET /api/projects` comme annuaire les reçoivent toujours. `ProjectArchiveControl` (en-tête de la fiche) porte
  l'archivage et la réouverture.
- **Dossier de clôture** (`server/projectClosure.ts`, rendu partagé `src/lib/closureDossierPdf.ts`, charte du cabinet,
  « P1|2 ») : un PDF qui reprend la fiche, l'archivage (date, conservation, motif), les contrôles de clôture, les
  factures avec leur reste à encaisser, les réserves et l'index des pièces conservées (300 au plus, la troncature est
  dite). `GET /api/projects/:id/closure-dossier` (administrateurs et managers : il porte des montants) le produit à la
  demande, 409 tant que l'affaire n'est pas archivée. **À l'archivage il est déposé tout seul, mais seulement si le
  cabinet a un espace externe actif** (`getActiveConnection`) : document `doc_type = 'DOSSIER_CLOTURE'`, catégorie
  « Clôture », rangé sous `<racine>/<code> - <affaire>/Clôture/`. Sans espace externe rien n'est écrit dans Supabase
  (le quota est justement ce que l'espace externe épargne) et la réponse porte `dossier.reason = 'no_external_storage'` ;
  un espace qui ne répond pas donne `deposit_failed` sans défaire l'archivage. Le dossier ne contient pas les fichiers
  eux-mêmes, seulement leur index.
- **Lecture seule complète** (`server/archivedProjectGuard.ts`, monté dans `server.ts` APRÈS l'authentification et AVANT
  toute route) : une écriture (`POST/PUT/PATCH/DELETE`) qui vise une affaire archivée répond 409 `PROJECT_ARCHIVED`. Le garde
  lit le projet dans le chemin (`/projects/:id/...`), dans le corps (`project_id` d'une création) ou dans la ligne visée
  (`TABLES_RATTACHEES` : tâches, documents, factures, réserves, OS, situations, marchés, notes d'honoraires, RFI, réunions,
  permis, plans, avenants, pointage). Exemptés : lecture, `archive` / `unarchive`, création et suppression de l'affaire,
  génération d'un PDF (`.../pdf`). Un envoi multipart (`POST /api/documents`) n'est lisible qu'après `multer` : sa route
  vérifie elle-même. **Toute NOUVELLE table rattachée à une affaire s'ajoute à `TABLES_RATTACHEES`**, sinon ses lignes
  restent modifiables. Un garde qui échoue laisse passer (journalisé) plutôt que de fermer l'application.
- **Affaires archivées hors du suivi** (`server/archivedProjects.ts`) : les alertes métier (`loadTenantSnapshot`) et les
  suggestions IA ne lisent plus leurs lignes (une alerte déjà ouverte se referme au cycle suivant), le planning, le
  tableau de bord et les sélecteurs de pointage non plus. `GET /api/projects` les rend toujours, avec `archived_at` : les
  pages qui s'en servent comme annuaire résolvent encore leur nom.
- **Durée de conservation** : `settings.archive_retention_years` (1 à 50, vide = 10), carte « Archivage » de `/settings`
  (onglet Cabinet). Elle s'applique aux archivages FUTURS : changer la durée ne recalcule pas `retention_until` des
  affaires déjà archivées. Règle d'alerte `conservation_echeance` (`defaultThresholdDays` 90, gravité info, affaires
  archivées dont la fin de conservation est dans le seuil ou dépassée) : elle prévient, **rien n'est jamais purgé seul**.
- **Archivage en masse** (`GET /api/archive/candidates?months=`, `POST /api/archive/bulk`, administrateurs et managers,
  `BulkArchiveDialog.tsx`, bouton « Archiver les terminées » de `/projects`) : les affaires `Completed` dont la date de
  fin remonte à N mois (une affaire terminée SANS date de fin n'est jamais proposée, le nombre en est donné), 50 au plus
  proposées, 25 au plus archivées par appel. Chaque affaire passe par `archiverAffaire` (le même code que l'archivage à
  l'unité : contrôles, motif, journal, dossier de clôture) ; un motif commun couvre celles en alerte, une affaire en
  échec n'arrête pas les autres, et le résultat dit pour chacune `archivee`, `deja_archivee`, `motif_requis`,
  `introuvable` ou `echec`.
- **Pas encore fait** : exclusion des affaires archivées des écrans qui les listent pour une autre raison (calendrier,
  courrier, documents), recalcul de `retention_until` quand la durée change, purge assistée en fin de conservation.

### Pagination et fan-out sur les listes

`GET /api/projects` et `GET /api/invoices` faisaient tous deux la même
chose : joindre, sur CHAQUE ligne de la liste, des données que seul le
projet ou la facture réellement ouverte finit par utiliser. Pour les
projets, `project_cotraitants(*), project_lots(*), project_stakeholders(*),
project_categories_junction(...)` — utilisé nulle part ailleurs que dans la
modale de `Projects.tsx` pour LE projet sélectionné, et pas du tout par
`ProjectDetail.tsx` (qui appelait déjà `/api/projects/:id/full`, lequel
n'incluait pourtant pas ce join — `project.lots_list` y était donc
silencieusement toujours vide malgré tout le code qui le lit, un bug
préexistant corrigé au passage). Pour les factures, `invoice_items(*)` —
utilisé nulle part dans la LISTE elle-même, seulement par
`InvoiceGenerator.tsx` quand on ouvre une facture précise pour la visualiser
ou la générer.

Une vingtaine de pages (Dashboard, Gantt, Documents, TimeTracking, Contacts,
Calendar, Mailbox, ...) n'appellent `GET /api/projects` que comme un
annuaire id→nom : aucune n'avait besoin de ce fan-out, et le payer sur
chaque appel devient réellement coûteux pour un cabinet avec des années
d'archives.

**Le fan-out a migré vers la lecture d'un seul élément** :
`GET /api/projects/:id/full` porte désormais ce même join (mappé sur
`cotraitants_list`/`lots_list`/`stakeholders_list`/`categories_list`,
exactement comme avant sur la liste) ; `GET /api/invoices/:id` (nouvelle
route) porte les `items`. `Projects.tsx`'s `handleProjectClick` et
`Invoices.tsx`'s `handleOpenGenerator` récupèrent désormais ces données à
l'ouverture plutôt que de compter sur ce que la liste avait déjà — la liste
elle-même ne les porte plus du tout.

**Pagination par curseur, opt-in et rétrocompatible.** `limit`/`cursor` sont
des paramètres de requête optionnels sur les deux listes — un curseur opaque
(base64 de `id` pour les projets, faute de colonne de date de création ; de
`created_at` pour les factures, déjà triées dessus). Sans eux, la route rend
exactement le même tableau qu'avant : aucun des nombreux appelants qui ne
paginent pas n'a besoin d'être touché. Un appelant qui passe les deux reçoit
`{ data, nextCursor }` à la place — `nextCursor: null` signale la dernière
page. Aucune page ne consomme encore ce mode (le tri/filtre des listes reste
géré côté client, via `usePagination`) ; c'est le mécanisme qui manquait,
pas encore son adoption dans l'UI.

Tous les autres endpoints de liste (`/api/documents`, `/api/tasks`,
`/api/contacts`, `/api/tenders`, ...) restent non paginés — voir
ROADMAP.md.

**`tests/fakeSupabaseAdmin.ts`'s `.order()`/`.limit()` sont devenus réels**
(triaient et tronquaient auparavant en no-op, voir le commentaire historique
resté dans le fichier) : les deux routes ci-dessus en dépendent pour un
comportement correct, ce qui n'était vrai d'aucune route avant elles parmi
la cinquantaine d'appels à `.order(...)` du codebase.

### `x-user-role` retiré du frontend

Le frontend envoyait encore l'en-tête `x-user-role` sur la sauvegarde et la
suppression d'un projet (`ProjectDetail.tsx`, `Projects.tsx`), alors que le
serveur ne l'a jamais lu : `DELETE /api/projects/:id` est gardé par
`requireRole('admin')`, qui dérive le rôle de `getSystemRole(tenantId,
userId)` côté serveur, jamais d'un en-tête client. L'en-tête était donc un
reliquat sans effet — retiré pour ne pas laisser croire qu'il joue un rôle
de sécurité. `ROADMAP.md`/`API.md` documentaient encore l'ancienne faille
(« x-user-role est fait confiance sans vérification ») ; corrigé au passage,
avec les mentions « pas de rate limiting » et « CORS reflète n'importe quelle
origine », toutes deux également obsolètes (`server/rateLimit.ts` et
l'allow-list CORS de `server.ts` existent déjà).

### Journal des appels téléphoniques

`/appels` (`src/pages/PhoneCalls.tsx`) : l'appel reçu ou passé au cabinet se saisit en quelques
secondes (interlocuteur, objet, notes), s'attribue à un collaborateur qui reçoit une notification, et
peut devenir une tâche. Table `phone_calls` (`supabase/migrate_phone_calls.sql`, hors `SYNC_TABLES`),
routes `server/routes/phoneCalls.ts` (`GET/POST /api/phone-calls`, `PUT/DELETE /api/phone-calls/:id`,
`POST /api/phone-calls/:id/task`, `tests/phoneCalls.test.ts`), vocabulaire dans
`src/schemas/phoneCall.schema.ts` (sens `entrant`/`sortant`, statuts `a_traiter`/`en_cours`/`traite`,
priorités des tâches).

- **Tous les rôles voient tous les appels du cabinet.** « Mes appels » (défaut) est un filtre de
  confort, pas une barrière. `project_id`, `contact_id` et `assignee_id` du corps sont vérifiés contre le
  cabinet (`assertTenantEntity`, `findMembership`), le PUT passe par une liste blanche de colonnes.
- **Notification** (`notifyUsers`, catégorie « Tâches », lien `/appels?open=<id>`) à l'attribution et à
  chaque CHANGEMENT d'assigné, jamais à une modification de statut ou de note, ni quand on s'attribue
  l'appel à soi-même.
- **« Créer une tâche »** (`POST /:id/task`) : tâche du même assigné, de la même priorité, rattachée
  à la même affaire, échéance = rappel souhaité ; l'appel garde le lien (`task_id`) et passe de
  « à traiter » à « en cours ». Rejouable : un appel qui a déjà sa tâche rend celle-ci
  (`already_exists`), jamais une seconde. **Possible hors ligne** : l'appareil génère l'identifiant de
  la tâche (`task_id` du corps, `^[A-Za-z0-9_-]{8,64}$`) et met la demande en file (id de file
  `task:<appel>`) ; l'appel affiche tout de suite sa tâche « en attente d'envoi »
  (`overlayPendingPhoneCalls`). Au rejeu, le serveur reprend une tâche de ce `task_id` déjà insérée
  (coupure avant le lien posé sur l'appel) au lieu d'en créer une autre. Les dates de la tâche sont
  celles du jour du rejeu.
- **Hors ligne** : lecture « cache d'abord » (`phoneCallsCache`, Dexie v10) et écritures par la file
  (`entity: 'phoneCall'`). L'id de l'appel est généré par l'appareil et `POST` est idempotent (200 au
  rejeu). Chaque modification a son propre id de file (deux changements successifs ne s'écrasent pas) ;
  `overlayPendingPhoneCalls` (`src/lib/phoneCalls.ts`, testé) rejoue la file par-dessus la liste lue,
  sans quoi une relecture ferait disparaître un appel saisi avant son envoi.
- **Instance non migrée** : la lecture rend une liste vide, l'écriture un 503 explicite.
- **Lancer l'appel depuis l'écran** : une icône verte (lien `tel:`, 44 px) ouvre le composeur du
  téléphone, dans la liste des appels et à côté du champ téléphone de la fiche, **sous 768 px
  seulement** (`md:hidden` : un lien `tel:` n'ouvre rien d'utile sur un poste de bureau).
  `telHref()` (`src/lib/phoneCalls.ts`, testé) ne garde que les chiffres et un « + » initial, lit
  « 00 » comme « + », retire le « (0) » de « +33 (0)6... » et rend `null` en dessous de 3 chiffres
  (pas d'icône pour « à rappeler »). Composer ne crée ni ne modifie rien : l'appel sortant se note
  par « Nouvel appel » (sens « sortant »).
- **Où le retrouver** : menu Outils, volet « Plan d'actions » de la fiche affaire (bouton « Appel »,
  `/appels?new=1&project=<id>`), liste `LinkedPhoneCalls` de l'onglet Correspondance, carte « Appels à
  traiter » de `OperationalKpis` (les appels de la personne connectée, quel que soit le périmètre du
  tableau de bord).
- **Exports** (`src/lib/phoneCallsExport.ts`) : la liste telle qu'affichée, PDF paysage et Excel à la
  charte (seul un rappel en retard est en rouge). Un rappel en retard = échéance strictement passée sur
  un appel non traité ; une date absente ou illisible n'en est jamais un.
- **Agents et MCP** : ressource `phone_calls` dans `AGENT_RESOURCES` (par défaut pour l'agent
  « secrétaire »), `called_at` posé par le serveur quand l'agent ne le fournit pas.
