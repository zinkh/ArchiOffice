# API Reference

ArchiOffice's entire backend is a single Express app (`server.ts`) exposing a REST API under `/api/**`. This document covers what a third-party integrator needs to know: how to authenticate, what to expect from responses, and what's actually available, grouped by resource.

There is no separate public/partner API — this is the same API the React frontend uses. Treat it as an internal API you can also call directly, with the caveats in [Limitations](#limitations-for-integrators) below.

## Authentication

Every route under `/api/**` (except the exemptions below) requires a **Supabase Auth JWT**:

```
Authorization: Bearer <supabase-access-token>
```

The server verifies the token by calling `supabaseAdmin.auth.getUser(token)` against your Supabase project — it does **not** accept an API key, a service-account token, or any other credential type. In practice this means an external integration needs to authenticate as a real user, the same way the SPA does:

1. Sign in via Supabase Auth (email/password, or Google OAuth through `POST /api/auth/google/token`).
2. Send the resulting access token as a Bearer token on every request.
3. Refresh it before it expires, same as the frontend does with the Supabase JS client.

**There is currently no long-lived API key, no OAuth2 client-credentials grant, and no scoped/read-only token.** If you're planning a server-to-server integration, budget time for token refresh handling, and raise it with the team if you need a proper API-key mechanism — it doesn't exist yet (tracked in [ROADMAP.md](ROADMAP.md#platform)).

### Multi-tenancy

Every authenticated user belongs to exactly one tenant (`profiles.tenant_id`). You never pass a tenant ID — the server resolves it from your token via `getTenantId(req.user.id)` and scopes every query to it. A token for a user with no tenant yet gets a `409 { error: "NO_TENANT" }` until the account completes `/api/agency-setup/*`.

### Routes reachable without a token

`/api/health`, `/api/public/*` (registration, password reset, tenant lookup), `POST /api/billing/webhook` (Stancer payment events), and the offline-mode local-auth routes.

## Conventions

- **Success responses** are raw JSON, not wrapped in an envelope: list endpoints return a plain array (`res.json(data || [])`), single-resource fetches return the object directly, creates return `{ id }` with `201`, and most updates/deletes return `{ success: true }`.
- **Errors** are always `{ "error": "message" }` with one of these status codes:
  | Code | Meaning |
  |---|---|
  | 400 | Validation error (missing/invalid fields) |
  | 401 | Missing or invalid bearer token |
  | 402 | Plan quota exceeded or trial expired (`checkQuota`) |
  | 403 | Role/permission check failed |
  | 409 | Conflict — duplicate slug, no tenant attached, etc. |
  | 500 | Unhandled server error (message usually includes the underlying cause) |
  | 503 | A required integration isn't configured (e.g. `GEMINI_API_KEY` unset) |
- **No pagination.** List endpoints return the full tenant-scoped table. Large tenants will get large responses — don't assume `limit`/`offset`/cursor query parameters exist.
- **No API versioning**, except the self-contained `/api/maf/v1/*` namespace.
- **File uploads** use `multipart/form-data` with a `file` field (50 MB limit), handled by `multer` in memory and pushed to Supabase Storage. Used by the visas, plans, documents, proposal import, meeting photos, profile CV/avatar, and chat-attachment endpoints.

## Endpoint catalog

Endpoints are grouped by resource. Most resources follow a standard `GET (list) / GET :id / POST / PUT :id / DELETE :id` shape — those are collapsed into one line; anything with non-standard behavior is called out separately.

### Onboarding & account
- `POST /api/public/register`, `POST /api/public/resend-confirmation`, `POST /api/public/forgot-password`, `GET /api/public/tenant/:slug` — signup flow, no auth required.
- `POST /api/auth/google/token` — exchange a Google OAuth code for a session.
- `GET /api/me` — current user's profile.
- `GET /api/agency-setup/status`, `GET /api/agency-setup/search`, `POST /api/agency-setup/create`, `POST /api/agency-setup/join`, `DELETE /api/agency-setup/join` — attach a tenant-less account to a new or existing agency.

### Team & profiles
- `GET/POST /api/team`, `PUT /api/team/:id`, `PUT /api/team/:id/role`, `PUT /api/team/:id/manager` — team CRUD, role and manager assignment.
- `GET /api/team/join-requests`, `POST /api/team/join-requests/:id/approve`, `POST /api/team/join-requests/:id/reject`.
- `GET /api/project-members`, `GET/POST/DELETE /api/projects/:id/members(/:userId)` — per-project assignment.
- `GET/PUT /api/profile`, `GET /api/profile/:userId`, `POST/DELETE /api/profile/cv`, `POST/PUT/DELETE /api/profile/education(/:id)`, `POST/PUT/DELETE /api/profile/experience(/:id)`.

### Projects & planning
- `GET/POST/PUT/DELETE /api/projects(/:id)`, `GET /api/projects/:id/full` (full project payload for the detail page).
- `GET/POST/DELETE /api/project_categories(/:id)`.
- `GET/POST/PUT/DELETE /api/project-templates(/:id)`.
- `GET/POST/PUT/DELETE /api/tasks(/:id)` — Gantt tasks.
- `GET/POST/PUT/DELETE /api/milestones(/:id)`.
- `GET/POST/PUT/DELETE /api/lots`, `GET /api/projects/:projectId/lots`, `DELETE /api/lots/:id`.
- `GET/PUT /api/projects/:projectId/act` — ACT-phase document.
- `GET/POST/PUT/DELETE /api/projects/:projectId/det(/:crId)` — DET-phase site-visit records.
- `POST /api/projects/:id/phase`, `GET /api/projects/:id/phase-history` — lifecycle phase transitions.

### Tenders
- `GET/POST/PUT/DELETE /api/tenders(/:id)`.
- `GET/POST/PUT/DELETE /api/tender-rss-sources(/:id)`, `POST /api/tender-rss-sources/poll-now`.
- `GET/PUT /api/tender-rss-matches(/:id)`, `POST /api/tender-rss-matches/:id/convert` — promote an RSS match to a real tender.

### Proposals, contracts, fees
- `GET/POST/PUT/DELETE /api/proposals(/:id)`, `GET /api/proposals/:id/export`, `POST /api/proposals/import` (file upload).
- `GET/POST/PUT/DELETE /api/contrats_moe(/:id)`.
- `GET/POST/PUT/DELETE /api/notes_honoraires(/:id)`.

### Invoicing, DPGF, billing situations
- `GET/POST/PUT/DELETE /api/invoices(/:id)`.
- `GET /api/dpgf/:projectId`, `POST/PUT/DELETE /api/dpgf(/:id)` **and** `POST/PUT/DELETE /api/dpgfs(/:id)` — two parallel CRUD sets exist; see [ROADMAP.md](ROADMAP.md#core-workflow) before integrating against either.
- `GET /api/situations/:projectId`, `GET /api/situations/:situationId/details`, `GET /api/situations/:situationId/details-enhanced`, `POST/PUT/DELETE /api/situations(/:id)`.
- `POST/PUT/DELETE /api/detail-situations(/:id)`, `POST /api/situations/:situationId/detail-bulk`.
- `PUT /api/situations/:id/etat-acompte`, `GET /api/situations/:situationId/etat-acompte-pdf`.
- `GET /api/situations/:projectId/avec-marche`.
- `GET/POST/PUT/DELETE /api/marches-entreprises(/:id)`.

### Specifications / CCTP
- `GET/POST/PUT/DELETE /api/specifications(/:id)`.
- `GET/POST /api/projects/:projectId/cctp`, `PUT/DELETE /api/cctps/:id` — newer, parallel CCTP model (see roadmap note above).

### Site supervision
- `GET/POST/PUT/DELETE /api/ordres_de_service(/:id)`, `PATCH /api/ordres_de_service/:id/status`, `GET /api/ordres_de_service/next-number`.
- `GET/POST/PUT/DELETE /api/visas(/:id)` (file upload on create/update).
- `GET/POST/PUT/DELETE /api/receptions(/:id)`.
- `GET/POST/PUT/DELETE /api/reserves(/:id)`, `GET/POST/PUT/DELETE /api/gpa-reserves(/:id)` (1-year warranty period).
- `GET/POST/PUT/DELETE /api/permits(/:id)`.
- `GET/POST/PUT/DELETE /api/rfis(/:id)`.
- `GET/POST /api/projects/:projectId/reports`, `PUT /api/reports/:reportId` — site-visit reports.
- `GET/POST /api/reports/:reportId/notes`, `PUT/DELETE /api/notes/:noteId`.
- `GET/POST/PUT/DELETE /api/projects/:projectId/observations`, `GET/PUT/DELETE /api/observations/:id`, `GET /api/reports/:reportId/observations`, `POST /api/observations/:id/link/:reportId`.

### Documents & plans
- `GET/POST/PUT/DELETE /api/documents(/:id)` (file upload), `GET /api/documents/:id/versions`, `PATCH /api/documents/:id/statut`, `GET/POST /api/documents/:id/diffusions`, `PATCH /api/documents/:id/diffusions/:diffId/acknowledge`.
- `GET/POST/DELETE /api/plans(/:id)` (file upload).

### Contacts
- `GET/POST/PUT/DELETE /api/contacts(/:id)`.
- `GET/POST/DELETE /api/contact-categories(/:id)`.
- `POST /api/sync/google-contacts`, `POST /api/sync/carddav`.

### Meetings
- `GET/POST/PUT/DELETE /api/meetings(/:id)`.
- `POST /api/meetings/:id/photos` (file upload), `DELETE /api/meetings/:meetingId/photos/:photoId`, `PATCH /api/meetings/photos/:photoId/caption`.
- `GET/POST /api/meetings/:id/attendees`, `POST /api/meetings/:id/attendees/new-contact`, `PATCH/DELETE /api/meetings/:meetingId/attendees/:attendeeId`.

### Internal feed & messaging
- `GET /api/feed`, `POST /api/feed/posts` (file upload), `POST /api/feed/posts/:id/like`, `POST /api/feed/activities/:id/like`, `POST /api/feed/posts/:id/comments` (file upload).
- `GET /api/notifications/unread-count`, `POST /api/notifications/mark-read`.
- `GET/POST /api/conversations`, `GET/POST /api/conversations/:id/messages` (file upload), `POST /api/conversations/:id/read`, `GET /api/messages/unread-count`, `POST/DELETE /api/conversations/:id/participants(/:userId)`.
- `POST /api/send-email` — outbound email via the tenant's configured SMTP.

### Push notifications
- `GET /api/push/config` — `{ configured, publicKey }`. The VAPID public key the browser needs to subscribe; `configured: false` on an instance with no VAPID keys, in which case Web Push is off and nothing else here fails.
- `POST /api/push/subscribe` — body is a `PushSubscription` (`{ endpoint, keys: { p256dh, auth } }`). Idempotent on `endpoint`; rejects a non-`https` endpoint with `400`.
- `POST /api/push/unsubscribe` — `{ endpoint }`, scoped to the caller's own subscriptions.
- `GET/PUT /api/push/preferences` — per-user, not per-tenant: `{ muted: string[] }` lists the activity categories this person has silenced. `GET` also returns `devices` (subscription count) and `configured`.
- `POST /api/push/test` — sends a test notification to the caller.
- `GET /api/notifications/pending` — the desktop client's pull channel (Electron has no push service). Returns up to 10 undelivered notifications from the last 24 h **and marks them delivered in the same call**, so a caller that drops the response drops those notifications; the durable record stays in `/api/feed`.

### Settings
- `GET/PUT /api/settings`.
- `POST /api/upload/logo`, `POST /api/upload/avatar` (file uploads).
- `POST /api/test-smtp`.

### AI
- `POST /api/ai/suggest-articles` — Gemini-backed drafting assistance. Meters and deducts from a per-tenant AI credit balance; returns `503` if `GEMINI_API_KEY` is unset.

### Billing & plans
- `GET /api/billing/status`, `POST /api/billing/checkout`, `POST /api/billing/webhook` (Stancer, no auth), `GET /api/billing/history`, `GET /api/billing/credits/packs`, `POST /api/billing/credits/checkout`.

### External integrations
Each of these follows roughly the same shape (`status`, `disconnect`, and OAuth `auth`/`callback` where the provider uses OAuth):
- **Zoho CRM**: `GET /api/zoho/status`, `GET /api/zoho/callback-url`, `GET /api/zoho/auth`, `GET /api/zoho/callback`, `DELETE /api/zoho/disconnect`, `POST /api/zoho/sync`.
- **Zoho Books**: `GET /api/zoho-books/status`, `GET /api/zoho-books/auth`, `GET /api/zoho-books/callback`, `DELETE /api/zoho-books/disconnect`, `POST /api/zoho-books/sync`.
- **Ragic**: `GET /api/ragic/status`, `DELETE /api/ragic/disconnect`, `POST /api/ragic/sync`, `POST /api/ragic/webhook` (inbound).
- **Odoo**: `GET /api/odoo/status`, `DELETE /api/odoo/disconnect`, `POST /api/odoo/sync`, `POST /api/odoo/test`.
- **Super PDP** (French e-invoicing): `GET /api/superpdp/status`, `DELETE /api/superpdp/disconnect`, `POST /api/superpdp/test`, `POST /api/superpdp/send/:invoiceId`, `GET /api/superpdp/events/:invoiceId`, `GET /api/superpdp/invoices`, `POST /api/superpdp/search-situation-facture/:situationId`, `POST /api/superpdp/link-situation/:situationId`, `POST /api/superpdp/attach-etat-acompte/:situationId`, `GET /api/superpdp/situation-status/:situationId`, `GET /api/superpdp/situations`.
- **Chorus Pro** (French B2G e-invoicing): same shape as Super PDP under `/api/chorus-pro/*`.

### MAF declaration
- `GET/PUT /api/maf/v1/config`.
- `GET/POST/PUT/DELETE /api/maf/v1/entries(/:id)`, `PATCH /api/maf/v1/entries/:id/statut`.
- `GET /api/maf/v1/summary`, `GET /api/maf/v1/export-pdf`, `GET /api/maf/v1/situations-cumul`, `GET /api/maf/v1/suivi`, `GET /api/maf/v1/spec`.
- `POST /api/maf/v1/submit` — returns `501 { error: "not_implemented" }` today (enterprise-only, unbuilt).

### Reference data
- `GET/POST/PUT/DELETE /api/references/custom(/:id)`, `POST /api/references/custom/bulk`.

### Geo & open-data lookups (French government APIs)
- `GET /api/rnb-buildings` — Répertoire National des Bâtiments.
- `GET /api/georisques` — geological/technological risk data.
- `GET /api/urbanisme`, `GET /api/urban-planning/documents`, `GET /api/urban-planning/details/:id` — PLU/GPU zoning.
- `GET /api/bdnb-geocode`, `GET /api/bdnb` — Base de Données Nationale des Bâtiments.
- `GET /api/address-search` — address autocomplete.
- `GET /api/weather`.
- `GET /api/historical-monuments`.
- `GET /api/cadastre/parcel`.
- `GET /api/search` — cross-entity search within your tenant's data.

### Super-admin (platform operator only, not tenant-scoped)
- `GET /api/admin/is-admin`, `GET /api/admin/stats`, `GET /api/admin/tenants`, `POST /api/admin/tenants`, `PATCH /api/admin/tenants/:id/plan`, `PATCH /api/admin/tenants/:id/trial`, `PATCH /api/admin/tenants/:id/ai-credit`, `DELETE /api/admin/tenants/:id`. Gated by a hardcoded `SUPER_ADMIN_EMAIL` match, not a `profiles` role — irrelevant to normal tenant integrations.

## Limitations for integrators

- **No API key / service-account auth.** You must hold a real Supabase user session. Plan for token refresh.
- **CORS reflects any Origin** with credentials allowed, and only permits `Content-Type` and `Authorization` as custom request headers — a browser-based third-party integration can't add its own auth header without a server-side CORS change.
- **No rate limiting.** Self-throttle; the server won't do it for you.
- **`x-user-role` is a client-supplied header**, trusted as-is by at least one destructive check (project delete). Don't rely on it as a security boundary in your own integration, and don't treat its presence in a request as authorization on the server side either.
- **No outbound webhooks/events.** The only webhooks are inbound (Stancer billing events, Ragic sync). If you need to react to changes in ArchiOffice in near-real-time, you'll need to poll.
- **No pagination** on list endpoints — expect full tenant-scoped arrays back.
- **Duplicated data models in a couple of spots** (`/api/dpgf` vs `/api/dpgfs`, `/api/specifications` vs `/api/projects/:id/cctp` + `/api/cctps/:id`) reflect an in-progress consolidation, not two supported alternatives — check [ROADMAP.md](ROADMAP.md) or ask before building against either.

See [ROADMAP.md](ROADMAP.md) for what's implemented vs. planned at a feature level, and the main [README](README.md) for local setup and the end-to-end product workflow.
