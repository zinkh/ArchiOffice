---
paths:
  - "packages/archioffice-agents/**"
  - "mcp-server.ts"
  - "server/agent*.ts"
  - "server/routes/agent*.ts"
  - "server/mcp*.ts"
  - "src/components/agents/**"
  - "src/pages/Agent*.tsx"
---

# Agents IA et serveur MCP

> Règles extraites du CLAUDE.md racine, sans modification de contenu. Chargées quand Claude lit un fichier correspondant aux chemins ci-dessus.

### Écriture du DPGF par les agents et le MCP (`manage_dpgf`)

`manage_dpgf` (`projectWorkTools.ts`, scope `projects`, donc aussi exposé au MCP) ajoute, modifie
ou supprime des LIGNES du DPGF d'une opération, au lieu d'un UPDATE SQL sur `dpgfs` ou de
l'envoi du document entier. L'outil n'est qu'un client de `POST /api/projects/:id/dpgf/lignes`
(`server/routes/dpgf.ts`), qui applique l'opération par `server/dpgfLignes.ts` (pur, testé,
`tests/dpgfLignes.test.ts`) : même jeton, même cabinet que l'écran.

- **Actions** : `add_lignes` (lot, chapitre par numéro ou titre, défaut « DESCRIPTION DES OUVRAGES »,
  jusqu'à 300 lignes par appel, numérotation `<chapitre>.<n>` à la suite, `replace_existing` pour
  écraser une ligne vide « Nouvel article »), `update_ligne` et `delete_ligne` (par `id` ou numéro ;
  la suppression passe par la confirmation en deux temps, un `dry_run` serveur en donne l'aperçu).
  Il ne crée ni DPGF, ni lot, ni chapitre : le lot doit exister (`manage_project_lots`).
- **Jamais touchés** : un chapitre `cctpOnly`, et une ligne qui porte un `cctpDescription`
  (conservée par `replace_existing`, refusée en suppression). Une nouvelle ligne n'a ni
  `batimentId`, ni `phaseId`, ni `trancheId` : `batimentId: ''` voudrait dire « aucun bâtiment, sans
  héritage », l'absence « hérite du chapitre ou du lot ».
- **Un appel est accepté en entier ou refusé en entier** (quantité et prix numériques et positifs,
  lot et chapitre existants) ; erreurs en français, avec la liste des lots ou chapitres disponibles.
  Rejouer `add_lignes` ajoute de nouveau : refaire un import passe par `replace_existing`.
- **Totaux** : `prixTotal` des lignes touchées, `sousTotal` de chaque lot, `totalHT` et `totalTTC`
  (champ `TVA` du document, 20 % à défaut) ; le récapitulatif rend les lignes ajoutées par lot et
  les sous-totaux.
- **Limite de la concurrence, à connaître** : `dpgfs` n'a ni `updated_at` ni version (aucune
  migration n'a été faite) et le texte `data` est trop gros pour une comparaison dans une requête
  PostgREST. La route sérialise donc les écritures par DPGF dans le processus et RELIT le document
  juste avant d'écrire (trois essais, puis 409). Cela couvre des appels d'agent simultanés et la
  plupart des enregistrements de l'application web, pas la fenêtre de quelques millisecondes entre
  la relecture et l'écriture, ni plusieurs instances du serveur. L'autosauvegarde de l'écran réécrit
  de toute façon le document entier : une colonne `updated_at` (ou une fonction SQL atomique) serait
  la vraie réponse, à décider séparément.

### Intervenants d'une affaire (agents et MCP)

Les intervenants (`project_stakeholders`, liste « Intervenants » de la fiche) ne sont pas une
ressource de `AGENT_RESOURCES` : ils vivent dans la fiche affaire (`stakeholders_list`) et
s'écrivent par `PUT /api/projects/:id/stakeholders`, qui REMPLACE toute la liste. Un agent
n'avait donc aucun moyen d'y toucher et créait une tâche « mettre à jour les intervenants » à la
place. `manage_project_stakeholders` (`projectStakeholdersTool.ts`, scope `projects`, exposé au
MCP) fait `list`, `add` et `remove` : il relit la liste (`/full`), y applique la demande et
renvoie l'ensemble. Une ligne existante garde son identifiant (les présences de compte rendu s'y
rattachent), un doublon (même contact, même rôle) est ignoré, un contact se désigne par
`contact_id` ou par son nom exact (plusieurs fiches homonymes : refus et liste des candidats),
un rôle est obligatoire. `remove` passe par la confirmation en deux temps de `delete_record`.

### Fiche d'un nouveau contact entreprise (agents)

`contactEnrichmentSection` (`systemPrompts.ts`) : tout agent qui écrit sur `contacts` (Sophie comprise) et qui peut chercher sur le web cherche, quand une entreprise est ajoutée, ses coordonnées publiques (adresse, téléphone, e-mail, site, SIRET) et ses spécialités, puis PROPOSE de compléter la fiche, jamais d'écriture sans accord. Spécialités : `corps_etat` pour une entreprise (Gros œuvre, Couverture, Bardage...), `specialite` pour un bureau d'études, ajoutées aux existantes. Homonymes : l'agent demande lequel.

**Deux façons de chercher, selon les capacités réelles de l'agent** : la recherche web native (Gemini, Claude : `webSearchActive`) ou `fetch_url` seul, ce qui est le cas de **Mistral** (pas de recherche native sur Chat Completions). Avec `fetch_url` seul, l'agent interroge l'annuaire officiel `https://recherche-entreprises.api.gouv.fr/search?q=...&etat_administratif=A&per_page=5` (JSON sans clé, le même service que `/api/entreprises/search` ; il donne SIRET, adresse, code NAF, ni téléphone ni e-mail) puis le site de l'entreprise (champ `website`, ou adresse fournie par l'annuaire ou l'utilisateur, jamais inventée). **`fetch_url` n'y est autorisé que par exception** à la règle « URL fournie par l'utilisateur », sur ces deux sources seulement (la description de l'outil, `tools.ts`, le dit aussi). Un indice code NAF vers métier est donné (43.91B couverture, 43.91A charpente, 41.20 gros œuvre...), présenté comme « déduit du code NAF » ; un métier fin comme le bardage ne se déduit pas d'un code et vient du site.

La règle dépend des capacités, pas du texte du prompt : elle survit à `system_prompt_override`, et aucune migration n'est nécessaire. Absente si l'agent n'écrit pas sur les contacts, ou n'a ni recherche web ni `fetch_url`. `corps_etat`, `specialite`, `siret` et `website` rejoignent les champs connus de la ressource `contacts`. Test : `tests/agentContactEnrichment.test.ts` (cas recherche native, `fetch_url` seul, les deux, aucun). Non vérifié contre un vrai modèle Mistral.

### Couverture des agents : outils d'opération, documents, Markdown

Au-delà des ressources CRUD de `AGENT_RESOURCES`, des outils écrits à la main couvrent ce que la
fiche affaire porte en listes ou en routes imbriquées (`projectWorkTools.ts`, scope `projects` ou
`meetings`, exposés au MCP) : `manage_project_lots`, `manage_project_cotraitants`,
`manage_project_members`, `manage_project_journal` (phase en cours et notes de phase),
`manage_observations`, `manage_meeting_attendees`. Même règle partout : rejouer est sans risque,
retirer passe par `needs_confirmation` puis `confirm: true`. **Le changement de phase reste un
geste humain** (checklist de contrôles, `POST /api/projects/:id/phase`). Réglages, équipe et
facturation restent hors des agents.

`AGENT_RESOURCES` gagne `rfis`, `avenants_moe`, `gpa_reserves`, `time_entries` et quatre sous-éléments
d'appel d'offres (`tender_*`). Deux drapeaux : `listParam` (liste lue par parent, `parent_id` dans
`search_records`/`get_record`) et `mergeOnUpdate` : le PUT de ces routes remet à null ou à zéro les
colonnes absentes du corps (notes d'une réunion, valeur et surface d'un appel d'offres...), donc
`update_record` relit l'enregistrement et renvoie TOUTES ses colonnes avec les champs fournis par-dessus.
À ne pas activer sur une route qui reprend le corps tel quel (`...req.body`) ou valide un schéma strict.

`documentTools.ts` : `list_documents` et `read_document` pour le chat (capacité `docsRead`), et
`attach_to` dans un bloc `artifact` pour ranger le fichier généré sur une fiche (seulement un type de
fiche du périmètre d'écriture de l'agent, jeton de la personne). Le MCP garde ses propres versions.

`businessTools.ts` couvre les modules sans route de collection à plat, chacun protégé par un scope
existant (`BUSINESS_TOOL_SCOPES`, aucune migration) : `manage_situations` (scope
`marches_entreprises` : cumul présenté/admis, période déduite, certify/reopen/mark_paid ; il ne
calcule JAMAIS retenue, révision, TVA ni net à payer, et refuse une situation saisie ligne par ligne),
`manage_project_notices` (list/read/write/generate, remplacer un texte rédigé passe par
confirmation, les notices réglementaires restent des brouillons), `manage_consultation` (entreprises
consultées de l'ACT : écrit la consultation ENTIÈRE en ne changeant que `entreprises`, jamais d'envoi
de DCE), `create_invoice_from_note` (scope `invoices`, montants confirmés avant génération) et
`manage_calendar` (scope `meetings` : agenda agrégé réunions + jalons + tâches + Google, création,
déplacement et suppression d'événements Google). Les événements Google passent par
`POST/PATCH/DELETE /api/google-calendar/events` (`server/googleCalendarEvent.ts`, pur et testé :
fuseau Europe/Paris, jour entier à fin exclusive) ; ce sont des événements propres, que
« Synchroniser » (jalons et tâches) ne reprend ni ne supprime. La ressource `invoices` accepte
maintenant les lignes (`items`) et se supprime tant qu'elle est en brouillon (le serveur refuse le
reste) ; le numéro n'est jamais écrit par un agent.

**Réponses d'agent en Markdown** : `client/chatMarkdownParser.ts` (analyse pure, testée) puis
`ChatMarkdown.tsx` rendent titres, listes, tableaux, gras et liens sans HTML brut. Seuls http(s),
mailto, tel et les chemins relatifs sont des liens ; un lien vers l'application navigue sans recharger.

### Import de notes dans un CR de chantier (agents et MCP)

`import_site_report_notes` (`packages/archioffice-agents/src/server/siteReportNotesTool.ts`) range
des notes déjà structurées dans le BROUILLON d'un CR de chantier : `rubriques` (site_report_notes),
`observations` (rattachées au CR, lot résolu comme `add_site_report_observation`), `decisions` et
`meeting_notes` (ajoutées à la suite du texte existant). L'outil n'interprète rien : l'agent lit
d'abord la source (`read_email`, `read_email_attachment`, `read_document`) et fait le tri. Il suit les
mêmes garde-fous que les autres outils DET : scope `projects`, jeton de la personne (API REST en boucle
locale), jamais sur un CR diffusé, un seul brouillon choisi d'office sinon demande, doublons ignorés
(comparaison sans casse : rejouer un import ne change rien), un lot introuvable ou une ligne refusée
n'arrête pas le reste (`non_importes`, `lots_possibles`). Décisions et notes passent par UN `PUT
/api/reports/:id`, qui réécrit format, intervenants et prochaine réunion depuis le corps : l'outil les
renvoie tels que lus. Exposé au MCP sans code propre : `buildAgentTools(MCP_CAPS)` le reprend.

### Dictée vocale

Un micro dans la barre de saisie du chat (`client/useDictation.ts`). Le texte
reconnu se dépose dans la zone de texte et s'y **arrête** : la dictée n'envoie
jamais d'elle-même. Une reconnaissance vocale se trompe, et un agent qui écrit
dans la base ne doit pas agir sur une phrase que personne n'a relue.

Deux moteurs derrière la même interface, parce qu'aucun ne couvre tous les
postes :

| | « navigateur » | « serveur » |
|---|---|---|
| Mécanique | `SpeechRecognition` (Web Speech API) | `MediaRecorder` puis `POST /api/agents/transcribe` |
| Où | Chrome, Edge, Safari | partout où l'on peut enregistrer : Firefox, client Electron |
| Restitution | au fil de la parole | à l'arrêt de l'enregistrement |
| Coût | nul | jetons IA du cabinet, au tarif audio |

Le moteur navigateur passe en premier quand il existe. Le moteur serveur prend
le relais là où il n'existe pas — **et là où il existe mais ne fonctionne
pas** : dans le Chromium d'Electron, `webkitSpeechRecognition` est présent
mais échoue en `network`, le service de reconnaissance de Google étant lié à
un navigateur et pas à une application (même raison que pour le Web Push, plus
bas). D'où la bascule sur erreur, et pas seulement sur absence.

Trois points côté serveur :

1. **La transcription retranscrit, elle ne répond pas.** Une dictée est presque
   toujours une instruction adressée à un agent (« demande à Sophie de
   préparer le devis ») : un modèle laissé libre y répond au lieu de l'écrire.
   La consigne de `gemini.ts` le lui interdit explicitement, à `temperature: 0`.
2. **Le fournisseur de transcription ne suit pas forcément celui du chat.**
   `resolveTranscriptionProvider()` garde le fournisseur actif s'il sait lire
   de l'audio, et bascule sur Gemini sinon : Claude n'accepte aucune entrée
   audio, et la transcription Mistral (Voxtral) se facture à la minute, hors
   du catalogue au jeton sur lequel toute la facturation repose. Sans ce repli,
   un cabinet basculé sur Claude depuis `/admin` aurait un micro inerte alors
   que la clé Gemini de l'instance est là.
3. **Les jetons audio se facturent à leur propre tarif**
   (`ModelCost.audioInputUsdPerM`, 1,00 $/M contre 0,50 $/M en texte chez
   Gemini). Ils comptent dans les colonnes d'entrée de `agent_token_usage` ;
   c'est `endpoint_type = 'transcription'` qui les distingue. Un modèle sans
   tarif audio publié facture l'audio au tarif texte : une modalité non tarifée
   ne doit jamais ressortir moins chère que celle qu'on tarife.

Le vocabulaire du cabinet (sigles du métier, noms de projets) est soufflé au
moteur à chaque appel. Sans lui, « le CCTP du projet Villa Martin » ressort
phonétiquement, or c'est exactement ce que la dictée sert à nommer.

### Synthèse vocale

Symétrique de la dictée : un haut-parleur sur chaque message d'agent
(`client/useSpeech.ts`), qui lit à voix haute le texte déjà affiché. Rien à
faire relire ici — contrairement à la dictée, le texte a déjà été validé par
un humain avant d'arriver dans le chat (tapé par l'utilisateur, ou une réponse
d'agent déjà affichée à l'écran) : la synthèse ne fait que le prononcer.

Mêmes deux moteurs que la dictée, pour la même raison — aucun ne couvre tous
les postes :

| | « navigateur » | « serveur » |
|---|---|---|
| Mécanique | `speechSynthesis` (Web Speech API) | `POST /api/agents/speak`, lu via `<audio>` |
| Où | partout où des voix système sont installées | là où il n'y en a pas |
| Coût | nul | jetons IA du cabinet |

Le navigateur passe en premier. Le serveur prend le relais quand le premier
échoue, **pas seulement quand il est absent** : `speechSynthesis` existe dans
le Chromium d'Electron mais peut n'y exposer aucune voix, et `speak()` avale
alors la consigne sans jamais déclencher ni `start` ni `error` — un silence
au-delà d'un court délai (`BROWSER_START_TIMEOUT_MS`) vaut donc une panne,
exactement comme la dictée y échoue en `network` pour la même raison (le
moteur est lié au navigateur, pas à l'application).

Deux points côté serveur :

1. **La voix passe toujours par un modèle TTS dédié**
   (`DEFAULT_GEMINI_TTS_MODEL`, `gemini-2.5-flash-preview-tts`), jamais par le
   modèle de chat actif : aucun modèle de chat, chez aucun des trois
   fournisseurs, ne produit de l'audio en sortie. `resolveSpeechProvider()`
   n'a donc pas la branche « garder le fournisseur actif » de
   `resolveTranscriptionProvider()` — il n'y a rien à garder, seul Gemini sait
   faire, quel que soit le fournisseur choisi pour le chat dans `/admin`.
2. **Gemini TTS rend du PCM brut**, qu'aucun lecteur ne sait ouvrir sans
   conteneur. `pcmToWav()` (`gemini.ts`) l'enveloppe dans un en-tête WAV
   minimal (44 octets) plutôt que de dépendre d'une bibliothèque pour un
   format aussi simple à écrire soi-même.

La route répond en binaire (`audio/wav`), pas en JSON : un fichier encodé en
base64 gonflerait le transfert d'un tiers pour rien. Le coût et le solde
restant voyagent en en-têtes (`X-Cost-Eur-Cents`, `X-Remaining-Balance-Cents`)
plutôt que dans un corps qui n'est déjà plus du JSON.

### Écritures d'agent : schéma, défauts, erreurs

`AGENT_RESOURCES` (`packages/archioffice-agents/src/types.ts`) porte, pour
chaque ressource, quatre choses en plus de son libellé : `knownFields` (les
colonnes réellement acceptées), `required`, `enums` (vocabulaire fermé) et
`defaults`. `prepareRecord()` (`server/tools.ts`) s'en sert avant chaque
écriture pour écarter les champs inconnus, normaliser la casse des valeurs à
choix fermé et poser les défauts manquants — chaque intervention étant
rapportée au modèle (`champs_ignores`, `valeurs_par_defaut`) pour qu'il la
répercute à l'utilisateur.

Sans cette couche, un modèle qui invente un schéma plausible
(`validity_period`, `payment_terms`, `phases`) ou qui écrit `draft` au lieu de
`Draft` recevait un « Validation error » sans nom de champ, parce que le
tableau `details` de `validateBody()` était jeté avant d'atteindre le modèle.
Il n'avait alors aucun moyen de se corriger et enchaînait les variantes au
hasard. Le détail de l'erreur, les champs acceptés et le vocabulaire attendu
lui reviennent désormais en entier.

La posture correspondante est écrite dans le prompt (`systemPrompts.ts`) :
l'agent exécute une demande explicite sans la faire valider, ne réclame jamais
un champ facultatif, et rend compte de ses hypothèses **après** coup.

### Capacités et autonomie des agents

Au-delà du chat et des écritures CRUD (`action_scopes`), un agent porte quatre
capacités indépendantes, une colonne chacune sur `agents`, réglées par
l'architecte depuis `/agents/:id/edit` :

| Colonne | Outils exposés | Fichier |
|---|---|---|
| `web_fetch_enabled` | `fetch_url` | `server/webFetch.ts` |
| `mail_enabled` / `mail_send_enabled` | `search_emails`, `list_emails`, `read_email`, `send_email` | `server/mailTools.ts` |
| `geo_enabled` | `search_address`, `get_parcelle_cadastrale`, `get_zone_plu`, `get_risques`, `get_monuments_historiques` | `server/geoTools.ts` |
| `docs_read_enabled` | `read_cctp`, `read_dpgf` | `server/projectDocTools.ts` |

Comme les outils CRUD, tout passe par l'API REST de l'application en boucle
locale avec le jeton de l'utilisateur : un agent n'a jamais plus de droits que
la personne qui lui parle. `capabilitiesFromAgent()` (`src/types.ts`) est le
seul endroit qui traduit les colonnes en capacités, et il impose l'invariant
« pas d'envoi de mail sans lecture ».

Deux mécanismes tournent sans qu'on leur pose de question :

- **Alertes métier** — `server/agentAlerts.ts`. Un cycle (hebdomadaire par défaut,
  `AGENT_ALERTS_INTERVAL_HOURS` pour le changer) relit
  l'état de chaque cabinet et crée une alerte par situation anormale (études
  engagées sans contrat MOE signé, chantier sans OS, facture échue, réserves
  non levées, devis sans réponse, échéance d'AO, contrat signé non facturé,
  réunion sans compte rendu, tâches en retard). Chaque règle est activable et
  a un seuil réglable (`agent_alert_rules`). Une alerte est dédupliquée par
  `dedup_key` et refermée automatiquement quand sa cause disparaît.
- **Exécutions planifiées** — `packages/archioffice-agents/src/server/scheduler.ts`.
  Un agent exécute une consigne à cadence fixe et rend un compte rendu.
  Volontairement **en lecture seule** : hors session il n'existe aucun jeton
  utilisateur à transmettre à l'API interne, et fabriquer un jeton de service
  contournerait les contrôles que les actions d'agent traversent justement.

### Bibliothèque de connaissances des agents

`knowledge_enabled` (`supabase/migrate_agent_knowledge.sql`), une colonne de
plus sur `agents` réglable depuis `/agents/:id/edit`, off par défaut et
jamais héritée d'un template — même traitement que `web_search_enabled`.
Ferme le trou signalé par l'architecte : un agent ne pouvait s'appuyer que
sur `firm_knowledge` (l'historique interne du cabinet) ou sur des documents
joints AU MESSAGE COURANT, jamais sur un document déposé une fois pour
toutes pour lui — une réglementation, un DTU, une notice technique.

**Aucune nouvelle table.** `'agents'` rejoint `ATTACHABLE_RESOURCE_TYPES`
(`server/routes/documents.ts`) : un document de bibliothèque est une ligne
`documents` ordinaire, avec `resource_type = 'agents'` et `resource_id`
l'agent visé. Le dépôt, la liste et la suppression passent par
`<ResourceAttachments resourceType="agents" resourceId={agent.id} />`
(`src/components/ResourceAttachments.tsx`), affiché sur `/agents/:id/edit`
dès que `knowledge_enabled` est coché — le même composant générique que la
fiche permis, sans code dédié.

**Auto-injecté à chaque tour, jamais via un tool.** `buildAgentContext()`
(`packages/archioffice-agents/src/server/context.ts`) lit, quand
`capabilitiesFromAgent(agent).knowledge` est vrai, les documents
`resource_type = 'agents'` de CET agent (`resource_id = currentAgentId`),
en extrait le texte (`extractKnowledgeDocText()` — pdf-parse, mammoth, OCR
en repli sur un PDF scanné ; jamais de vision, une réglementation étant du
texte et non une photo) et les pose dans `ctx.knowledgeDocuments`. Même
principe que `firm_knowledge` : pas de recherche, pas de `tool` que le
modèle appellerait — le contenu est simplement dans le prompt
(`BIBLIOTHÈQUE DE CONNAISSANCES DE CET AGENT`, `systemPrompts.ts`), sous
`docContentsSection`/`firmKnowledgeSection` et donc lu même quand
`system_prompt_override` remplace tout le prompt généré (même raison que
ces deux sections).

**Plafonné pour rester un coût de jetons prévisible, pas un RAG.**
`MAX_KNOWLEDGE_DOCS` (10 documents) et `MAX_KNOWLEDGE_DOC_CHARS` (6000
caractères, tronqué au-delà) bornent ce qui part dans CHAQUE tour de CHAQUE
conversation avec cet agent — volontairement pensé pour des pièces courtes
à moyennes (notices, extraits de DTU), pas pour un corpus réglementaire de
plusieurs centaines de pages : ce dépôt n'a pas de recherche par mots-clés
ni d'embeddings, tout document déposé est relu en entier. `/agents/:id/edit`
le dit explicitement dans le texte d'aide du réglage.

### Apprentissage des agents : proposer, jamais appliquer

Un agent qui se voyait corrigé, ou qui butait sur une capacité qu'il n'avait
pas, n'avait aucun moyen de le retenir au-delà de la conversation en cours —
au tour suivant, il repartait de zéro. `learning_enabled`
(`supabase/migrate_agent_learning.sql`), une colonne de plus sur `agents`
réglable depuis `/agents/:id/edit`, off par défaut et jamais héritée d'un
template (même traitement que `knowledge_enabled`), donne accès à l'outil
`suggerer_amelioration(kind, titre, contenu, capacite_suggeree?)`
(`packages/archioffice-agents/src/server/learningTools.ts`).

**Trois natures de proposition**, jamais appliquées seules — même principe
que `needs_confirmation` sur `create_record` : mémoriser une correction,
signaler une capacité manquante ou rédiger une note change durablement le
comportement d'un agent, ça se confirme, ça ne se déduit jamais.

- `correction` — l'utilisateur vient de corriger une réponse ou une
  hypothèse de l'agent.
- `missing_capability` — l'agent n'a pas pu répondre correctement faute d'un
  outil ou d'un accès qu'il n'a pas ; `capacite_suggeree` nomme la colonne
  concernée (`mail_enabled`, `geo_enabled`...) pour que l'écran de revue
  pointe directement vers `/agents/:id/edit`.
- `knowledge_note` — l'agent propose lui-même une note pour sa mémoire (une
  règle ou une préférence du cabinet apprise en tâche).

**Retours de l'utilisateur depuis le chat** (`supabase/migrate_agent_learning_feedback_kinds.sql`).
Sous chaque réponse d'un agent qui a `learning_enabled`, trois boutons ouvrent
`FeedbackModal` (`AgentChat.tsx`) : `correction` (corriger une erreur), `note`
(un fait à retenir) et `improvement` (une amélioration à apporter). Ils déposent
une proposition `pending` par le MÊME `POST /api/agent-learning-suggestions` que
l'outil (`as_agent_id` revalidé, `learning_enabled` exigé) : une seule file, un
seul écran de revue, aucune seconde route. Les boutons n'apparaissent pas pour un
agent qui n'apprend pas ; l'envoi est confirmé par un message qui rappelle que la
proposition attend la validation d'un administrateur. Une instance qui avait joué
l'ancienne migration porte l'ancienne contrainte sur `kind` : la migration
complémentaire la remplace.

**Seul un administrateur valide.** `PUT /api/agent-learning-suggestions/:id` passe par
`requireRole('admin')`, injecté en dernier paramètre de `registerAgentRoutes` (comme
pour les missions et le RAG) ; sans garde injectée la route répond 403 plutôt que de
s'ouvrir. N'importe quel membre peut en revanche DÉPOSER une proposition : elle reste
`pending` et n'atteint le prompt qu'une fois approuvée. L'écran `/agents/apprentissage`
masque les boutons de validation aux autres rôles
(`tests/agentLearningGuard.test.ts`).

**Une file d'attente, pas une écriture définitive.** L'outil dépose la
proposition dans `agent_learning_suggestions`, statut `pending` — jamais dans
`documents` ni dans le prompt. L'architecte la revoit depuis
`/agents/apprentissage` (`AgentLearning.tsx`) et l'approuve ou la rejette
(`PUT /api/agent-learning-suggestions/:id`) ; `POST` (appelé par l'outil,
`as_agent_id`) revalide l'agent comme `POST /api/feed/posts` revalide
`as_agent_id` — introuvable, inactif ou sans `learning_enabled` est refusé.
Une proposition déjà traitée ne peut pas être retraitée (409).

**Seule une proposition *approuvée* devient mémoire, et jamais pour
`missing_capability`.** `buildAgentContext()` (`context.ts`) relit,
quand `learningEnabled` est vrai, les lignes `agent_learning_suggestions` de
CET agent au statut `approved` de ces natures (`correction`, `note`, `improvement`,
`knowledge_note`), dans
`ctx.learningNotes` — auto-injecté à chaque tour comme
`knowledgeDocuments`, jamais via un `tool`, jamais tant que le statut reste
`pending` (`MÉMOIRE D'APPRENTISSAGE`, `systemPrompts.ts`, plafonné à
`MAX_LEARNING_NOTES`/`MAX_LEARNING_NOTE_CHARS` — du texte court déjà en base,
pas un document à extraire). Une proposition `missing_capability` approuvée
ne déclenche RIEN d'automatique côté agent : approuver documente seulement
que l'architecte a vu la demande, activer la capacité reste un geste
volontaire distinct depuis `/agents/:id/edit` — jamais l'écran de revue lui-
même.

### Pièce jointe illisible : jamais passée sous silence

Incident du 12 octobre 2026 : un `.xls` de suivi de réserves (Stenay) joint au chat de Sophie n'avait
aucun extracteur, `buildAgentContext` l'écartait sans rien dire, et le modèle, qui savait qu'un fichier
était joint, en a inventé le contenu (cinq « réserves AOR » d'un autre projet) puis a créé des tâches
dessus. Trois garde-fous, à ne pas défaire :

- **Les tableurs sont lus** (`spreadsheetText.ts` : `.xls`, `.xlsx`, `.xlsm`, `.ods`, un bloc par onglet,
  noms d'onglets en tête, troncature annoncée), dans le chat (`context.ts`) comme dans
  `extractDocumentText` (outils MCP, pièces jointes de mail).
- **Un document joint non lu est TOUJOURS signalé** : `markUnread()` (`context.ts`) pose « CONTENU NON LU »
  dans `documentContents` pour un fichier introuvable, un format non pris en charge, un fichier vide,
  une erreur de lecture ou un délai dépassé. Plus aucun `return` muet dans cette boucle.
- **Règle de prompt** (`systemPrompts.ts`, `docContentsSection`, valable même avec
  `system_prompt_override`) : seul le contenu présent entre les repères existe, un onglet ou une ligne
  absents se disent, et on cite les lignes exactes reprises avant toute création d'enregistrement.

### Pas de création sans source (tous les agents)

Le prompt seul n'arrête pas un modèle qui hallucine : le contrôle est fait par le SERVEUR
(`packages/archioffice-agents/src/server/provenance.ts`, `tests/provenance.test.ts`). `create_record`,
`create_site_report`, `add_site_report_observation` et `import_site_report_notes` exigent
`source: { type, citation }` ; `executeAgentAction` refuse la création (`SOURCE_NON_VERIFIEE`, avant tout
appel réseau) si la citation (12 caractères utiles au moins) ne figure pas, hors casse, accents et
ponctuation, dans le `SourceCorpus` du tour : messages de la PERSONNE (historique compris), contenu des
documents joints lus, résultats des outils de LECTURE. Exclus : les messages de l'agent lui-même, les
résultats d'outils d'écriture et `consulter_agent`, pour qu'une invention ne puisse pas se citer.

Limites assumées : une image jointe ne se vérifie pas par texte (`image_jointe` accepté tant qu'une image
est jointe) ; une citation exacte prouve que la source existe, pas que l'enregistrement la reprend
fidèlement ; la liaison MCP (conversation hors de ce serveur) n'est pas contrôlée ; `update_record` n'est
pas couvert. La règle est aussi posée dans le prompt (`SOURCE_RULE`), même sous `system_prompt_override`.

### Délégation entre agents

Incident du 7 septembre 2026 : un agent avait créé 19 CCTP vides en réponse à
des demandes qui visaient en réalité la Bibliothèque d'ouvrages, faute d'outil
sur `articles_type` et de tout moyen de savoir qu'un collègue, lui, l'avait.
`AgentContext.colleagues` (`context.ts`) ferme cette boucle : à chaque appel,
`buildAgentContext()` liste les autres agents **actifs** du cabinet (jamais
l'agent lui-même — d'où le nouveau paramètre `currentAgentId`), avec leur nom,
leur métier et le libellé humain de leurs ressources autorisées (déduit de
`AGENT_RESOURCES` à partir de leur `action_scopes`).

Toujours peuplée, **sans condition de `context_scopes`** : à la différence des
projets, contacts ou du référentiel du cabinet, savoir qui d'autre existe dans
le cabinet n'expose aucune donnée métier — la restreindre derrière un scope
n'aurait fait que réintroduire le trou qui a causé l'incident pour certains
agents.

`buildAgentSystemPrompt()` (`systemPrompts.ts`) traduit cette liste en une
règle explicite (« Une demande qui sort de ton métier... ») : nommer le
collègue dont le rôle ou les ressources correspondent plutôt que d'improviser
avec la ressource la plus proche, et demander franchement à l'utilisateur qui
s'en occupe si aucun collègue listé ne convient — jamais deviner. La règle
survit à un `system_prompt_override` complet (comme les notes fetch_url et
messagerie) : elle vient des données (`ctx.colleagues`), pas du texte du
prompt, donc un architecte qui réécrit tout le prompt d'un agent ne doit pas
perdre au passage sa capacité à rediriger vers un collègue.

Sans `delegate_enabled` (capacité suivante), la délégation reste une
**suggestion faite à l'utilisateur** : nommer la bonne personne et le laisser
basculer de conversation lui-même.

### Consultation entre agents et flux d'activité

Deux capacités indépendantes, dans le même esprit que `web_fetch_enabled` —
une colonne de plus sur `agents`, réglable depuis `/agents/:id/edit`, off par
défaut (`supabase/migrate_agent_interop.sql`) :

| Colonne | Outil | Fichier |
|---|---|---|
| `delegate_enabled` | `consulter_agent` | `server/delegateTools.ts` |
| `notify_users_enabled` | `publier_flux_activite` | `server/notifyTools.ts` |

**`consulter_agent(agent_id, message)`** fait ce que la suggestion ci-dessus
ne pouvait pas : obtenir la réponse du collègue **dans le même tour**, plutôt
que renvoyer l'utilisateur ouvrir une autre conversation. Il n'existe pas de
notion de « conversation entre agents » séparée — la question part par
`POST /api/agents/:id/chat` sur la conversation du collègue **avec le même
utilisateur**, avec son jeton (même principe que le reste des outils
d'agent : « une action se comporte exactement comme si l'utilisateur l'avait
faite lui-même »). La consultation est donc facturée normalement, aux
crédits du même tenant, et s'enregistre pour de vrai dans l'historique du
collègue — pas un aparté hors système.

Un seul niveau : l'en-tête `X-Agent-Delegation`, posé sur cet appel imbriqué,
retire `consulter_agent` des outils de ce tour côté route de chat
(`routes.ts`), quel que soit le réglage du collègue consulté. Sans ce
garde-fou, deux agents qui se renvoient la question boucleraient
indéfiniment, chaque tour étant facturé. `AgentChatResponse.consulted` fait
remonter qui a été consulté ; `AgentChat.tsx` bascule alors automatiquement
sur la conversation de ce collègue pour montrer sa réponse (après un court
délai, le temps de lire d'abord celle de l'agent interrogé) — c'est ce qui
« ouvre son onglet ».

**`publier_flux_activite(message)`** est le pendant pour un vrai utilisateur :
poster dans Notifications & Flux d'activité, sous le nom de l'agent
(`feed_posts.user_id`/`user_name`, validés côté serveur contre `agents` par
`as_agent_id` — jamais un nom envoyé tel quel). Aucun nouveau canal : même
table, même mécanique de mention (`@Prénom Nom`, `server/routes/activityFeed.ts`)
que le flux humain, donc les mêmes notifications système. `AgentContext.teamMembers`
(comme `colleagues`, toujours peuplé, sans condition de `context_scopes` : ce
sont des noms, pas une donnée métier) donne à l'agent le nom exact à
reprendre — la mention n'y répond qu'à une correspondance stricte avec
`profiles.name`.

### Recherche web des agents

`web_search_enabled` (`supabase/migrate_agent_web_search.sql`), une colonne de
plus sur `agents` réglable depuis `/agents/:id/edit`, off par défaut et jamais
héritée d'un template (même traitement que `web_fetch_enabled`). Contrairement
à `fetch_url` ou aux outils cartographiques, ce n'est PAS une déclaration de
fonction que `buildAgentTools()` ajoute et qu'`executeAgentAction()` exécute :
c'est le tool NATIF de recherche web du fournisseur IA actif du cabinet —
`google_search` chez Gemini, `web_search_20250305` chez Claude — exécuté côté
fournisseur. Ni Gemini ni Claude ne renvoient d'appel d'outil à notre charge
pour ça ; ils rendent directement une réponse déjà sourcée.

`LlmProvider.supportsWebSearch` (`llm/types.ts`) dit si le fournisseur actif
sait le faire ; `routes.ts` calcule `webSearchActive = caps.webSearch &&
!!provider.supportsWebSearch` une fois par requête et le passe à la fois à
`provider.chat({ ..., webSearch })` et à `buildAgentSystemPrompt()`, pour que
le prompt ne promette jamais une capacité que le tour n'aura pas.

**Mistral n'est pas de la partie.** `web_search`/`web_search_premium` de
Mistral n'existent que via son API Conversations (`/v1/conversations`) — sa
propre documentation précise que Chat Completions, l'endpoint que
`mistral.ts` appelle, ne les supporte pas : la réponse de Chat Completions ne
porte pas les références de résultat de recherche que ces tools renvoient.
`mistral.ts` ne déclare donc pas `supportsWebSearch`, et la capacité reste
sans effet — dégradé, mais honnête, plutôt qu'un réglage qui échouerait
silencieusement ou ferait échouer l'appel API — tant qu'un cabinet fait
tourner ses agents sur Mistral plutôt que sur Gemini ou Claude.

### Documents produits par un agent

`server/artifacts.ts` fabrique les fichiers demandés dans un bloc
```` ```artifact ```` (docx, pdf, xlsx, csv). Tous portent la charte du cabinet
lue dans `settings` par `server/agencyIdentity.ts` : logo et coordonnées en
en-tête, adresse et SIRET en pied de page, pagination « P1|2 » en bas à droite.

### Connecteur MCP : changer d'agence sans reconnecter

Un architecte qui exerce dans plusieurs structures (AAZS, AACZ) change d'agence depuis le connecteur par trois outils
(`packages/archioffice-agents/src/server/mcp/agencyTools.ts`) : `list_agencies` (seulement les agences dont la personne est
membre, son rôle, l'agence active), `get_active_agency` et `switch_agency` (`agency_id` exact, ou `query` : nom, code court ou
sigle, ex. « AACZ »). Plusieurs correspondances : `needs_clarification` avec les candidats, rien n'est choisi.

- **Persistance** : `mcp_connections.active_tenant_id` (`supabase/migrate_mcp_active_agency.sql`), propre à UNE connexion.
  NULL = jamais changé : la connexion reste sur le cabinet du consentement (`tenant_id`, celui affiché dans l'interface
  web à ce moment), donc les liaisons existantes ne changent pas. Le cabinet affiché dans le navigateur n'est jamais relu.
  Le renouvellement du jeton conserve la sélection. Instance non migrée : `switch_agency` échoue proprement (rien ne change).
- **Droits revérifiés à chaque appel** (`resolveAccessToken`, annuaire `server/mcpAgencyDirectory.ts` sur
  `tenantMemberships.ts`) : la colonne est une préférence, jamais une autorisation. Appartenance perdue : `AGENCY_ACCESS_DENIED`
  sur les outils de données comme sur `/api` (403), sans repli sur une autre agence ; les trois outils d'agence restent utilisables
  pour en sortir. Codes : `AGENCY_UNKNOWN`, `AGENCY_ACCESS_DENIED`, `AGENCY_NOT_SELECTED`, `AGENCY_SWITCH_NOT_CONFIRMED`,
  `AGENCY_MISMATCH`, `AGENCY_CONFIRMATION_REQUIRED`.
- **Une agence stable par appel** (`mcp/dispatch.ts`) : instantané pris au début de l'appel, transmis aux appels internes par
  `X-Tenant-Id` ; le middleware `/api` n'accepte cet en-tête pour un jeton `mcp_at_` que si la personne est membre maintenant.
  Un `switch_agency` en cours d'exécution ne redirige donc pas un appel déjà démarré. Le ticket `create_upload_url` reprend ce même cabinet.
- **Garde-fou `agency_id`** sur chaque outil de données (refus si différent de l'agence active). Une fois qu'une connexion a
  changé d'agence, `confirm: true` EXIGE `agency_id`. Curseur de `list_projects` préfixé par le cabinet (`AGENCY_MISMATCH` ailleurs).
- **Réponses** : `_meta.agency` ({ id, name, slug }) toujours, champ `agency` en tête d'un résultat objet, second bloc de
  contenu pour une liste (le premier bloc garde sa forme). Instructions MCP : `MCP_INSTRUCTIONS` (`httpServer.ts`).
- Tests : `tests/mcpAgencySwitching.test.ts` (vrai endpoint `/mcp`, données fictives).

### Pièces jointes polymorphes et MCP

`documents` ne se rattachait jusqu'ici qu'à un projet (`project_id`) : une
fiche sans projet — un permis (PC/DP/AT), un appel d'offres, un devis — n'avait
aucun moyen de porter un fichier, alors que le cas déclencheur (un CERFA rempli
et ses notices sur une fiche `permits`) en avait justement besoin.
`supabase/migrate_documents_attachments.sql` ajoute `resource_type` (défaut
`'projects'`) et `resource_id`, backfillé depuis `project_id` : toute ligne
existante garde son sens, et l'onglet Documents d'une affaire continue de
filtrer par `project_id` sans y toucher. `mime_type`/`size_bytes` rejoignent
aussi `documents` elle-même (`document_versions` n'avait que `size_bytes`) :
les lire à la demande aurait voulu rouvrir la dernière version à chaque appel.

**`ATTACHABLE_RESOURCE_TYPES`** (`server/routes/documents.ts`) est une liste
explicite plutôt qu'un import d'`AGENT_RESOURCES` : certaines clés de ce
jeu-là (`references`, `articles_type`...) ont un `basePath` qui ne
correspond PAS au nom réel de leur table, et `assertTenantEntity()` prend le
nom de table tel quel — une liste vérifiée à la main évite un `.from()` sur
la mauvaise table. `POST /api/documents` valide `resource_id` avec
`assertTenantEntity` dès que `resource_type !== 'projects'`, exactement
comme le fait déjà `project_id`. Le dossier logique sur l'espace de stockage
du cabinet (`folderPathForResource`) niche sous le projet de la ressource
quand elle en porte un (un permis a toujours un `project_id`), et retombe
sur un sous-dossier nommé d'après la ressource sinon (devis, appels
d'offres, qui n'ont pas encore d'affaire).

**Le MCP ArchiOffice** (`packages/archioffice-agents/src/server/mcp/tools.ts`)
gagne six outils écrits à la main — `upload_document`, `list_documents`,
`get_document`, `read_document`, `import_email_attachment`,
`delete_document` — aucun ne rentrant dans le moule générique
`create_record`/`update_record` (un upload porte un fichier binaire encodé
en base64, pas un objet JSON). Ils réutilisent tels quels
`POST/GET/DELETE /api/documents` : `upload_document`/`import_email_attachment`
partagent `depositDocument()`, qui reconstruit un `FormData`/`Blob` en
mémoire (Node 22, pas de dépendance ajoutée) plutôt que d'ouvrir une route
JSON parallèle, et `get_document`/`read_document` partagent
`downloadAttachedDocumentBytes()`, qui repasse par
`GET /api/storage/signed-url` (le même mécanisme que l'ouverture d'un
document côté navigateur) avant de retélécharger les octets — aucune
nouvelle route de lecture de fichier n'a donc été nécessaire.
`import_email_attachment` (voir « Lecture des pièces jointes de messagerie
par les agents » plus haut) est le seul des six à combiner cette écriture
avec une lecture côté messagerie (`mailAttachmentTools.ts`).
Limite commune 25 Mo (`MAX_MCP_FILE_BYTES`), plus basse que la limite serveur
(50 Mo, `server/documentUpload.ts`) : chez `upload_document`/`get_document`,
un fichier voyage en base64 dans l'appel JSON-RPC lui-même, environ un tiers
plus volumineux que l'original — `import_email_attachment`/`read_document`
n'ont pas ce détour (octets ou texte extrait directement) mais gardent la
même limite, par cohérence avec le reste de cette famille d'outils.
`delete_document` suit la même confirmation en deux temps que
`delete_record`/`consulter_agent` (`needs_confirmation` puis `confirm: true`)
— exception délibérée à la règle « jamais de suppression depuis une liaison
externe » : retirer UNE pièce jointe n'a pas les conséquences de supprimer
la fiche elle-même.

`DOCUMENT_RESOURCE_TYPES` (mcp/tools.ts) est une copie à la main de
`ATTACHABLE_RESOURCE_TYPES` : ce paquet n'importe rien du serveur hôte (même
raison que la copie de `parseStorageRef` dans `context.ts`), donc pas de
source commune possible — les deux listes doivent être maintenues ensemble.

**Côté écran**, `src/components/ResourceAttachments.tsx` est le pendant
générique : liste/dépose/supprime les pièces jointes d'une fiche donnée
(`resourceType`/`resourceId`), câblé pour l'instant sur la fiche permis
(`ProjectDetail.tsx`, ligne dépliable). Les autres ressources attachables
pourront le réutiliser tel quel quand leur propre écran de détail existera.

### Chat des agents : pièces jointes, rappels, nouvelle discussion

Panneau (`AgentChat.tsx`) et page (`AgentChatPage.tsx`) partagent les mêmes briques. Règles à garder :

- **Trombone = menu** (`DocumentPicker`) : prendre une photo (`capture`, visible au doigt seulement, `pointer-coarse:`), choisir un fichier, ou reprendre un document de la GED. Le téléversement passe par `uploadChatDocument` (`chatUpload.ts`, `POST /api/documents`, catégorie « Assistant IA »). Avant, seul le glisser-déposer envoyait un fichier : rien n'existait sur téléphone. Les pièces jointes sont une rangée dans le flux (`AttachedDocChips`), pas une couche en position absolue.
- **Contrôles de saisie à 44 px** (trombone, micro, champ, envoi) sur un même axe ; libellé du champ « Votre message… » (16 px au doigt, donc on raccourcit le texte plutôt que la police).
- **Rappels IA repliés** derrière une ligne d'alerte avec une flèche (état mémorisé dans `localStorage`, `agent_chat_suggestions_open`) ; cliquer « Rédiger un rappel » referme la liste et remplit le champ.
- **« Nouvelle discussion »** (clé `agent_chat_clear`, bouton d'en-tête) **supprime** la conversation en cours après confirmation : l'historique des discussions n'existe pas encore (voir ROADMAP.md, « Saved conversation history »). Ne pas laisser croire à un archivage.
- **Bouton « Arrêter »** (`ChatRequestStatus`) : petite pastille, zone de touche de 44 px par `before:-inset-2`.
- **Le bouton flottant « Assistants IA » est masqué sur `/agents/:id/chat`** (il recouvrait l'envoi). Le panneau se tient 88 px au-dessus du bas, au-dessus de la pastille mobile de 60 px (`MobileShortcutBar`, boutons de 48 px).

### Écriture des textes du CCTP par les agents et le MCP (`manage_cctp`)

`manage_cctp` (`projectWorkTools.ts`, scope `projects`, donc aussi exposé au MCP) est le pendant de `manage_dpgf` pour le
TEXTE du CCTP : client de `POST /api/projects/:id/cctp/textes` (`server/routes/dpgf.ts`), appliqué par
`server/cctpTextes.ts` (pur, `tests/cctpTextes.test.ts`), même verrou et même relecture que `.../dpgf/lignes`.

- **Actions** : `set_texte` et `append_texte` (cible `lot`, `chapitre` ou `article`, 20 000 caractères au plus, `[b]` pour le
  gras), `add_articles` (jusqu'à 100, sans quantité ni prix ; dans un chapitre `cctpOnly` ou avec `cctp_only`, ni unité).
- **Jamais de perte silencieuse** : `set_texte` sur un texte existant exige `remplacer: true` ; l'outil fait d'abord un
  `dry_run` et renvoie `needs_confirmation` (ancien et nouveau texte) avant `confirm: true`. `append_texte` ajoute à la suite.
- **Marqueur « en cours »** posé par une personne : 409, `forcer: true` seulement sur demande explicite.
- Quantités et prix restent à `manage_dpgf` : cet outil n'en écrit jamais.

### Lecture paginée du CCTP, du DPGF et du BPU (`read_cctp`, `read_dpgf`, `read_bpu`)

Incident de novembre 2026 : « articles incomplets en lecture MCP ». `read_cctp` plafonnait un lot à 60 articles et chaque texte à
1 200 caractères, sans le dire : les chapitres suivants sortaient avec `articles: []` et le modèle prenait la tranche pour le tout.
`read_dpgf` et `read_bpu` s'arrêtaient à 120 lignes avec un simple `tronque`. Les trois outils (`projectDocTools.ts`, exposés au MCP
par `buildAgentTools(MCP_CAPS)`) suivent désormais une règle commune, à ne pas défaire : **une lecture coupée se dit et se reprend**.

- **Totaux exacts, toujours** : `nb_articles_total` / `nb_articles_retournes` (CCTP), `nb_lignes_total` / `nb_lignes_retournees`
  (DPGF), `nb_articles_lot_total` / `nb_articles_retournes` (BPU). Tous les articles sont comptés, même ceux qui ne sont pas rendus.
- **Pagination** : le CCTP rend ses articles dans un budget de 60 000 caractères par appel (`MAX_CHARS_PER_CALL`, environ 15 000
  jetons), le DPGF et le BPU dans la limite de 300 lignes (`MAX_LIGNES_PER_LOT`). Au-delà, `tronque: true` et
  `suite: { offset, consigne }` : rappeler l'outil avec le même `lot` et cet `offset`, jusqu'à ce que `tronque` disparaisse. Un
  modèle ne conclut jamais sur une lecture `tronque`.
- **`read_cctp` : deux paramètres de plus** : `chapitre` (numéro ou titre, pour ne lire que lui) et `article` (numéro, avec `lot` :
  texte intégral jusqu'à 30 000 caractères, `MAX_FULL_ARTICLE_CHARS`). Un texte coupé à 1 200 caractères en lecture de lot porte
  `longueur_totale` et `texte_complet`, qui nomme l'appel à faire pour le lire en entier.
- **Ce que compte `offset`** : les articles terminaux pour le CCTP et le BPU (une ligne à sous-articles ne compte pas), toutes les
  lignes y compris les parents pour le DPGF. Pour le CCTP, il est relatif aux chapitres sélectionnés.
- Tests : `tests/agentAutonomy.test.ts` (lot de 151 articles relu page par page jusqu'au dernier, chapitre seul, article entier).
  Toute nouvelle limite sur une lecture doit livrer, avec elle, son total et sa reprise.
