# Roadmap & Feature Status

This page tracks what's actually implemented in ArchiOffice today versus what's planned or only partially wired up. It exists so users and integrators don't have to read `server.ts` to find out whether something works. There's no formal release process behind this — it reflects the state of the code, updated as things change.

Status legend: ✅ Implemented · 🟡 Partial / experimental · ⏳ Planned (UI placeholder only, no backend) · 🚫 Stubbed (calls fail on purpose)

## Core workflow

| Area | Status | Notes |
|---|---|---|
| Projects, milestones, Gantt, Kanban, Calendar | ✅ | Full CRUD, in daily use. |
| Tenders (*appels d'offres*) + RSS watch | ✅ | Includes RSS source polling and match → tender conversion. |
| Proposals (*devis*) with AI-assisted drafting | ✅ | Gemini-backed suggestion endpoint, gated by per-tenant AI credits. |
| Contracts (*contrats MOE*) | ✅ | Co-traitants/sous-traitants, status workflow. |
| CCTP (technical specifications) | 🟡 | Two parallel data models exist server-side (`/api/specifications` and the newer `/api/projects/:id/cctp` + `/api/cctps/:id`). Functionally usable, but treat this as still consolidating — don't build external integrations against both. |
| DPGF (cost breakdown), XML import | ✅ | Import of existing DPGF XML files works. |
| Situations / progress billing (*états d'acompte*) | ✅ | Includes PDF export of the *état d'acompte*. |
| Invoicing (Factur-X / EN 16931) | ✅ | |
| Site reports, meeting minutes, ordres de service, observations, reserves | ✅ | Meeting minutes export to real DOCX via the `docx` library. |
| Document vault (versioning, diffusion/acknowledgement tracking) | ✅ | |
| Maps: cadastre, PLU/GPU zoning, Géorisques, historical monuments, BDNB | ✅ | Proxies to French government open-data APIs. |
| Internal feed, notifications, direct messaging | ✅ | |
| Team management, roles, multi-tenant join requests | ✅ | Roles: `admin`, `manager`, `pm`, `user`. |
| Billing & plan quotas | ✅ | Payment processing via **Stancer** (not Stripe), quota enforcement (`projects`, `users`, `documents`) tied to plan/trial status. |

## Document export

| Format | Status | Notes |
|---|---|---|
| PDF (invoices, MAF declarations, états d'acompte, etc.) | ✅ | jsPDF/autotable, works throughout. |
| Word/DOCX — meeting minutes | ✅ | Real export via `docx`. |
| Word/Excel — Specifications (CCTP) page | ✅ | `generateWordDoc`/`generateExcelDoc` in `src/services/documentService.ts` build real `.docx` (via `docx`) and `.xlsx` (via `xlsx`) files from the spec's sections/items. |

## Integrations (Paramètres → Intégrations)

| Integration | Status |
|---|---|
| Zoho Invoice | ✅ Active — OAuth + bidirectional sync |
| Zoho Books | ✅ Active — OAuth + bidirectional sync |
| Odoo | ✅ Active — JSON-RPC sync |
| Ragic | ✅ Active — sync + inbound webhook |
| Super PDP | ✅ Active — French e-invoicing (send, status, situation linking) |
| Chorus Pro | ✅ Active — French B2G e-invoicing portal |
| Déclaration MAF | ✅ Active — versioned `/api/maf/v1/*` sub-API, except: |
| MAF submission (`/api/maf/v1/submit`) | 🚫 Returns HTTP 501, marked "Enterprise only — contact sales" |
| Stripe | ⏳ Planned — listed in Settings, no backend |
| QuickBooks | ⏳ Planned — listed in Settings, no backend |
| Google Drive | ⏳ Planned — listed in Settings, no backend |
| Dropbox | ⏳ Planned — listed in Settings, no backend |
| Salesforce | ⏳ Planned — listed in Settings, no backend |
| Slack | ⏳ Planned — listed in Settings, no backend |
| Microsoft Teams | ⏳ Planned — listed in Settings, no backend |

## Platform

| Area | Status | Notes |
|---|---|---|
| Web app (React/Vite/Express) | ✅ | Primary, most-tested target. |
| Electron desktop build (offline-first, local sync) | 🟡 | Fully scaffolded (`electron/`, embedded Postgres, `electron-builder.yml`) but less battle-tested than the web app. |
| Super-admin dashboard (`/admin`) | 🟡 | Functional platform-operator tools (tenant stats, plan/trial overrides), smaller and less polished than the main app. Gated by a single hardcoded `SUPER_ADMIN_EMAIL`, not a real role. |
| Public API for third-party integrators | ⏳ | No API-key or service-account auth exists yet — see [API.md](API.md#authentication) for what integrating today actually requires. |
| Rate limiting | ⏳ | Not implemented on any endpoint. |
| API versioning | ⏳ | Flat `/api/*` surface with no version prefix, except the self-contained `/api/maf/v1/*` namespace. |

## Known gaps worth knowing about before you rely on something

- **`x-user-role` header is client-supplied and unverified** for at least one destructive check (project delete). Don't build automation that assumes this is a real security boundary.
- **No pagination** on list endpoints — large tenants get full, unpaged arrays back.
- **Webhooks are inbound-only** (billing events from Stancer, sync notifications from Ragic) — there's no outbound event/webhook system for third parties wanting to react to changes in ArchiOffice.

Screenshots and a demo GIF are also still on the list — see the TODO in [README.md](README.md#screenshots) if you'd like to contribute some.

---

Don't see something you expected here, or know of a gap this page is missing? Open an issue or update this file in the same PR as the change that makes it stale.
