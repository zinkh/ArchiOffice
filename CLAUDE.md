# ArchiOffice — AI Assistant Guide

## Project Overview

**ArchiOffice** is a SaaS management platform for French architectural offices. It covers the full project lifecycle: proposals, tenders, invoices, CCTP/DPGF technical specifications, Gantt planning, meeting reports, cadastral maps, and PLU urban-planning zone queries. The app targets a **French-speaking audience** and uses French architectural terminology throughout.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript 5.8, Vite 6, Tailwind CSS 4 |
| Backend | Express 4 (Node 22), served from `server.ts` |
| Database | Supabase (PostgreSQL), Dexie (IndexedDB for offline) |
| AI | Google Gemini (`@google/genai`) |
| Maps | MapLibre GL, IGN APICARTO, Géorisques API |
| Charts | Recharts, Tremor, D3 |
| Exports | jsPDF, docx, xlsx, file-saver, fast-xml-parser |
| i18n | i18next + react-i18next |
| Auth | Supabase Auth (JWT), ProtectedRoute wrapper |
| Protocol | MCP server (`mcp-server.ts`) via better-sqlite3 |

## Repository Layout

```
/
├── server.ts            # Express backend (~5 000 lines) — API + static serving
├── mcp-server.ts        # Model Context Protocol server (local SQLite)
├── index.html           # Vite HTML entry point
├── vite.config.ts       # Vite config (path alias @/*, HMR toggle)
├── tsconfig.json        # TypeScript config (ES2022, ESNext, react-jsx)
├── postcss.config.js
├── proxy.json           # Platform routing config (no active endpoints — the former
│                         # unauthenticated /api-proxy/** passthrough to Google's
│                         # Generative Language API was removed, 2026-08 compliance
│                         # pass: nothing in src/ ever called it, and all Gemini
│                         # calls already go through governed /api/ai/* endpoints)
├── Dockerfile
├── .env.example
├── supabase/
│   ├── schema.sql       # Full DB schema (655 lines)
│   └── migrate_*.sql    # Incremental migrations
└── src/
    ├── main.tsx         # React mount, auth interceptor
    ├── App.tsx          # Router, layout, sidebar, header (~573 lines)
    ├── UserContext.tsx  # Auth context + user state
    ├── i18n.ts          # All translations (FR/EN, ~52 KB)
    ├── types.ts         # Shared TypeScript interfaces (~16 KB)
    ├── index.css        # Global Tailwind + custom styles
    ├── db.ts            # Dexie schema
    ├── pages/           # One file per route (28 pages)
    ├── components/      # Reusable UI components (27 files)
    ├── components/pro/  # CCTP, DPGF, Lots editors
    ├── hooks/           # useCCTP, useDPGF, useSettings
    ├── lib/             # api.ts, supabase.ts, sync.ts, export helpers
    ├── services/        # documentService.ts, userService.ts
    └── types/           # cctp.ts, dpgf.ts
```

## Development Workflow

### Prerequisites

- Node.js 22+
- Environment variables set (copy `.env.example` → `.env`)

### Running Locally

```bash
npm install          # Install dependencies (uses legacy-peer-deps)
npm run dev          # Start server (tsx server.ts) — serves Vite dev + API
```

The single `server.ts` process:
1. Spawns Vite as a child process for frontend hot-reload
2. Proxies `/api-proxy/**` to the Google Generative Language API
3. Serves all `/api/**` REST endpoints
4. Falls back to the React SPA for all other routes

### Build

```bash
npm run build        # vite build → dist/, then copies proxy.json to dist/
npm run start        # Production: tsx server.ts (serves dist/ as static)
npm run preview      # Preview built output with Vite
```

### Type Checking (Lint)

```bash
npm run lint         # tsc --noEmit — TypeScript type check only
```

There is **no ESLint, no Prettier, no commit hooks**. Keep code consistent with surrounding style manually.

## Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | One AI key required | Google Gemini (the default provider) |
| `ANTHROPIC_API_KEY` | Optional | Claude, when a tenant or the instance runs on Anthropic |
| `MISTRAL_API_KEY` | Optional | Mistral (French, EU-hosted) |
| `AI_PROVIDER` / `AI_MODEL` | Optional | Instance-wide provider/model default, overridable at runtime from `/admin` (`gemini` + `gemini-3-flash-preview` when unset) |
| `AI_PRICE_MARKUP` | Optional | Operator margin over each model's real cost (default `1.3333`) |
| `VITE_SUPABASE_URL` | Yes | Supabase URL (injected into frontend at build time) |
| `VITE_SUPABASE_ANON_KEY` | Yes | Supabase anon key (frontend) |
| `SUPABASE_URL` | Yes (backend) | Supabase URL for server-side calls |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes (backend) | Supabase service role key (bypasses RLS) |
| `APP_URL` | Yes | Deployed app base URL |
| `SMTP_HOST/PORT/USER/PASS` | Optional | Email via Nodemailer |
| `GEORISQUES_TOKEN` | Optional | French geological risk API |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Optional | Web Push (PWA notifications). Generate once per instance with `node scripts/generate-vapid-keys.mjs`; unset means Web Push is off and nothing else breaks |
| `VAPID_SUBJECT` | Optional | Contact address the push service uses to reach the operator (`mailto:` or `https:`). Falls back to `APP_URL` |
| `PORT` | Optional | Server port (default 8080 in Docker) |
| `DISABLE_HMR` | Optional | Set `true` to disable Vite HMR |

`VITE_SUPABASE_*` variables are embedded into the frontend bundle at build time via `vite.config.ts`.

## Database

### Supabase / PostgreSQL

The schema lives in `supabase/schema.sql`. Key tables:

| Table | Description |
|---|---|
| `tenants` | Multi-tenant root — each cabinet d'architecture is one tenant |
| `profiles` | User accounts linked to `auth.users` — l'identité (une ligne par personne) |
| `tenant_memberships` | Appartenance personne × cabinet et rôle tenu dans ce cabinet — un architecte peut exercer dans plusieurs structures |
| `projects` | Architectural projects |
| `proposals` | Client proposals (devis) |
| `tenders` | Market opportunities (appels d'offres) |
| `invoices` | Factures (Factur-X EN 16931 compliant) |
| `specifications` | Anciens documents « cahier des charges » — plus exposés dans l'UI depuis que `/specifications` est devenue la bibliothèque d'ouvrages ; l'API subsiste, les lignes sont conservées |
| `articles_type` | Bibliothèque d'ouvrages du cabinet (article, prix courant, classement, provenance) |
| `article_prix_observations` | Prix constatés par article, sans écraser le prix courant |
| `ref_sfb_elements`, `ref_corps_etat`, `ref_dtu`, `ref_dtu_corps_etat`, `ref_naf` | Nomenclatures publiques, **globales** et non multi-tenant |
| `documents` | Versioned document repository |
| `site_reports` | Construction site inspection reports |
| `meetings` | Meeting minutes (réunions de chantier) |
| `contacts` | CRM contacts |
| `tasks` | Milestone & Gantt tasks |
| `billing_events` | Payment tracking (Stancer/Stripe) |

All data is scoped to `tenant_id`. RLS policies enforce isolation. The backend uses `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS) for trusted operations. Le cabinet servi à une requête est celui de l'en-tête `X-Tenant-Id`, validé contre `tenant_memberships` (voir « Plusieurs cabinets pour une même personne »), à défaut le cabinet par défaut du profil.

Apply migrations sequentially in filename order when setting up a new instance.

### Offline / Local

- `src/db.ts` — Dexie (IndexedDB) schema for offline caching and sync
- `mcp-server.ts` — Uses `better-sqlite3` (`archimanager.db`) for local CLI tooling
- `electron/dataLocation.cjs` — lets the desktop client choose where the local Postgres data and uploaded documents live (see « Emplacement des données (client Electron) » below)

## Architecture Conventions

### Frontend Routing

Routes are defined in `src/App.tsx`. Each top-level page has its own file under `src/pages/`. All routes are wrapped in `<ProtectedRoute>` (checks Supabase session).

### Auth

- `src/UserContext.tsx` — `useUser()` hook provides `{ user, tenant, profile }`.
- `src/lib/authInterceptor.ts` — Adds the Supabase JWT to all Axios requests.
- Supabase client is in `src/lib/supabase.ts`.

### API Calls

- Frontend HTTP calls use Axios, configured in `src/lib/api.ts`.
- Server API endpoints are in `server.ts` under `/api/**`.
- Supabase JS client is also used directly from the frontend for reads.

### Internationalization

All UI strings must use i18next. Translations live in `src/i18n.ts`. The file is large (~52 KB) — search for existing keys before adding new ones.

```tsx
import { useTranslation } from 'react-i18next';
const { t } = useTranslation();
// Usage: t('someKey')
```

### Types

Shared interfaces live in `src/types.ts`. CCTP-specific types are in `src/types/cctp.ts`, DPGF in `src/types/dpgf.ts`.

### Export / Document Generation

| Format | Library | Location |
|---|---|---|
| PDF | jsPDF + jspdf-autotable | Inline in pages or `src/lib/` |
| Word/DOCX | docx | `src/lib/meetingExport.ts`, inline in pages |
| Excel | xlsx | Inline in pages |
| XML (DPGF import) | fast-xml-parser | `src/lib/xmlHelper.ts` |

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

Point non traité ici, à garder en tête : `POST /api/team` retrouve un compte
déjà existant via `profiles.eq('email', email)`. Un compte créé par
inscription libre ou via un fournisseur externe peut avoir `profiles.email`
vide alors que l'adresse existe bien côté Supabase Auth — l'ajout à un second
cabinet le manquerait alors et tenterait de recréer un compte pour la même
adresse. Un point de résolution centralisé (Auth d'abord, `profiles` en
repli) fermerait ce cas sans devoir le refaire à chaque route qui cherche un
utilisateur par e-mail.

### Références inter-locataires non validées

`tenantScopedFrom.ts` empêche une requête d'écrire une ligne dans le mauvais
tenant, mais ne dit rien des identifiants qu'un payload se contente de
RÉFÉRENCER — un `project_id` accepté tel quel dans le corps d'une requête peut
pointer vers un projet d'un autre cabinet, tant que rien ne vérifie son
appartenance avant l'écriture. `server/assertTenantEntity.ts` est le helper
générique introduit pour ça (`assertTenantEntity(supabaseAdmin, table, id,
tenantId): Promise<boolean>`) ; `server/routes/invoices.ts` l'utilise sur
`project_id` en création et en modification. D'autres endroits acceptent une
référence du même genre sans ce contrôle (`project_id` sur
`server/routes/proposals.ts`, entre autres) — à traiter au fur et à mesure
avec le même helper plutôt qu'en le dupliquant.

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

API keys are never part of this. They stay in the environment, and `PUT /api/admin/ai-provider` refuses a provider whose key is missing rather than let an operator switch the platform onto a 503.

**Two invariants worth keeping:**

1. **A model absent from `MODEL_CATALOG` cannot run.** `resolveLlmProvider()` refuses it, because running a model we can't price means billing a tenant an invented amount. Adding a model means adding its real cost.
2. **Cost is a fact, margin is a knob.** Per-token cost differs ~10x between Gemini Flash and Claude Opus, so it lives per model in the catalogue; `AI_PRICE_MARKUP` is the single commercial lever on top. Every usage row records `provider` and `model` so a charge can be read back with the rate that produced it.

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

- **Alertes métier** — `server/agentAlerts.ts`. Un cycle (6 h par défaut) relit
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

### OCR

`packages/archioffice-agents/src/server/ocr.ts` rattrape les documents sans
couche texte : `pdftoppm` (poppler-utils, installé par le Dockerfile) met les
pages en image, `tesseract.js` les reconnaît. Si l'un des deux manque, le
contenu injecté dit explicitement que le document est scanné et illisible,
plutôt que de le laisser passer pour vide.

### Documents produits par un agent

`server/artifacts.ts` fabrique les fichiers demandés dans un bloc
```` ```artifact ```` (docx, pdf, xlsx, csv). Tous portent la charte du cabinet
lue dans `settings` par `server/agencyIdentity.ts` : logo et coordonnées en
en-tête, adresse et SIRET en pied de page, pagination « P1|2 » en bas à droite.

### Notifications système (PWA et poste de travail)

Le flux d'activité ne prévient personne quand l'application est fermée, et le
mail (`server/mailer.ts`) arrive avec la latence d'une boîte de réception. Le
canal « système » comble cet écart. Une seule source, deux transports, parce
qu'aucun des deux ne couvre tous les postes :

| | Web Push | File `notification_outbox` |
|---|---|---|
| Cible | PWA installée (navigateur, iOS 16.4+ depuis l'écran d'accueil) | Client Electron |
| Sens | Le serveur pousse | Le client relève, toutes les 60 s |
| Fichiers | `public/push-sw.js`, `src/lib/push.ts` | `electron/{main,preload}.cjs`, `src/lib/desktopNotifications.ts` |

`notifyUsers()` (`server/push.ts`) est le point d'entrée unique : il écrit une
ligne par destinataire dans `notification_outbox`, puis tente le Web Push
par-dessus. L'écriture est inconditionnelle, l'envoi est un meilleur effort —
une instance sans clés VAPID garde donc les notifications du poste de travail
et le flux en application, elle perd seulement le canal navigateur.

Deux points à ne pas contourner :

1. **Chromium embarqué dans Electron n'est enregistré auprès d'aucun service de
   push.** FCM et consorts sont liés à un navigateur, pas à une application :
   le Web Push ne peut pas fonctionner dans le client de bureau, d'où le
   relevé périodique. Ce n'est pas un contournement provisoire.
2. **Le service worker est généré par Workbox (`generateSW`).** Les
   gestionnaires `push`/`notificationclick` vivent donc dans un fichier
   statique importé en tête (`workbox.importScripts` dans `vite.config.ts`),
   et non dans un service worker écrit à la main : passer en `injectManifest`
   reviendrait à reprendre la précache et le cycle de mise à jour dont dépend
   `src/components/UpdateBanner.tsx`.

Producteurs branchés : `server/agentAlerts.ts` (toute alerte créée, quelle que
soit la préférence d'envoi de mail de la règle) et les mentions `@` de
`server/routes/activityFeed.ts`. Le filtrage propre au canal est personnel et
non par cabinet : `profiles.notification_prefs` (`{ muted: [catégories] }`),
réglé depuis `src/components/PushNotificationsCard.tsx`.

### Écran de démarrage (client Electron)

`electron/splash.html` (+ `electron/splashPreload.cjs`) remplace la fenêtre
blanche qui s'affichait pendant que Postgres/PostgREST/le serveur applicatif
démarraient. Une seule liste d'étapes fait foi, `SPLASH_STEPS` dans
`electron/main.cjs`, envoyée au splash par IPC (`splash:init`) — le HTML ne
code aucun libellé en dur, pour qu'il n'existe qu'un seul endroit à mettre à
jour si une étape change.

`reportStep(id, status, detail)` (`main.cjs`) est passé tel quel à
`startOfflineDataStack()`/`startLocalPostgres()` (`electron/pgBootstrap.cjs`),
qui l'appellent à leurs points réels de progression (initialisation
Postgres, application des migrations, démarrage de PostgREST) — l'écran
reflète donc l'avancement RÉEL, pas une simulation minutée. Une étape (`app-
server`, « Démarrage du serveur applicatif ») couvre volontairement PostgREST
ET le serveur Node lancé juste après : `pgBootstrap.cjs` la laisse `active`
en sortant, c'est `main.cjs` qui la clôt une fois SON propre contrôle de
santé (`/api/health`) passé — le vrai signal que l'API est utilisable, pas
seulement que PostgREST répond.

Sur un échec fatal, l'étape en cause se marque `error` à l'endroit précis de
la panne (jamais deviné après coup par un `catch` générique), et l'écran de
démarrage reste affiché avec un bandeau détaillant le chemin du journal et un
bouton « Quitter » — cette fenêtre n'a ni barre de titre ni menu, donc aucune
croix système pour se fermer autrement. Remplace l'ancien écran d'erreur en
texte brut (`data:text/plain`), qui montrait un message mais jamais À QUEL
ENDROIT précis le démarrage avait échoué.

Un piège rencontré en le construisant, à ne pas réintroduire : une tuile
d'icône de taille fixe (`width/height: 84px`), enfant direct d'un conteneur
flex `column` et elle-même conteneur flex pour son SVG, se voyait
sous-dimensionnée à la taille de son contenu (42px) sur la toute première
passe de mise en page de Chromium — reproductible de façon fiable, et pas
seulement en tests headless. `flex: 0 0 84px` (une base explicite, plutôt que
`flex-basis:auto` dérivé de `height`) lève l'ambiguïté dès cette première
passe.

### Emplacement des données (client Electron)

Historiquement, la base Postgres embarquée (`pgdata/`) et les fichiers
uploadés (`storage/<bucket>/…`) vivaient sous un seul dossier imposé par le
système (`app.getPath('userData')`). `electron/dataLocation.cjs` laisse
choisir les deux **séparément**, typiquement pour mettre les documents sur un
disque réseau ou un dossier partagé pendant que la base reste locale.

**Le choix n'est proposé qu'une seule fois, au tout premier lancement**,
avant que la moindre donnée n'existe — le déplacer ensuite reviendrait à
migrer un Postgres déjà peuplé (arrêt propre, copie intégrale vérifiée,
reprise), volontairement hors périmètre. Un poste déjà installé avant
l'existence de ce choix (repéré par un `pgdata/` déjà présent à l'emplacement
historique) n'est donc jamais reposé la question : `resolveDataLocation()`
lui réécrit silencieusement `data-location.json` sur son emplacement
d'origine. Ce fichier-pointeur reste, lui, toujours à l'emplacement standard
du système — il ne contient que deux chemins, rien qui justifie de le
déplacer aussi.

**La base de données doit rester sur un disque local.** Un Postgres dont le
répertoire de données vit dans un dossier synchronisé (Drive, Dropbox,
OneDrive…) ou sur un partage réseau s'expose à des écritures partielles et
des verrous que ces systèmes ne respectent pas comme un disque local — un
risque réel de base corrompue. Le dialogue de premier lancement le dit
explicitement ; rien ne l'empêche techniquement (détecter un lecteur réseau
de façon fiable, tous OS confondus, n'a pas de solution simple), c'est
délibéré : mieux vaut prévenir que bloquer sur une détection qui se
tromperait dans un sens ou dans l'autre. Les documents, eux, n'ont pas cette
contrainte : ce sont de simples fichiers.

`server/offlineAccount.ts::storageDir()` lit `OFFLINE_STORAGE_DIR`
(repli sur `OFFLINE_DATA_DIR/storage` si absent — rétrocompatible avec un
poste installé avant cette variable) ; tout le reste (compte local, secret
JWT, état du lien cloud) continue de vivre sous `OFFLINE_DATA_DIR` via
`getDataDir()`, inchangé. `server/offlineGateway.ts`'s `/storage/v1` passe
uniformément par `storageDir(bucket)`, donc ce seul changement couvre tous
les buckets (documents, logos, photos de réunion, CV…) sans les lister un
par un.

Les chemins choisis sont lus par le renderer via le pont IPC
(`src/lib/desktopBridge.ts`, affiché en lecture seule dans Réglages), jamais
via l'API HTTP : ce sont des chemins du poste, pas une donnée du cabinet.
`openDataFolder(kind)` n'accepte que `'db' | 'storage'`, jamais un chemin
fourni par le renderer — c'est `main.cjs` qui résout le chemin réel depuis sa
propre variable interne, pour ne jamais ouvrir un chemin arbitraire à la
demande du renderer.

### Maps

- `MapLibreCadastre.tsx` — Cadastral parcels via IGN WMTS tiles
- `LocationMaps.tsx` — General project location map
- `UrbanPlanningInfo.tsx` — Queries PLU zones via APICARTO GPU API
- `HistoricalMonuments.tsx` — Heritage monument data
- All map API calls are proxied or made directly to French government APIs

## Key Patterns

### Supabase Queries

```ts
import { supabase } from '@/lib/supabase';

const { data, error } = await supabase
  .from('projects')
  .select('*')
  .eq('tenant_id', tenantId);
```

### Server-side Supabase (with service role)

```ts
// In server.ts — already initialized as `supabaseAdmin`
const { data } = await supabaseAdmin
  .from('projects')
  .select('*');
```

### Path Aliases

The `@` alias maps to the repository root in both TypeScript and Vite:

```ts
import { supabase } from '@/src/lib/supabase';
import type { Project } from '@/src/types';
```

### Component Style

- Tailwind utility classes for all styling
- `clsx` for conditional class merging
- Tabler Icons (`@tabler/icons-react`) for icons
- Tremor for dashboard charts
- No CSS modules — global styles in `src/index.css`

## French Architectural Domain Terms

| Term | Meaning |
|---|---|
| CCTP | Cahier des Clauses Techniques Particulières (technical specs) |
| DPGF | Décomposition du Prix Global et Forfaitaire (cost breakdown) |
| PLU | Plan Local d'Urbanisme (local zoning plan) |
| APS/APD | Avant-Projet Sommaire / Détaillé (design phases) |
| DCE | Dossier de Consultation des Entreprises (tender package) |
| DOE | Dossier des Ouvrages Exécutés (as-built file) |
| MOE | Maîtrise d'œuvre (project management) |
| MOA | Maîtrise d'ouvrage (project owner/client) |
| Lot | Market trade package (e.g., Gros œuvre, Charpente, Électricité) |
| Devis | Proposal / quotation |
| Facture | Invoice |
| Réunion de chantier | Site meeting / construction meeting |
| Ordre de service | Work order |

## Tests

There is a Vitest suite (`npm test`), run in CI (`.github/workflows/*.yml`, job `lint-and-build`) after `npm run lint` and before `npm run build` — a change is not done until all three pass. `tests/*.test.ts` cover server routes end-to-end through the real Express app against `tests/testServer.ts`'s in-memory `fakeSupabaseAdmin` (a small PostgREST-like emulator with `.select/.insert/.update/.delete/.upsert(rows, {onConflict})/.eq/.single/.maybeSingle`, `.seed(table, rows)`, `.getTable(table)`); `src/lib/__tests__/*.test.ts` cover pure frontend logic (import/rapprochement, ACT-versement, formulas). `npm run lint` (`tsc --noEmit`) still only type-checks — it does not run the tests.

## Docker

```dockerfile
# Build with Supabase env vars
docker build \
  --build-arg VITE_SUPABASE_URL=... \
  --build-arg VITE_SUPABASE_ANON_KEY=... \
  -t archioffice .

docker run -p 8080:8080 \
  -e GEMINI_API_KEY=... \
  -e SUPABASE_URL=... \
  -e SUPABASE_SERVICE_ROLE_KEY=... \
  archioffice
```

## Files to Know Well

| File | Why |
|---|---|
| `server.ts` | All backend API routes — changes here affect the entire API surface |
| `src/App.tsx` | All client-side routes and the main layout shell |
| `src/UserContext.tsx` | Auth and tenant context — used everywhere |
| `src/types.ts` | Shared data models — keep in sync with DB schema |
| `supabase/schema.sql` | Source of truth for the database structure |
| `src/i18n.ts` | All UI strings — always add translations for new UI text |
| `src/lib/api.ts` | Axios base config — change base URL or auth here |
| `src/pages/ProjectDetail.tsx` | Largest page (177 KB) — the main project workspace |
