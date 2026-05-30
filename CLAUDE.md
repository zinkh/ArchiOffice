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
├── proxy.json           # Routes /api-proxy/** → Google Generative Language API
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
| `GEMINI_API_KEY` | Yes | Google Gemini AI (proposals, CCTP generation) |
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

### AI (Gemini)

AI features (proposal drafting, CCTP generation) call `@google/genai` from the backend (`server.ts`). The frontend never calls Gemini directly — it goes through `/api/gemini-*` endpoints.

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
