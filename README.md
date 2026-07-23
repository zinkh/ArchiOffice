# ArchiOffice

**ArchiOffice** is a SaaS management platform built for French architectural offices (*cabinets d'architecture*). It covers the full project lifecycle — from the first client proposal to the final invoice — in one place, using the French architectural terminology professionals already know (CCTP, DPGF, PLU, DCE, MOE/MOA, etc.).

## What it does

- **Projects & planning** — track every project from *Avant-Projet* through delivery, with Gantt charts, Kanban boards, and milestone tracking.
- **Proposals & tenders** — draft client proposals (*devis*) and respond to tenders (*appels d'offres*), with AI-assisted drafting powered by Gemini.
- **Technical specifications** — build CCTP (technical specs) and DPGF (cost breakdowns) documents, including XML import for existing DPGF files.
- **Invoicing** — generate Factur-X (EN 16931) compliant invoices, with Chorus Pro portal support for French public-sector billing.
- **Site & meeting management** — log site inspection reports and meeting minutes (*réunions de chantier*), issue work orders (*ordres de service*).
- **Contacts & team** — a lightweight CRM for clients and contractors, plus team/role management per cabinet.
- **Maps & urban planning data** — cadastral parcel maps, PLU zoning lookups, heritage monument and geological risk data via French government APIs (IGN, APICARTO, Géorisques).
- **Document generation & export** — PDF, Word (.docx), and Excel exports for proposals, specs, and reports.
- **Offline-first desktop option** — an Electron build with local storage and cloud sync for working without a constant connection.

## Screenshots

<!--
  TODO: Add screenshots or a short demo GIF here once you have a running
  instance with sample data. Recommended shots: the Dashboard, a Project
  detail view (Gantt/Kanban), a CCTP/DPGF editor, and the Invoices list.
  Drop image files under docs/screenshots/ and reference them below, e.g.:

  ![Dashboard](docs/screenshots/dashboard.png)
  ![Project Gantt view](docs/screenshots/gantt.png)
-->
*Screenshots coming soon — see the TODO above if you'd like to contribute some from a running instance.*

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript 5.8, Vite 6, Tailwind CSS 4 |
| Backend | Express 4 (Node 22), served from `server.ts` |
| Database | Supabase (PostgreSQL), Dexie (IndexedDB for offline) |
| AI | Google Gemini (`@google/genai`) |
| Maps | MapLibre GL, IGN APICARTO, Géorisques API |
| Exports | jsPDF, docx, xlsx, fast-xml-parser |
| i18n | i18next + react-i18next (French / English) |
| Auth | Supabase Auth (JWT) |
| Desktop | Electron (offline-first build with local sync) |

## Getting started

### Prerequisites

- Node.js 22+
- A [Supabase](https://supabase.com) project (for the database and auth) — apply the schema in `supabase/schema.sql`, then any `supabase/migrate_*.sql` files in order
- A [Google Gemini API key](https://ai.google.dev/) for AI-assisted drafting

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Copy the example file and fill in your own values:

```bash
cp .env.example .env
```

| Variable | Required | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | Yes | Google Gemini AI (proposal & CCTP drafting) |
| `VITE_SUPABASE_URL` | Yes | Supabase project URL (bundled into the frontend) |
| `VITE_SUPABASE_ANON_KEY` | Yes | Supabase anon/public key (frontend) |
| `SUPABASE_URL` | Yes | Supabase project URL (backend only) |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key — bypasses RLS, backend only |
| `APP_URL` | Yes | Public base URL of the deployed app (used in emails, OAuth callbacks) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | Optional | Outgoing email (Nodemailer) — account confirmation, password reset, invites |
| `GEORISQUES_TOKEN` | Optional | French geological risk API |
| `VITE_GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Optional | Google OAuth2 sign-in and Google Contacts sync |
| `SUPER_ADMIN_EMAIL` / `VITE_SUPER_ADMIN_EMAIL` | Optional | Enables the `/admin` super-admin dashboard for this email |
| `SENTRY_DSN` / `VITE_SENTRY_DSN` | Optional | Error reporting (backend / frontend) |
| `PORT` | Optional | Server port (defaults to `8080` in Docker) |
| `DISABLE_HMR` | Optional | Set to `true` to disable Vite hot module reload |

### 3. Run the app locally

```bash
npm run dev
```

This starts a single process (`tsx server.ts`) that serves the Vite dev server (with HMR) and the `/api/**` REST backend together at `http://localhost:3000`.

### 4. Type-check

There's no test suite or linter beyond TypeScript's own checks:

```bash
npm run lint   # tsc --noEmit
```

### 5. Build for production

```bash
npm run build   # outputs the static frontend to dist/
npm run start   # serves dist/ with the same Express server
```

## Docker

```bash
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

## Desktop (Electron)

ArchiOffice also ships as an offline-first desktop app with local storage and cloud sync. See `electron-builder.yml` and the `electron:build` script in `package.json`.
