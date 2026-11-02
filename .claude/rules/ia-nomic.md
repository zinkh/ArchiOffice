---
paths:
  - "packages/archioffice-agents/src/server/llm/**"
  - "packages/archioffice-agents/src/server/nomic.ts"
  - "packages/archioffice-agents/src/server/documentParser.ts"
  - "packages/archioffice-agents/src/server/ocr.ts"
  - "packages/archioffice-agents/src/server/documentTextExtraction.ts"
  - "server/routes/cctpGeneration.ts"
  - "server/routes/aiSuggestions.ts"
  - "server/routes/copilot*.ts"
  - "src/lib/copilotSuggestions.ts"
  - "src/components/CctpGenerateDialog.tsx"
---

# IA : fournisseurs, Nomic, OCR, suggestions

> Règles extraites du CLAUDE.md racine, sans modification de contenu. Chargées quand Claude lit un fichier correspondant aux chemins ci-dessus.

### AI (provider abstraction)

AI features (agent chat, CCTP generation) are called from the backend only — the frontend never talks to a model provider directly.

All model calls go through the provider-neutral layer in `packages/archioffice-agents/src/server/llm/`:

| File | Role |
|---|---|
| `llm/types.ts` | `LlmProvider`, `LlmMessage`, `LlmToolDef`, `LlmChatResult` — no vendor types |
| `llm/gemini.ts` | Gemini adapter (`@google/genai`) |
| `llm/anthropic.ts` | Claude adapter (`@anthropic-ai/sdk`) |
| `llm/mistral.ts` | Mistral adapter (plain `fetch`, OpenAI-shaped endpoint) |
| `llm/pricing.ts` | `MODEL_CATALOG` — each model's real cost, and `priceEurCents()` |
| `llm/config.ts` | The active provider and the model chosen per provider in `/admin`, cached, in `platform_settings` |
| `llm/index.ts` | `resolveLlmProvider()` — the single place that picks provider, model and key |

The two call sites are `packages/archioffice-agents/src/server/routes.ts` (agent chat, with the tool-calling loop) and `server/routes/aiSuggestions.ts` (CCTP articles). Neither imports a vendor SDK: add a provider by writing an adapter and registering it in `resolveLlmProvider()`, not by editing call sites.

Conversation state is held by the caller, not by an SDK chat object, because every provider we target is stateless. Tool definitions are plain JSON Schema (`parametersJsonSchema`), which maps onto all three without rewriting. An assistant turn also carries an opaque `raw` field — the provider's own content blocks, replayed verbatim — and les deux fournisseurs qui signent leur raisonnement en dépendent : les blocs de pensée de Claude et leurs signatures, et les `thoughtSignature` que Gemini 3 attache à chaque `functionCall` et exige de retrouver intacts au tour suivant. Reconstruire un appel d'outil à partir du seul couple (nom, arguments) perd cette signature, et Gemini répond alors 400 `Function call is missing a thought_signature` dès le deuxième appel d'un même échange.

**Selecting a provider.** Precedence, highest first: an explicit argument to `resolveLlmProvider()` (per-tenant BYOK, not built yet) → the `platform_settings.ai_provider` row set from the `/admin` back-office → `AI_PROVIDER`/`AI_MODEL` → Gemini. The stored setting outranks the environment on purpose, otherwise an instance that sets `AI_PROVIDER` could never be switched from the UI.

`describeLlmSelection()` resolves the pair from **one** source rather than field by field: a provider from one place and a model from another produce an invalid pair (Claude asked for a Gemini model). A source naming only a provider falls through to that provider's own default model.

**Un fournisseur par cabinet.** `tenants.ai_provider` / `ai_model` (`supabase/migrate_tenant_ai_provider.sql`, NULL = suit la plateforme) surchargent le réglage plateforme pour UN cabinet. Tous les appels qui savent pour quel cabinet ils tournent passent par `getTenantAiConfig(supabaseAdmin, tenantId)` (`llm/config.ts`) et non plus par `getPlatformAiConfig`, qui ne sert plus qu'à l'écran plateforme. Un cabinet avec un fournisseur mais sans modèle reçoit le modèle par défaut de CE fournisseur, jamais le modèle plateforme. Réglé par `GET/PUT /api/admin/tenants/:id/ai-provider` (mêmes refus que le réglage plateforme : fournisseur inconnu, modèle hors catalogue, clé absente ; `provider: null` rend le cabinet à la plateforme) depuis la fiche cabinet de `/admin`. La dictée et la synthèse vocale gardent leur repli Gemini quand le fournisseur du cabinet ne sait pas lire ou produire de l'audio.

API keys are never part of this. They stay in the environment, and `PUT /api/admin/ai-provider` refuses a provider whose key is missing rather than let an operator switch the platform onto a 503.

**Two invariants worth keeping:**

1. **A model absent from `MODEL_CATALOG` cannot run.** `resolveLlmProvider()` refuses it, because running a model we can't price means billing a tenant an invented amount. Adding a model means adding its real cost.
2. **Cost is a fact, margin is a knob.** Per-token cost differs ~10x between Gemini Flash and Claude Opus, so it lives per model in the catalogue; `AI_PRICE_MARKUP` is the single commercial lever on top. Every usage row records `provider` and `model` so a charge can be read back with the rate that produced it.

### Nomic : lecture des plans et génération du CCTP

Nomic n'a **pas d'API de chat** : ce n'est pas un quatrième fournisseur de
`llm/`, mais un moteur de lecture (`/v1/parse`) et d'extraction structurée
(`/v1/extract`) de pièces d'ingénierie. Client sans dépendance dans
`packages/archioffice-agents/src/server/nomic.ts`, protocole relevé sur le SDK
officiel : dépôt (`/v1/upload` puis PUT présigné), tâche, `/v1/status/:id`,
résultat par `result_url`.

**Moteur de lecture** (`documentParser.ts`) : `local` (pdf-parse + mammoth +
Tesseract) ou `nomic`, réglé dans `/admin` (« Lecture des documents »,
`GET/PUT /api/admin/document-parser`, stocké dans `platform_settings` sous
`document_parser`, même cache de 30 s que le fournisseur IA). Priorité :
`/admin` → `DOCUMENT_PARSER` → `local` ; basculer sur Nomic sans
`NOMIC_API_KEY` est refusé. Il s'applique à `extractDocumentText`
(pièces jointes de mail, `read_document`, courrier entrant), aux pièces jointes
d'un message d'agent (après la branche vision, qui reste préférée pour une
photo) et à `extractKnowledgeDocText` (analyse du DCE, génération du CCTP).
**Deux règles à garder** : un échec de Nomic retombe sur le moteur local
(`parseWithActiveEngine` rend `null`), et la bibliothèque de connaissances
d'un agent reste TOUJOURS locale (`allowNomic = false`) : relue à chaque tour,
elle serait refacturée à la page à chaque message. `server.ts` dépose le client
Supabase au démarrage (`setDocumentParserSettingsClient`), sur le patron de
`setExternalFileReader`.

**« Générer » dans l'éditeur CCTP** (`CctpGenerateDialog.tsx`,
`POST /api/projects/:projectId/cctp/generate`, `server/routes/cctpGeneration.ts`) :
l'architecte coche jusqu'à 10 pièces de l'affaire et choisit le moteur.
`llm` lit les pièces avec le moteur de lecture actif puis fait rédiger le
modèle IA de la plateforme (réserve → exécute → règle, `endpoint_type =
'cctp_generation'`) ; `nomic` dépose les fichiers bruts et laisse Nomic
Extract remplir le schéma lots > chapitres > articles en voyant le plan
lui-même. Le coût Nomic (lecture et extraction) est porté par le compte Nomic
de l'opérateur et **n'est pas refacturé** aux crédits du cabinet : il n'a pas
de tarif au jeton que `MODEL_CATALOG` pourrait porter, et inventer un montant
est exclu. La route ne réécrit jamais le document : la proposition
(`lotsDepuisGeneration`, `src/lib/cctpGeneration.ts`) s'ajoute APRÈS les lots
existants, quantités et prix à 0, chaque article marqué `genereParIa` (badge
« IA » dans l'arbre, comme « BIB » pour la bibliothèque), puis passe par
l'enregistrement habituel. Seules les pièces dont `project_id` est l'affaire
visée sont lues.

**Moteur « llm » : un lot à la fois.** Un seul appel pour tout le CCTP produisait un
JSON de plusieurs milliers de jetons, plus long que les délais des fournisseurs
(120 s chez Mistral) et des proxys. `CctpGenerateDialog` enchaîne donc, dans le
navigateur : `POST .../cctp/plan` (liste des lots, sans chapitres) puis
`POST .../cctp/generate-lot` par lot, trois à la fois (`cctpLotLimiter`, 60 par
minute et par personne). Chaque appel est facturé séparément (réserve → exécute →
règle) ; un lot en échec n'emporte pas les autres (« Réessayer les lots en
échec », « Insérer les lots obtenus »). Nomic reste sur `POST .../cctp/generate`.
**Cache de prompt** : les pièces (`cachePrefix`, `LlmChatParams`) sont placées en
tête de chaque appel, identiques du plan au dernier lot, avec le même `system`.
Claude les marque `cache_control` (écriture à 125 %, lecture à 10 %, ramenées en
jetons d'entrée équivalents dans `usage`) ; Gemini met en cache implicitement un
préfixe identique ; Mistral reçoit `prompt_cache_key` (`cacheKey`, condensé SHA-256
de cabinet, affaire et pièces, jamais de donnée en clair) et facture les jetons
servis par le cache (`usage.prompt_tokens_details.cached_tokens`) à 10 % : succès
possible mais jamais garanti, blocs de 64 jetons. Le
plan, lancé seul avant les lots, écrit le cache que les lots lisent ensuite. Le
texte extrait des pièces est gardé 15 min en mémoire, PAR PIÈCE (`pieceCache`), pour ne pas
relire ni réOCRiser les plans à chaque lot. **La lecture des pièces a sa propre route** :
`POST .../cctp/read-piece` (une pièce par requête, sans modèle ni crédit) est appelée une pièce après l'autre
par l'écran AVANT le plan. Lues dans la requête du plan, l'OCR d'un plan scanné plus l'appel au modèle dépassaient
le délai des passerelles (~60 s) et l'écran affichait « ArchiOffice est en cours de mise à jour » (502/503/504 sans
corps JSON). **Le choix des lots est en deux temps** : « Lister les lots » (lecture + plan) puis liste de cases à cocher
(tous cochés au départ, « Tout cocher / Tout décocher »), « Rédiger N lots » ne rédige que les lots cochés (chacun est
facturé) ; « Réessayer les lots en échec » ne reprend que les lots cochés. Cache par pièce : si une requête tombe sur une
autre instance du serveur, la pièce est relue (plus lent, jamais faux).

### OCR

`packages/archioffice-agents/src/server/ocr.ts` rattrape les documents sans
couche texte : `pdftoppm` (poppler-utils, installé par le Dockerfile) met les
pages en image, `tesseract.js` les reconnaît. Si l'un des deux manque, le
contenu injecté dit explicitement que le document est scanné et illisible,
plutôt que de le laisser passer pour vide.

**Une photo n'est pas un document scanné à plat, et ne doit plus passer par
Tesseract quand le fournisseur actif sait faire mieux.** Jusqu'ici, toute
pièce jointe sans couche texte — un PDF scanné aussi bien qu'une photo de
carte de visite ou de véhicule d'entreprise prise en perspective, avec
reflets et angle de vue — suivait le même chemin OCR. Tesseract, conçu pour
du texte scanné à plat, produit sur une photo réelle un texte incohérent
que le modèle « corrige » ensuite en une donnée plausible mais fausse
(incident constaté : une photo de camionnette d'entreprise de couverture a
donné lieu à un contact inventé — nom, société et téléphone différents de
tout ce qui figurait réellement sur le véhicule). Le modèle ne voyait alors
jamais les pixels de l'image, seulement le bruit OCR.

`LlmProvider.supportsVision` (`llm/types.ts`, vrai pour les trois adaptateurs
— `gemini.ts`, `anthropic.ts` et `mistral.ts`, dont les alias `-latest`
pointent vers des versions vision-capables de Large/Medium/Small, voir
docs.mistral.ai/studio/conversations/vision) dit si le fournisseur actif sait
lire une image jointe au message (`LlmMessage.images`, envoyée en vision
native — `inlineData` chez Gemini, un bloc `image` chez Claude, un
`image_url` en data URI chez Mistral). `buildAgentContext()` (`context.ts`)
route en conséquence chaque pièce sans couche texte : image directe
(`.jpg`/`.png`/`.webp`) ou page de PDF scanné rasterisée en PNG partent dans
`ctx.documentImages` quand `supportsVision` est vrai, jamais par Tesseract ;
sans fournisseur vision, le chemin OCR d'origine reste inchangé — dégradé,
mais honnête, plutôt que d'envoyer une image qu'il ignorerait ou refuserait.
`ctx.documentImages` est distinct de `ctx.documentContents` : ce dernier
reste du texte injecté dans le prompt système, les images voyagent en pièce
jointe réelle du message utilisateur (`routes.ts`).

Ça ne suffit pas à éliminer toute erreur de lecture — une photo floue ou mal
cadrée reste une photo floue ou mal cadrée pour un modèle vision. D'où la
section IMAGES JOINTES du prompt (`systemPrompts.ts`) : ne rapporter que ce
qui est clairement lisible, dire explicitement « illisible » pour un champ
incertain plutôt que de le compléter par la valeur la plus plausible, et ne
jamais transcrire une donnée qui semblerait cohérente avec le type de
document sans être individuellement repérable dans l'image.

### Suggestions IA : un moteur de règles, pas un seul type d'alerte

`src/lib/copilotSuggestions.ts` (testé, `src/lib/__tests__/copilotSuggestions.test.ts`) alimente la carte « Suggestions IA » du tableau de bord ET la pastille du chat, par une seule route, `GET /api/copilot/suggestions` (le tableau de bord ne recalcule plus rien). Sans appel au modèle ni crédit : des règles sur les données du cabinet. Vingt-sept règles : factures en retard, tâches en retard (par projet, ou internes), jalons en retard, réserves en retard de levée, permis dont le délai d'instruction expire (DP 1 mois, PC 3, AT 4, délai de droit commun à vérifier), appels d'offres à remettre sous 7 jours, tâches à échéance sous 3 jours, projets en retard d'avancement, factures à échéance sous 7 jours, réunions sans compte rendu, devis sans réponse (15 jours), contrats signés non facturés (45 jours), tâches sans responsable, affaires en cours sans contrat MOE, lots sans entreprise, fiches d'affaire incomplètes, factures en brouillon depuis 7 jours, observations de chantier en retard, OS sans accusé de réception (7 jours), situations de travaux à vérifier (10 jours), qualification d'une entreprise titulaire expirée ou sous 30 jours (jamais signalée sans qualification enregistrée), entreprises titulaires sans coordonnées ou sans SIRET valide, collaborateur à plus de 15 tâches ouvertes, entreprises notifiées sans attestation d'assurance (marché notifié ou signé, ni résilié ni subséquent ; l'attestation est la pièce « assurance » cochée dans l'ACT, ou un document de l'affaire dont le nom, la description ou le type cite assurance ou décennale et qui est rattaché à la fiche de l'entreprise ou la nomme), validité de l'attestation d'assurance (expirée ou sous 30 jours), RGE exigé par un lot (entreprise titulaire sans qualification RGE, expirée ou sous 30 jours). Volontairement absents : honoraires consommés et temps sans coût horaire (données de gestion réservées aux administrateurs, la route est ouverte à tous les rôles), attestation MAF et affaire inactive (pas de donnée fiable).

À ne pas défaire : un plafond par type (3) et un tour de rôle entre les règles, puis le rouge avant l'orange, 10 suggestions au plus. Une donnée facultative non lue (`meetings`, `reserves`, `contracts`, `permits`, `lots` : table absente ou en erreur) vaut `undefined` et la règle se tait : jamais « sans contrat » parce que la lecture a échoué. Une date absente ou illisible n'est jamais un retard. Les brouillons envoyés au chat sont internes (plan de rattrapage, point, liste de contrôle) et ne s'adressent au client que pour une relance de paiement ; l'IA propose, la personne relit, rien n'est modifié sans confirmation. Textes : `ai_suggestion_*`, `ai_draft_*`, `ai_field_*` (fr et en).
