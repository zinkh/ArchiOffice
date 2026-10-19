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
| CCTP (technical specifications) | ✅ | Lives in the same lot/chapitre/article tree as the DPGF (`cctpDescription`/`cctpOnly` fields, `/api/projects/:id/dpgf`) — no separate CCTP resource. The former `/api/specifications` table/route was removed. |
| DPGF (cost breakdown), XML import | ✅ | Import of existing DPGF XML files works. |
| Situations / progress billing (*états d'acompte*) | ✅ | Includes PDF export of the *état d'acompte*. |
| Invoicing (Factur-X / EN 16931) | ✅ | |
| Site reports, meeting minutes, ordres de service, observations, reserves | ✅ | Meeting minutes export to real DOCX via the `docx` library. |
| Document vault (versioning, diffusion/acknowledgement tracking) | ✅ | |
| Maps: cadastre, PLU/GPU zoning, Géorisques, historical monuments, BDNB | ✅ | Proxies to French government open-data APIs. |
| Internal feed, notifications, direct messaging | ✅ | |
| Project correspondence: editable drafts, personal signature, filing in the origin mailbox | ✅ | Linking an email to a project files it in a Gmail label / Outlook or IMAP folder `ArchiOffice/<project>` (best effort). Drafts are edited in place in the provider mailbox; there is no stored draft-to-project link, the tab matches drafts by client address and project name/code. |
| Team management, roles, multi-tenant join requests | ✅ | Roles: `admin`, `manager`, `pm`, `user`. |
| Time tracking, leave, profitability by phase | 🟡 | Clock-in/out and manual entries with project, **mission phase** and a billable flag; leave requests with manager approval and balances; weekly/monthly HR exports. Admins set a **loaded hourly cost per member** (stored on the cabinet membership), and the HONOS tab shows planned fees vs cost of time per phase (admin and manager only). Not built yet: the workload plan, FEC export and expense reports, see the three entries under Known gaps. |
| Company qualifications (Qualibat, Qualifelec, RGE...), search for building companies | 🟡 | Per-contact qualifications with validity status, an "expires soon" alert on consulted companies, import of RGE qualifications from the ADEME open data, and a company search (SIRENE directory + RGE badge) from the ACT consultation table. Qualibat itself is **not** queried: see the Qualibat entry under Integrations and the TODO under Known gaps. |
| Sharing a project with a co-contractor (*cotraitant*) with per-item edit rights | ⏳ | Not built, see "Project sharing with a co-contractor" below. Today a co-contractor can only be listed on the project (`project_cotraitants`) and in the contract; it has no access to the project in the application. |
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
| Nextcloud | ✅ Active — WebDAV, documents and plans stored on the tenant's own server |
| kDrive (Infomaniak) | ✅ Active — same WebDAV adapter as Nextcloud |
| Google Drive | ✅ Active — OAuth (`drive.file` scope), documents and plans stored on the tenant's own Drive |
| Dropbox | ✅ Active — OAuth, documents and plans stored on the tenant's own Dropbox |
| Qualibat (API Entreprise, `certifications_batiment`) | ⏳ Blocked — the API is reserved for public administrations and needs a DataPass authorisation we don't hold; by SIRET only, no search. See the TODO below |
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
| "Latest" / "Default" model alias per provider (Gemini, Mistral, Claude) | ⏳ | Planned, not built. Today every selectable model is a pinned id in `MODEL_CATALOG`, so following a provider's new release means a code change. See "Latest and default model aliases" below. |
| BYOK (tenants bringing their own API key) | ⏳ | Designed, not built — see below. |
| Speech synthesis (TTS) native per provider | ⏳ | Always Gemini today, regardless of the tenant's active chat provider — see below. |

### Latest and default model aliases — planned

Goal: let the operator (and later a tenant) pick "Latest" or "Default" for Gemini, Mistral and Claude, so the newest model is reachable when a provider ships one, without waiting for a code release. Nothing is built; this records the constraints so they don't have to be re-derived.

- **Two aliases per provider.** `default` is the model we have validated and priced (what `describeLlmSelection()` falls back to today). `latest` follows the provider's own moving alias: `mistral-*-latest` (already used in `MODEL_CATALOG`), Gemini's `*-latest` ids, and the unpinned Claude aliases. The choice is stored per provider in `platform_settings` next to the current model, and per tenant later through `tenants.ai_model`.
- **The pricing invariant still holds.** A model absent from `MODEL_CATALOG` cannot run, because billing an unpriced model means inventing an amount. A moving alias can silently point to a model with a different price, so each alias needs a catalogue entry with a rate we maintain, and the resolved model id has to be recorded.
- **Record the resolved model.** `agent_token_usage` must store the concrete model id the provider answered with (not just "latest"), so a charge can be read back with the rate that produced it. Compare it with the priced model on each call and log a warning when they differ, so a price drift is visible.
- **Fallback.** If a `latest` alias is rejected by the provider (retired or renamed), fall back to that provider's `default` instead of failing the request, and report it in `/admin`.
- **Admin UI.** Add "Latest" and "Default" entries to the model picker of **Fournisseur IA** in `/admin`, with a short note that "Latest" can change behaviour and cost without a deployment.
- **Open question.** Whether `latest` should be allowed for a tenant-level choice, or stay a platform operator setting only, given its effect on billing.

### Project sharing with a co-contractor — planned

Goal: share a project with a co-contractor (*cotraitant*) so they can work on it, and let the architect decide, item by item, what they may edit and what stays read-only. Nothing is built.

- **Model.** An external collaborator is not a member of the tenant: reuse the `tenant_memberships` identity split rather than adding a second account system, with a dedicated restricted role, and scope the access to specific projects the way `project_members` already does for `pm`. An invitation by email follows the existing `POST /api/team` flow (single-use link, the person chooses their own password).
- **Per-item permissions.** A `project_shares` table (project, collaborator, status) plus `project_share_grants` (share, resource kind such as `lots`, `cctp`, `dpgf`, `tasks`, `documents`, `meetings`, `observations`, and optionally a lot or a chapter, with `read` or `write`). Default is no access: the architect grants explicitly, and anything not granted is invisible, not just read-only.
- **Server is the barrier.** Every route reached by a collaborator checks the grant on the server (as `server/invoiceAccess.ts` does for invoices), never only in the UI. Financial data (fees, invoices, notes d'honoraires of the agency) stays out of any grant by default.
- **Scope by lot.** Because a co-contractor usually owns a mission or a lot, grants should be expressible per lot (`projectLotId`) so they edit their own part of the CCTP/DPGF without seeing or touching the others.
- **Traceability.** Record who changed what (the activity log already exists), and consider a change proposal mode where the co-contractor's edits wait for the architect's approval, as an option per grant.
- **Cross-tenant references.** The shared project stays owned by one tenant; apply `assertTenantEntity` and `findMembership` checks so a collaborator can never reference or write outside the granted project.
- **Before shipping.** Update the privacy policy and the subcontractor list, and define what happens to the access when the co-contractor is removed from the contract or the project is archived.

### BYOK — planned

The remaining step of the multi-provider work. Nothing is built yet; this records the design so it doesn't have to be re-derived.

- **Storage**: a `tenant_ai_providers` table (`tenant_id`, `provider`, `api_key_encrypted`, `key_hint`, `default_model`, `is_active`), one row per provider so several can coexist. Encrypt with the existing `server/secretsCrypto.ts` (AES-256-GCM, `MAIL_ENCRYPTION_KEY`) — the same primitive already used for IMAP passwords and OAuth refresh tokens, no new crypto.
- **Never echo a key back**: follow the `SECRET_COLS` pattern in `server/routes/settings.ts`; return a masked hint (`sk-ant-...4f2a`), never the key.
- **Wiring**: `resolveLlmProvider()` already takes `{ provider, model, apiKey }` — the tenant lookup plugs in there, and no call site changes.
- **Billing**: on a BYOK call, skip `deductAiCredit` and the prepaid `NO_TOKENS` gate, but still write the `agent_token_usage` row with `cost_eur_cents = 0`, so the tenant keeps its consumption visible without being charged. The `plan !== 'enterprise'` gate on agent chat is worth revisiting at the same time: BYOK is precisely what would let agents open up to lower plans at no cost risk to the operator.
- **Open question**: tenant-wide only, or also per agent (`agents.provider` / `agents.model`)? Per-agent allows "Claude for drafting, Mistral for cheap classification" but doubles the config surface.
- **Already in place**: `resolveLlmProvider()` takes `{ provider, model, apiKey }` and those win over everything else, and `platform_settings` shows the pattern for a stored selection. The per-tenant lookup slots in where `getPlatformAiConfig()` is called today — in `routes.ts` and `aiSuggestions.ts` — with the tenant's decrypted key as `apiKey`.
- **Also required**: BYOK moves data processing to a provider the tenant picked, so the privacy policy (`src/pages/PrivacyPolicy.tsx`) and the subcontractor list need updating before it ships.

### External storage — not built

The storage layer itself is in place (`server/externalStorage/`, see CLAUDE.md's
"Stockage sur l'espace du cabinet"). These are the pieces deliberately left out,
recorded here so the reasoning doesn't have to be re-derived.

- **Migrating files uploaded before the connection.** Today the saving is
  gradual: old files stay on Supabase, new ones go to the tenant's space. A
  backfill job would copy the existing ones over, rewrite `file_url` and
  `storage_backend`, then delete the Supabase object. It is a bulk, hard-to-undo
  operation over a tenant's entire archive, which is why it wasn't bundled with
  the initial work — it deserves its own dry-run mode, per-file resumability and
  a verification pass before anything is deleted.
- **Widening the scope past `documents` and `plans`.** Mechanically easy —
  `storeBusinessFile()` takes a bucket — but meeting photos, chat/feed
  attachments and CVs don't weigh enough to justify it. `logos` and
  `support-attachments` must never move (see the gaps section above).
- **Google Shared Drives and Dropbox Business team spaces.** The Drive adapter
  already sends `supportsAllDrives` on every call and the connection table has a
  `drive_id` column reserved for it, but nothing selects a shared drive in the
  UI. Dropbox Business would need the `Dropbox-API-Path-Root` /
  `Dropbox-API-Select-User` headers. Both are additive.
- **Following folder renames.** If someone renames an affaire's folder from
  their own drive, the next upload recreates one under the canonical name next
  to it, rather than chasing the rename (which would mean guessing). Files
  already deposited are unaffected — they are addressed by their own id, never
  by their folder's path.
- **A local cache for the Electron client.** Offline mode serves files from the
  workstation's own disk and returns HTTP 503 with an explicit message for an
  externally stored file. Caching them locally is a feature in its own right.
- **Per-provider direct upload.** See the memory-pressure gap above.

### Inbound mail per tenant — partly built

The alias domain is now set per tenant (`settings.mail_inbox_domain`, Réglages > Agents IA > Courrier entrant; `AGENT_MAIL_INBOX_ALIAS_DOMAIN` is only an instance fallback). The IMAP mailbox that receives the mail is still one shared, instance-wide mailbox (`AGENT_MAIL_INBOX_HOST/PORT/USERNAME/PASSWORD`).

- **Per-tenant IMAP mailboxes — not built.** Each cabinet would store its own encrypted IMAP credentials and get its own poll, which removes the dependence on the operator wiring every tenant domain (MX or redirect) into one mailbox. Heavier: one poller per tenant, credential encryption like `email_connections`, and a failure mode per mailbox.
- **Domain not verified.** The app cannot check that the domain a tenant enters actually delivers to the shared mailbox; routing reads only the `agents+<slug>` part of the recipient. A DNS or test-message check would close that gap.

### TTS per provider — planned

`resolveSpeechProvider()` (`packages/archioffice-agents/src/server/llm/index.ts`) always returns Gemini today, whatever the tenant's active chat provider is — see CLAUDE.md's "Synthèse vocale". That's not an oversight to fix, it's a limit of what Anthropic and Mistral currently expose: neither publishes a public text-to-speech endpoint (Claude has none; Mistral's audio work, Voxtral, is speech-to-text only), so there is no Claude/Mistral adapter to route to yet.

- **Blocked on the providers, not on our code**: `LlmProvider.speak` is already optional per-adapter (see `gemini.ts`'s `speak()` and the interface in `llm/types.ts`) precisely so a provider without TTS just doesn't implement it — the plumbing for "native per provider" already exists, same shape as `supportsWebSearch` for the recently added web-search capability.
- **When a provider ships one**: add `speak()` to that adapter (mirroring `gemini.ts`'s `pcmToWav()`-style handling of whatever raw format it returns) and change `resolveSpeechProvider()` to prefer the active chat provider when it implements `speak`, falling back to Gemini otherwise — the same fallback shape already used by `resolveTranscriptionProvider()` for audio input.
- **Pricing**: a new entry in `llm/pricing.ts`'s `MODEL_CATALOG` for that provider's TTS model — the same invariant as everywhere else in the AI layer, a model absent from the catalog can't run because we can't bill it honestly.

## Platform

| Area | Status | Notes |
|---|---|---|
| Web app (React/Vite/Express) | ✅ | Primary, most-tested target. |
| Electron desktop build (offline-first, local sync) | 🟡 | Fully scaffolded (`electron/`, embedded Postgres, `electron-builder.yml`) but less battle-tested than the web app. |
| Super-admin dashboard (`/admin`) | 🟡 | Functional platform-operator tools (tenant stats, plan/trial overrides), smaller and less polished than the main app. Gated by a single hardcoded `SUPER_ADMIN_EMAIL`, not a real role. |
| Public API for third-party integrators | ⏳ | No API-key or service-account auth exists yet — see [API.md](API.md#authentication) for what integrating today actually requires. |
| Rate limiting | 🟡 | In place on the sensitive endpoints most worth protecting (`server/rateLimit.ts`: public auth, local login, AI generation, outbound email, the billing webhook, the SMTP test) — not a blanket limiter on every route. |
| API versioning | ⏳ | Flat `/api/*` surface with no version prefix, except the self-contained `/api/maf/v1/*` namespace. |

## Known gaps worth knowing about before you rely on something

- **TODO: ask Qualibat for access to its API.** The cabinet has no DataPass access, so the [API Entreprise Qualibat endpoint](https://entreprise.api.gouv.fr/catalogue/qualibat/certifications_batiment) (reserved for administrations and local authorities) is out of reach. Write to Qualibat to ask whether it offers its own API or a partnership for private firms: checking a certificate by SIRET, and ideally searching its directory by trade and département, which the API Entreprise endpoint does not offer. In the meantime the cabinet records qualifications by hand (or imports the RGE ones from the ADEME open data) and checks the certificate on the Qualibat website. Two follow-ups once an answer is in: point `QUALIBAT_ANNUAIRE_URL` (`src/lib/qualifications.ts`) at the actual directory page, and add a `source = 'qualibat'` feed to `contact_qualifications` (the table already allows `api_entreprise` as a source; a Qualibat-specific one would need a CHECK update).
- **The ADEME RGE dataset was not exercised against the live service when it was integrated** (network access was filtered in the development environment). `server/rgeLookup.ts` reads its columns tolerantly and the dataset name can be overridden with `ADEME_RGE_DATASET`, but the first real import should be checked by hand on a known company.

- **No pagination on most list endpoints** (`/api/documents`, `/api/tasks`, `/api/contacts`, `/api/tenders`, `/api/rfis`, `/api/reserves`, `/api/meetings`, and others) — large tenants get full, unpaged arrays back. `/api/projects` and `/api/invoices` got opt-in cursor pagination (`?limit=&cursor=`, returning `{ data, nextCursor }`) and dropped their per-row relational fan-out (cotraitants/lots/stakeholders/categories, line items) down to a single per-item detail fetch — see CLAUDE.md's "Pagination et fan-out sur les listes" — but the remaining endpoints above still return everything, unpaged, on every call.
- **Uploads go through the server's memory**, not a direct signed upload to storage. Every route on the multer/`memoryStorage()` path (`server/documentUpload.ts`, `server/imageUpload.ts`) buffers the whole file (up to 50 Mo) in the Node process before it reaches storage — Supabase's, or the tenant's own space. Several concurrent large uploads can add up to real memory pressure. A direct-to-storage signed-upload flow (client asks the server for a short-lived signed upload URL, then uploads straight to the now-private storage bucket) would remove the server from that hot path entirely; not started, and it would have to be reworked per provider now that three of them exist.
- **External storage covers documents and plans only.** A tenant that connects
  its own space (Google Drive, Dropbox, Nextcloud, kDrive) gets its `documents`
  and `plans` files written there — including document versions and visa
  attachments, which live in the `documents` bucket. Meeting photos, chat and
  feed attachments and CVs stay on Supabase Storage: they don't weigh enough to
  be worth the extra moving part. `logos` is public by design, and
  `support-attachments` has to stay with us so the platform superadmin can still
  read them from `/admin/support` — a tenant's own drive would be unreachable to
  them.
- **Files uploaded before a tenant connects its space are not migrated.** They
  stay on Supabase and keep being served from there, which is why each row
  records where its own file lives (`storage_backend`, derived from `file_url`).
  The saving is therefore gradual, and a bulk migration of existing files is not
  built — see "External storage — not built" above.
- **Reads of externally stored files go through the server**, except on Dropbox,
  which can mint a short-lived per-bearer download link the read route redirects
  to. Google Drive and WebDAV have no equivalent that doesn't widen the file's
  sharing inside the tenant's own space, so their bytes are streamed through us
  (`Range` requests are passed upstream, so pdf.js still works on large plans).
  That puts external reads back on the same hot path as uploads.
- **`@tanstack/react-table` is pinned to v8.** v9 (dependabot PR #226, closed) rewrites the whole API — `useReactTable`, `getCoreRowModel` and `getFilteredRowModel` become `createCoreRowModel`-style factories, `VisibilityState` and the column `size` option are gone, and the generics changed — so `src/components/ObservationsTable.tsx` (the only consumer: resizable columns, filtering, column visibility) no longer compiles against it. TODO: either migrate that component to the v9 API, or replace the library with a lighter table for that one screen; until then the `^8` range in `package.json` is intentional.
- **Suspended tenants are not fully frozen for background jobs.** A tenant suspended by the platform superadmin (`tenants.suspended_at`, see CLAUDE.md « Suspension d'un cabinet ») is blocked for every member on every `/api` request, and the alert cycle, the lifecycle emails and the closure purge already skip it. Three jobs that run outside any request still touch it: the BOAMP/TED tender watch (`server/tenderRssPoller.ts`, inserts new tenders), the notification archiver (`server/notificationArchiver.ts`, archives old notifications) and the payment reminders (`server/dunning.ts`, emails the cabinet's admins). TODO: exclude suspended tenants from those three, the same way `agentAlerts.ts` does (`.is('suspended_at', null)` on the tenant list), and add a test per job.
- **The contract window (`/contrats`, `src/pages/Contrats.tsx`) closes without asking when it has unsaved edits.** Escape, the close button or a click on the backdrop discard whatever was typed in the MOE contract modal. TODO: compare the form with the last loaded or saved contract and confirm with `useConfirmDialog` before closing, the same guard the work-situation dialog now has (`SituationDialog.tsx`, `confirmDiscard`). The marché dialog of the RDT tab (`MarcheDialog.tsx`) has the same gap, less costly since it holds fewer fields.
- **Webhooks are inbound-only** (billing events from Stancer, sync notifications from Ragic) — there's no outbound event/webhook system for third parties wanting to react to changes in ArchiOffice.

Screenshots and a demo GIF are also still on the list — see the TODO in [README.md](README.md#screenshots) if you'd like to contribute some.

---

Don't see something you expected here, or know of a gap this page is missing? Open an issue or update this file in the same PR as the change that makes it stale.

### Workload plan (*plan de charge*): assignments per collaborator and per week

⏳ Planned. Time tracking only shows hours already worked (`TeamWeekSchedule`); nothing plans the future. Competitors (OOTI, Milient, Architek) all offer it.

- New table of assignments (tenant, user, project, phase, week or date range, planned hours), with the usual `tenant_id` scoping, `assertTenantEntity` checks on `project_id` and membership checks on `user_id`.
- A view per collaborator and per week: planned hours against capacity, overloads in red, planned vs actually worked hours (from `time_entries`).
- **Linked to leave already managed**: approved `leave_requests` (and public holidays) reduce a person's weekly capacity, so planning on a week of leave shows the overload instead of hiding it. `leave_requests.business_days` already gives the number of days.
- Planned hours per phase feed a forecast of the profitability by phase (planned hours x hourly cost vs fees), next to the actual figures that already exist.
- Out of scope for a first version: drag-and-drop on the Gantt, automatic levelling, skills matching.

### FEC export (*Fichier des Écritures Comptables*)

⏳ Planned. Only the Zoho and Odoo connectors exist today; Sage and Dext (common among French practices) are not connected, and no accounting file can be exported.

- Export of the invoices (and payments) of a fiscal year in the FEC layout required by the tax administration (18 mandatory columns, tab- or pipe-separated, `SIREN` + `FEC` + closing date in the file name).
- Needs a chart-of-accounts mapping per tenant (client, sales, VAT collected accounts), settings in `/settings`, and a validation pass (balanced entries, sequential numbering, no gap) before download. The sequential invoice numbering in `document_sequences` already guarantees the numbering rule.
- Frozen invoices (`invoice_accounting_sync.sync_status = 'synced'`) must come out unchanged between two exports of the same year.
- Follow-up: Sage and Dext import files built on the same journal lines.

### Expense reports (*notes de frais*) and supplier invoices

⏳ Planned, after the FEC export (their entries are what the FEC needs to be complete). No table, route or screen exists.

- Expense report per member: date, amount excl. VAT, VAT, category, receipt (stored through the existing document store), project and phase to charge it to, billable or not, validation circuit modelled on leave requests (`pending`, `approved`, `rejected`).
- Supplier quotes and invoices attachable to a project and a phase, so they count in the cost side of the profitability by phase.
- Export of approved expenses for payroll/accounting (Excel in the cabinet charter, then FEC lines).

