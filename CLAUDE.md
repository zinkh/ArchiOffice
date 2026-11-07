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
npm run build        # vite build → dist/, copies proxy.json, compiles the server → dist-api/ (scripts/build-server.mjs)
npm run start        # Production: node dist-api/server.mjs (serves dist/ as static; `start:tsx` runs the sources)
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
| `NOMIC_API_KEY` | Optional | Nomic Platform (`nk-…`) : lecture des plans/DCE (Nomic Parse) et génération du CCTP (Nomic Extract). Sans elle, seul le moteur local existe |
| `NOMIC_API_URL` / `DOCUMENT_PARSER` | Optional | Hôte de l'API Nomic (défaut `https://api-atlas.nomic.ai`) ; moteur de lecture par défaut de l'instance (`local` ou `nomic`), surclassé par le réglage `/admin` |
| `AI_PROVIDER` / `AI_MODEL` | Optional | Instance-wide provider/model default, overridable at runtime from `/admin` (`gemini` + `gemini-3-flash-preview` when unset) |
| `AI_PRICE_MARKUP` | Optional | Operator margin over each model's real cost (default `1.3333`) |
| `VITE_SUPABASE_URL` | Yes | Supabase URL (injected into frontend at build time) |
| `VITE_SUPABASE_ANON_KEY` | Yes | Supabase anon key (frontend) |
| `SUPABASE_URL` | Yes (backend) | Supabase URL for server-side calls |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes (backend) | Supabase service role key (bypasses RLS) |
| `APP_URL` | Yes | Deployed app base URL |
| `SMTP_HOST/PORT/USER/PASS` | Optional | Email via Nodemailer |
| `GEORISQUES_TOKEN` | Optional | French geological risk API |
| `ADEME_RGE_DATASET` | Optional | Nom du jeu de données ADEME des entreprises RGE (défaut `liste-des-entreprises-rge-2`), lu par l'import de qualifications |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Optional | Web Push (PWA notifications). Generate once per instance with `node scripts/generate-vapid-keys.mjs`; unset means Web Push is off and nothing else breaks |
| `VAPID_SUBJECT` | Optional | Contact address the push service uses to reach the operator (`mailto:` or `https:`). Falls back to `APP_URL` |
| `AGENT_MAIL_INBOX_HOST/PORT/USERNAME/PASSWORD` | Optional | Shared IMAP mailbox for inbound "forward an email to an agent" (`server/agentMailInbox.ts`) — job inactive unless all four are set |
| `AGENT_MAIL_INBOX_ALIAS_DOMAIN` | Optional | Fallback domain for the `agents+<slug>@…` alias, used only by a tenant that has not set its own (`settings.mail_inbox_domain`, `/settings` > Agents IA) |
| `AGENT_MAIL_INBOX_FOLDER` / `AGENT_MAIL_INBOX_POLL_MINUTES` | Optional | IMAP folder polled (default `INBOX`) and poll cadence in minutes (default 3) |
| `DOE_REMINDERS_INTERVAL_HOURS` | Optional | Cadence du cycle des relances automatiques de l'atelier DOE (défaut 6 h) |
| `DESKTOP_MAX_UPLOAD_MB` / `DESKTOP_UPLOAD_DIR` | Optional | Synchronisation desktop : taille maximale d'un fichier déposé par morceaux (défaut 200 Mo, le fichier est relu en mémoire à la fin) et dossier temporaire des morceaux (défaut : dossier temporaire du système) |
| `VITE_TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | Optional | Cloudflare Turnstile sur connexion, inscription et mot de passe oublié. Clé de site (frontend, injectée au build) et clé secrète (backend, `server/turnstile.ts`). Sans elles, aucun captcha. La même clé secrète se saisit aussi dans Supabase (Authentication > Attack Protection) pour la connexion par mot de passe. Le client Electron (lien au cloud, reconnexion, bascule : `server/cloudLinkRoutes.ts`, `server/localCloudUpgrade.ts`) relaie le jeton du widget à Supabase : son build doit donc embarquer `VITE_TURNSTILE_SITE_KEY`, et le widget doit autoriser le nom d'hôte `127.0.0.1` |
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
| Excel | exceljs (écriture, `src/lib/xlsxLetterhead.ts`), xlsx (lecture des imports) | `src/lib/` |
| XML (DPGF import) | fast-xml-parser | `src/lib/xmlHelper.ts` |

### Règles détaillées par domaine

Le détail des conventions de chaque domaine a été déplacé hors de ce fichier pour limiter le contexte chargé à chaque session. Rien n'a été supprimé : chaque section se retrouve dans le fichier indiqué.

| Domaine | Fichier | Chargement |
|---|---|---|
| Facturation, honoraires et connecteurs comptables | `.claude/rules/facturation.md` | automatique, selon les fichiers lus |
| Chantier : AOR, DOE, OPR, réserves, plans | `.claude/rules/chantier-aor.md` | automatique, selon les fichiers lus |
| Chantier : DET, RDT, comptes-rendus, planning, observations | `.claude/rules/chantier-det-rdt.md` | automatique, selon les fichiers lus |
| ACT, consultation, offres, marchés, qualifications | `.claude/rules/act-marches.md` | automatique, selon les fichiers lus |
| Onglet PRO : CCTP, DPGF, bibliothèque d'ouvrages, lots, modèles | `.claude/rules/pro-cctp-dpgf.md` | automatique, selon les fichiers lus |
| Propositions, appels d'offres, faisabilité | `.claude/rules/propositions-ao.md` | automatique, selon les fichiers lus |
| E-mails, messagerie et calendriers | `.claude/rules/emails.md` | automatique, selon les fichiers lus |
| IA : fournisseurs, Nomic, OCR, suggestions | `.claude/rules/ia-nomic.md` | automatique, selon les fichiers lus |
| Agents IA et serveur MCP | `.claude/rules/agents-mcp.md` | automatique, selon les fichiers lus |
| Exports PDF, Excel, Word : charte du cabinet | `.claude/rules/exports-charte.md` | automatique, selon les fichiers lus |
| Interface : fiche affaire, tableaux de bord, mouvement | `.claude/rules/ui-fiche-affaire.md` | automatique, selon les fichiers lus |
| Équipe, cabinets, contacts, archivage, sécurité | `.claude/rules/equipe-tenants.md` | automatique, selon les fichiers lus |
| Plateforme : PWA et client Electron | `.claude/rules/plateforme-pwa-electron.md` | automatique, selon les fichiers lus |
| Stockage des fichiers ArchiOffice  | skill `archioffice-stockage-fichiers` | sur demande (Skill) |
| Messagerie utilisée par les agents ArchiOffice  | skill `archioffice-courrier-agents` | sur demande (Skill) |
| Documents PDF A0/A4 générés par Chromium (playwright-core) dans ArchiOffice  | skill `archioffice-pdf-chromium` | sur demande (Skill) |

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
