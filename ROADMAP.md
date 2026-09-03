# Roadmap & Feature Status

This page tracks what's actually implemented in ArchiOffice today versus what's planned or only partially wired up. It exists so users and integrators don't have to read `server.ts` to find out whether something works. There's no formal release process behind this — it reflects the state of the code, updated as things change.

Status legend: ✅ Implemented · 🟡 Partial / experimental · ⏳ Planned (UI placeholder only, no backend) · 🚫 Stubbed (calls fail on purpose)

## Core workflow

| Area | Status | Notes |
|---|---|---|
| Projects, milestones, Gantt, Kanban, Calendar | ✅ | Full CRUD, in daily use. |
| Tenders (*appels d'offres*) + RSS watch | ✅ | Includes RSS source polling and match → tender conversion. |
| Proposals (*devis*) with AI-assisted drafting | ✅ | Suggestion endpoint behind the provider-neutral LLM layer, gated by per-tenant AI credits. |
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
| Word/Excel — Specifications (CCTP) page | 🚫 | `generateWordDoc`/`generateExcelDoc` in `src/services/documentService.ts` are stubs that show an "not implemented yet" alert. **The Specifications export buttons don't produce a file today.** |

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

## AI providers

Model calls go through one provider-neutral layer, `packages/archioffice-agents/src/server/llm/` — see the AI section of [CLAUDE.md](CLAUDE.md) for how it fits together.

| Area | Status | Notes |
|---|---|---|
| Gemini | ✅ | Default provider. `gemini-3-flash-preview`. |
| Claude (Anthropic) | ✅ | Adapter + pricing in place; set `ANTHROPIC_API_KEY` and `AI_PROVIDER=anthropic` to run the instance on it. Not yet exercised against real tenant traffic. |
| Mistral | ✅ | Same. French, EU-hosted — the relevant argument for tenants whose own clients impose GDPR or data-sovereignty constraints. |
| Per-model pricing | ✅ | `llm/pricing.ts`. A model absent from `MODEL_CATALOG` is refused rather than billed at an invented rate; `AI_PRICE_MARKUP` is the single margin lever. |
| Provider choice from the UI | ✅ | Platform operator picks the active provider **and a model per provider** in `/admin` (**Fournisseur IA**), stored in `platform_settings`, effective within ~30s with no restart. Each provider keeps its own model, so switching back restores the earlier choice instead of resetting to that provider's default. A provider with no API key configured can be pre-set but not activated. Still instance-wide: no per-tenant or per-agent picker. |
| BYOK (tenants bringing their own API key) | ⏳ | Designed, not built — see below. |

### BYOK — planned

The remaining step of the multi-provider work. Nothing is built yet; this records the design so it doesn't have to be re-derived.

- **Storage**: a `tenant_ai_providers` table (`tenant_id`, `provider`, `api_key_encrypted`, `key_hint`, `default_model`, `is_active`), one row per provider so several can coexist. Encrypt with the existing `server/secretsCrypto.ts` (AES-256-GCM, `MAIL_ENCRYPTION_KEY`) — the same primitive already used for IMAP passwords and OAuth refresh tokens, no new crypto.
- **Never echo a key back**: follow the `SECRET_COLS` pattern in `server/routes/settings.ts`; return a masked hint (`sk-ant-...4f2a`), never the key.
- **Wiring**: `resolveLlmProvider()` already takes `{ provider, model, apiKey }` — the tenant lookup plugs in there, and no call site changes.
- **Billing**: on a BYOK call, skip `deductAiCredit` and the prepaid `NO_TOKENS` gate, but still write the `agent_token_usage` row with `cost_eur_cents = 0`, so the tenant keeps its consumption visible without being charged. The `plan !== 'enterprise'` gate on agent chat is worth revisiting at the same time: BYOK is precisely what would let agents open up to lower plans at no cost risk to the operator.
- **Open question**: tenant-wide only, or also per agent (`agents.provider` / `agents.model`)? Per-agent allows "Claude for drafting, Mistral for cheap classification" but doubles the config surface.
- **Already in place**: `resolveLlmProvider()` takes `{ provider, model, apiKey }` and those win over everything else, and `platform_settings` shows the pattern for a stored selection. The per-tenant lookup slots in where `getPlatformAiConfig()` is called today — in `routes.ts` and `aiSuggestions.ts` — with the tenant's decrypted key as `apiKey`.
- **Also required**: BYOK moves data processing to a provider the tenant picked, so the privacy policy (`src/pages/PrivacyPolicy.tsx`) and the subcontractor list need updating before it ships.

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
