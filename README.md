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
- **Document generation & export** — PDF export throughout, plus Word (.docx) export for meeting minutes. (Word/Excel export from the Specifications page is a known gap — see [ROADMAP.md](ROADMAP.md#document-export).)
- **Offline-first desktop option** — an Electron build with local storage and cloud sync for working without a constant connection.

Want the full picture of what's implemented vs. still planned? See [ROADMAP.md](ROADMAP.md). Building an integration or calling the API directly? See [API.md](API.md).

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

## Your first session

Once the app is running and pointed at a Supabase project, here's the actual path from an empty database to a usable instance.

### 1. Create the first account and cabinet

Go to `/register` and fill in a cabinet (agency) name, an admin name, an email, and a password. This calls `POST /api/public/register`, which creates both the **tenant** (the cabinet) and the admin **profile** in one step. You won't be logged in immediately — confirm the account via the email link (or resend it from the same screen) before signing in at `/login`.

Signing in with Google instead of email/password works too, but a Google account isn't attached to a tenant yet. On first login you'll land on `/agency-setup`, where you either:
- **Create a new cabinet** (becomes admin of a fresh tenant), or
- **Join an existing one** by searching for it by name — this sends a join request that sits pending until an admin approves it from the Team page.

Every user belongs to exactly one tenant, and the entire app is scoped to it server-side — there's no manual tenant switching or ID to pass around.

### 2. Invite your team

From **Administration → Équipe** (`/team`), an admin can add teammates directly or approve pending join requests. Roles are `admin`, `manager`, `pm`, and `user` — only admins manage roles and approve joins. The `/onboarding` wizard (agency info → logo → avatar → invite teammates) covers the same ground in one guided flow if you'd rather use that instead of the Team page.

### 3. Follow a project through its lifecycle

ArchiOffice models the real workflow of a French architecture practice. A typical project flows through these pages, roughly in this order:

1. **Appel d'offres** (`/tenders`) — track a public tender/competition you're pursuing: deadlines, mandataire, milestones.
2. **Devis / Proposition** (`/proposals`) — draft a fee proposal against the *loi MOP* mission breakdown (ESQ, APS, APD, PRO, ACT, VISA, DET, AOR, OPC), with address/cadastre/Géorisques lookups and AI-assisted drafting (Gemini).
3. **Contrat** (`/contrats`) — once the proposal is accepted, formalize the *maîtrise d'œuvre* contract (construction neuve, réhabilitation, concours, AMO, diagnostic…), tracking co-traitants/sous-traitants and status from Brouillon to Signé.
4. **Projet** (`/projects/:id`) — the project itself, optionally seeded from a template (`/templates`). `ProjectDetail` is the hub for everything below, organized into tabs per mission phase and gated by whether the project is flagged as *chantier* (active construction site).
5. **Spécifications / CCTP‑DPGF** (`/specifications`) — write the technical specs (CCTP) and cost breakdown (DPGF), including XML import of existing DPGF files.
6. **Planification** — `/gantt`, `/kanban`, and `/calendar` for scheduling tasks and milestones.
7. **Suivi de chantier** — `/ordres-de-service` (work orders, Brouillon → Soumis → Approuvé/Refusé), `/reunions` (site-visit and meeting minutes with photos and attendees, exportable to PDF/DOCX), and construction-phase billing situations inside the project.
8. **Facturation** (`/invoices`) — invoice per mission phase, Draft → Sent → Paid/Overdue, with French e-invoicing status (Chorus Pro / PDP / Factur-X).
9. **Documents** (`/documents`) — the versioned document vault, organized by the same mission-phase taxonomy, with diffusion tracking.

Everything above is reachable from four sidebar groups: **Gestion** (Dashboard, Projets, Références, Documents), **Finances** (Propositions, Factures, Appels d'offres, Contrats), **Outils** (Spécifications, Gantt, Calendrier, Kanban, Réunions, Ordres de service, Contacts), and **Administration** (Agents IA, Équipe, Modèles, Paramètres, Facturation).

### 4. Connect integrations (optional)

**Paramètres → Intégrations** (`/settings`) lists third-party connectors. Some are fully wired up today (Zoho Invoice, Zoho Books, Odoo, Ragic, Super PDP, Chorus Pro, MAF declaration); others are shown as **"coming soon"** placeholders in the UI with no backend yet (Stripe, QuickBooks, Google Drive, Dropbox, Salesforce, Slack, Microsoft Teams) — see [ROADMAP.md](ROADMAP.md) for current status before relying on one of those.

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

## Further documentation

- **[ROADMAP.md](ROADMAP.md)** — what's solidly implemented, what's partial/experimental, and what's a UI placeholder with no backend yet.
- **[API.md](API.md)** — REST API reference for `/api/**`: authentication, conventions, and the full endpoint catalog, for anyone integrating with ArchiOffice directly or building against it as a third party.
- **[CLAUDE.md](CLAUDE.md)** — repository layout and architecture conventions, aimed at contributors and AI coding assistants working in this codebase.
