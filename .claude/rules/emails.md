---
paths:
  - "server/mail*.ts"
  - "server/emailSender.ts"
  - "server/emailAttachments.ts"
  - "server/routes/mail*.ts"
  - "server/routes/gmailSync.ts"
  - "server/routes/outlookSync.ts"
  - "server/routes/imapMailSync.ts"
  - "server/routes/googleCalendar*.ts"
  - "server/calendarAccounts.ts"
  - "src/components/Mail*.tsx"
  - "src/components/mail/**"
  - "src/pages/Mailbox.tsx"
  - "src/pages/Calendar.tsx"
---

# E-mails, messagerie et calendriers

> Règles extraites du CLAUDE.md racine, sans modification de contenu. Chargées quand Claude lit un fichier correspondant aux chemins ci-dessus.

### Pièces jointes d'un e-mail : jamais relayées brutes à nodemailer

`POST /api/send-email` relayait `attachments` tel que reçu, or nodemailer lit pour une pièce
jointe `path` (fichier du serveur), `href` (adresse, donc le réseau interne), `raw`,
`headers`... : toute personne connectée pouvait se faire envoyer `.env` ou une clé du serveur.
`sanitizeEmailAttachments()` (`server/emailAttachments.ts`, `tests/emailAttachments.test.ts`)
ne garde que `{ filename, content en base64, contentType }` : nom nettoyé (ni chemin ni
retour à la ligne), contenu décodé en `Buffer`, type de contenu vérifié, 20 pièces et 25 Mo
au plus. Tout le reste est retiré, et une pièce jointe sans contenu base64 est refusée en
400. Tout nouveau chemin qui envoie des pièces jointes venues d'un client doit passer par là,
ou par un fichier téléversé (`multer`), jamais par un objet nodemailer construit côté client.

### Expéditeur d'un e-mail : adresse de l'agence ou adresse personnelle par cabinet

Un même compte (contact@aazs.fr) exerce dans plusieurs agences et n'y écrit pas avec la même
adresse, ni avec celle de sa connexion : dans chaque agence, soit l'adresse générale de
l'agence (`settings.email`), soit son adresse personnelle DANS cette agence
(`tenant_memberships.sender_email`, `supabase/migrate_membership_sender_email.sql`, une ligne
par personne × cabinet). Réglée par la personne dans Réglages > « Mes paramètres de
messagerie » (champ visible quand « Envoyer depuis mon adresse personnelle » est choisi),
lue et écrite par `GET /api/me` / `PUT /api/team/:id` (`mailSenderEmail`, pour le cabinet ACTIF).

`server/emailSender.ts::resolveEmailSender()` décide pour `POST /api/send-email` et la
diffusion d'un compte-rendu : le choix de la personne (`profiles.sender_option`), à défaut
celui du cabinet (`settings.sender_option`). En « personnel » avec une adresse : `from` = cette
adresse, l'agence en copie, `Reply-To` sur elle. **Sans adresse enregistrée, ou sur une
instance non migrée, le message part de l'adresse de l'agence**, jamais sans expéditeur.

**L'adresse n'est JAMAIS lue dans la requête d'un client** : `userEmail`, que la route
acceptait comme expéditeur, est ignoré (n'importe qui de connecté aurait pu écrire au nom de
n'importe qui). Seule la personne règle sa propre adresse (un administrateur ne le fait pas à
sa place : 403) et une adresse invalide ou multiple est refusée (400). Tout nouvel envoi par le
SMTP du cabinet passe par `resolveEmailSender()`. Le SMTP du cabinet doit accepter d'envoyer
avec une adresse différente de son identifiant de connexion, ce qu'ArchiOffice ne peut pas
vérifier.

### Multi-comptes mail et multi-calendriers

`email_connections` et `calendar_connections` portaient chacune un index
`UNIQUE(user_id, provider)` : au plus une boîte Gmail, une Outlook, une IMAP
par utilisateur, une seule connexion Google Calendar. Un architecte a
pourtant plusieurs adresses (cabinet, personnelle, dédiée aux AO) et parfois
plusieurs calendriers utiles (agenda personnel + agenda partagé
« Chantiers »). `supabase/migrate_multi_mail_calendar.sql` lève ces index et
introduit le même principe déjà en place pour `document_templates` : une
colonne `is_default BOOLEAN` + un index unique **partiel**
`WHERE is_default = true`, qui garantit au plus un défaut par utilisateur
sans empêcher d'en avoir zéro ou plusieurs comptes.

**Mail** — `server/mailAccounts.ts` est le seul endroit qui décide quel
compte sert une requête : `resolveMailAccount(tenantId, userId, provider,
accountId?)` renvoie le compte nommé s'il appartient à l'utilisateur, sinon
son défaut, sinon le plus ancien. Il remplace les trois `getConnection()` en
`.maybeSingle()` que `gmailSync.ts`/`outlookSync.ts`/`imapMailSync.ts`
avaient chacun ; toutes leurs routes acceptent désormais un `accountId`
(query ou body) pour désigner un compte précis. `GET /api/mail/accounts`
(`server/routes/mailAccounts.ts`) remplace les six routes `GET .../status` +
`DELETE .../disconnect` propres à chaque fournisseur — un seul point d'entrée
qui liste toutes les boîtes de l'utilisateur, tous fournisseurs confondus,
sans jamais exposer un secret.

Le cache de jeton OAuth (`server/mailTokenCache.ts`,
`server/mailOAuthTokens.ts`) est keyé par `connection.id`, pas par
`user_id` comme avant ce changement — sans ça, deux comptes Gmail du même
utilisateur se serviraient mutuellement leur jeton d'accès.

Une boîte IMAP n'a pas de capacité d'envoi (le protocole n'en a simplement
pas) : `email_connections` porte donc en plus un SMTP propre au compte
(`smtp_host`/`port`/`username`/`password_encrypted`, chiffré comme
`imap_password_encrypted`). `server/mailSend.ts` envoie via le compte
résolu (Gmail, Outlook, ou IMAP+SMTP propre) ; `POST /api/send-email`
(factures, devis, notes d'honoraires, invitations d'équipe) tente d'abord
le compte par défaut de l'utilisateur avant de retomber sur le SMTP du
cabinet (`settings.smtp_*`) — c'est ce repli qui garde `/api/send-email`
fonctionnel pour un cabinet n'ayant connecté aucune boîte personnelle. Les
envois automatiques hors session (relances `server/dunning.ts`, alertes
`server/agentAlerts.ts`, mails de cycle de vie) restent, eux, sur le SMTP du
cabinet : aucun utilisateur n'est identifiable pour ces déclenchements, et
faire tourner un traitement de fond sur un jeton OAuth personnel serait le
secret partagé que le cadrage de cette fonctionnalité a justement écarté.

`packages/archioffice-agents/src/server/mailTools.ts` (`search_emails`,
`list_emails`, `read_email`, `send_email`) porte un paramètre `compte`
optionnel : un `GET /api/mail/accounts` résout le compte nommé ou le défaut,
en un seul appel — remplaçant les trois requêtes `/status` (une par
fournisseur, ordre figé) d'avant ce changement.

Deux tables filles gagnent la même désambiguïsation : `email_links.
connection_id` et `email_folder_links` (dont l'`onConflict` porte maintenant
sur `connection_id`, pas `user_id + provider`) évitent que deux comptes du
même fournisseur se marchent dessus sur un même `external_message_id` ou un
label partagé (deux comptes Gmail ont chacun un label « INBOX »).

**Calendrier** — une connexion Google Calendar est un **compte**, qui expose
plusieurs **calendriers** (`calendar_calendars`, nouvelle table) : `primary`,
un agenda partagé, etc. Deux booléens indépendants par calendrier :
`sync_enabled` (affiché en lecture dans `/calendar`) et `is_default` (la
cible d'écriture du push ArchiOffice → Google, unique par utilisateur, tous
comptes confondus — pas par calendrier). `server/calendarAccounts.ts` porte
la résolution (`resolveWriteCalendar`, `listReadCalendars`,
`refreshCalendarList` qui interroge `calendarList.list` chez Google) ;
`GET /api/google-calendar/events` agrège tous les calendriers `sync_enabled`
de tous les comptes et étiquette chaque événement de son `calendarId` et sa
couleur (`Calendar.tsx` les distingue désormais par cette couleur plutôt que
de tous les rendre dans le gris par défaut) ; `POST /api/google-calendar/sync`
écrit dans le calendrier `is_default` au lieu de `'primary'` en dur. Le
scope OAuth (`calendar.events` + `calendar.readonly`) a été élargi pour
permettre `calendarList.list` — un compte connecté avant cet ajout garde
l'ancien scope, plus étroit, et `calendarList` échoue alors en 403 avec la
même forme que Gmail/Outlook (`isInsufficientScopeError`), proposant de
reconnecter plutôt que d'échouer sans explication.

### Aperçu d'opération, brouillons, signature et classement des emails

**Volet « Plan d'actions »** (`ProjectOverview.tsx`, colonne D). Quatre gestes
ouvrent une autre page déjà **rattachée à l'opération** par l'adresse, jamais
par une sélection à refaire :

| Bouton | Destination | Rattachement |
|---|---|---|
| Courrier | `/document_templates?project=<id>` | `DocumentTemplates` préremplit le sélecteur d'affaire ET coche « enregistrer dans le projet » |
| Réunion | `/reunions?parent=project:<id>&new=1` | `Reunions.tsx` sélectionne l'affaire (mécanisme `?parent=` des liens d'agent) puis ouvre le formulaire de création ; `new` est posé APRÈS `selectProject`, qui referme ce formulaire |

Sous « Prochains jalons », **« Prochaines tâches »** lit `useTasks({ projectId })` :
les 5 premières tâches non terminées, échéance la plus proche d'abord (sans
échéance en dernier), en rouge si dépassée ; un clic mène à `?tab=TACHES`. Ce sont
bien des TÂCHES (`tasks`), distinctes des jalons (`milestones`) au-dessus.

**Réunions liées** (`src/components/LinkedMeetings.tsx`, logique pure dans
`src/lib/linkedMeetings.ts`, testée) : la même rubrique sur la fiche d'une affaire (volet
Plan d'actions), d'une proposition (rubrique repliable de la modale) et d'un appel d'offres
(onglet « Réunions »). Elle lit `GET /api/meetings?<parent>_id=` (à venir d'abord, puis les
passées) et ouvre une réunion par `/reunions?parent=<kind>:<id>&open=<id>`. Le parent du lien
se déduit de la RÉUNION et non de la fiche (`meetingParent`) : une visite de proposition
rattachée aussi à l'affaire n'est listée par `/reunions` que sous la proposition. `/reunions`
résout `?parent=project:` sur toutes les affaires, terminées comprises (`allProjects`),
même si sa colonne de gauche masque ces dernières.

**Brouillons modifiables** (`CorrespondenceTab.tsx`, `MailDraftEditModal.tsx`,
`server/mailDraft.ts`, `server/routes/mailDrafts.ts`). Un brouillon vit dans la
boîte du fournisseur et n'est **jamais copié en base** : `GET /api/mail/drafts?
account_id=` (20 récents), `GET /api/mail/drafts/:id?account_id=` (À, Cc, objet,
corps) et `PUT /api/mail/drafts/:id` (réécrit, n'envoie jamais). `account_id` est
toujours relu parmi les comptes de l'utilisateur. Gmail : `drafts.update` ; Outlook :
`PATCH /me/messages/:id` (le corps repasse en texte brut) ; IMAP : pas de mise à
jour possible, donc APPEND de la nouvelle version PUIS suppression de l'ancienne
(un échec entre les deux laisse un doublon, jamais un brouillon perdu) et l'uid
change. Aucun lien brouillon → opération n'est stocké (aucune migration) :
l'onglet montre par défaut les brouillons adressés au client de l'affaire ou dont
l'objet/l'extrait mentionne son nom, son code ou sa référence
(`relatedKeywords`), avec un bascule « tous les brouillons ».

**Signature de courrier** : `profiles.mail_signature` (TEXT,
`migrate_profile_mail_signature.sql`), personnelle et non par cabinet (même
principe que `show_personal_contacts`), réglée dans Réglages > Mon profil, lue et
écrite par `GET /api/me` / `PUT /api/team/:id` (`mailSignature`, 2000 caractères
maximum). `MailComposeModal` la pose sous le corps d'un nouveau message ou d'une
réponse ; elle reste modifiable avant l'envoi. Les envois automatiques hors
session (relances, alertes) ne la portent pas : aucune personne à qui l'attribuer.

**Rattacher un email à une opération le classe dans sa boîte d'origine**
(`server/mailFiling.ts`, appelé par `POST /api/mail/links`). Uniquement pour
`local_type = 'project'`, avec un `connection_id`, sauf `file_in_mailbox: false` :

| Fournisseur | Emplacement | Effet |
|---|---|---|
| Gmail | libellé `ArchiOffice/<code> - <nom>` | libellé posé ET `INBOX` retiré (le message quitte la boîte de réception) |
| Outlook | dossier `<code> - <nom>` sous un dossier racine `ArchiOffice` | déplacement |
| IMAP | dossier `ArchiOffice<délimiteur><code> - <nom>` (préfixe `INBOX.` si le serveur l'impose) | déplacement, dossier abonné |

Dossier et libellé sont créés à la demande, retrouvés par leur nom exact sinon ;
`projectFolderName()` retire séparateurs et caractères réservés (`/ \ : * ? " < > | .`)
et plafonne à 60 caractères. Trois règles à ne pas défaire :

1. **Outlook et IMAP renumérotent le message déplacé** (id Graph, uid). C'est le
   NOUVEL identifiant qui est enregistré dans `email_links.external_message_id`
   (rendu aussi dans la réponse) ; sans cela le lien ne rouvrirait plus rien. IMAP
   lit `uidMap` et, sans UIDPLUS, retrouve le message par son Message-ID. Gmail
   garde son id : un libellé n'est pas un déplacement. Le front retire le résultat
   de la liste plutôt que de laisser un bouton sur l'ancien emplacement.
2. **Meilleur effort, jamais bloquant.** Le rattachement est enregistré même si le
   classement échoue ; la réponse porte `filing: { status: 'filed' | 'failed' |
   'skipped', folder?, error? }` et l'écran affiche l'erreur. Cas typique : un compte
   Gmail connecté avant `gmail.modify` ou un jeton Outlook sans `Mail.ReadWrite`
   (proposer de reconnecter, comme pour l'archivage).
3. **Retirer le lien ne remet pas le message en place** : le classement dans la
   boîte est un geste de l'architecte, pas un état que l'application maintient.
