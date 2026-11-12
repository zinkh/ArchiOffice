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

**Complément (issue #245).** Ce balayage avait laissé quatre trous, fermés depuis :
`contratsMoe.ts` (`project_id`, `client_id`, POST et PUT), `notesHonoraires.ts`
(`project_id`, y compris pour les rôles que la visibilité ne restreint pas, et
`contrat_id`, POST et PUT), `avenantsMoe.ts` (`project_id`, `contrat_moe_id`, POST ;
le PUT ne les accepte pas) et `POST /api/projects/:id/members` (le projet de l'URL
n'était pas contrôlé : « validé en amont » était faux pour cette route, seul le
`user_id` l'était). `firstForeignRelation(supabaseAdmin, tenantId, [{ table, id, label }])`
(`server/assertTenantEntity.ts`) valide PLUSIEURS relations d'un coup et rend le
message de refus de la première qui n'est pas du cabinet, ou `null` : une relation
absente, `null` ou vide est ignorée (on peut effacer un lien) et un identifiant qui
n'est pas une chaîne (objet ou tableau glissé dans le JSON) est refusé sans atteindre la
requête. Convention de réponse : un identifiant du CORPS → 400, un identifiant de l'URL →
404, dans les deux cas « X introuvable pour ce cabinet. », **identique pour une ressource
étrangère et pour une ressource inexistante** (rien ne révèle qu'un id existe chez un
autre cabinet). Tests : `tests/crossTenantRelations.test.ts`. **Une nouvelle colonne qui
référence une autre table est à ajouter à la route qui l'écrit.**

**La base, dernière ligne de défense** (`supabase/migrate_zz_tenant_composite_fks.sql`,
pilote pour `projects`, `contacts` et `contrats_moe`). Une clé simple ne garantit que
l'EXISTENCE de l'id, pas son cabinet : la migration pose `UNIQUE (id, tenant_id)` sur ces
trois parents et remplace chaque clé simple de leurs tables enfants par une clé composite
`(colonne, tenant_id)`, de sorte que PostgreSQL refuse une ligne dont le parent est d'un
autre cabinet même si une route oublie le contrôle (`tests/tenantCompositeFks.pg.test.ts`,
vrai Postgres, ignoré sans `PGHOST`). Points à ne pas défaire :

- **La règle de suppression d'origine est reprise** : `SET NULL` devient `SET NULL (colonne)`
  (PostgreSQL 15+), qui n'efface QUE la colonne de liaison et jamais `tenant_id` ; la
  migration ne fait rien sous PostgreSQL 15.
- **La clé simple est SUPPRIMÉE, jamais conservée à côté** : deux relations entre les mêmes
  tables rendraient les jointures PostgREST (`.select('*, projects(name)')`) ambiguës.
- **Clés `DEFERRABLE INITIALLY IMMEDIATE`** : contrôlées à chaque instruction, sauf dans la
  transaction de `server/localCloudUpgrade.ts` qui réécrit `tenant_id` table par table dans un
  ordre quelconque et y demande `SET CONSTRAINTS ALL DEFERRED`. **Toute nouvelle réécriture en
  masse de `tenant_id` doit faire pareil.**
- **Découverte dynamique** des clés (pas de liste figée) : une table est ignorée avec un
  avertissement, jamais en échec, si une ligne croise déjà deux cabinets, si son `tenant_id`
  est nullable avec des NULL, ou si les types diffèrent. `project_members.tenant_id` est du
  TEXTE alors que `projects.tenant_id` est un UUID : elle garde sa clé simple et son
  contrôle reste celui de la route. Étendre à un autre parent = l'ajouter à `v_parents`.
- **Limite sur un poste local neuf** : `electron/applySchema.cjs` rejoue après tous les fichiers
  les instructions qui ont échoué au premier passage ; `avenants_moe.contrat_moe_id` y garde
  donc sa clé simple (49 composites au lieu de 50). Pas de conséquence en production.
- **Mesuré en production avant d'écrire la migration** : 154 clés simples entre tables à
  `tenant_id`, 0 ligne qui croise deux cabinets.

**Deuxième lot** (`supabase/migrate_zz_tenant_composite_fks_2.sql`, le même bloc avec une autre
liste `v_parents`) : `proposals`, `tenders`, `marches_entreprises`, `documents`, `meetings`,
`invoices`, `situations`, `reserves`, `receptions`, `plans`, `tasks`, `dpgfs`, `dpgf_items`,
`cctps`, `project_lots`, `project_shares`, `project_share_comments`. Fichier à part : un poste
local n'applique chaque fichier qu'une fois et la production a déjà reçu le premier. Mesuré en
production avant de l'écrire : 40 parents restants, 84 clés simples, 0 ligne croisée ; ce lot en
pose 46. À ne pas défaire :

- **Pas de jointure PostgREST à indice de colonne vers un parent converti** (le nom de la colonne
  après un point d'exclamation) : PostgREST n'accepte un indice de colonne que pour une clé à UNE
  seule colonne, la jointure échouerait (PGRST200) sur une clé composite. Une jointure SANS indice
  (`projects(name)`) reste valable, et c'est ce que fait le code partout.
  `tests/compositeFkEmbedHints.test.ts` lit les `v_parents` des migrations et interdit tout indice
  de colonne vers un parent converti : **ajouter un parent à une migration sans réécrire ses
  jointures à indice fait échouer ce test**, avant la production. Pour lire un champ d'une table liée
  par PLUSIEURS clés vers la même table (deux liens vers `site_reports`), faire UNE lecture groupée
  limitée au cabinet plutôt qu'une jointure : voir `withReportNumbers` (`server/routes/observations.ts`).
- **Troisième lot : `site_reports`** (`supabase/migrate_zz_tenant_composite_fks_3.sql`, 3 clés :
  `observations.created_report_id` et `resolved_report_id` en SET NULL, `site_report_notes.report_id`
  en CASCADE). `observations.ts` le joignait par indice de colonne ; ces jointures sont réécrites en une
  lecture groupée et la forme de la réponse (`created_report`, `resolved_report`, `created_report_number`,
  `resolved_report_number`) est inchangée (`tests/observationReportNumbers.test.ts`). **À appliquer en
  production APRÈS le déploiement de ce code** : appliquée avant, les listes d'observations échoueraient
  tant que l'ancien serveur tourne.
- **`marches_entreprises` a deux liens auto-référents en `RESTRICT`** (`parent_marche_id`,
  `accord_cadre_groupe_id`) : leur clé composite n'est PAS différable et reste refusée même après
  `SET CONSTRAINTS ALL DEFERRED`. La mise à niveau local vers cloud les traverse, car son `UPDATE`
  touche le parent et l'enfant dans la même instruction.

**Audit de routes (issue #245)** : `agentMissions.ts` (`agent_id`, `document_id` et `project_id`
sont vérifiés par des requêtes en ligne limitées au cabinet, d'où l'absence d'`assertTenantEntity`),
`marchesSubsequents.ts` (`groupe_avec` passe par `lireMarche(tenantId, ...)`, l'émission par une
fonction SQL dont les paramètres viennent de lectures limitées au cabinet) et
`accordCadreConsultations.ts` (tous les liens sont dérivés du marché de l'URL et de son groupe,
limités au cabinet) sont conformes : aucun identifiant du corps n'atteint la base sans contrôle.

**Quatrième lot : infrastructure et messagerie** (`supabase/migrate_zz_tenant_composite_fks_4.sql`,
21 parents : `agents`, `conversations`, `custom_references`, `email_connections`,
`agent_conversations`, `agent_missions`, `agent_recurring_tasks`, `agent_schedules`,
`articles_type`, `calendar_calendars`, `calendar_connections`, `consultation_depot_invites`,
`document_templates`, `external_storage_connections`, `feed_posts`, `inspiration_boards`,
`inspiration_items`, `rag_documents`, `support_tickets`, `tender_rss_sources`, `webhooks`). Mesuré en
production : 36 clés, 0 ligne croisée, la plus grosse table enfant a 28 lignes. Vérifié dans le code
qu'aucun flux légitime ne croise deux cabinets sur ces liens (réponse de la plateforme à un ticket :
cabinet du ticket ; duplication d'un modèle : source lue par `tenantScopedFrom` ; segments RAG : cabinet de
leur document ; connexions de messagerie lues par cabinet). **Un nouveau parent s'ajoute seulement
après cette vérification** : une clé composite refuserait un flux qui croise volontairement deux
cabinets (une ressource partagée ou de la plateforme), même si les données d'aujourd'hui sont propres.
Différence avec les lots précédents, à ne pas défaire : **un `RESTRICT` ENTRE DEUX TABLES**
(`agent_missions.coordinator_agent_id` vers `agents`) devient `NO ACTION` différable, car un `RESTRICT`
n'est pas différable et ferait échouer la mise à niveau local vers cloud quel que soit l'ordre des
réécritures de `tenant_id` ; la suppression d'un coordinateur encore référencé reste refusée sur-le-champ.
Un lien AUTO-RÉFÉRENT reste un vrai `RESTRICT` (parent et enfant sont réécrits dans la même instruction).

Pas encore fait : `project_members` (son `tenant_id` est du TEXTE alors que celui de `projects` est un
UUID : il faudrait d'abord changer ce type, avec ses politiques RLS et ses index, pour un gain faible
puisque la route contrôle déjà le projet) et les clés vers `profiles`, dont le `tenant_id` n'est que le
cabinet par défaut d'une personne. Hors de ces deux cas, toutes les clés entre tables à `tenant_id`
sont couvertes.

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
quantité ni prix SAUF sur un lot accordé (voir « Chiffres dans la vue CCTP » plus bas : un
seul droit par lot) ; la vue DPGF a quantités et prix mais ni textes, ni
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
document). Le droit se donne par lot et vaut pour le CCTP ET le DPGF (voir « Un seul droit par
lot ») ; `FIELD_KIND` ne dit plus que dans quelle vue l'élément doit être visible (une ligne
`cctpOnly` n'existe pas dans la vue DPGF). Un champ ajouté demain n'est jamais proposable tant
qu'il n'est pas ajouté à cette liste. Le métré (`metre`) en fait partie.

- **On ne propose que sur ce qu'on voit**, dans la vue du type de droit : une ligne `cctpOnly`
  n'a ni quantité ni prix, elle n'existe pas dans la vue DPGF (404).
- **Refusés comme dans l'éditeur** (`blockedEdit`) : un article à sous-articles (il porte la
  somme de ses enfants), ou qui n'est pas un ouvrage ; la quantité SEULE d'un article réparti par bâtiment (`quantitesBatiments`, son métré par bâtiment se propose) ; une quantité seule sur un article qui a un métré (`quantiteDetails`) ; un nombre négatif, non numérique,
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
  à la RÉVISION lue (`.eq('revision', row.revision)`, et `.eq('lot_title', base_value)` pour un
  titre de lot) : un enregistrement concurrent donne 409 `PROPOSAL_CONFLICT`, jamais un
  écrasement. **Ne jamais filtrer sur `data`** : le document pèse plusieurs centaines de Ko et un
  filtre PostgREST passe dans l'URL (testé : `tests/projectShareProposals.test.ts`).
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
- **Révision du document, et l'onglet PRO périmé** (ancienne « limite connue », résolue) :
  `dpgfs.revision` (`supabase/migrate_dpgfs_revision.sql`) est un compteur incrémenté par un
  DÉCLENCHEUR SQL (`dpgfs_bump_revision`) à chaque changement réel de `data`, quel que soit
  l'écrivain (éditeur, agents, approbation, restauration) : aucun chemin d'écriture ne peut
  l'oublier, et seules les offres (`dpgfs.offres`) ne la font pas avancer. `GET
  /api/projects/:id/dpgf` rend `_rev` avec le document ; `POST ...?baseRev=<rév>` n'écrit que si la
  révision stockée est celle lue (sinon 409 `DOC_STALE`, rien n'est écrit) ; sans `baseRev`
  (`useDPGF.ts`, outils), l'écriture est inchangée. `_rev` n'est jamais enregistré dans le
  document. Côté éditeur (`src/lib/dpgfDocument.ts`, `useAutosavedDoc`) : un 409 met le hook en
  `conflict` (plus d'enregistrement automatique, copie locale conservée) et `ProConflictBanner`
  propose deux sorties qui mettent TOUJOURS la version perdante de côté dans l'historique
  (`POST .../dpgf/versions` accepte un `document` pour figer la version locale) : « charger la
  version à jour » ou « enregistrer ma version ». Si la mise de côté échoue, rien n'est remplacé.
  La restauration d'un instantané relit le document ET la révision (`reload`). `drifted` reste
  pour les approbations écrasées avant cette protection. Limite : un document chargé depuis la
  copie locale (API indisponible) n'a pas de révision et s'enregistre sans condition.
- **Un seul droit par lot pour le CCTP et le DPGF** (décision de l'architecte) : un lot accordé
  l'est pour les DEUX documents, au niveau le plus haut des deux droits (`symmetrizeGrants`,
  `access.ts`). Appliqué à l'écriture (`normalizeGrants` enregistre les deux types) ET à la
  lecture (`loadGrants`) : un droit enregistré d'un seul côté avant cette règle se lit unifié,
  sans migration de données (il ouvre donc aussi l'autre moitié du lot). Le panneau de partage
  (`ProjectSharesPanel`) n'a plus qu'un sélecteur par lot ; `SharedDocument` traite les deux
  types comme une famille. `allows`/`grantedLotIds` ne changent pas.
- **Chiffres dans la vue CCTP** : sur un lot accordé, la vue CCTP porte `quantite`, `pourMemoire`,
  `prixUnitaire`, `prixTotal` et le métré (`quantiteDetails` en liste blanche : `id`, `libelle`,
  `expression`, `quantite`, `niveau`, `local`, jamais la note interne ni le bâtiment ou la phase)
  (`guestDocumentView(..., chiffresLotIds)`, `CCTP_CHIFFRES_FIELDS`, `METRE_FIELDS`) ; la vue
  DPGF porte aussi le métré. Rien pour un article ou un chapitre réservé au CCTP, ni sous lui ;
  jamais les totaux du document ni les prix d'un autre lot. Tests :
  `tests/projectShareCctpChiffres.test.ts`.
- **Proposer un métré** (champ `metre`, migration `migrate_project_share_proposals_metre.sql`,
  appliquée) : UNE proposition remplace la liste de lignes de l'article. Valeur = liste JSON de
  `{ libelle, expression }` (`parseMetreValue` : 200 lignes, 200 caractères, chaque calcul valide
  et total positif ou nul par `validerMetre`, la fonction de l'éditeur ; lignes vides retirées ;
  forme canonique, la même que `readField`, pour que la comparaison avec le métré actuel soit
  exacte). Valeur de départ : le métré tel que le confrère le voit (`[]` sans métré). À
  l'approbation, `applyFieldToNode` reprend une ligne de même libellé avec son `id` et ses champs
  d'une ventilation d'avant (rien n'est perdu), puis `appliquerMetre` fixe quantité et montant
  comme l'éditeur ; une liste vide retire le métré et garde la quantité ; un article « pour
  mémoire » garde un montant à 0. Refusé : article à sous-articles. Une
  quantité proposée seule sur un article qui a un métré est refusée (`blockedEdit` : elle se
  modifie par le métré) ; son PRIX et son unité se proposent, quelle que soit la composition de
  la quantité. **Article réparti par bâtiment** (`quantitesBatiments`) : son métré se propose, chaque ligne portant un bâtiment (`{ libelle, expression, batimentId }`, `metreForNode` : bâtiment connu de l'opération sur chaque ligne, total de CHAQUE bâtiment positif ou nul, `validerMetre(..., {parBatiment})`) ; sur un autre article un `batimentId` est refusé. La vue du confrère porte pour cela les bâtiments de l'opération (`multiBatiments`, `batiments` : id, code, libellé, ordre), `quantitesBatiments` (des chiffres) et le `batimentId` des lignes du métré d'un article par bâtiment SEULEMENT (ailleurs c'est un reste de ventilation, jamais exposé). À l'approbation `appliquerMetre` fixe la quantité de chaque bâtiment (un bâtiment affecté sans ligne reste à 0), une ligne reprise garde son `id` et sa note et peut changer de bâtiment, et la proposition devient périmée si un bâtiment a disparu de l'opération entre-temps. La quantité seule d'un article par bâtiment reste refusée. Le cabinet lit `[DX] Façade Est : 10` (`batimentCodes`). Tests : `tests/projectShareMetreBatiments.test.ts`. Côté écran : `ProposeMetre` rouvre la fenêtre de l'éditeur (`MetreDialog`) ; ce
  que le confrère a saisi reste dans la fenêtre si l'envoi est refusé ; le cabinet lit le métré en
  lignes (`metreEnTexte`). Tests : `tests/projectShareMetre.test.ts`,
  `tests/sharedDocumentMetre.test.ts`.

Écrans : `ProposeEdit` dans `SharedDocument.tsx` (invité), `ShareProposalsInbox.tsx`
(cabinet : actuel face à proposé, approuver, refuser avec motif, alerte de limite, historique)
et niveau « propositions » du choix des droits par lot dans `ProjectSharesPanel.tsx`. Tests :
`tests/projectShareProposals.test.ts`, `tests/projectShareProposalsPrices.test.ts`,
`tests/dpgfRevision.test.ts`, `tests/useAutosavedDocConflict.test.ts`,
`src/lib/__tests__/dpgfDocument.test.ts`. Pas encore vérifié dans un navigateur : le bandeau de
conflit, la saisie d'une quantité depuis le CCTP côté confrère.

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

### Gestion des membres : révocation et réinitialisation du mot de passe

`POST /api/team/:id/revoke` (`server/routes/team.ts`, administrateurs, `tests/teamRevokeReset.test.ts`) **détache** le
membre du cabinet (`removeMembership` : rôle, supérieur et accès tombent avec l'adhésion) et, **seulement s'il n'exerce
nulle part ailleurs**, bloque son compte Supabase Auth (`ban_duration` de 100 ans : plus de connexion ni de
renouvellement de session). Son profil et tout ce qu'il a produit sont conservés ; ceux dont il était le supérieur n'en ont
plus. Refus : sa propre révocation (400), un membre d'un autre cabinet (404), le dernier administrateur (409
`LAST_ADMIN`). **Rétablir** = le réinviter avec la même adresse (`POST /api/team`), qui lève le blocage avant de
rattacher le compte existant (un échec de déblocage n'empêche pas le rattachement).

`POST /api/team/:id/reset-password` envoie à un membre du cabinet un lien de récupération à usage unique
(`generateLink({ type: 'recovery' })`, `/reset-password`) par `sendPlatformMail` : aucun mot de passe n'est choisi ni
transmis, et le lien n'est **jamais renvoyé** à l'administrateur (`emailSent` / `emailError` seulement). Écran : actions
« Réinitialiser le mot de passe » et « Révoquer l'accès » dans la liste de `/team` (`TeamMembers.tsx`, administrateurs).

**Erreur « Database error saving new user »** : GoTrue insère dans `auth.users` avec `supabase_auth_admin`, dont le
`search_path` n'a pas `public`. `handle_new_user()` écrivait `INSERT INTO profiles` sans schéma et faisait échouer la
création du compte. `supabase/migrate_fix_handle_new_user_search_path.sql` qualifie `public.profiles`, fixe
`SET search_path = public, pg_temp` et ne laisse plus une anomalie de profil bloquer la création (la route fait de toute
façon un upsert du profil). **Toute fonction de trigger sur `auth.users` doit qualifier ses tables.**
