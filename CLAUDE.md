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
| `PORT` | Optional | Server port (default 8080 in Docker) |
| `DISABLE_HMR` | Optional | Set `true` to disable Vite HMR |

`VITE_SUPABASE_*` variables are embedded into the frontend bundle at build time via `vite.config.ts`.

## Database

### Supabase / PostgreSQL

The schema lives in `supabase/schema.sql`. Key tables:

| Table | Description |
|---|---|
| `tenants` | Multi-tenant root — each cabinet d'architecture is one tenant |
| `profiles` | User accounts linked to `auth.users` |
| `projects` | Architectural projects |
| `proposals` | Client proposals (devis) |
| `tenders` | Market opportunities (appels d'offres) |
| `invoices` | Factures (Factur-X EN 16931 compliant) |
| `specifications` | CCTP documents |
| `documents` | Versioned document repository |
| `site_reports` | Construction site inspection reports |
| `meetings` | Meeting minutes (réunions de chantier) |
| `contacts` | CRM contacts |
| `tasks` | Milestone & Gantt tasks |
| `billing_events` | Payment tracking (Stancer/Stripe) |

All data is scoped to `tenant_id`. RLS policies enforce isolation. The backend uses `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS) for trusted operations.

Apply migrations sequentially in filename order when setting up a new instance.

### Offline / Local

- `src/db.ts` — Dexie (IndexedDB) schema for offline caching and sync
- `mcp-server.ts` — Uses `better-sqlite3` (`archimanager.db`) for local CLI tooling

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

Conversation state is held by the caller, not by an SDK chat object, because every provider we target is stateless. Tool definitions are plain JSON Schema (`parametersJsonSchema`), which maps onto all three without rewriting. An assistant turn also carries an opaque `raw` field — the provider's own content blocks, replayed verbatim — which is what keeps Claude's thinking blocks and their signatures intact across a tool-calling round.

**Selecting a provider.** Precedence, highest first: an explicit argument to `resolveLlmProvider()` (per-tenant BYOK, not built yet) → the `platform_settings.ai_provider` row set from the `/admin` back-office → `AI_PROVIDER`/`AI_MODEL` → Gemini. The stored setting outranks the environment on purpose, otherwise an instance that sets `AI_PROVIDER` could never be switched from the UI.

`describeLlmSelection()` resolves the pair from **one** source rather than field by field: a provider from one place and a model from another produce an invalid pair (Claude asked for a Gemini model). A source naming only a provider falls through to that provider's own default model.

API keys are never part of this. They stay in the environment, and `PUT /api/admin/ai-provider` refuses a provider whose key is missing rather than let an operator switch the platform onto a 503.

**Two invariants worth keeping:**

1. **A model absent from `MODEL_CATALOG` cannot run.** `resolveLlmProvider()` refuses it, because running a model we can't price means billing a tenant an invented amount. Adding a model means adding its real cost.
2. **Cost is a fact, margin is a knob.** Per-token cost differs ~10x between Gemini Flash and Claude Opus, so it lives per model in the catalogue; `AI_PRICE_MARKUP` is the single commercial lever on top. Every usage row records `provider` and `model` so a charge can be read back with the rate that produced it.

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

## No Tests

There is no test suite. `npm run lint` runs TypeScript type-checking only. Validate changes manually by running the dev server.

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
