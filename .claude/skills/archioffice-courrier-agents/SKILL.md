---
name: archioffice-courrier-agents
description: "Messagerie utilisée par les agents ArchiOffice : lecture des pièces jointes d'e-mail, import sur les fiches, recherche IMAP, courrier entrant par transfert vers un alias, jeton de relais mail_at_, revue matinale des mails. À utiliser pour toute modification de server/agentMailInbox.ts, agentMailReview.ts, agentMailRelayTokens.ts, mailAttachmentTools.ts ou de la recherche IMAP."
---

# ArchiOffice : courrier agents

> Contenu extrait du CLAUDE.md racine, sans modification.

### Lecture des pièces jointes de messagerie par les agents

`read_email` (`mail_enabled`) rapportait déjà les pièces jointes d'un
message (nom, taille) mais aucun outil ne pouvait en ouvrir le contenu : un
agent qui avait identifié le bon email (« envoie des documents Blénod-lès-
Pont-à-Mousson ») restait incapable d'exploiter le plan, le diagnostic ou
l'esquisse qui y était joint, faute de tout accès à ces octets — il ne
pouvait que le dire à l'utilisateur, comme cité dans l'incident qui a motivé
cette capacité.

**`mail_attachments_enabled`** (`supabase/migrate_agent_mail_attachments.sql`),
une colonne de plus sur `agents` réglable depuis `/agents/:id/edit`, est un
palier distinct de `mail_enabled` — même principe que `mail_send_enabled`/
`docs_write_enabled` : `capabilitiesFromAgent()` exige les deux
(`mail_enabled` ET `mail_attachments_enabled`), off par défaut et jamais
hérité d'un template. Ouvrir une pièce jointe télécharge des octets
externes et peut déclencher un OCR — plus coûteux qu'une simple lecture de
corps de message — et mérite d'être activé sciemment plutôt qu'allumé
d'office avec la lecture de la boîte.

**`read_email_attachment(id, attachment_id, compte?)`**
(`packages/archioffice-agents/src/server/mailAttachmentTools.ts`) prend le
relais de `read_email`, qui rapporte désormais `attachments[].id` et
`.mimeType` en plus du nom et de la taille (`mailTools.ts`) — sans eux, un
agent qui avait lu un message n'avait aucun moyen de désigner laquelle de
ses pièces jointes ouvrir. Le téléchargement passe par les mêmes routes
internes que l'ouverture d'une pièce jointe côté écran
(`GET /api/gmail/messages/:id/attachments/:attachmentId`,
`.../outlook/...`, `.../mail/imap/messages/:folder/:uid/attachments/:id`) :
aucune nouvelle route serveur n'a été ajoutée, seul un nouvel appelant
interne s'en sert.

**Texte seul, jamais de vision native.** `ctx.documentImages` (vision, voir
plus haut) n'est peuplé qu'AVANT le premier appel au modèle, à partir des
documents joints AU MESSAGE — un résultat d'outil obtenu EN COURS de tour
n'a aujourd'hui aucun moyen d'y ajouter une image. Une pièce jointe scannée
ou photographiée retombe donc sur l'OCR texte (`ocrDocument`, `ocr.ts`),
exactement comme un fournisseur sans vision dans `context.ts` : dégradé,
mais honnête, plutôt qu'un tool qui prétendrait lire une image qu'il ne
transmet pas réellement au modèle. Une pièce jointe trop volumineuse
(20 Mo) est refusée avant tout téléchargement plutôt que de faire échouer
l'extraction après coup, et le contenu extrait est plafonné à 20 000
caractères (`MAX_EXTRACTED_TEXT_CHARS`,
`packages/archioffice-agents/src/server/documentTextExtraction.ts`) — assez
pour un devis ou une notice de plusieurs pages, sans devenir un corpus à
parcourir. L'extraction elle-même (`extractDocumentText`, PDF/DOCX/texte
brut avec repli OCR) vit dans ce module partagé, réutilisé tel quel par
`read_document` ci-dessous : même geste, une seule implémentation.

**Exposée au MCP, avec un pont vers les fiches du cabinet.** Un cas réel l'a
révélé : un email « 71 BLANDAN Devis signe » avec deux PDF en pièces
jointes, retrouvé par `search_emails`, mais impossible à lire ni à rattacher
à l'affaire depuis le connecteur MCP — `read_email_attachment` existait déjà
côté chat interne, mais `MCP_CAPS.mailAttachments`
(`packages/archioffice-agents/src/server/mcp/tools.ts`) était à `false`.
Il est passé à `true` : `read_email_attachment` rejoint `MCP_TOOLS` via
`buildAgentTools()`, sans route ni outil supplémentaire à écrire. Deux
outils MCP écrits à la main complètent le pont :

- **`import_email_attachment(id, attachment_ids | attachment_id, resource,
  resource_id, category?, description?, compte?, force?)`** dépose une ou
  plusieurs pièces jointes d'un email déjà lu directement sur une fiche du
  cabinet — réutilise `getFullMessage`/`downloadAttachmentBytes`
  (`mailAttachmentTools.ts`, désormais exportées) côté lecture et
  `depositDocument` (factorisé hors d'`upload_document`, même `POST
  /api/documents`) côté écriture. Le fichier ne transite jamais en base64
  par le modèle : il va de la messagerie au stockage sans détour. Un
  doublon (même nom, même taille déjà présents sur la fiche) est refusé et
  signalé plutôt que déposé en double, sauf `force: true`.
- **`read_document(resource, resource_id, document_id)`** lit le texte d'une
  pièce déjà attachée à une fiche (import ci-dessus, ou tout document
  existant) avec les mêmes extracteurs et la même limite que
  `read_email_attachment` — préférable à `get_document` (qui renvoie du
  base64 que le modèle ne peut pas lire) pour analyser un PDF ou un DOCX.

### Recherche IMAP : objet ET corps, pas le corps seul

`GET /api/mail/imap/search` (`server/routes/imapMailSync.ts`) posait le
paramètre libre `q` sur le critère IMAP `body` : un mot présent uniquement
dans l'objet d'un message (« Blandan » dans « 71 BLANDAN Devis signe »)
n'était donc jamais trouvé par `search_emails query="Blandan"`, alors que
`subject="Blandan"` le trouvait — un comportement qui ne correspondait à
aucune des deux autres messageries (le `q` libre de Gmail matche déjà
objet + corps + le reste, tout comme `$search` chez Outlook/Graph).
`buildImapSearchCriteria()`, extraite en fonction pure et testable sans
serveur IMAP (`tests/imapSearchCriteria.test.ts`), pose désormais `q` sur
`text` (IMAP SEARCH TEXT, RFC 3501) — qui couvre les en-têtes, objet compris,
ET le corps — au lieu de `body`.

### Courrier entrant : transfert d'un email vers un agent

Jusqu'ici, aucun mécanisme de réception de mail n'existait dans
ArchiOffice : le SMTP configuré (`settings.smtp_*`) est strictement
sortant, et les connecteurs Gmail/Outlook/IMAP ne font que du pull à la
demande sur la boîte d'UN utilisateur humain (`email_connections`,
`user_id NOT NULL`). `server/agentMailInbox.ts` relève désormais
périodiquement une boîte IMAP **partagée**, propriété de la plateforme et
non d'un utilisateur, pour qu'un email transféré à un alias dédié soit pris
en charge par un agent — sans nouveau prestataire webhook, en réutilisant
l'infrastructure IMAP déjà écrite (`ImapFlow`,
`server/mailFullMessage.ts`).

**Un seul alias par cabinet, un agent de triage désigné.** Pas d'alias par
agent : `settings.mail_triage_agent_id`
(`supabase/migrate_agent_mail_inbox.sql`) fixe, par cabinet, quel agent
traite tout ce qui arrive à son alias — réglable depuis `/settings`
(`AgentMailInboxCard.tsx`), avec la même vérification d'appartenance au
tenant que le reste des références inter-ressources de cette table
(`assertTenantEntity`, voir « Références inter-locataires non validées »).
L'alias lui-même se déduit de `tenants.slug` (le seul identifiant
réellement unique sur toute l'instance — `agents.slug` ne l'est que par
cabinet) : `agents+<slug-cabinet>@<domaine>` (`buildMailInboxAlias()`),
affiché dans la même carte.

**Le domaine se règle par cabinet, pas par l'instance.**
`settings.mail_inbox_domain` (`supabase/migrate_mail_inbox_domain.sql`) est saisi
par un administrateur dans la carte « Courrier entrant » (`/settings` > Agents IA),
normalisé et validé côté serveur (`normalizeMailInboxDomain`, 400 si ce n'est pas
un nom de domaine). Vide, il retombe sur `AGENT_MAIL_INBOX_ALIAS_DOMAIN`
(simple repli d'instance, facultatif), sinon la carte affiche un champ à
remplir et pas d'alias. `GET /api/settings` rend aussi `mailInboxAvailable`
(boîte IMAP partagée configurée) pour avertir qu'un domaine saisi ne relève
rien tant que l'opérateur n'a pas branché la boîte. Le routage ne lit que le
slug du `To` : le domaine ne sert qu'à composer l'adresse, c'est au
cabinet de le faire aboutir (MX ou redirection) vers la boîte partagée.

**Prérequis hors code, à ne jamais perdre de vue.** Cette adresse ne
fonctionne que si l'opérateur a réellement provisionné une boîte mail
(ex. chez Infomaniak) qui reçoit tous les sous-adressages `+` dans une
seule boîte IMAP (ou un alias/catch-all redirigé vers elle), avec un
enregistrement MX pointant dessus pour le domaine choisi. Ni le DNS ni la
création de la boîte ne sont du ressort de l'application — seuls les
identifiants IMAP de cette boîte partagée sont configurés côté serveur
(`AGENT_MAIL_INBOX_HOST/PORT/USERNAME/PASSWORD`, comme `SMTP_*`). Le job
reste inactif tant que ces variables manquent, comme le Web Push sans clés
VAPID : rien d'autre ne casse (`isMailInboxConfigured()`).

**Jamais d'action sans expéditeur reconnu.** L'en-tête `From` d'un
transfert n'est pas fiable (falsifiable), donc `processMessage()` ne se
contente pas de le lire : il cherche un `profiles.email` correspondant PUIS
vérifie son appartenance à CE cabinet (`findMembership()`,
`server/tenantMemberships.ts` — pas seulement `profiles.tenant_id` par
défaut, pour couvrir un architecte qui exerce dans plusieurs cabinets, voir
« Plusieurs cabinets pour une même personne »). Sans correspondance, le
message est ignoré silencieusement côté utilisateur (seulement loggé côté
serveur) — jamais d'action, même en lecture seule, pour un expéditeur non
reconnu.

**Le pont d'authentification `mail_at_`.** Traiter l'email avec les VRAIS
droits de la personne reconnue (`create_record`, écriture DPGF... selon ses
capacités) veut dire rejouer `POST /api/agents/:id/chat` en entier —
facturation réserve/règle, boucle d'outils, persistance de conversation —
pas réinventer une exécution parallèle. Mais ce point d'entrée exige un
`Authorization` Bearer validé comme un JWT Supabase, et le poller ne parle
à personne de vivant. `server/agentMailRelayTokens.ts` ajoute un troisième
préfixe reconnu par le middleware `/api` de `server.ts`, à côté des jetons
`mcp_at_` et `tg_at_` déjà dispatchés là : `mail_at_`, résolu par une
nouvelle table `agent_mail_relay_tokens`. Contrairement aux deux autres
(liaisons persistantes, révocables mais valables tant qu'elles ne le sont
pas), un jeton `mail_at_` ne vit que le temps d'UN appel — émis juste avant
de rappeler l'API interne, marqué consommé dès sa résolution (`used_at`),
expiré au bout de 5 minutes s'il n'a pas servi.

**Idempotence.** `agent_mail_inbox_processed(message_id_header, tenant_id,
processed_at)` protège contre un double traitement si le flag `\Seen` ne
tient pas ou si deux relevés se chevauchent — même prudence que
`article_prix_observations.source_ref` pour la remontée de prix BPU. Un
message est marqué `\Seen` dans tous les cas à la fin de son traitement, y
compris un échec (agent introuvable, appel interne en erreur) : un message
illisible ne doit pas être retraité indéfiniment à chaque relevé plutôt que
de bloquer les suivants.

**Corps et pièces jointes.** Le texte envoyé à l'agent réutilise
`extractDocumentText` (`packages/archioffice-agents/src/server/
documentTextExtraction.ts`, déjà écrit pour `read_email_attachment`/
`read_document`) pour chaque pièce jointe — aucune nouvelle logique
d'extraction — avec la même mise en garde que `read_email` : contenu
externe non fiable, jamais des instructions. Plafonné à
`MAX_ATTACHMENTS_PER_MESSAGE` (5) et `MAX_ATTACHMENT_BYTES` (20 Mo, même
plafond que `read_email_attachment`) pour qu'un transfert pathologique ne
bloque jamais tout un relevé.

**Restitution.** L'échange apparaît dans la conversation de l'agent de
triage comme un tour de chat normal (`agent_conversations`/
`agent_messages`, via la route existante) — pas de réponse email dans
cette première version. `notifyUsers()` (`server/push.ts`) prévient
seulement la personne reconnue qu'un email transféré a été traité, avec un
lien direct vers cette conversation.

### Revue matinale des mails par un agent

Chaque matin, l'agent choisi par la personne (Sophie) relit SA boîte, repère les
mails qui attendent une réponse et lui envoie une notification push par mail,
avec une proposition de réponse. Réglage personnel et non par cabinet (une boîte
mail l'est) : `agent_mail_reviews`, une ligne par couple cabinet x personne
(`supabase/migrate_agent_mail_review.sql`), réglée depuis `/settings`
(`AgentMailReviewCard.tsx`, avec « Lancer maintenant » et la dernière revue).

**Un job dédié, pas une exécution planifiée d'agent** : `scheduler.ts` est sans
outil, faute de jeton utilisateur hors session. `server/agentMailReview.ts` lit
les boîtes par la boucle locale (`executeMailTool`, `list_emails` puis
`read_email`) avec un jeton `mail_at_` de la personne, donc avec ses seuls droits.
Le modèle n'a aucun outil et rien n'est jamais ENVOYÉ : un mail piégé ne peut
produire qu'un texte de proposition. Seule écriture dans la boîte : chaque
proposition est enregistrée en BROUILLON (`create_draft`, jeton `mail_at_` propre
aux brouillons, `createReplyDrafts`) dans la boîte où le mail est arrivé, adressé
à l'expéditeur, objet « Re: ». Ce n'est pas une réponse dans le fil (nouveau
message). Meilleur effort : un brouillon qui échoue ne prive pas du push, il en
retire seulement la mention « Brouillon enregistré. ». Limite de débit de la route
de brouillons : 30 par 15 minutes et par personne, partagée avec ses envois.

- **Un seul appel au modèle** pour toute la revue (mails numérotés, sortie JSON
  `{"mails":[{n, reponse_attendue, urgence, raison, proposition}]}`), rattachée
  aux messages par leur numéro et non par un identifiant que le modèle recopierait.
- **Heure locale** (`hour_local` + `timezone`, 8 h Paris par défaut), pas une
  heure UTC : 8 h reste 8 h au passage à l'heure d'été. Lun-ven par défaut ; la
  fenêtre relue court depuis la dernière revue (20 à 72 h), donc le lundi couvre
  le week-end.
- **Écartés avant le modèle** : ses propres envois, les expéditeurs automatiques
  (`noreply`, newsletters...), le trop ancien. L'agent doit avoir `mail_enabled`.
- **Notifications** : une par mail (tag distinct, catégorie « Alertes IA » donc
  coupable depuis les préférences), plus une de synthèse au-delà d'un mail. Rien
  quand aucun mail n'attend de réponse. Lien vers `/mailbox`.
- **Échéance réservée avant la lecture** (mise à jour conditionnelle de
  `next_run_at`) : une revue longue ou un second processus ne la rejoue pas. Une
  revue manuelle ne déplace jamais l'échéance du matin (limitée à une toutes les
  2 minutes). Sans crédit IA, la revue est sautée comme une exécution planifiée.
- **Jeton de relais multi-usage** : `issueMailRelayToken(..., { maxUses })`. Le
  jeton ordinaire reste à usage unique ; `max_uses`/`use_count` ne sont écrites
  que pour une revue (qui rappelle l'API une cinquantaine de fois en quelques
  secondes), avec décompte conditionnel. Durée de vie inchangée : 5 minutes.
