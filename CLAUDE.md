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

**Le numéro local vient d'une séquence atomique, plus d'un comptage.** `getNextDocNumber`
(devis, factures, notes d'honoraires) et `getNextAffaireInvoiceNumber` (référence
`CODE-ACO-NN` d'un acompte) appellent `nextDocumentSequence()` (`server/documentSequence.ts`),
donc la fonction SQL `next_document_number(cabinet, série)`
(`supabase/migrate_atomic_document_numbering.sql`) : un `UPDATE ... RETURNING` sur
`document_sequences`, sous verrou de ligne Postgres. L'ancien « nombre de lignes + 1 » donnait le
même numéro à deux créations simultanées (trois notes d'honoraires d'un cabinet portent déjà
« NH-01 » en production). Séries : `invoice`, `proposal`, `note_honoraires`, `acompte:<projet>`.
Quatre règles à garder :

- **Remise à zéro chaque année** : la clé d'une séquence est (cabinet, série, année) ; la
  numérotation repart de 001 au 1er janvier. Les références d'acompte d'une affaire
  (`acompte:<projet>`) ignorent l'année (année 0).
- **Amorçage sur l'existant**, à la première demande d'une série pour une année : le plus grand
  suffixe d'un numéro de la forme `…-AAAA-NNN` de CETTE année (001 s'il n'y en a pas ; pour un
  acompte, le nombre d'acomptes déjà émis sur l'affaire). Une référence saisie à la
  main (« 2626 », « NH-01 ») n'est volontairement pas lue comme un suffixe, sinon elle ferait sauter
  la numérotation. Un numéro réservé par une création qui échoue ensuite n'est pas rendu : la suite
  peut avoir un trou, jamais un doublon.
- **Repli sans la migration** (poste Electron, hébergement en retard) : seule l'absence de la
  fonction (`PGRST202`, `42883`) ramène à l'ancien calcul ; toute autre erreur est remontée, jamais
  remplacée par un numéro approximatif.
- **Fonctions réservées au rôle serveur** (`REVOKE` pour `PUBLIC`, `anon`, `authenticated`) : un
  compte connecté ne peut pas faire avancer la séquence d'un autre cabinet par l'API REST.

Tests : `tests/documentSequences.test.ts` (faux Supabase avec latence d'écriture, qui donne des
doublons avec l'ancien calcul) et `tests/documentSequences.pg.test.ts` (vrai Postgres, vraies
connexions parallèles, exécuté par la CI). Les index uniques `(tenant_id, numero)` des devis et des
notes d'honoraires ne sont PAS posés : des doublons existent déjà en production et feraient échouer
la migration.

### Délai de paiement et date d'échéance

Une facture sans date d'échéance explicite (typiquement la facture brouillon
générée depuis une note d'honoraires, `POST /api/notes_honoraires/:id/
facture`) était insérée avec `due_date: null` — affiché à l'écran comme
« 01/01/1970 » (`new Date(null)` vaut l'epoch, que `toLocaleDateString` formate
sans se plaindre plutôt que d'échouer).

`settings.invoice_payment_terms_days` (`supabase/migrate_invoice_payment_terms.sql`,
réglable depuis `/settings` → Cabinet, « Facturation — Délai de paiement »,
NULL valant 30 jours) fixe désormais le nombre de jours ajoutés à la date
d'émission pour calculer l'échéance chaque fois qu'elle n'est pas fournie
explicitement — `server/invoiceDueDate.ts::computeInvoiceDueDate()`, appelé
par `POST /api/invoices` et `POST /api/notes_honoraires/:id/facture`. Une
échéance explicitement fournie par l'appelant continue de gagner : ce réglage
ne fait que combler l'absence, jamais l'écraser.

**Se synchronise avec Zoho et Odoo sans code supplémentaire.** Les trois
connecteurs (`pushInvoiceToZohoInvoice`/`Books`, `pushInvoiceToOdoo`) lisent
déjà `invoices.due_date` de la ligne locale au moment du push — l'échéance
calculée à la création part donc avec la facture dès le premier envoi, sans
notion de délai de paiement à répliquer côté connecteur.

Les écrans qui affichaient `new Date(invoice.due_date).toLocaleDateString()`
sans garde (`Invoices.tsx`, `InvoiceGenerator.tsx`) sont corrigés pour rendre
« --- » plutôt que l'epoch sur une facture antérieure à ce changement, dont
`due_date` reste `null` tant qu'elle n'est pas rouverte et resauvegardée. Le
formulaire de création de facture et `InvoiceGenerator` préremplissent
désormais l'échéance par défaut à partir de ce même réglage plutôt que 14 ou
30 jours codés en dur.

### Le Maître d'Ouvrage d'une facture (`invoices.client_id`)

Jusqu'ici `invoices` n'avait aucun lien vers `contacts` : le « client » d'une
facture se déduisait toujours de son projet (`project_id` → `projects` →
`client`), donc une facture sans projet — facture générale, ou importée d'un
connecteur comptable — n'avait aucune identité de Maître d'Ouvrage : ni nom,
ni SIRET, ni adresse, ni téléphone, alors qu'une facture française doit
porter ces mentions pour l'acheteur comme pour le vendeur (`seller_*` existe
déjà sur cette table). `invoices.client_id`
(`supabase/migrate_invoice_client_link.sql`, FK vers `contacts`) ferme ce
trou : rempli depuis `projects.client_id` à la création quand les deux
existent, toujours modifiable ensuite — même principe que `project_id` :
corriger le rattachement n'est pas modifier le contenu légal déjà envoyé,
et c'est exactement ce qui permet de corriger après coup un contact que le
connecteur a créé à la volée sans toutes ses mentions.

`server/invoiceClientContact.ts` centralise la résolution :

- **`resolveInvoiceClientId`** — `client_id` de la facture, sinon celui de
  son projet, sinon aucun. Lecture seule.
- **`loadInvoiceClientContact`** — la fiche complète du contact (nom, SIRET,
  TVA, adresse, téléphone, email), jointe par `GET /api/invoices/:id`
  uniquement (jamais la liste — voir « Pagination et fan-out sur les
  listes » plus haut) et exposée en lecture seule sous `invoice.client`.
- **`resolveOrCreateContactFromExternal`** — utilisée seulement au PULL
  Zoho (Invoice/Books) : retrouve un contact existant par email puis par nom
  exact, sinon en crée un avec les informations renvoyées par Zoho. Odoo
  n'en a pas besoin : sa propre synchro de contacts (`server/routes/
  odoo.ts`) pull déjà chaque `res.partner` dans `contacts` par `odoo_id`
  avant que les factures ne soient traitées dans le même appel.

**Push (ArchiOffice → connecteur), les trois connecteurs :**

`pushInvoiceToZohoInvoice`/`pushInvoiceToZohoBooks` (et l'envoi en masse des
deux routes `/sync`) recherchent désormais un contact Zoho par nom réel du
Maître d'Ouvrage (plus par nom de projet) et, faute de correspondance, en
créent un avec nom, email, téléphone et adresse de facturation — Zoho
Invoice/Books n'ayant pas de champ SIRET natif, celui-ci est écrit dans
`notes` (`SIRET : <valeur>`), relu au pull via une regex sur ce même
format. `pushInvoiceToOdoo` résout (ou pousse pour la première fois) le
`res.partner` du contact et pose enfin `partner_id` sur la facture — cette
colonne n'était jamais renseignée avant, qu'une facture soit créée à
l'unité ou par la synchro `/api/odoo/sync` : la ligne de vente Odoo n'avait
alors aucun acheteur, malgré une synchro de contacts déjà complète (SIRET
dans `ref`, TVA dans `vat`) tournant à côté sans être exploitée par les
factures.

**Pull (connecteur → ArchiOffice) :** un import Zoho sans correspondance
locale (`zohoInvoiceToLocalRow`) résout maintenant le client — un appel
`GET /contacts/:id` de plus, mais seulement pour un client réellement
nouveau, jamais par facture déjà connue. Côté Odoo, `client_id` se déduit
d'une recherche `contacts.odoo_id = partner_id` : ne JAMAIS écraser un
`client_id` existant avec `null` quand cette recherche ne trouve rien (une
facture déjà rattachée à la main ne doit pas perdre son contact au pull
suivant) — seule une correspondance trouvée peut mettre à jour la ligne.

**Factur-X / EN16931 (`src/lib/facturX.ts`)** portait déjà `FacturXParty`
avec `siret`/`vatNumber`/`email`, mais seul le vendeur les utilisait : le
XML CII n'émettait ni `SpecifiedLegalOrganization` ni
`SpecifiedTaxRegistration` pour l'acheteur, et `EnInvoiceJson.buyer` n'avait
même pas de type pour les porter — une facture envoyée à SuperPDP (`server/
routes/superpdp.ts`) n'a donc jamais transmis le SIRET/l'adresse/la TVA du
Maître d'Ouvrage, quelle que soit la donnée disponible côté ArchiOffice.
Les deux lisent maintenant `invoice.client_id` via `loadInvoiceClientContact`
(`InvoiceGenerator.tsx` pour l'export local, `buildEnInvoice` pour l'envoi
SuperPDP) ; Chorus Pro (B2G, identifié par SIRET seul) gagne le même repli
en plus de celui déjà existant sur `projects.client_siret`.

### Atelier DOE (onglet AOR)

L'ancienne carte « Dossier des ouvrages exécutés » (un tableau de documents, un avis à la main) est remplacée par
`src/components/aor/DoeAtelier.tsx` : le cabinet **sollicite** les entreprises, **relance** automatiquement, **analyse et
valide** les documents reçus, **vise** chaque dossier et **transmet une archive** au maître d'ouvrage. Migration
`supabase/migrate_doe_atelier.sql` (trois tables hors `SYNC_TABLES`, quatre colonnes sur `documents`). Une instance non
migrée lit un atelier vide (`disponible: false`) et refuse l'écriture en 503.

- **Les fichiers restent des lignes de `documents`** (`doc_type = 'DOE'`, `contact_id` = clé de l'entreprise comme avant) :
  même stockage (Supabase ou espace du cabinet via `storeBusinessFile`, rangés sous `<affaire>/AOR/DOE/<entreprise>`), même
  quota, même suppression (`DELETE /api/documents/:id`). Colonnes ajoutées : `doe_piece`, `doe_lot_id`, `doe_request_id`,
  `doe_source` (`entreprise` | `cabinet`). Le visa est un document `DOE_VISA`, l'archive un document `DOE_ARCHIVE` : ils
  n'entrent jamais dans la liste des documents d'une entreprise.
- **Le statut se déduit, il n'est jamais saisi** (`statutEntreprise`, `src/lib/doeAtelier.ts`, testé) : à solliciter,
  sollicitée, incomplet, à analyser, à corriger, conforme, visé. Une entreprise = un `contact_id` (ou nom) des lots du projet,
  lus par `server/doe/dossier.ts` (`chargerDossier`, seule lecture partagée par l'écran, les relances, le visa et l'archive).
  Un visa **défavorable** laisse le dossier « à corriger » ; un document déposé **après** un visa rouvre l'analyse.
- **Pièces attendues** (`DOE_PIECES` : plans conformes à l'exécution, notices, fiches techniques, PV d'essais, attestations,
  garanties) : exigées par défaut sauf attestations, réglables par opération (`doe_settings.required_pieces`).
- **Sollicitation par lien personnel sans compte** (`/doe/:token`, `src/pages/DepotDoe.tsx`, route publique hors
  `ProtectedLayout`), sur le patron du dépôt des offres : jeton `doe_…` dont seul le SHA-256 est stocké, un seul lien actif par
  entreprise (index unique partiel), **renvoyer le lien en crée un nouveau et révoque l'ancien**. Contrairement au dépôt des
  offres, **aucune condition de plan, de marché ou de stockage externe** : un DOE se remet aussi en marché public. Le portail
  contrôle les octets (`server/doe/fileRules.ts` : PDF, Word, Excel, ODS, ODT, plus JPEG et PNG vérifiés à leur signature,
  jamais DWG ni DXF), refuse un lot étranger, accuse réception par e-mail, prévient les personnes de l'affaire, **n'écrit
  que dans `documents`** et **ne refuse jamais un dépôt tardif**. Une entreprise ne retire que ses propres documents non
  encore analysés. Le quota de documents du cabinet s'applique (503 neutre sinon).
- **Relances automatiques** (`server/doe/relances.ts`, `startDoeReminders`, toutes les 6 h, `DOE_REMINDERS_INTERVAL_HOURS`) :
  une relance part quand l'intervalle est écoulé (7 jours par défaut, 2 à 60) depuis la dernière, tant que le dossier attend
  l'entreprise (`sollicitee`, `partiel`, `a_corriger`), dans la limite du plafond (4 par défaut, 10 au plus), et jamais pour une
  demande jamais envoyée, révoquée, expirée, sans adresse, ou d'un cabinet suspendu. Chaque relance **crée un nouveau lien**
  (le jeton n'est pas conservé), cite les pièces encore manquantes et les observations sur les documents refusés. La demande
  est « prise » par une mise à jour conditionnelle (`revoked_at IS NULL`) : deux processus ne l'envoient pas deux fois. **Si le
  message ne part pas, l'ancien lien est rendu valable et rien n'est compté.** L'envoi passe par le SMTP du cabinet
  (`server/doe/mail.ts`), jamais par un compte personnel : une relance part sans session humaine.
- **Analyse = suggestion, jamais avis** (`POST /api/projects/:id/doe/analyser`, sans modèle ni coût, lecture du texte par
  `lireTexteDepot`) : reconnaît la pièce d'après le nom et le texte (`classerPiece`), classe un document **non classé**
  quand la confiance atteint 0,5, signale scan sans texte, texte très court, pièce non reconnue ou différente de celle
  déclarée, plan DWG/DXF et doublon. L'avis par document (favorable, avec observations, défavorable, `validation_status`)
  et ses observations (`validation_comments`, transmises à l'entreprise sur la page de dépôt) restent un geste de
  l'architecte (`PUT /api/doe/documents/:id`).
- **Visa** (`POST /api/projects/:id/doe/visas`) : avis favorable, favorable avec observations ou défavorable. Un visa
  favorable **exige** toutes les pièces exigées et un avis sur chaque document (409 sinon) ; le défavorable est toujours
  possible. Le numéro `DOE-AAAA-NNN` est **réservé par l'insertion de la ligne** (index unique `(tenant_id, numero)`, nouvel essai
  au conflit), pas par `next_document_number` dont la liste de séries est fermée côté SQL ; le numéro réservé est rendu si le PDF
  ou son dépôt échoue. Le PDF (`src/lib/doePdf.ts`, charte du cabinet, « P1|2 ») photographie les pièces et les avis au moment
  du visa, il est déposé comme document de l'affaire, et peut partir par e-mail à l'entreprise (avec, pour un défavorable, un
  nouveau lien de correction qui ne compte pas comme une relance).
- **Archive pour le maître d'ouvrage** (`POST /api/projects/:id/doe/archive`, `server/doe/archive.ts`, `jszip`) :
  `00 - Bordereau de transmission.pdf`, `01 - Plans de la maitrise d'oeuvre/` (plans AOR les plus récents, ou tous : un plan
  remplacé par une version suivante via `parent_id` n'est pas joint), `02 - DOE des entreprises/<lots> - <entreprise>/<pièce>/`
  (jamais un document refusé), `03 - Visas/`. **Seuls les dossiers visés y entrent** ; en joindre d'autres est un choix explicite,
  et transmettre sans eux demande une confirmation (409 `dossiers_non_vises`). Les réserves (dossier non visé, visé avec
  observations, fichier introuvable) sont portées au bordereau. Plafond de 300 Mo en mémoire (413 sinon) ; l'archive est
  enregistrée comme document, téléchargeable, et envoyée en pièce jointe seulement sous 20 Mo, sinon l'écran le dit.
- **Tests** : `src/lib/__tests__/doeAtelier.test.ts` (statuts, relances, classement, archive, messages) et
  `tests/doeAtelier.test.ts` (routes du cabinet et portail public sur un drive en mémoire, nodemailer remplacé).
- **Pas encore fait** : lecture OCR des DOE scannés (ils sont signalés « sans texte », pas lus), pièces attendues propres à
  chaque lot, visa groupé de plusieurs entreprises, envoi du lien par un compte mail personnel.

### PV d'OPR par lot (onglet AOR, bloc Réception)

Un procès-verbal des opérations préalables à la réception **par lot**, en deux régimes qui partagent le même modèle de données. Le régime se déduit de l'affaire (`projects.is_public_client`), jamais de la requête, et se fige à la création. **Étapes livrées** : données et logique (1), PV privé complet (2), EXE4 et EXE5 du marché public (3), EXE6 à EXE9, nature des réserves et export groupé (4). **Pas encore fait** : le passage automatique des réserves au statut « Levée » quand une levée est décidée (la décision reste un geste ; les statuts des réserves se règlent dans le suivi des réserves) et la lecture hors ligne de ces PV.

- **Données** : colonnes ajoutées à `receptions` (`supabase/migrate_opr_pv.sql`, `migrate_opr_pv_reference_signature.sql`) : `regime` (`prive` | `public`, NULL = PV générique d'avant, comportement inchangé), `marche_id`, `lot_id`, `ccag_version`, dates (`date_avis_achevement`, `date_achevement_annoncee`, `date_opr`) et sections jsonb (`presences`, `constats`, `proposition`, `decision`, `levee`, `carence`, `delais`), `signed_at`/`signed_mode`/`signed_document_id`. Les réserves de l'annexe sont les `reserves` du PV (`reception_id`), aucune duplication. `receptions` est dans `TABLES_RATTACHEES` : une affaire archivée est en lecture seule.
- **Logique pure** (`src/lib/oprPv.ts`, `oprPvDelais.ts`, `oprPvSanitize.ts`, testée) : cinq natures de réserves communes à tous les formulaires (épreuves, travaux, malfaçons, installations, pose des équipements) ; **statut déduit** (`statutPv`), jamais saisi ; `formulaireDecision` (EXE7 pour une non-réception, EXE6 sinon) et `formulairesDuPv` (la levée EXE8/EXE9 ne suit qu'une réception) ; `controlerPv` (conditions de réserve, annexes, convocation, dates, réserves ouvertes). `sanitizeOprPayload` revalide tout le corps côté serveur ; `lirePv` lit une ligne sans jamais lever.
- **Délais communs au privé et au public** : OPR sous 20 jours après l'avis d'achèvement (le plus tardif de l'avis et de l'achèvement annoncé), transmission de la levée sous 5 jours, décision du maître d'ouvrage sous 30 jours, carence du maître d'œuvre 30 jours après la lettre recommandée. Valeurs par défaut des notices EXE ; **chaque PV porte les siens** (`delais`) : en privé le contrat fait foi. Une date illisible n'est jamais un retard.
- **Routes** (`server/routes/receptions.ts`) : le PUT d'un PV d'OPR est **partiel** (un champ absent du corps n'est pas effacé) ; le PUT d'un PV générique garde l'ancien comportement (tout réécrit). Le lot d'un PV ne change jamais ; un accord-cadre n'a pas de PV ; marché et lot sont vérifiés contre le cabinet ET l'affaire. Référence `OPR-AAAA-NNN` attribuée par le serveur (index unique partiel `receptions_opr_reference`, nouvel essai au conflit) ; une référence saisie est respectée. `POST /api/receptions/:id/signature` (papier ou électronique) est refusée tant que `controlerPv` signale une erreur ; un PV signé répond 409 `PV_SIGNE` à toute modification jusqu'à `POST .../signature/rouvrir`. Instance non migrée : 503 `OPR_PV_UNAVAILABLE`.
- **Rendu** : le contenu est construit une fois sous forme de blocs neutres (`src/lib/oprPvDocument.ts`, `construirePvPrive`, testé sans navigateur) puis rendu à l'identique en PDF (`oprPvPdf.ts`, charte du cabinet, « P1|2 », cases à cocher **dessinées** : ☐ n'existe pas dans les polices de jsPDF) et en Word (`oprPvDocx.ts`). Le titre d'en-tête est court (`PROCÈS-VERBAL D'OPR`) : le titre complet chevauchait le nom de l'agence. Une donnée absente s'imprime en pointillés, jamais inventée ; l'annexe imprime des lignes vides à compléter à la main quand il n'y a pas de réserve.
- **Écran** : `OprPvSection` (tableau au bureau, cartes sous 768 px ; liste les PV du régime de l'affaire), `OprPvDialog` (trois volets, réserves de l'annexe, échéances, contrôles, signature), `useOprPv`. Branchés dans `ProjectDetail.tsx` par quelques lignes. Le formulaire exporte ce qui est saisi, réserves non enregistrées comprises ; retirer une réserve ne ferme pas la fenêtre.
- **Marché public (EXE4 à EXE9)** : `src/lib/oprPvExe.ts` construit les six cerfas avec les intitulés du ministère (mise à jour du 01/04/2019) : rubriques A à D (pouvoir adjudicateur, titulaire avec SIRET, maître d'œuvre, objet), E et F de l'EXE4 (portée, présences, six constats numérotés, signatures, attestation de refus), E et F de l'EXE5 (numérotation 1, 1.1, 1.2.1, 1.3.1.1, 2). Même rendu PDF/Word que le privé. **Aucune mention inventée** : une donnée absente s'imprime en pointillés, un CCAG non renseigné n'est pas affirmé. Mentions propres au public dans `receptions.public_info` (jsonb : `portee`, `prestations`, `signataire`, `reference_marche`, `supabase/migrate_opr_pv_public_info.sql`) ; le lieu de signature réutilise `receptions.lieu`. L'identité du titulaire et du pouvoir adjudicateur vient des fiches contact (`donneesExe`, `identiteDepuisContact` : raison sociale, adresse de travail avant l'adresse générale), à défaut des noms connus. La référence du marché est rappelée dans l'en-tête de chaque page (la notice l'exige). La proposition a quatre avis : « sous réserve » ne porte que épreuves et travaux, « avec réserve » que malfaçons, repli et pose (contrôlé par `controlerPv`). 
- **Décision et levée** : l'EXE7 (non-réception) ou l'EXE6 (réception) suit la proposition puis la décision (`formulaireDecision`), l'EXE8 et l'EXE9 ne suivent qu'une réception prononcée (`formulairesDuPv`). `levee` (jsonb) porte le PV de levée (ses propres présences et constats, EXE8), la proposition du maître d'œuvre (`rapporter`, `lever_toutes`, `maintenir_toutes`, `lever_partie` + annexe des réserves levées + réserves maintenues avec leur date) et la décision du maître d'ouvrage (mêmes options, plus `accepter`), avec les dates qui portent le délai de transmission. **L'issue retenue** (`optionLeveeRetenue`) est la décision, ou la proposition quand le maître d'ouvrage l'accepte ; elle alimente le statut déduit (`reserves_levees`, `reception_rapportee`). Une levée enregistrée à l'ancienne (deux dates) se relit sans rien perdre. `controlerPv` exige, pour une levée partielle, l'annexe des réserves levées, les réserves maintenues et la date de celles de repli ou de pose ; il signale une levée sans réception avec réserves.
- **Nature des réserves** (`reserves.nature`, `supabase/migrate_reserves_nature.sql`, mêmes cinq natures que les cerfas) : posée à la création d'une réserve du PV, corrigée par `PUT /api/reserves/:id/nature` (le PUT d'une réserve réécrit tous ses champs et ne touche la nature que si le corps la porte). Elle ventile les annexes : un tableau par nature sous le numéro d'annexe que cite le formulaire ; épreuves, travaux et malfaçons sont numérotées, le repli du chantier et la pose des équipements ne le sont pas (leur échéance est dans la condition). Les réserves sans nature sont regroupées à la suite ; sans aucune nature, une annexe unique. L'annexe de l'EXE8 liste les réserves encore ouvertes, celle de l'EXE9 les réserves levées.
- **Export groupé** : « Tout exporter (ZIP) » rassemble un PDF par formulaire et par lot (`telechargerArchivePv`, qui réutilise `livrer` : un seul fichier part tel quel, plusieurs en ZIP) ; le formulaire propose les PDF et Word de chaque formulaire que le PV porte.
- **Points ouverts** : « CCAG applicable » (2009 ou 2021) est porté par le PV et non par le marché (liste blanche de `marches_entreprises` non modifiée) ; les formulaires 2019 citent le CCAG 2009, leur validité avec le CCAG 2021 est à confirmer sur le site de la DAJ. Pas de lecture hors ligne de ces PV.
- Tests : `src/lib/__tests__/oprPv.test.ts`, `oprPvDocument.test.ts`, `oprPvExe.test.ts`, `tests/oprPvReceptions.test.ts`, `tests/oprPvUi.test.ts`, `tests/reserveNature.test.ts`.

### Import de plans AOR en lot et renommage

Bloc Plans de l'onglet AOR : « Importer un plan » ouvre un sélecteur multiple, et le bloc entier accepte un
glisser-déposer de fichiers (`PlansDropZone`, `src/components/aor/PlansImport.tsx`, seulement pour un glisser qui
porte des fichiers). Les fichiers arrivent dans `PlansImportDialog` : un nom modifiable par plan avant l'envoi,
alerte sur les noms en double (dans le lot ou déjà sur l'affaire), retrait d'une ligne, ajout de fichiers. Les
envois partent UN PAR UN vers `POST /api/plans` (index A, version 1, catégorie AOR) ; un échec s'affiche sur sa
ligne et n'arrête pas les suivants, et le bouton relance seulement ceux qui restent. Logique pure et testée dans
`src/lib/planImport.ts` (`nomPlanRetenu` : caractères interdits retirés, extension d'origine rétablie si effacée ;
50 plans au plus par import ; vides et déjà présents écartés). « Nouvel indice » d'un plan garde son sélecteur à
fichier unique (`handlePlanUpload`). Renommer un plan déjà importé : crayon `PlanName` (Entrée enregistre, Échap
annule) puis `PUT /api/plans/:id`, qui ne change que `plans.name` (200 caractères au plus, 404 hors cabinet),
jamais le fichier ni son emplacement. Aucune migration. Tests : `src/lib/__tests__/planImport.test.ts`,
`tests/plansRename.test.ts`. Pas vérifié dans un navigateur réel.

**Ordre des plans.** Chaque plan AOR a une poignée (`PlanGrip`) : glisser à la souris, ou appui long au doigt
(`usePlanReorder`, sur `startPressDrag` comme `LotsManager`). L'ordre se prévisualise pendant le geste et ne part
qu'au relâché, par `PUT /api/plans/order` (`{ project_id, ids }`, liste complète, déclarée avant `/:id`) qui écrit
`plans.sort_order` (`supabase/migrate_plans_sort_order.sql`) ; un plan d'un autre cabinet ou d'une autre affaire,
un doublon ou une liste vide sont refusés en 400 sans rien écrire, une instance non migrée répond 503
`PLAN_ORDER_UNAVAILABLE`. Un échec d'enregistrement remet l'ordre précédent à l'écran. Tri
(`src/lib/planOrder.ts`, testé) : plans jamais rangés d'abord (le plus récent en tête, comme avant), puis les plans
rangés selon leur rang : un plan déposé après un réordonnancement apparaît donc en haut de la liste. Tests :
**Tri par nom** : un bouton de l'en-tête du bloc (visible à partir de deux plans) range les plans A à Z, puis Z à A
au clic suivant (`idsTriesParNom`, `sensProchainTri` : accents et casse ignorés, nombres lus comme des nombres,
« Plan 2 » avant « Plan 10 »). Il écrit l'ordre manuel par la même route `PUT /api/plans/order` : ce n'est pas un
mode permanent, un plan déposé ensuite apparaît en haut et la poignée reste utilisable après le tri.
`planOrder.test.ts`, `tests/plansRename.test.ts`. Pas vérifié dans un navigateur réel.

### Réserves de chantier : fiche, photos, export PDF

`src/components/pro/ReserveTracker.tsx` (les mêmes réserves d'OPR et
réserves GPA, une table chacune, `apiBase` décide) est construit pour le
téléphone d'abord, là où une réserve se relève : une liste de cartes sur
mobile (`md:hidden`, numéro, intitulé, vignette de la première photo,
entreprise en charge, échéance, statut), le tableau groupé par lot au bureau,
et dans les deux cas **un appui sur la réserve ouvre sa fiche**
(`ReserveDetail.tsx`, panneau plein écran sur mobile, modale au bureau).
Plus d'édition en ligne dans le tableau : la fiche est le seul endroit où l'on
modifie une réserve, le statut restant changeable d'une pastille depuis la
liste. Ce que les deux partagent (statuts, pastille, retard, extrait de plan)
vit dans `reserveShared.tsx`.

**Photos.** `reserve_photos` (`supabase/migrate_reserves_photos_recent_views.sql`)
sur le modèle de `meeting_photos`, bucket privé `reserve-photos` lu par URL
signée comme les autres (`PRIVATE_STORAGE_BUCKETS`). Une seule table pour les
deux jeux de réserves, distingués par `reserve_kind` (`'opr' | 'gpa'`) — une
clé étrangère ne peut pas viser deux tables, donc **la suppression en cascade
est faite par `deleteReservePhotos()`** (`server/reservePhotos.ts`) à la
suppression d'une réserve, pas par la base. `GET /api/reserves` et
`GET /api/gpa-reserves` (et la fiche `/api/projects/:id/full`) attachent
`photos: []` à chaque réserve en UNE requête (`attachReservePhotos`), jamais
une par réserve. Dans la fiche, `<input capture="environment">` ouvre
directement l'appareil photo sur un téléphone ; en création, les photos
prises avant l'enregistrement sont mises en file et envoyées une à une une
fois la réserve créée (il faut son id pour les rattacher).

**Suivi / réponse.** Une réserve peut être faite sans être satisfaisante : `reserves.reponse` et
`gpa_reserves.reponse` (`supabase/migrate_reserves_reponse.sql`, TEXT, 5000 caractères) portent la
réponse de l'entreprise ou la remarque de la maîtrise d'œuvre, comme la réponse d'une observation du
DET. Saisie dans la fiche (`ReserveDetail`, champ « Suivi / réponse », mis en avant quand le statut est
« Levée refusée par le MOE »), vue dans la liste (icône + extrait), cherchée par la recherche et imprimée
dans l'export PDF. `PUT` ne l'écrit que si le corps la porte (`normalizeReponse`,
`server/reservePhotos.ts`) : un changement de statut depuis la liste ne l'efface pas ; une instance non
migrée répond 503. Test : `tests/reserveReponse.test.ts`.

**Extrait de plan.** Les repères sont stockés en pourcentage de la première
page du plan (`x`/`y`, PlanAnnotator). `src/lib/planRender.ts` rend cette
page (pdf.js, ou `<img>` pour un plan image) sur un canvas mis en cache par
plan, et en découpe une fenêtre autour du repère (`renderPlanExcerpt`) pour la
fiche et l'export. Le rendu se fait côté navigateur, jamais côté serveur :
c'est le même pdf.js que PlanAnnotator, et le serveur n'a pas à rasteriser
des A0.

**Export PDF** (`src/lib/reservesExport.ts`, bouton « Exporter PDF », porte
sur la liste FILTRÉE à l'écran) : page de garde avec récapitulatif et tableau,
une page par plan avec tous les repères numérotés (paysage si le plan l'est),
puis une fiche par réserve (champs, commentaire, extrait de plan, photos en
vignettes de 42 mm). En-tête, pied et pagination « P1|2 » du cabinet via
`pdfLetterhead.ts`, nuances de gris. Les images passent par
`loadPhotoDataUrl` (réduites à 900 px) : embarquer les originaux ferait un
PDF de plusieurs dizaines de Mo pour rien.

### Projets ouverts récemment et jalons de mission

**Classement par défaut de `/projects`** : les affaires ouvertes le plus
récemment PAR LA PERSONNE CONNECTÉE en tête. `project_recent_views` (même
migration que ci-dessus, une ligne par couple personne × projet) est écrite
par `GET /api/projects/:id/full` (`recordProjectOpened`, meilleur effort) et
relue par `GET /api/projects` sous `last_opened_at` (`attachLastOpenedAt`,
`server/projectRecentViews.ts`). Stocké côté serveur et non dans le
navigateur pour que le classement suive la personne d'un poste à l'autre.
Un tri explicite du sélecteur remplace ce classement ; sans historique, la
liste garde l'ordre de l'API.

**Jalons en double.** `ProjectDetail.tsx` synchronise les jalons du projet
avec les missions du contrat MOE lié (un jalon par mission incluse, apparié
par titre). L'effet se déclenchait dès l'arrivée du contrat, alors que la
liste des jalons n'était pas encore lue en base — il recréait donc tous les
jalons de mission à chaque ouverture de la fiche. Il attend désormais
`milestonesLoaded`, garde en mémoire les créations en cours
(`milestoneCreationsInFlight`) et supprime les doublons laissés par l'ancien
comportement (pour une même mission, seul le jalon coché ou à défaut le plus
ancien est conservé). À ne pas défaire : un effet qui lit `milestones` sans
attendre qu'ils soient chargés recrée le bug.

**Stepper de mission sans historique de phase.** Sans ligne dans
`project_phase_history`, la fiche affiche déjà « Phase ESQ » : le stepper de
l'en-tête (et celui de la fiche complète) prend la première phase affichée
comme phase en cours plutôt que de ne rien marquer.

### Fiche affaire : enregistrement automatique et facture d'une note

**Plus de bouton Enregistrer.** La fiche (aperçu, fiche complète, champs
HONOS) s'enregistre seule, comme les notes, avenants, jalons et la
consultation ACT : `useProjectAutosave` (`src/hooks/useProjectAutosave.ts`)
envoie la fiche 1,2 s après la dernière frappe, chaîne les écritures (c'est la
fiche du moment de l'envoi qui part, une frappe pendant un envoi en déclenche
un autre), réessaie 5 s après un échec et envoie la fiche en attente au départ
de l'écran ou à la fermeture de l'onglet (`pagehide`, `keepalive` sous 64 Ko).
`isProjectDirty()` (`src/lib/projectDirty.ts`, testé) compare la fiche
affichée à la dernière version chargée ou enregistrée (`savedProject`) ; rien
ne part avant la lecture de la fiche. L'en-tête montre « Enregistrement… » puis
« Enregistré », ou « Échec de l'enregistrement » avec « Réessayer »
(`AutosaveIndicator.tsx`). Une fiche dont le nom a été vidé n'est pas envoyée
(`canAutosaveProject`). Ctrl+S envoie tout de suite. `useUnsavedChangesGuard`
ne prévient plus avant de quitter qu'en cas d'échec ou de nom manquant. Sous
`BrowserRouter`, `useBlocker` n'existe pas : un `navigate()` programmatique
doit passer par `confirmDiscard()`. Les montants repris du contrat lié
(`remuneration`, `construction_cost`) ne comptent pas comme une saisie.

**L'enregistrement n'envoie jamais les listes rattachées**
(`projectSavePayload` retire `lots_list`, `cotraitants_list`,
`stakeholders_list`, `categories_list`), et `PUT /api/projects/:id` ne
remplace une liste que si le corps la porte (`replaceList`,
`server/routes/projects.ts`, `tests/projectUpdateLists.test.ts`). Une ligne
déjà existante y garde son identifiant et ses autres colonnes. Avant ce
correctif, chaque enregistrement de la fiche recréait les lots avec un nouvel
identifiant et sans leurs montants (`base_amount`...), ce qui détachait les
visas (`lot_id`), les marchés et le DPGF (`projectLotId`).

Générer la facture brouillon d'une note se confirme montant HT et TTC sous les
yeux, et se conclut par un toast « Ouvrir la facture » (`/invoices?open=<id>`)
; « Facture créée » est un lien. `saveNote` garde le formulaire ouvert tant que
le serveur n'a pas confirmé. Les `alert()` de la fiche sont des toasts
(`useToastWithUndo`).

### Fiche affaire : onglets regroupés et onglet dans l'adresse

Les dix onglets de la fiche (INFOS, TACHES, HONOS, PRO, ACT, VISA, DET, RDT,
AOR, CORRESPONDANCE) gardent leurs identifiants et leur contenu, mais la barre
(`ProjectTabBar.tsx`, logique pure dans `src/lib/projectTabs.ts`, testée) les
présente en sept familles au plus : Infos, Tâches, Honoraires, Études (PRO),
Consultation (ACT), Chantier, Correspondance. Les quatre missions de chantier
passent en second niveau sous « Chantier », sigle MOP et nom complet ; revenir
sur une famille rouvre la mission qu'on y consultait. Une famille sans onglet
visible disparaît (hors mission chantier, cinq entrées). `PillTabs` porte
désormais les rôles ARIA d'onglets et la navigation aux flèches.

L'onglet ouvert vit dans `?tab=` (sauf INFOS, le défaut), écrit en
`replace` pour ne pas empiler l'historique : il survit au rechargement et au
retour depuis un autre écran. L'état initial est lu dans l'adresse dès le
premier rendu (sinon l'écriture de l'onglet par défaut effacerait le
paramètre avant sa lecture) ; un identifiant inconnu retombe sur INFOS. Les
liens existants (`?tab=TACHES`, liens d'agent `?tab=&open=`) restent valides.
Le stepper de phases de l'en-tête est nommé (« Phases de mission ») : une
pastille affiche le journal de sa phase (voir ci-dessous), le bouton « Passer
en {phase suivante} » à sa droite fait avancer la phase réelle après
confirmation.

Finitions de la même fiche, à conserver : les fenêtres (VISA, accusé de
réception d'OS, suppression de l'affaire) partagent le même voile
`bg-black/50`, portent `role="dialog"` et se ferment à Échap
(`useEscapeKey`, sauf pendant un enregistrement ou une suppression) ; les
actions révélées au survol (`opacity-0 group-hover:opacity-100`) restent
visibles au doigt (`pointer-coarse:`) et au clavier (`focus-within:`) ; les
lignes de groupe VISA et DOE se déplient par un vrai bouton (`aria-expanded`) ;
les jalons de l'aperçu sont des cases (`role="checkbox"`). Les couleurs de
l'aperçu et du badge MAF passent par les jetons `--tblr-*`, jamais par des hex
figés qui ignorent le thème sombre.

**Plus aucun `window.confirm()` dans la fiche.** Deux régimes :

- **Suppression annulable** (note d'honoraires, avenant, OS, permis) :
  `deleteWithUndo()` retire l'élément tout de suite et affiche « Annuler »
  pendant 6 s ; la requête `DELETE` ne part qu'ensuite
  (`UndoableDeleteQueue`, `src/lib/undoableDelete.ts`, testée ;
  `useUndoableDelete`). Une seule suppression en attente : en lancer une
  autre envoie la première. Quitter l'écran ou fermer l'onglet (`pagehide`,
  requête en `keepalive`) envoie la suppression en attente, jamais ne
  l'oublie. Un refus du serveur remet l'élément à sa place, avec un message.
- **Confirmation dans l'application** (`useConfirmDialog`,
  `src/components/ui/ConfirmDialog.tsx`, `role="alertdialog"`, Échap, focus
  tenu, focus initial sur « Annuler » pour une suppression) : jalons (que la
  synchronisation avec le contrat recrée, d'où pas d'annulation différée),
  RFI, visas, PV, réserves, documents DOE et plans, dont la suppression
  emporte souvent un fichier. La facture d'une note s'y confirme aussi, avec
  un récapitulatif HT, TVA et TTC.

### Fiche affaire : textes et libellés

Tous les textes de la fiche (`ProjectDetail.tsx`, `ProjectOverview.tsx`)
passent par i18next (`projectdetail_*`, `project_overview_*`), sauf le contenu
des PDF générés (OS, avenant, PV de réception) : ce sont des pièces
contractuelles françaises remises au maître d'ouvrage, volontairement non
traduites. Quatre règles à garder :

- **Une valeur stockée en français reste stockée telle quelle**, seul son
  affichage se traduit : statuts de note (`NOTE_STATUS_KEYS`), de réserve
  (`reserveStatusKey`, `src/components/pro/reserveShared.tsx`), d'affaire
  (`projects_status_*`), d'autorisation d'urbanisme (`project_permit_status_*`).
  Les noms de phase de la mission ont une seule source (`mission_phase_<CODE>`,
  vocabulaire de la loi MOP : APD = avant-projet définitif).
- **Un même cycle de statuts n'a pas les mêmes mots partout** :
  `osStatusBadge(status, 'os' | 'avenant')`, un OS approuvé a son accusé de
  réception, un avenant est accepté. Visas et DOE disent l'avis du maître
  d'œuvre (favorable, avec observations, défavorable), jamais « validé ».
- **Chaque champ a un libellé relié** (`htmlFor`/`id`, `FormField` le fait
  seul avec `useId`), chaque bouton icône un `aria-label` qui nomme son objet.
- **« Honoraires » dans le plan d'actions de l'aperçu mène à l'onglet HONOS**
  (notes d'honoraires de l'agence), toujours actif. Il menait aux « factures
  entreprises » de RDT et n'était actif qu'en mission chantier. RDT ne porte
  plus aucune facture de l'agence : voir « Situations de travaux et
  certificats de paiement ». Les montants de l'aperçu et de la fiche complète
  sont en lecture seule dès qu'un contrat est rattaché, comme dans HONOS.

### Fiche affaire sur téléphone et tablette

Vérifiée en 390, 820 et 1366 px. Règles à garder :

- **En-tête** : retour, titre (tronqué), supprimer et état d'enregistrement
  sur une seule ligne ; le stepper de phases prend toute la ligne suivante.
- **Barres défilantes** (familles d'onglets, missions de chantier, stepper) :
  `useHorizontalScrollHints` ramène l'élément actif dans le champ (en réglant
  `scrollLeft`, jamais `scrollIntoView`, qui ferait défiler la page) et pose
  `data-fade-start`/`data-fade-end` ; la classe `.scroll-fade-x` estompe le bord
  où du contenu est caché. Sans cela, la famille « Chantier » ouverte restait
  hors de l'écran.
- **`CardHeader`** passe l'action sous le titre quand la largeur manque (le
  titre garde 14rem) au lieu de tronquer le titre à trois lettres.
- **`StatTile`** : montant en `text-lg` sous 640 px, pour qu'un « 48 000,00 € »
  tienne dans une demi-largeur de téléphone.
- **Message vide d'un tableau plus large que l'écran** : `.table-empty-message`
  (collant à gauche) au lieu d'un texte centré sur toute la largeur, donc coupé.
- **RDT** : liste de situations touchable sous 768 px, tableau au-delà (référence
  et cumul admis à partir de 1024 px) ; la saisie ligne à ligne ne défile dans son
  cadre qu'au bureau (pas de défilement dans le défilement sur téléphone).
- **`<html lang>`** suit la langue de l'interface (`src/i18n.ts`) : il valait
  `en` en permanence, d'où une lecture d'écran et une césure anglaises.
- Un jalon sans date n'est plus pris pour la prochaine échéance (« Invalid Date »).

### Onglet AOR : onglets et échelle de texte

- **Une seule barre, pas de doublon** (`AorLayout.tsx`) : Réserves, DOE, Réception, Plans. Sous 1024 px c'est un jeu d'onglets (un seul bloc affiché, le dernier consulté mémorisé sous `aor:tab`) ; au bureau tous les blocs restent affichés et la barre mène au bloc voulu. Les anciens titres repliables par bloc (`aor:section:<id>`) n'existent plus.
- **Échelle de texte des cartes** : titre de carte 16 px (`text-base`), contrôles et texte courant 14 px (`text-sm`, comme `.btn` et les champs), informations secondaires 12 px (`text-xs`), pastilles et étiquettes en capitales 11 px (`text-[0.6875rem]`, jamais en dessous). Un contrôle n'est pas une information secondaire : bouton, champ, sélecteur et filtre restent à 14 px, cibles de 44 px au doigt (`pointer-coarse:min-h-11`).
- **Les fenêtres (`ModalShell`) sont montées à la racine de la page** (portail) : un parent transformé ou filtré devient le repère d'un élément `fixed` et la fenêtre prenait sa taille au lieu de celle de l'écran.

### OS multi-entreprises, travaux modificatifs et FTM (onglet DET)

- **Numérotation PAR ENTREPRISE** (`src/lib/numerotationEntreprise.ts`, testé, partagé serveur et écran) : chaque entreprise a sa propre suite d'OS (01-001, 01-002... : lot, puis rang à trois chiffres) et de FTM (FTM-01-01, FTM-01-02... : lot, puis rang dans la suite de l'entreprise pour CE lot). Une entreprise = sa fiche contact, à défaut son nom normalisé (`cleEntreprise`) : deux lots d'une même entreprise n'en font qu'une. Le numéro est attribué par le serveur, sous verrou par affaire, jamais lu dans la requête (`creerOrdreDeService`, `prochainNumeroOs`, `numerosFtm`). Un OS ou une FTM adressé à plusieurs entreprises reçoit un numéro dans la suite de CHACUNE : `numeros_entreprises` (jsonb, `[{ marche_id, lot, cle, entreprise, numero }]`) en garde le détail et `os_number` / `numero` en est le résumé affiché (« 04-002 / 05-001 », « FTM-04-03 / FTM-05-02 », même ordre que les noms). Les OS antérieurs (« 003 », numérotés à l'affaire) comptent pour les entreprises de leurs marchés : la suite continue après leur numéro (`numeroHeriteOs`, `numeroHeriteFtm` lisent le dernier groupe de chiffres). Une FTM sans entreprise a sa propre suite (« FTM-00-01 »). Le numéro d'un OS ou d'une FTM porte le numéro du lot (`lotPourNumero` : « 1 » devient « 01 », absent « 00 ») et sa suite est tenue par entreprise ET par lot (`cleEntrepriseLot`) : FTM-01-01 pour le lot 01, FTM-02-01 pour le lot 02, ce qui rend le numéro unique par affaire malgré l'ancien index. `GET /api/ordres_de_service/next-number?project_id=&marche_ids=a,b` rend l'aperçu par entreprise ; sans marchés, le plus grand numéro de l'affaire + 1. L'index unique `(affaire, numero)` des FTM peut rester en base : le numéro porte le lot, seule une collision de deux marchés sous un même numéro de lot (deux entreprises, même lot) la déclencherait, avec un message clair.
- **Un OS, plusieurs entreprises** : `ordres_de_service.marche_ids` (jsonb), `marche_id` restant le marché principal. Chaque marché est vérifié (cabinet, affaire, pas d'accord-cadre) ; `entreprise`, `lot` et `destinataire_os` résument tous les marchés. Colonnes absentes (instance non migrée) : repli sur le seul marché principal.
- **Pièces jointes d'un OS** : `ResourceAttachments` (`ordres_de_service`), choisies dans le formulaire puis déposées après création (`uploadResourceFiles`), ou depuis le trombone de la ligne.
- **Onglet « Travaux modificatifs »** (`TravauxModificatifsTab.tsx`, `server/routes/travauxModificatifs.ts`, `supabase/migrate_os_multi_entreprises_ftm.sql`) : devis reçus des entreprises (`devis_travaux_modificatifs`, statuts reçu / en analyse / accepté / refusé) et fiches de travaux modificatifs (`ftm`, statuts brouillon / émise / validée / refusée, entreprises concernées, incidences, lien vers l'OS émis). Un devis se rattache à une FTM ; supprimer la FTM détache ses devis. Pièces jointes sur les deux (`ftm`, `devis_travaux_modificatifs` dans `ATTACHABLE_RESOURCE_TYPES`). Instance non migrée : lecture vide, 503 à l'écriture.
- **Export PDF d'une FTM** (`src/lib/ftmPdf.ts`, `buildFtmRows` testé) : charte du cabinet, identification, objet, motif, description, incidences, devis liés avec total, trois cadres de visa (maître d'œuvre, entreprise(s), maître d'ouvrage). Rien n'est inventé : un champ absent s'imprime « — ».
- **OS prérempli depuis une FTM validée** (`POST /api/ftm/:id/ordre-service`) : refusé en 409 tant que la fiche n'est pas « validée » ou si elle a déjà son OS, en 400 sans entreprise. Brouillon d'OS de travaux : objet, description (motif + description), origine (`entreprise` devient `autres`), incidences de délai et de coût, montant = montant accepté de la fiche, à défaut somme des devis acceptés, à défaut estimation. Numéroté par entreprise par `creerOrdreDeService` (même chemin que la création à la main) ; la fiche garde `ordre_service_id`.
- **Cotraitance (deux entreprises sur un même lot)** : pas gérée, voir ROADMAP.md (« Co-contracting »). Les deux entreprises démarrent chacune à `04-001` / `FTM-04-01` ; l'index unique des FTM répond 409 à la seconde fiche.
- **Observations** : deux commandes par ligne (`ObservationsTable.tsx`) : « Nouvelle remarque pour la même entreprise » (même lot, bâtiment et phase) et « Changer d'entreprise ou attribuer à d'autres » (déplace la remarque vers un autre lot, ou en crée une copie par lot coché).

### Situations de travaux et certificats de paiement (onglet RDT)

L'onglet RDT listait les factures de l'AGENCE et en déduisait un « reste à
payer » qui mélangeait marchés de travaux et honoraires. Il porte désormais ce
que le maître d'œuvre traite en DET/RDT : les situations de travaux des
entreprises et les certificats de paiement établis à partir d'elles
(`src/components/projectDetail/situations/`), sans condition `is_chantier`.

- **Un bloc par marché** (`marches_entreprises` : une entreprise, un lot).
  « Reprendre les lots du projet » crée un marché par lot de `lots_list` qui a
  une entreprise (`contact_name`, montant base + options + avenants), sans
  doublon par numéro de lot.
- **Une situation porte le cumul HT** des travaux depuis le début du marché :
  `montant_presente_ht` (ce que facture l'entreprise) et `montant_admis_ht`
  (ce que l'architecte retient ; vide = le présenté est admis), plus
  `reference_entreprise` et `date_certificat`
  (`supabase/migrate_situations_certificats.sql`). Numérotée PAR MARCHÉ.
- **Le certificat se calcule en cumul** (`src/lib/certificatPaiement.ts`,
  testé) : période = cumul admis − cumul admis de la situation précédente DU
  MÊME MARCHÉ ; révision (si prix révisables), TVA, retenue de garantie (sur le
  TTC, nulle sous caution bancaire ou sur une période négative), remboursement
  d'avance, pénalités, net à payer. **Décompte de clôture** : total HT, liste
  des situations, TVA, TTC, puis reste à payer TTC = TTC − pénalités − avance
  versée − nets des certificats établis − retenue (libérable à la fin du délai
  de garantie, annoncée à part).
- **États stockés inchangés** (`Brouillon`, `Validée`, `Payée`), affichés « À
  vérifier », « Certificat établi », « Payée ». « Établir le certificat »
  enregistre `Validée` + `date_certificat` et télécharge le PDF ; les montants
  sont alors verrouillés jusqu'à « Rouvrir la vérification ».
- **Un seul rendu PDF** (`src/lib/certificatPaiementPdf.ts`), appelé par le
  navigateur (`certificatPaiementExport.ts`) ET par le serveur
  (`server/etatAcompte.ts`, logo via `loadAgencyIdentity`) pour la pièce jointe
  déposée sur la facture de l'entreprise chez Chorus Pro (public) ou Super PDP
  (privé) : le maître d'ouvrage reçoit le même document par les deux chemins.
  Charte du cabinet, nuances de gris, « P1|2 », date du certificat en en-tête.
- `POST/PUT /api/situations` (`server/routes/situations.ts`,
  `tests/situationsTravaux.test.ts`) passent par une liste blanche de champs
  (les colonnes Chorus Pro / Super PDP restent à leurs routes) et valident
  montants, dates et état. L'ancien `POST` écrivait `numero`/`statut`, colonnes
  inexistantes : aucune situation n'avait jamais pu être créée.
- **Deux modes de saisie cohabitent** (`situations.mode_saisie`,
  `supabase/migrate_situations_mode_detaille.sql`) : `simple`, le cumul HT se
  saisit directement ; `detaille`, un avancement CUMULÉ (%) se saisit sur
  chaque ligne du DPGF structuré du lot (`/api/projects/:id/dpgf`, jamais
  l'ancienne table `dpgf_items`) et le cumul en découle
  (`src/lib/situationDetaillee.ts`, testé ; `AvancementLignesTable.tsx`). Le
  lot du DPGF se retrouve par numéro (« 2 » = « 02 »), à défaut par intitulé ;
  le prix est celui de l'offre importée de l'entreprise (même nom, non
  écartée), à défaut celui du DPGF. Les lignes sont FIGÉES dans
  `situations.avancement_lignes` (désignation, quantité, prix, %) : un DPGF
  modifié après coup ne change pas une situation déjà saisie, et une ligne
  retirée du DPGF reste comptée. Une nouvelle situation repart de
  l'avancement de la précédente du même marché. **Le serveur recalcule
  `montant_presente_ht` à partir des lignes** (et `montantHt` = quantité × prix)
  sans croire un montant envoyé. Le certificat se calcule ensuite de la même
  façon dans les deux modes ; en mode détaillé, son PDF porte une annexe ligne
  à ligne (précédent, cumul, période).
- Les lignes `detail_situations` (avancement par poste de l'ancienne table
  `dpgf_items`) ne servent plus ; `src/pages/Situations.tsx`, qui les
  saisissait, est supprimé.

### Journal de l'opération (notes de phase)

Les observations de la fiche étaient deux champs (`etudes_notes`,
`chantier_notes`) partagés par toutes les phases : la note d'APS était écrasée
par celle de l'APD. `project_phase_notes` (`supabase/migrate_project_phase_notes.sql`,
hors `SYNC_TABLES`) porte une entrée datée par évènement : phase MOP, type
(`observation`, `programme`, `budget`, `decision_moa`, `attention`), auteur,
et pour un budget l'estimation des travaux avant ET après (écart en € et en %
calculé, `budgetDelta`, `src/lib/phaseJournal.ts`, testé). Routes
`server/routes/projectPhaseNotes.ts` (`GET/POST /api/projects/:id/phase-notes`,
`PUT/DELETE /api/phase-notes/:noteId`, `tests/projectPhaseNotes.test.ts`) ;
une instance sans la table lit un journal vide et refuse l'écriture en 503,
sans casser la fiche.

`PhaseJournal.tsx` remplace le champ Observations en tête de la colonne C de
l'aperçu ; Objet et Programme restent des champs de l'affaire, sous le
journal. Le stepper de l'en-tête porte un compteur par phase, rouge quand une
note de la phase est un dépassement de budget ; une pastille ouvre le journal
de sa phase, « Passer en … » (confirmé) appelle `POST /api/projects/:id/phase`.
`missionPhases` (`ProjectDetail.tsx`) est la seule liste des phases de la
mission, partagée par les deux steppers et le journal.

La migration reprend les anciennes observations en entrées `legacy-etudes-<id>`
/ `legacy-chantier-<id>` (identifiants déterministes, rejouable) sur la
dernière phase connue de la famille ; les colonnes ne sont pas supprimées.
Tant qu'aucune entrée `legacy-` n'est lue, l'aperçu montre ces anciennes
observations en lecture seule : une instance non migrée ne les perd pas de vue.

### Notices d’études et réglementaires

L’onglet projet **Études > NOTICES** (`src/components/projectDetail/ProjectNoticesTab.tsx`) conserve des brouillons distincts dans `project_notices` (`supabase/migrate_project_notices.sql`) : notice architecturale par phase ESQ / APS / APD / PC / PRO / DCE, plus notices Accessibilité et Sécurité incendie portées par le dossier PC. L’édition, les trames et les exports PDF/Word sont disponibles sans IA ; la rédaction assistée Enterprise passe par `server/routes/projectNotices.ts` et reprend la fiche affaire, le journal de phase, la notice architecturale précédente et les pièces jointes exploitables.

Les prompts réglementaires interdisent d’inventer catégories ERP, effectifs, dimensions, classements feu, SSI, références d’articles ou dérogations absentes des données. Une inconnue doit rester explicitement « à vérifier / à confirmer » et la sortie n’est jamais déclarée conforme de manière générale. Une notice rédigée est exposée comme **preuve suggérée** dans les contrôles de changement de phase via `server/phaseControls.ts` ; cette présence ne valide jamais automatiquement le contrôle.

### Onglet PRO : une barre au lieu du ruban

Le ruban (`ProRibbon`, supprimé) et les boutons Enregistrer ont disparu. La
ligne des sous-onglets de `ProTab` porte tout : les sous-onglets en casse
normale, l'état d'enregistrement (`AutosaveIndicator`, Ctrl+S enregistre tout
de suite), les actions du document affiché, puis un menu « ⋯ » pour le dossier
(contrôle, figer, historique, comparaison avec une autre affaire, structure,
impression).

- **Chaque atelier déclare ses actions** par `useProToolbar(items)`
  (`src/components/pro/toolbar/proToolbar.ts`) : boutons, menus déroulants,
  sélecteurs. ProTab ne se re-rend que si leur apparence change
  (`toolbarSignature`) et exécute toujours la DERNIÈRE version d'une action
  (`invokeToolbarAction`) : une fermeture périmée exporterait un document
  périmé. Sur téléphone, seules les entrées `mobile` restent dans la ligne, le
  reste passe dans « ⋯ » (`foldForMobile`).
- **Menus** (`ToolbarMenu.tsx`) : motif ARIA « menu button », posés en position
  fixe dans `<body>` pour qu'un tableau à défilement ne les coupe pas.
- **Barre de sélection** (`SelectionBar.tsx`) : n'existe que tant que quelque
  chose est sélectionné ; flotte au bas du tableau au bureau, se fixe au bas de
  l'écran sur téléphone. Le DPGF et le BPU/DQE ont une vraie sélection multiple
  (cases à cocher, Ctrl+clic, Maj+clic) ; monter, descendre, changer de niveau
  et dupliquer restent à une ligne à la fois. Chaque ligne du DPGF a aussi son
  menu « ⋯ » avec les mêmes actions.
- **Raccourcis du DPGF** (tableau focalisé) : Alt+↑/↓, Tab/Maj+Tab (seulement
  depuis le tableau lui-même, Échap désélectionne et rend Tab à la
  navigation), Ctrl+D, Ctrl+C, Ctrl+V, Suppr.
- **Suppression annulable** : « Annuler » dans le toast pendant 6 s, refusé si
  le document a changé depuis (on écraserait la saisie faite entre-temps).
- **Opérations sur la sélection** (`selectionOps.ts`, testé) : les clés de
  ligne sont positionnelles, d'où une suppression du dernier élément vers le
  premier ; un article collé sous un article trop profond remonte au premier
  niveau du chapitre.
- **Totaux recalculés depuis les articles** (`totauxDocument`) dans le DPGF,
  l'estimation et le DQE, jamais lus tels qu'enregistrés. L'estimation
  comptait les parents à plat et ignorait les sous-articles.
- **Téléphone** : le DPGF devient une liste de cartes (`DpgfMobileList.tsx`),
  un appui modifie désignation, quantité ou prix ; la bibliothèque passe en
  plein écran.
- Tableaux à la charte : en-têtes et lignes de lot sur `--tblr-surface-2`,
  plus aucun bandeau bleu figé. L'encre atténuée claire passe à `#5f6d84`
  (contraste 4,5:1 sur blanc, cf. DESIGN.md).

### Ordre des lots : la liste des lots du projet fait foi

`LotsManager.tsx` (onglet PRO > Lots) se réorganise par glisser-déposer au
pointeur (`startPressDrag`, poignée à gauche de chaque ligne). Pas de colonne
de rang : le numéro EST l'ordre (`GET` trie par numéro naturel). **Le numéro
est libre et modifiable en place** (`LotNumberInput`) : « 00 », « 01 », « 01A »
et « 01B » pour scinder un lot, « 01.1 » et « 01.2 », jusqu'à 12 caractères, sans
espace, unique dans le projet sans tenir compte de la casse (409 sinon ;
`validerNumeroDeLot`, `numeroDeLotPris`, `src/lib/lotsOrder.ts`, partagés écran /
serveur). Monter ou descendre un lot (`PUT /api/projects/:projectId/lots/order`,
`numerosPourOrdre`) : numérotation **automatique** tant que la série est standard
(que des nombres, le premier numéro est gardé : « 00 » reste premier, les suivants
suivent sans trou) ; dès qu'un numéro est personnalisé (« 01A », « 01.2 »), la
série existante est redistribuée telle quelle, jamais écrasée. Série incomplète ou
en double : retour à « 01 », « 02 »... Aucune migration SQL.

**Chapitres : « 1 », « 2 », « 3 » dans chaque lot**, jamais préfixés par le numéro du
lot (`numeroDeChapitre`, `src/lib/chapitresParDefaut.ts`) ; les articles suivent
(« 1.1 », « 1.1.1 »). C'est ce qui rend le point admis dans un numéro de lot.
`appliquerOrdreLots` ramène un document ancien (« 01.1 ») à cette forme, articles
compris. Contrepartie : un numéro d'article n'est plus unique dans le document, donc
l'import d'une offre rapproche plus souvent par intitulé que par numéro (la passe
« numéro » exige l'unicité) ; les références `#...` des classeurs exportés ne changent pas.
**Trois chapitres par défaut dans chaque lot créé** du CCTP / DPGF (`chapitresParDefaut`,
option `chapitresParDefaut` d'`appliquerOrdreLots`, aussi à la création d'un lot dans
le DPGF, pas dans le bordereau) : « PRESCRIPTIONS GENERALES » et « PRESCRIPTIONS
TECHNIQUES » (`cctpOnly`, donc masqués du DPGF) et « DESCRIPTION DES OUVRAGES ». Tous
modifiables ; la case « Visible dans le DPGF » de l'éditeur du CCTP lève le masquage.
Les lots déjà existants ne reçoivent pas ces chapitres.
`src/lib/lotsOrder.ts::appliquerOrdreLots()` reporte ensuite cet ordre et ces
numéros sur le DPGF (donc le CCTP, même document) et le bordereau, chapitres
et articles compris (seul le préfixe « ancien. » est remplacé, un code de
bibliothèque n'est jamais touché). Rattachement par `projectLotId`, à défaut par
intitulé, et le lien est alors posé ; un lot du document absent du projet garde
son numéro et passe en dernier. `ProTab.synchroniserLots` fait cette
propagation, l'autosauvegarde enregistre.

**Numéros et intitulés de lots strictement identiques partout** (liste, CCTP,
DPGF, estimation, BPU/DQE). Deux sens, jamais de suppression silencieuse :

- **Liste → documents** (cas normal : on crée d'abord les lots) :
  `appliquerOrdreLots()` donne à chaque lot du document le numéro et l'intitulé
  EXACTS du projet et crée les lots manquants (vides). Appliqué à chaque
  modification de la vue LOTS et une fois à l'ouverture, mais seulement si le
  document ne diverge pas (`lotsDivergent()` : aucun lot du document sans
  rattachement `projectLotId` à un lot existant).
- **Document → liste** (CCTP rédigé avant les lots) : si le document diverge, un
  bandeau (ProTab) propose « Remplir la liste des lots depuis le CCTP »
  (`planImportLots()` + `PUT /api/lots/:id` / `POST`, les lots existants
  rapprochés par intitulé identique puis proche prennent numéro et intitulé du
  document) ou « Aligner le CCTP sur la liste » (retire les lots hors liste,
  après confirmation qui cite ceux qui portent du contenu).

Un projet sans lot ne touche jamais aux documents.

### Suivi des entreprises consultées (ACT)

Le tableau « Entreprises consultées » de l'onglet ACT vit dans
`src/components/ACTEntreprisesTable.tsx`, sa logique pure dans
`src/lib/actEntreprises.ts` (testée) : aucune nouvelle donnée, tout se déduit
des champs déjà enregistrés dans `consultation.entreprises` (jsonb, aucune
migration).

- **Statut déduit, jamais saisi** (`statutEntreprise`) : « ne répond pas » >
  offre reçue > DCE transmis (« À relancer » dès que `relance_le` est atteinte
  sans offre, sinon « DCE envoyé ») > DCE à envoyer (`envoyer_dce`) > DCE non
  prévu. `relance_le` se lit donc comme la date de relance PRÉVUE. Les deux
  anciennes cases « Envoyer DCE » / « Ne répond pas » sont dans le menu de la
  pastille de statut.
- **Couverture** (`couverture`) : lot sous `MIN_ENTREPRISES_PAR_LOT` (3)
  entreprises (les « ne répond pas » ne comptent pas), entreprises sans lot,
  sans email alors que le DCE reste à envoyer. Un lot sous-couvert propose des
  contacts « Entreprise » dont un corps d'état recoupe l'intitulé du lot
  (`suggererContacts`, rapprochement par radicaux de 5 lettres : une
  suggestion que l'architecte confirme, pas une affectation).
- **Envoi du DCE** : le bouton de ligne ouvre `MailComposeModal` (prop
  `initial`) prérempli avec les lots de l'entreprise et les pièces du DCE qui
  la concernent ; à l'envoi, `dce_transmis_le` est posée. Les pièces du DCE
  ne sont que des intitulés : les fichiers se joignent dans la fenêtre de
  message. Pas d'envoi groupé volontairement (chaque entreprise ne doit voir
  que son propre message).
- **Ajout d'une entreprise** (`EntrepriseAddForm.tsx`, bouton « Ajouter » de l'en-tête) : un mini
  formulaire au-dessus du tableau (entreprise choisie dans les contacts ou créée sur place, email,
  corps d'état, lots, dates, DCE à envoyer) remplace l'ancienne ligne vide ajoutée tout en bas. À
  l'enregistrement la ligne se classe sous son lot (le tableau est regroupé par lot), les filtres sont
  levés, la page défile jusqu'à elle et elle est surlignée (`miseEnAvant`). Sans lot choisi, les lots
  sont PROPOSÉS d'après le corps d'état de la fiche (`lotsCorrespondants`, même rapprochement par
  radicaux que les suggestions de contacts) tant qu'on n'y a pas touché. Une fiche déjà consultée n'est
  jamais dupliquée : les lots choisis s'ajoutent à sa ligne. « Enregistrer et ajouter une autre » garde
  les lots, usage courant en série sur un même lot.
- **Actions groupées** sur la sélection (lots, DCE transmis aujourd'hui,
  relance, ne répond pas, retirer). Sous 768 px le tableau devient une liste
  de cartes (`useMediaQuery`, un seul rendu monté à la fois).
- **Enregistrement automatique** (`ACTModule.tsx`) : toute modification de la
  consultation (ajout d'une entreprise compris) est écrite 1,2 s après la
  dernière frappe, le bouton « Sauvegarder » restant disponible. Trois garde-fous
  à ne pas défaire : rien n'est écrit avant la fin de la lecture (`loaded`),
  sinon une saisie précoce écraserait la consultation enregistrée par une
  consultation vide ; les écritures sont chaînées (`saveChain`) et
  `editVersion` empêche une écriture en vol d'effacer l'état « à enregistrer »
  d'une modification arrivée entre-temps ; un échec relance une tentative
  après 5 s et le dernier état est écrit au démontage.
- `MultiSelectDropdown` (cases à cocher dans un popover) sert aux corps d'état
  et aux lots ; son `triggerContent` en fait aussi le menu de la pastille.

### Négociation des offres (ACT) : fiches, options, synthèse économique

Phase « Négociation » du module ACT, entre la collecte et l'analyse. Tout vit
dans la consultation (`act_data.consultation`, jsonb) sous des clés
facultatives : **aucune migration SQL**, une consultation ancienne reste
valide. La logique pure est dans `src/lib/actNegociation.ts` (testée), l'écran
dans `src/components/act/` (`NegociationPhase` : fiches par lot, pièces
reçues, synthèse économique), les exports dans `src/lib/actNegociationExport.ts`.

- **La base reste `Offre.montant_base`** (source unique du prix de base). Les
  options et variantes sont des `LigneOffre` de la négociation du couple
  lot x entreprise (`consultation.negociations`). Une **option s'ajoute au
  total, une variante est une offre de substitution** et n'y entre jamais. Même
  éditeur (`LignesOffreEditor`) à l'ouverture des plis (collecte) et en
  négociation.
- **Trois étages de prix** : ouverture, vérifié (`montants_verifies`, seulement
  quand il diffère), courant (le dernier tour qui a touché la ligne, tours lus
  dans l'ordre des dates). Un tour ne porte que les lignes qui ont bougé.
  Total, gain, reste à obtenir et statut (`à vérifier`, `à négocier`, `en
  négociation`, `offre finale`, `retenue`, `écartée`) se **déduisent**, jamais
  saisis.
- **L'analyse, l'attribution et les exports lisent le prix courant**
  (`offresAuPrixCourant`, `montantAttribution`), pas celui de l'ouverture ; le
  montant d'ouverture reste affiché barré à côté. Une offre sans négociation se
  comporte exactement comme avant.
- **Synthèse économique** (`lignesSynthese`, `totauxOperation`) : estimations
  APD, PRO base et PRO + options par lot (saisies, à défaut l'estimatif du
  sous-total du DPGF versé au comparatif), moins-disant et moyenne, écarts en
  euros et en pourcentage, objectif (saisi, à défaut celui de l'offre
  moins-disante), décision. **Un lot sans offre exploitable est compté à son
  estimation** dans les totaux, sinon le dépassement serait faussé. Une offre
  non conforme ou écartée de la négociation n'entre jamais dans la comparaison.
- **Tolérance du CCAP** (`controleTolerance`) : estimation actualisée par
  `indice connu / indice à la date de l'estimation` (BT01), plafond = estimation
  actualisée x (1 + tolérance), trois niveaux (sous l'estimation, dans la
  tolérance, au-delà). Taux de TVA et de tolérance dans `consultation.parametres`.
- **Pièces reçues** (`pieces_recues`, entreprise -> pièces cochées) : pièces
  administratives de la consultation + pièces d'offre (`PIECES_OFFRE_DEFAUT`).
  « Marquer non conforme » est un geste explicite, jamais automatique.
- **Exports** à la charte (nuances de gris, « P1|2 ») : PV d'ouverture par lot,
  fiche de négociation d'une entreprise, synthèse en PDF et en Excel (feuille
  « Synthèse » avec formules de somme, feuille « Négociation »). Les montants
  des PDF passent par un `euros()` qui remplace l'espace fine U+202F, absente des
  polices de jsPDF (sinon « 31 /210 » : voir la note d'honoraires plus haut).

### Postes ajoutés par une entreprise et import dans un document vierge

Une ligne du fichier d'une offre qui ne correspond à aucun article du marché
(`OffreImportDialog.tsx`, étape de rapprochement) se rattache à la main ou, au
choix dans le menu « Rattacher à… », **devient un poste** (« + Créer un poste »).
Un bouton crée d'un coup un poste pour toutes les lignes non rattachées.

- **Le poste vit dans l'offre, pas dans le document** : `OffreDocument.postesAjoutes`
  (`PosteAjoute`, `src/types/dpgf.ts`, jsonb, aucune migration, les routes
  `/dpgf/offres` et `/bpu/offres` le conservent déjà). Le DPGF/BPU de référence reste celui que toutes les
  entreprises ont chiffré. Le lot du poste se déduit du premier segment de son numéro (« 02.05 » ->
  lot « 02 »), à défaut du lot de la ligne précédente, à défaut du premier lot
  (`src/lib/postesAjoutes.ts`, testé). Sans quantité annoncée, un poste vaut 1 ; son montant entre dans
  `totalOffreHT`, affiché « dont X de postes ajoutés ». Chaque poste laisse aussi une anomalie `ligne_ajoutee`.
- **Marqué dans l'analyse** : `versComparatif` (`src/lib/bpuToAct.ts`) verse ces postes sous une section
  « Postes ajoutés par les entreprises » de leur lot, avec `ComparatifArticle.ajoute_par`, seule l'entreprise
  concernée ayant un prix ; le sous-total du lot les compte. `ACTModule.tsx` colore la ligne (violet, couleur
  de donnée) avec la pastille « Ajouté par … » ; l'export Excel du comparatif (`actAnalysisExport.ts`) ajoute
  « (ajouté par … ) » au libellé, la couleur n'y passant pas. Une offre écartée n'ajoute rien.
- **Même dialogue pour remplir un document vierge** (`mode="document"`) : onglet PRO, menu « Importer un fichier
  (créer les postes) » du DPGF, du DQE/BPU et du CCTP (bouton). Pas d'entreprise ni de prix obligatoire
  (`detectHeader(..., { prixOptionnel })`, un CCTP n'a que des désignations) ; les lignes absentes du document
  sont cochées « à créer » d'office et `ajouterLignesAuDocument` les range lot > chapitre > article (premier
  segment = lot, deuxième = chapitre quand le numéro en compte trois, sinon un chapitre « Articles
  importés »). Un lot ou un chapitre existant est complété, jamais dupliqué, aucun article existant n'est
  modifié. `ProTab` écrit par `setDpgf`/`setBpu` et non `editDpgf`/`editBpu` : ceux-ci enverraient chaque
  nouvelle ligne à la bibliothèque d'ouvrages, que des centaines de lignes tierces n'ont pas à enrichir d'office.

### DQE : chapitres de marché subséquent, sélection, dépôt de fichier

`BPUChapitre.msCode` (« Ms1 », jsonb, aucune migration) rattache un chapitre du bordereau à un marché subséquent ; sans code, le chapitre relève de l'accord-cadre. Un lot porte côte à côte ses chapitres d'accord-cadre et ceux de chaque subséquent. Menu Ajouter > « Chapitre de marché subséquent » (code suivant proposé), actions de sélection « Marché subséquent » / « Accord-cadre », vue filtrable (menu Marché > Afficher). `ExportSelection.marches` (`AC_EXPORT` ou code Ms) isole un marché à l'export (`filtrerPourExport`, `marcheDuChapitre`, `src/lib/exportPerimetre.ts`, testé) ; la fenêtre d'export n'offre la section que si le bordereau en contient. Le lien avec l'émission d'un subséquent de l'onglet RDT n'est pas fait. Le tableau a des cases à cocher et « Tout sélectionner », un crayon pour modifier un chapitre, et reçoit un tableur déposé (`onDropFichier` : bordereau vierge, lignes en articles ; sinon offre à rapprocher). Un PDF est refusé avec un message : seul Excel, ODS et CSV sont lus.

### Accords-cadres et marchés subséquents (onglet RDT)

Un accord-cadre est une ligne de `marches_entreprises` (`type_marche = 'accord_cadre'`) ; chaque marché
subséquent en est une ligne enfant (`type_marche = 'subsequent'`, `parent_marche_id`, `numero_subsequent`). Les
OS, situations et certificats de paiement s'accrochent tous à `marche_id` : un subséquent se paie donc comme
n'importe quel marché, sans code propre. Colonnes dans `supabase/migrate_marches_subsequents.sql`
(`mode_execution`, `montant_mini_ht`, `montant_maxi_ht`, `date_fin_accord_cadre`, `objet`, `lignes_commande`,
`date_notification`) ; toutes facultatives, un marché existant reste un marché ordinaire. Réservé aux affaires
dont le maître d'ouvrage est public (`is_public_client`), à un ou plusieurs titulaires (voir plus bas).

- **Le plafond se contrôle en base, jamais dans le code applicatif** : `enregistrer_marche_subsequent(tenant,
  accord-cadre, ligne, id?)` prend un verrou de ligne sur l'accord-cadre, vérifie signature, fin et maximum,
  numérote (`max + 1` sous ce même verrou, pas `document_sequences`) et écrit dans la même transaction. Deux
  émissions simultanées ne franchissent donc pas le maximum (`tests/marchesSubsequents.test.ts`). Un
  subséquent résilié (`statut = 'resilie'`) ne consomme plus le plafond ; la fonction est réservée au rôle serveur.
- **Le montant d'un subséquent n'est jamais envoyé par le client** : `server/routes/marchesSubsequents.ts` le
  recalcule depuis les lignes (quantité x prix). Quand l'offre de l'accord-cadre est figée (`offre_snapshot.prix`),
  chaque ligne doit être un article du bordereau à un prix inférieur ou égal à celui du bordereau (`validerLignesCommande` : une
  remise en concurrence peut le faire baisser, jamais monter) ; une ligne hors bordereau est refusée, un subséquent ne crée pas de prix. Les postes ajoutés par l'entreprise ne sont pas
  commandables (absents de `offre_snapshot.prix`). Sans offre figée (accord-cadre saisi à la main), lignes libres.
- **Garde-fous des routes génériques** : `COLONNES_ACT` retire les nouvelles colonnes du POST/PUT générique de
  `marches_entreprises`, le PUT retire `montant_ht` d'un subséquent, le DELETE refuse un accord-cadre qui a des
  subséquents et un subséquent signé. Un accord-cadre n'est pas convertible s'il porte déjà des situations ; son
  maximum ne descend pas sous l'émis. Un accord-cadre doit être signé avant toute émission (dialogue de signature
  papier ou électronique, mêmes routes `/signature` que les marchés de l'ACT).
- **Logique pure** `src/lib/accordCadre.ts` (testée) : consommation (`sans_plafond`, `normal`, `proche` à 80 %,
  `atteint`, `depasse`), `verifierEmission`, `validerLignesCommande`, `articlesDuBordereau`, `libelleMarche`
  (« AC lot 02 », « MS n°3 »). Elle sert à l'aperçu à l'écran ; l'autorité reste la base.
- **Écran** : `AccordCadrePanel` (jauge `role="progressbar"`, signature, liste des subséquents), `AccordCadreDialog`
  (conditions), `SubsequentDialog` (lignes composées depuis le bordereau, total et plafond en direct),
  branchés dans `SituationsTravaux.tsx`. Chaque subséquent a aussi son bloc de marché avec ses situations. Le total
  « marchés » de l'onglet RDT exclut le montant de l'accord-cadre lui-même (le subséquent le porte déjà). Textes :
  `accord_cadre_*` (fr et en).
- **PDF** `src/lib/marcheSubsequentPdf.ts` (rendu partagé navigateur et Node, sur les briques de
  `certificatPaiementPdf.ts`) : lignes, totaux, situation du plafond, signatures du titulaire et du pouvoir
  adjudicateur ; téléchargement par `marcheSubsequentExport.ts`. Pas encore joint à une facture Chorus Pro.
- **Ordres de service** : un OS ne vise jamais un accord-cadre (400 à la création comme à la modification) ; les
  sélecteurs de marché n'offrent que les marchés exécutables et préfixent « MS n°N ».
- **Alertes** (`server/agentAlerts.ts`, aucune migration) : `accord_cadre_plafond` (80 %, atteint, dépassé ; seuil
  fixe, la clé d'alerte porte le statut pour que « proche » se referme quand « atteint » s'ouvre) et
  `accord_cadre_echeance` (fin dans 90 jours par défaut, réglable ; seulement s'il reste un minimum à atteindre
  ou du crédit à engager ; reste signalée 90 jours après la fin si le minimum n'est pas atteint). Les accords-cadres non
  signés, résiliés ou d'une affaire terminée sont ignorés.
- **Plusieurs titulaires** (`supabase/migrate_marches_subsequents_multi_titulaires.sql`) : un accord-cadre multi-attributaires
  reste un ensemble de lignes `accord_cadre`, UNE PAR TITULAIRE (son bordereau figé, sa signature, ses subséquents). Une
  ligne « de tête » porte les conditions communes ; les autres pointent sur elle par `accord_cadre_groupe_id` et n'ont aucune
  condition propre (409 si on tente de les régler). `POST .../accord-cadre` avec `groupe_avec: <tête>` fait rejoindre un marché
  ordinaire du même projet. `enregistrer_marche_subsequent` verrouille la tête PUIS le titulaire (même ordre partout, pas
  d'interblocage), cumule et numérote sur TOUT le groupe : le plafond est partagé. La tête ne se défait pas tant que des
  titulaires lui sont rattachés. `GET .../subsequents` rend `tete`, `titulaires`, tous les subséquents du groupe.
- **Remise en concurrence** (`accord_cadre_consultations`, `server/routes/accordCadreConsultations.ts`,
  `ConsultationsSection.tsx`, au moins deux titulaires) : lignes à commander (articles du bordereau + quantités), offre par titulaire
  (`prix` par article, jamais au-dessus du bordereau du titulaire, `verifierOffre`), classement du moins-disant (`classerOffres`,
  offres complètes seulement). `POST .../attribuer` réserve la consultation (`en_cours` -> `attribuee`, mise à jour
  conditionnelle), émet le subséquent sous le titulaire retenu AUX PRIX DE SON OFFRE par la même `executerEmission` (donc le même
  verrou et les mêmes refus, plafond compris) et rend la consultation à `en_cours` si l'émission échoue. Retenir une offre qui n'est
  pas la moins-disante exige un motif. Une consultation attribuée ne se supprime pas. Instance non migrée : lecture vide, 503 à l'écriture.
- **Alertes** : un groupe compte pour UN accord-cadre (plafond de la tête, subséquents de tous les titulaires). Le cycle d'alertes
  est hebdomadaire (`AGENT_ALERTS_INTERVAL_HOURS`) ; pas de carte de tableau de bord, le blocage à l'émission reste immédiat.
- **Agents et MCP** : `manage_accord_cadre` (`businessTools.ts`, scope `marches_entreprises`) : `list`, `emit` (confirmation en
  deux temps avec montant et reste disponible), et la remise en concurrence (`consult_list|create|offers|award|abandon`, attribution
  et abandon confirmés). Il ne crée pas l'accord-cadre ni ses conditions et ne signe rien : cela reste à l'écran.
- **Chorus Pro et SuperPDP** : la pièce jointe d'une facture cite l'accord-cadre d'un subséquent (`mentionMarche`).
- **Pas encore fait** : libellé propre aux bons de commande.

### Espace public de dépôt des offres (ACT)

Une entreprise consultée reçoit un **lien personnel, sans compte** (`/depot/<jeton>`,
`src/pages/DepotOffres.tsx`, route publique hors `ProtectedLayout`) et y remet son offre
par **saisie en ligne** (montant de base HT, options, variantes, délai, observations),
**bordereau chiffré** (Excel ou ODS) ou **fichiers**. Génération du lien, panneau
« Dépôts des entreprises » (phase Offres) et réglages vivent dans le module ACT
(`src/components/act/{InviterDepotDialog,DepotsRecusPanel,DepotSettingsDialog,DepotIntegration}.tsx`,
`src/hooks/useConsultationDepot.ts`). Migration : `supabase/migrate_consultation_depots.sql`
(`consultation_depot_settings`, `consultation_depot_invites`, `consultation_depots`, hors
`SYNC_TABLES`).

**Trois conditions, revérifiées à CHAQUE appel** (`server/consultationDepot/eligibility.ts`,
côté cabinet comme côté portail) : plan **Enterprise** ; **marché privé** (`is_public_client`
faux : en marché public la remise dématérialisée passe par un profil acheteur, que ce portail
ne remplace pas) ; **espace de stockage externe actif** (`external_storage_connections`).
Perdre l'une d'elles ferme les liens déjà émis (503 neutre côté entreprise, qui ne
voit jamais ni le plan ni la configuration) sans rien supprimer ; les remises déjà reçues
restent lisibles par le cabinet.

- **Aucun octet d'offre dans Supabase.** `server/consultationDepot/storeDepotFile.ts` reprend la
  mécanique de `storeBusinessFile` SANS sa branche Supabase : un drive en panne fait échouer
  le dépôt en 502, jamais de repli. Rangement :
  `<racine>/<code> - <affaire>/Consultation/<Lot xx - titre | Tous lots>/<entreprise>/<AAAA-MM-JJ> - <fichier>`.
  Le fichier transite par le serveur (mémoire, `multer`), le fournisseur n'acceptant qu'un `Buffer`.
- **Formats** : PDF, Word (`.docx`), Excel (`.xlsx`), ODS et ODT, **rien d'autre** (ni DWG ni DXF,
  ni formats à macros, ni anciens binaires). Plafonds : 25 Mo par fichier, 100 Mo et 10 fichiers par
  dépôt (`src/lib/consultationDepot.ts`, partagé écran / serveur). Le contrôle se fait sur les
  **octets** (`fileRules.ts` : en-tête PDF, annuaire central des archives ZIP, entrées de macros
  ou de programmes refusées, type ODF vérifié), jamais sur le nom ni le type MIME annoncés.
- **Le jeton n'existe que dans le lien** : la base ne garde que son SHA-256 (`tokens.ts`). Il n'est
  donc rendu qu'une fois ; « renvoyer le lien » en crée un nouveau et révoque l'ancien. Un jeton
  mal formé, inconnu, révoqué ou expiré donne la même réponse 404. Expiration = date limite + 14 jours
  (90 jours sans date limite), repoussée si la date limite recule, jamais raccourcie.
- **Un dépôt n'écrase jamais l'offre.** Il arrive dans `consultation_depots` (zone d'attente,
  versionnée, horodatée, empreinte SHA-256, accusé de réception par e-mail) et l'architecte
  l'intègre explicitement, avec aperçu de l'effet : saisie → `src/lib/consultationDepotApply.ts`
  (testé : base dans `Offre.montant_base`, options et variantes en lignes de négociation au prix
  d'ouverture, tours intacts) ; bordereau → l'import existant du DPGF / BPU (`OffreImportDialog`,
  `fichierInitial`) ; acte d'engagement → la lecture existante du formulaire (`RecapActe`,
  `lireActeDepuisBuffer`). L'intégration se fait dans le navigateur (le document de la consultation
  est enregistré par `ACTModule`) ; la route (`POST /api/depots/:id/integrer`) ne fait que constater.
- **Hors délai = signalement, jamais refus.** `hors_delai` est posé à la réception ; le retrait par
  l'entreprise n'est possible qu'avant la date limite.
- **Plis scellés (option)** : tant que `sealed` et que la date limite n'est pas atteinte
  (`plisScelles`), le cabinet voit qu'une remise existe sans nom de fichier ni contenu ; ouvrir,
  intégrer, rejeter et analyser répondent 423 ; le scellement ne peut plus être levé ni la date
  avancée. Un scellement exige une date limite.
- **Statut « Offre déposée »** (`actEntreprises.ts`, `depot_recu_le`) se déduit des remises à
  traiter et n'est JAMAIS enregistré dans la consultation (le tableau lit une vue, `patch` repart
  de la source).
- **Montants probables** (`POST /api/depots/:id/analyser`, `src/lib/depotMontants.ts`,
  `server/consultationDepot/analyse.ts`) : lecture du texte (PDF, Word, tableur, ODT) et repérage
  par règles des montants en euros, sans modèle ni coût ni OCR ; le texte n'est pas tronqué (le total
  d'un devis est à la fin). Une SUGGESTION confirmée d'un clic, jamais appliquée seule.
- **Limiteurs** (`rateLimit.ts`) : `depotReadLimiter` / `depotWriteLimiter` par IP, réglables par
  `DEPOT_READ_LIMIT` / `DEPOT_WRITE_LIMIT` (les tests les relèvent).
- **Pièces du DCE** : la consultation ne porte que des intitulés ; seules les pièces cochées dans
  les réglages (`published_document_ids`, documents de l'affaire) sont téléchargeables depuis le lien.

### Documents du marché (ACT, phase Critères)

Sous les critères et pièces administratives, `MarcheDocumentsPanel.tsx` génère le
règlement de consultation, le CCAP (marché privé, renvoi à la norme NF P 03-001
et non au sigle CCAG, valeurs par défaut de la norme) et l'acte d'engagement.
Réglages dans `consultation.marche` (jsonb, sans migration), contenu pur dans
`src/lib/actMarche.ts`, rendu PDF/Word dans `actMarcheExport.ts`. Un champ vide
reste en pointillés, jamais inventé.

**L'acte d'engagement est un formulaire PDF unique** (`actEngagementForm.ts`,
champs `ae_*` stables : ne pas les renommer sans changer `AE_FORM_VERSION`),
rempli par chaque entreprise. `champsDepuisPdf` (`actEngagementImport.ts`) le
relit, `lireActeFormulaire` l'interprète en signalant les anomalies sans les
corriger, `appliquerActeAuxOffres` (`actEngagementApply.ts`) le verse dans la
consultation : entreprise rapprochée par SIRET (fiche contact) puis par nom,
sinon créée ; offre du couple lot x entreprise mise à jour sans doublon, notes,
conformité et négociations intactes. L'aperçu de l'effet précède l'import.

### Marchés de travaux constitués depuis l'ACT (phase « Marchés »)

Dernière étape d'ACT, après l'attribution : `MarchesPhase.tsx` liste un marché par lot attribué
(`consultation.attributions`) et constitue la ligne `marches_entreprises` correspondante
(`supabase/migrate_marches_act.sql` : `act_lot_id`, `act_entreprise_id`, `contact_id`, `offre_snapshot`,
`statut_signature` `a_constituer | a_signer | signe`, `mode_signature`, `date_signature`,
`acte_signe_document_id`). La création manuelle d'un marché (formulaire d'OS, RDT) reste possible, sans
consultation : ces lignes n'ont pas d'`act_lot_id` et n'apparaissent pas dans la phase.

- **Constitution idempotente** : `POST /api/projects/:projectId/marches-act` (`server/routes/marchesEntreprises.ts`,
  `tests/marchesAct.test.ts`). Un second appel met à jour un marché non signé, ne duplique jamais (index unique
  TOTAL `(project_id, act_lot_id)`, les NULL des marchés manuels restent libres) et **ne touche jamais un marché
  signé** : si l'attribution change ensuite, l'écran signale l'écart sans rien réécrire. Le POST/PUT générique
  retire ces colonnes du corps (`sansColonnesAct`) : seules les routes de l'ACT les écrivent.
- **Quatre pièces, chacune dans son fichier** (`src/lib/marcheAct.ts`, pur et testé). Le CCAP est UN SEUL pour
  l'opération, jamais par entreprise (`construireCCAP`, réglages de la phase « Critères »). Le CCTP est l'extrait
  du lot (sans prix). Le DPGF est celui du lot aux prix de l'offre retenue, **figés** dans `offre_snapshot` à la
  constitution : un DPGF modifié ensuite ne change pas le marché ; un article absent de l'offre vaut zéro (compté,
  jamais complété par l'estimation du cabinet), les postes ajoutés par l'entreprise sont rangés sous un chapitre
  dédié. L'acte d'engagement est le formulaire PDF existant, prérempli (`valeursActe` : rien d'inventé, un champ
  inconnu reste vide). « Les 4 pièces » livre une archive de quatre fichiers séparés.
- **Signature, deux modes** : papier (dépôt du scan) ou électronique (dépôt du PDF signé). Aucun service de
  signature électronique n'est connecté : le mode est enregistré avec le document déposé (catégorie « Marchés »,
  phase ACT). `POST /api/marches-entreprises/:id/signature` puis `.../signature/rouvrir` ; la date, le mode et le
  document sont validés par le serveur.

### Exports PDF et Excel : une seule charte

Tout document produit depuis l'interface porte la charte du cabinet : en-tête
(logo, coordonnées, titre à droite), tableaux en nuances de gris, pied de page
(adresse, SIRET...) et pagination « P1|2 » en bas à droite. La couleur n'est
admise que pour une donnée qui en a besoin (statut d'une réserve, retard).

- **Logo sur la première page seulement.** Le logo (et les coordonnées, le bandeau des cotraitants) ne
  s'imprime que sur la PREMIÈRE page. Les pages suivantes portent un en-tête d'UNE seule ligne : le nom de
  l'agence en texte à gauche, le nom du document à droite, jamais le logo. PDF : `drawAgencyHeader()` dessine
  seul cette ligne dès qu'il est appelé au-delà de la page 1 (`drawCompactHeader`), et `drawAgencyFooters()`
  l'ajoute aux pages restées sans en-tête ; ne jamais redessiner l'en-tête complet après un `addPage()`.
  Excel : `ajouterFeuille()` pose `differentFirst` (première page sans en-tête d'impression, les suivantes
  « agence | document »). Word : `docxSectionChrome()` (`src/lib/docxRunningHeader.ts`) pose `titlePage`
  et les deux en-têtes (complet en première page, ligne réduite ensuite) ; tout nouvel export Word passe
  par lui. Documents d'agent (`artifacts.ts`) : même règle en PDF, en Word et en Excel (ExcelJS, plus
  SheetJS qui n'écrit pas les en-têtes d'impression).
- **PDF** : `src/lib/pdfLetterhead.ts` (`drawAgencyHeader`, `drawAgencyFooters`,
  `tableauGris()` / `TABLEAU_GRIS` pour les tableaux autoTable, `fetchAgencySettings()`
  pour un générateur qui n'a pas les réglages sous la main). Ne plus écrire de
  bandeau coloré ni de « Page i/n » à la main.
- **Excel** : `src/lib/xlsxLetterhead.ts`, sur ExcelJS (chargé à la demande) :
  `ajouterFeuille()` pose l'en-tête, l'entête de tableau, le volet figé et la mise
  en page d'impression (A4 ajusté en largeur, titres répétés, pied avec `&P|&N`) ;
  `exporterListe()` couvre une simple liste. SheetJS (`xlsx`) ne reste utilisé que pour
  LIRE des imports : il ne sait ni styler ni placer une image. Un montant reste un
  nombre dans la cellule (format `FORMAT_EURO`), jamais un texte formaté.
- **Les entreprises consultées** (ACT) sont classées par LOT, en PDF comme en Excel
  (`groupByLot`, `src/lib/actExport.ts`), plus par corps d'état. Une entreprise sur
  plusieurs lots apparaît sous chacun, une entreprise sans lot sous « Sans lot assigné ».
  Le rapport d'analyse des offres et le comparatif sont dans `src/lib/actAnalysisExport.ts`.
- **BPU/DQE** (`bpuExport.ts`) : le classeur est aussi un format d'aller-retour que
  `bpuImport.ts` relit. L'en-tête du cabinet y est donc libre (l'import repère la
  ligne d'entête de colonnes, `detectHeader`, pas un numéro de ligne), mais les
  INTITULÉS de colonnes, la colonne A (références `#L1`, `#C1.2`, `A1`...), les lignes de
  lot/chapitre non fusionnées et la feuille masquée `_meta` ne changent pas.
  `src/lib/__tests__/bpuExcelRoundTrip.test.ts` exporte puis relit.
- **Répartition d'honoraires** (`feeDistribution.ts`) : reste une calculette, ses formules
  visent des lignes décalées par l'en-tête, d'où un compteur de lignes tenu à l'écriture.
- **Hors périmètre** : la facture d'abonnement ArchiOffice (`subscriptionInvoice.ts`),
  émise par la plateforme et non par le cabinet, et les exports Word (hors règle de l'en-tête réduit ci-dessus).

### Charte sobre : documents générés, pas l'interface

La préférence de l'architecte pour le noir, le blanc et les gris, la couleur étant
réservée aux données qui en ont besoin, vaut pour les **documents générés** (PDF,
Word, Excel, courriers, exports) et **pas pour le code de l'interface**. L'interface
reste bleue : ses couleurs passent par les jetons `--tblr-*` (`--tblr-primary`,
`--tblr-primary-lt`, `--tblr-surface`...), jamais par des `bg-blue-*` / `text-blue-*`
figés qui ignorent le thème sombre. Les couleurs de statut (vert, ambre, rouge) sont des
données et restent.

### Onglet DET : décisions d'interface

- **En-tête masqué sous 1024 px** (mobile et tablette) : titre, indicateurs et bouton
  disparaissent ; « Nouveau compte-rendu » est repris en tête de la liste des
  comptes-rendus (`lg:hidden`). Les sous-onglets (Comptes-rendus, Observations,
  Entreprises, OS & situations, Photos) passent par `PillTabs` (rôles ARIA, flèches).
- **« Diffuser » envoie un e-mail à chaque entreprise et chaque intervenant** : le PDF du
  compte-rendu en pièce jointe, et dans le corps de CHAQUE message les seules observations
  qui concernent le destinataire. Voir « Diffusion d'un compte-rendu par e-mail » plus bas.
- **La reprise en bloc des observations « à lever » en réserves AOR vit dans l'onglet
  AOR** (`ReprendreObservationsBanner`, au-dessus du suivi des réserves). La reprise
  d'UNE observation reste sur sa ligne du tableau des observations. Règle commune dans
  `src/lib/observationsReserves.ts` (testée).
- **Colonnes masquées du tableau des observations mémorisées par poste**
  (`obsTable:<filtre>:visibility`, localStorage), comme les largeurs de colonnes.
- Les contrôles sans libellé visible portent un `aria-label` (chevrons, météo,
  température) et les chevrons une cible de 44 px.

### Diffusion d'un compte-rendu par e-mail

`DiffusionDialog.tsx` (bouton « Diffuser », « Rediffuser » une fois diffusé) liste les
destinataires AVANT l'envoi : adresse, rôle, nombre d'observations qui leur sont adressées,
tous cochés par défaut, ceux sans adresse signalés et non cochables. Le PDF est généré dans le
navigateur (`exportSiteReportToPDF(..., { download: false })`, photos comprises) puis envoyé en
multipart à `POST /api/reports/:reportId/diffuse` (`server/routes/siteReportDiffusion.ts`,
`tests/siteReportDiffusion.test.ts`).

- **Qui reçoit quoi** : `src/lib/crDiffusion.ts` (pur, testé, partagé écran et serveur). Les
  destinataires sont les entreprises titulaires d'un lot et les intervenants de l'opération qui
  ont une fiche contact, chacun une fois (une entreprise sur trois lots = un message). Une
  observation va à l'entreprise de son lot (`lot_id`) ou à la personne désignée (`contact_id`).
  Un destinataire sans observation reçoit tout de même le compte-rendu, avec la mention explicite.
- **Le client n'envoie jamais d'adresse** : seulement des identifiants de contacts. Le serveur
  rejoue `buildDiffusionRecipients` depuis l'opération (lots, intervenants, observations du
  compte-rendu) et n'écrit qu'à l'adresse de la fiche ; un identifiant étranger est ignoré.
- **Un message par destinataire**, l'un après l'autre : personne ne voit l'adresse des autres.
  Le PDF doit commencer par `%PDF-` et peser au plus 20 Mo.
- **Transport : le SMTP du cabinet**, comme `POST /api/send-email` avec pièce jointe. Les
  comptes Gmail/Outlook connectés (`sendViaAccount`) n'ont pas encore de chemin d'envoi avec
  pièce jointe. Expéditeur et `Reply-To` : `resolveEmailSender()` (voir « Expéditeur d'un e-mail »).
- **Statut** : le compte-rendu ne passe à `diffuse` que si au moins un message est parti. Un
  échec partiel est rapporté nommément (`failed`) et « Rediffuser » permet de réessayer. Aucun
  suivi des destinataires n'est stocké (pas de migration) : la trace est le journal d'activité.
- Hors ligne ou saisie en attente de synchronisation : la diffusion est refusée, le message
  partirait sans elle.

### Pièces jointes d'un e-mail : jamais relayées brutes à nodemailer

`POST /api/send-email` relayait `attachments` tel que reçu, or nodemailer lit pour une pièce
jointe `path` (fichier du serveur), `href` (adresse, donc le réseau interne), `raw`,
`headers`... : toute personne connectée pouvait se faire envoyer `.env` ou une clé du serveur.
`sanitizeEmailAttachments()` (`server/emailAttachments.ts`, `tests/emailAttachments.test.ts`)
ne garde que `{ filename, content en base64, contentType }` : nom nettoyé (ni chemin ni
retour à la ligne), contenu décodé en `Buffer`, type de contenu vérifié, 20 pièces et 25 Mo
au plus. Tout le reste est retiré, et une pièce jointe sans contenu base64 est refusée en
400. Tout nouveau chemin qui envoie des pièces jointes venues d'un client doit passer par là,
ou par un fichier téléversé (`multer`), jamais par un objet nodemailer construit côté client.

### Expéditeur d'un e-mail : adresse de l'agence ou adresse personnelle par cabinet

Un même compte (contact@aazs.fr) exerce dans plusieurs agences et n'y écrit pas avec la même
adresse, ni avec celle de sa connexion : dans chaque agence, soit l'adresse générale de
l'agence (`settings.email`), soit son adresse personnelle DANS cette agence
(`tenant_memberships.sender_email`, `supabase/migrate_membership_sender_email.sql`, une ligne
par personne × cabinet). Réglée par la personne dans Réglages > « Mes paramètres de
messagerie » (champ visible quand « Envoyer depuis mon adresse personnelle » est choisi),
lue et écrite par `GET /api/me` / `PUT /api/team/:id` (`mailSenderEmail`, pour le cabinet ACTIF).

`server/emailSender.ts::resolveEmailSender()` décide pour `POST /api/send-email` et la
diffusion d'un compte-rendu : le choix de la personne (`profiles.sender_option`), à défaut
celui du cabinet (`settings.sender_option`). En « personnel » avec une adresse : `from` = cette
adresse, l'agence en copie, `Reply-To` sur elle. **Sans adresse enregistrée, ou sur une
instance non migrée, le message part de l'adresse de l'agence**, jamais sans expéditeur.

**L'adresse n'est JAMAIS lue dans la requête d'un client** : `userEmail`, que la route
acceptait comme expéditeur, est ignoré (n'importe qui de connecté aurait pu écrire au nom de
n'importe qui). Seule la personne règle sa propre adresse (un administrateur ne le fait pas à
sa place : 403) et une adresse invalide ou multiple est refusée (400). Tout nouvel envoi par le
SMTP du cabinet passe par `resolveEmailSender()`. Le SMTP du cabinet doit accepter d'envoyer
avec une adresse différente de son identifiant de connexion, ce qu'ArchiOffice ne peut pas
vérifier.

### Dossier de références pour les marchés publics

Bouton « Dossier de références » de `/references` (`src/components/ReferencesDossierDialog.tsx`) : l'architecte coche les opérations
(affaires ou références manuelles), les réordonne (flèches), choisit les images de chaque fiche (6 au plus, la première est la
principale, téléversement de plusieurs images possible), complète la fiche, retouche le texte du programme **pour cet export
seulement** et génère un PDF A4 **paysage ou portrait** : page de garde (logo, « Références », gérant, mosaïque, coordonnées),
tableau récapitulatif, une fiche par référence.

- **Rendu** : `server/referencesDossier/` ; `template.ts` (HTML/CSS pur, testé) -> `render.ts` (playwright-core, Chromium de l'hôte :
  `CHROMIUM_PATH`, sinon chemin Playwright, sinon `/usr/bin/chromium` ; `printBackground`, `preferCSSPageSize`, aucune requête réseau,
  un rendu à la fois). Le Dockerfile installe `chromium`. Source Sans 3 est embarquée en base64 (`@fontsource/source-sans-3`).
  Route `POST /api/references/dossier/pdf` (`referencesDossierLimiter`, 6 par minute, 60 références au plus).
- **Charte de la fiche** (À NE PAS CHANGER sans l'accord de l'architecte) : marges 11 x 12 mm, titre 13,5 pt gras majuscules
  « Nature — Ville (Dépt) », logo 11 mm, filet 1,2 pt, grille d'infos (Programme, Labels / distinctions, Maître d'ouvrage,
  Maître d'œuvre, Mission, Phase, Surface / Budget), accent unique `#b2242a`, pied « NOM · AAZS · 01 / 01 ». **Toute donnée absente
  s'imprime « NC »** (`nc()`), jamais une valeur inventée. Images : `classeNbImages` (n1 à n6), `.thumbs` seulement à partir de 4
  images ; portrait = une grande image puis les vignettes, paysage = deux grandes puis une rangée de vignettes.
- **Données** : `reference_sheets` (`supabase/migrate_reference_sheets.sql`, une ligne par affaire OU référence manuelle : nature, ville,
  département, labels, maître d'œuvre, mission, phase, texte du budget, images retenues). Sans fiche, les valeurs se déduisent :
  ville/département du code postal de l'adresse (`deriveCityDept`, rien sans code postal), mission du contrat MOE lié, cotraitants
  dans le maître d'œuvre, budget = `construction_cost` (jamais `budget`, ambigu), programme = `projects.programme` seulement (la
  `description` peut porter des honoraires : jamais reprise). Une instance sans la table lit des fiches vides (`42P01`) et refuse l'écriture en 503.
- **Aucune image d'un autre projet** : chaque image est relue en base et n'est acceptée que si elle appartient à la référence ET au
  cabinet (`loadCandidate`, `server/referencesDossier/data.ts`) ; sinon elle est ignorée et signalée (`X-Dossier-Warnings`).
  Les images viennent de la couverture, des documents de l'affaire (images ou catégorie « Références - images ») ou, pour une
  référence manuelle, de sa galerie et des documents `resource_type = 'custom_references'` (ajouté à `ATTACHABLE_RESOURCE_TYPES`).
  Elles sont réduites à 1800 px (JPEG) avant le rendu ; un fichier sur un drive externe n'est pas lu.
- Pagination « 01 / 12 » sur le document entier (couverture comptée, sans pied) : c'est le gabarit de la fiche, qui l'emporte sur « P1|2 ».
- Tests : `tests/referencesDossier.test.ts`. Pas encore de PPTX.

### Panneaux d'affichage : chantier et permis de construire

Deux PDF A0 générés par Chromium (même mécanique que le dossier de références : HTML pur testé, `playwright-core`, aucune requête réseau, une seule file de rendu partagée `renderHtmlToPdf`, `server/referencesDossier/render.ts`). Code dans `server/panneaux/`, routes `server/routes/panneaux.ts`, limiteur `panneauxLimiter` (6 par minute et par personne), migration `supabase/migrate_panneaux.sql`.

**Pas de pied de page, pas de pagination.** Un panneau d'affichage ne porte ni coordonnées de l'agence en bas ni « P1|1 » (dérogation voulue par l'architecte à la charte des documents). Le bas du panneau de chantier porte un **QR code** en bas à droite (`qr.ts`, SVG vectoriel, zone de silence de 4 modules) avec son texte explicatif : il renvoie à `/chantier/<jeton>` (`src/pages/ChantierPublic.tsx`), liste publique et sans compte des entreprises (lot, nom, adresse), servie par `GET /api/public/chantier/:token` (`depotReadLimiter`, exempté d'authentification par le préfixe `/api/public`). Le jeton (`publicLink.ts`) est un HMAC de l'identifiant de l'affaire (clé dérivée de `MAIL_ENCRYPTION_KEY`) : stable, donc le QR imprimé reste valable, sans stockage ni migration ; un jeton falsifié ou une affaire inconnue donnent le même 404. La liste publique est complète (elle ignore les lignes masquées du panneau) et ne porte ni logo ni donnée autre que nom et adresse. Réglage `qrCode` (vrai par défaut). Adresse encodée : `APP_URL`, à défaut l'hôte de la requête. **Sous-traitants** : saisis dans l'onglet RDT, sous le bloc de chaque marché (`SousTraitantsMarche.tsx`, `server/routes/marcheSousTraitants.ts`, table `marche_sous_traitants`, `supabase/migrate_marche_sous_traitants.sql`, nom, prestation, adresse, SIRET). Jamais imprimés sur le panneau ; repris par `loadChantierPanel` (`sousTraitants`) dans la liste publique du QR code, avec leur entreprise et leur lot. Un accord-cadre n'en porte pas (on les ajoute au subséquent). Instance non migrée : lecture vide, 503 à l'écriture. **Pas encore fait** : la base légale exacte (décret n° 2023-452 du 9 juin 2023, article du code du travail visé) n'a pas pu être relue sur Légifrance depuis le serveur et n'est donc pas citée sur le panneau.

**Formats et mise à l'échelle** (`pageSpec.ts`). Les gabarits sont dessinés une fois à la taille d'un A0 (841 mm en portrait, 1189 mm en paysage) puis mis à l'échelle par `zoom` : un A1 est un A0 réduit, pas une autre mise en page. Chantier : A0, A1, A2, A3, portrait ou paysage. Permis : A0, 80 x 120, 100 x 150 (réglementaires) et A3, A4 (aperçu). Chaque rendu mesure le débordement de `.body` et le remonte en avertissement (`X-Panneau-Warnings`), jamais un contenu rogné en silence.

**Panneau de chantier** (`GET/PUT /api/projects/:id/panneau-chantier`, `POST .../pdf`, `PanneauChantierDialog.tsx`, bouton « Panneau de chantier » du plan d'actions de la fiche affaire). Rien n'est ressaisi : maître d'ouvrage (fiche du client), AMO et intervenants (`project_stakeholders`), cotraitants, architecte (réglages du cabinet), lots (`project_lots`, ordre naturel) et entreprises relus à chaque génération. L'entreprise d'un lot vient du marché (`marches_entreprises`), rapproché du lot par intitulé (`associerMarches`, `server/planningSources.ts`, le numéro ne faisant que départager : sur une affaire réelle le marché 09 « Peinture » répond au lot 07), à défaut de la fiche du lot ; un marché subséquent ou résilié est ignoré. Un lot sans entreprise s'affiche « Entreprise à désigner ». Le nombre de colonnes de lots s'adapte (3 jusqu'à 27 lots, 4 jusqu'à 48 en portrait et 40 en paysage, 5 au-delà). Le client n'envoie que des réglages (format, orientation, lignes masquées, image, titre, logos), validés par liste blanche (`sanitizePanelSettings`), mémorisés par affaire dans `project_site_panels` (jsonb). Une instance sans la table lit des réglages vides et refuse l'écriture en 503.

**Logos** : celui de la fiche contact (`contacts.logo`, data URL saisie avec `ContactLogoField`), relu côté serveur par identifiant et jamais pris dans la requête. Validation sur les octets (`logos.ts`) : PNG, JPEG ou WebP, jamais SVG (scripts, références externes), 1,5 Mo au plus. Un logo invalide est ignoré et signalé, il ne fait jamais échouer le rendu. Niveaux de gris par défaut (charte du cabinet), couleur sur option ; masquables par ligne ou en bloc ; une entreprise sans logo ne réserve aucun espace. Avertissement sous 100 dpi à la taille imprimée. Un contact d'un autre cabinet n'est jamais lu (nom, adresse et logo compris).

**Panneau d'affichage du permis** (`GET /api/permits/:id/panneau`, `POST .../panneau/pdf`, `PanneauPermisDialog.tsx`, bouton sur chaque ligne de PC ou de DP). Mentions portées par la fiche du permis (colonnes `nature_projet`, `superficie_terrain_m2`, `surface_plancher_m2`, `nombre_logements`, `hauteur_m`, `mairie_nom`, `mairie_adresse`, `numero_decision`, écrites par `PUT /api/permits/:id` via `panneauExtras`, seulement si présentes dans le corps), préremplies depuis l'affaire sans rien inventer (nature = `projects.programme`, jamais `description` qui peut porter des honoraires). Une autorisation de travaux (AT) n'a pas de gabarit.
- **Textes réglementaires** (`mentionsLegales.ts`, verrouillés par `tests/panneauxPermis.test.ts`) : rédigés SANS accès à Légifrance. `MENTIONS_VERIFIEES_LE` reste `null` tant qu'ils n'ont pas été relus contre le texte officiel (art. R424-15, A424-15 à A424-19, R600-1, R600-2, arrêté du 30 mars 2017). À faire avant tout usage officiel. La fenêtre affiche en permanence « mentions à vérifier par l'architecte ».
- **Dimensions** : les DEUX côtés doivent faire au moins 80 cm (`isRegulatorySize`). Le texte parle de dimensions « supérieures à 80 cm » : le 80 x 120 du commerce est accepté, lecture à confirmer sur Légifrance. Un format plus petit (A1, A2, A3, A4) reçoit le filigrane « Aperçu non réglementaire ».
- **Brouillon et définitif** : l'affichage n'est obligatoire qu'à la délivrance, pas au dépôt. À la création d'un PC, le client génère un brouillon (champs à compléter en pointillés, bandeau « Brouillon, à compléter à la délivrance ») et le rattache au permis (documents `resource_type = 'permits'`, catégorie « Permis »), en meilleur effort. Au passage à `accorde`, un toast propose la version définitive. La version définitive est refusée en 400 (liste `missing`) tant qu'un champ obligatoire manque (bénéficiaire, architecte, numéro, date de délivrance, nature, superficie du terrain, mairie), et en 409 sur un permis refusé. Surface de plancher et hauteur absentes sont signalées sans bloquer (une hauteur absente ou erronée peut empêcher le délai de recours de courir).

**Pas encore fait** : traits de coupe et fond perdu, envoi du panneau d'aperçu par e-mail au maître d'ouvrage depuis la fenêtre, outil d'agent/MCP `generate_site_panel`, extension à la déclaration préalable de lotissement.

### Qualifications des entreprises et recherche d'entreprises

`contact_qualifications` (`supabase/migrate_contact_qualifications.sql`) : une ligne par qualification
détenue par une entreprise (Qualibat, Qualifelec, Qualit'EnR, Certibat, RGE, autre), clé d'unicité
(contact, organisme, référence), `source` (`saisie`, `ademe`, `api_entreprise`) et `verified_at`/
`verified_by` pour le contrôle du certificat. Hors `SYNC_TABLES` : rien à propager vers un poste local.
La logique pure (statuts, résumé, SIRET, validation) est dans `src/lib/qualifications.ts`, partagée par
le serveur et l'écran.

**Qualibat n'est PAS interrogé.** Son API (API Entreprise, `certifications_batiment`) est réservée aux
administrations (habilitation DataPass que le cabinet n'a pas), se consulte par SIRET et n'offre aucune
recherche ; l'annuaire de Qualibat n'a pas d'API ouverte et ne doit pas être aspiré. D'où trois sources,
aucune ne valant verdict :

- **Saisie** par l'architecte sur la fiche contact (`ContactQualifications.tsx`), avec « Vérifier sur
  Qualibat » (copie le SIRET, ouvre `QUALIBAT_ANNUAIRE_URL`) puis le bouclier « contrôlée ». **Modifier
  organisme, référence ou dates retire le contrôle** : l'attestation portait sur ce qui était affiché.
- **Import RGE** (`server/rgeLookup.ts`, `POST /api/contacts/:id/qualifications/rge-sync`) depuis les
  données ouvertes de l'ADEME. Il ne couvre QUE les qualifications RGE : une réponse vide veut dire « pas
  de qualification RGE connue », jamais « non qualifiée » (l'écran le dit). Rejouable, jamais d'écrasement
  d'une ligne saisie à la main (seules les lignes `source = 'ademe'` sont mises à jour), cache de 6 h,
  nom du jeu de données surchargeable par `ADEME_RGE_DATASET` (non vérifié contre le service réel).
- **API Entreprise** : prévue dans le modèle (`source = 'api_entreprise'`), non branchée. TODO dans
  ROADMAP.md : demander à Qualibat un accès.

**Statut** (`statutQualification`) : valide, expire bientôt (60 jours), expirée, sans échéance. L'entreprise
est jugée sur sa MEILLEURE qualification (`resumeQualifications`) : une seule en cours de validité suffit
pour attribuer un lot. Pastille dans le tableau ACT (`QualificationBadge`, une lecture groupée
`GET /api/qualifications` par `useQualifications`, jamais une requête par ligne) et règle d'alerte
`qualification_expiree` (`agentAlerts.ts`, délai réglable, 30 jours par défaut) limitée aux entreprises
consultées sur une affaire en cours (`act_data.consultation.entreprises[].contact_id`).

**Recherche d'entreprises** (`GET /api/entreprises/search`, `server/routes/entreprisesSearch.ts`,
`EntrepriseSearchDialog.tsx`, bouton « Rechercher » du tableau ACT) : API publique « Recherche
d'entreprises » (SIRENE) interrogée par le serveur, paramètres validés avant d'être transmis, 30 requêtes
par minute et par personne. Chaque résultat est enrichi, chaque enrichissement étant facultatif (un échec
laisse la liste intacte) : qualifications RGE, libellé NAF (`ref_naf`), fiche contact existante du cabinet
(SIRET normalisé). Ajouter une entreprise crée la fiche (catégorie Entreprise, SIRET, TVA déduite du
SIREN, adresse) puis rejoue l'import RGE ; la consultation n'est modifiée que par « Ajouter à la
consultation », avec un lot facultatif.

### Tableaux de bord : un bloc opérationnel, deux périmètres

`src/components/dashboard/OperationalKpis.tsx` (calcul pur dans
`src/lib/dashboardOps.ts`, testé) porte les KPI de suivi : permis actifs,
échéances à 30 jours, tâches en cours, réunions de la semaine, RFI en attente,
réserves OPR et GPA. Chaque carte signale ses retards (« Aucun retard » sinon).
Seul le **périmètre** diffère :

- **Administrateur** (`Dashboard.tsx`) : `scopeProjectIds={null}`, toute
  l'agence. Les cartes « Affaires en cours » et « Échéances » existent déjà dans
  sa grille, donc `omit={['projects', 'deadlines']}`. Il est aussi le seul à
  voir le commercial (devis en attente, appels d'offres).
- **Manager** (`ManagerDashboard.tsx`) : les affaires de son équipe uniquement.
  Sa finance tient en trois cartes (encaissé, reste à encaisser, factures en
  retard) calculées avec les mêmes helpers que l'administrateur
  (`dashboardMetrics.ts`) ; le budget estimé n'a plus de carte, il figure déjà
  sur le graphique honoraires consommés vs prévus.

Une date absente ou illisible n'est jamais comptée comme un retard.

**Panneau d'accueil commun** (`RoleHero.tsx`, contenu pur dans
`src/lib/dashboardHero.ts`, testé) : la même carte « Bonjour {prénom} » pour
tous, mais un message par profil. L'administrateur lit l'encaissé du mois et
les factures en retard de l'agence ; le manager les mêmes chiffres pour son
équipe ; un collaborateur (`pm`, `user`) ce qui l'attend sur SES affaires
(points en retard, affaires en cours, réunions de la semaine) et **jamais de
chiffre de facturation**. Pour le manager et le collaborateur, le panneau
attend les chiffres du suivi (`OperationalKpis` `onKpis`) : afficher « rien en
retard » avant leur lecture serait faux. `ResponsibleDashboard` (collaborateur)
utilise désormais le même `OperationalKpis`, limité à ses affaires.

### Chef de projet (`pm`) : voit les montants de ses affaires, ne facture pas

Le chef de projet voit les factures et les notes d'honoraires **des affaires
dont il est membre** (`project_members`) et rien d'autre ; il prépare des notes
d'honoraires mais **ne crée, ne modifie ni ne supprime aucune facture** ni ne
génère la facture d'une note. L'administrateur et le manager facturent.
`server/invoiceAccess.ts` porte la règle : `visibleProjectIds()` (lecture,
`GET /api/invoices`, `GET /api/invoices/:id`, notes d'honoraires) et
`ensureCanWriteInvoices()` (403 `INVOICE_WRITE_FORBIDDEN` sur `POST`/`PUT`/
`DELETE /api/invoices`, `sync-retry`, `POST /api/notes_honoraires/:id/facture`).
Le rôle `user` n'est **pas** restreint (c'est le rôle par défaut d'un membre : le restreindre casserait les cabinets existants). **Un rôle inconnu ou absent
n'est jamais restreint** (instance non migrée, mode local) : on ne ferme un
accès qu'à un rôle explicitement limité. Un rôle limité sans affaire voit une
liste vide, jamais « tout ». `src/lib/invoicePermissions.ts` masque côté écran
les boutons correspondants ; le serveur reste la barrière.

Son tableau de bord (`ResponsibleDashboard`) porte une trésorerie « mes
affaires » (`TreasuryKpis`, `computeTreasury`) et son panneau d'accueil parle
des montants de ses affaires, avec un bouton vers ses affaires et non vers le
traitement des retards. Les autres intégrations qui écrivent des factures
(SuperPDP, Chorus Pro, Zoho) n'ont pas encore ce garde-fou.

### Journal des appels téléphoniques

`/appels` (`src/pages/PhoneCalls.tsx`) : l'appel reçu ou passé au cabinet se saisit en quelques
secondes (interlocuteur, objet, notes), s'attribue à un collaborateur qui reçoit une notification, et
peut devenir une tâche. Table `phone_calls` (`supabase/migrate_phone_calls.sql`, hors `SYNC_TABLES`),
routes `server/routes/phoneCalls.ts` (`GET/POST /api/phone-calls`, `PUT/DELETE /api/phone-calls/:id`,
`POST /api/phone-calls/:id/task`, `tests/phoneCalls.test.ts`), vocabulaire dans
`src/schemas/phoneCall.schema.ts` (sens `entrant`/`sortant`, statuts `a_traiter`/`en_cours`/`traite`,
priorités des tâches).

- **Tous les rôles voient tous les appels du cabinet.** « Mes appels » (défaut) est un filtre de
  confort, pas une barrière. `project_id`, `contact_id` et `assignee_id` du corps sont vérifiés contre le
  cabinet (`assertTenantEntity`, `findMembership`), le PUT passe par une liste blanche de colonnes.
- **Notification** (`notifyUsers`, catégorie « Tâches », lien `/appels?open=<id>`) à l'attribution et à
  chaque CHANGEMENT d'assigné, jamais à une modification de statut ou de note, ni quand on s'attribue
  l'appel à soi-même.
- **« Créer une tâche »** (`POST /:id/task`) : tâche du même assigné, de la même priorité, rattachée
  à la même affaire, échéance = rappel souhaité ; l'appel garde le lien (`task_id`) et passe de
  « à traiter » à « en cours ». Rejouable : un appel qui a déjà sa tâche rend celle-ci
  (`already_exists`), jamais une seconde. **Possible hors ligne** : l'appareil génère l'identifiant de
  la tâche (`task_id` du corps, `^[A-Za-z0-9_-]{8,64}$`) et met la demande en file (id de file
  `task:<appel>`) ; l'appel affiche tout de suite sa tâche « en attente d'envoi »
  (`overlayPendingPhoneCalls`). Au rejeu, le serveur reprend une tâche de ce `task_id` déjà insérée
  (coupure avant le lien posé sur l'appel) au lieu d'en créer une autre. Les dates de la tâche sont
  celles du jour du rejeu.
- **Hors ligne** : lecture « cache d'abord » (`phoneCallsCache`, Dexie v10) et écritures par la file
  (`entity: 'phoneCall'`). L'id de l'appel est généré par l'appareil et `POST` est idempotent (200 au
  rejeu). Chaque modification a son propre id de file (deux changements successifs ne s'écrasent pas) ;
  `overlayPendingPhoneCalls` (`src/lib/phoneCalls.ts`, testé) rejoue la file par-dessus la liste lue,
  sans quoi une relecture ferait disparaître un appel saisi avant son envoi.
- **Instance non migrée** : la lecture rend une liste vide, l'écriture un 503 explicite.
- **Lancer l'appel depuis l'écran** : une icône verte (lien `tel:`, 44 px) ouvre le composeur du
  téléphone, dans la liste des appels et à côté du champ téléphone de la fiche, **sous 768 px
  seulement** (`md:hidden` : un lien `tel:` n'ouvre rien d'utile sur un poste de bureau).
  `telHref()` (`src/lib/phoneCalls.ts`, testé) ne garde que les chiffres et un « + » initial, lit
  « 00 » comme « + », retire le « (0) » de « +33 (0)6... » et rend `null` en dessous de 3 chiffres
  (pas d'icône pour « à rappeler »). Composer ne crée ni ne modifie rien : l'appel sortant se note
  par « Nouvel appel » (sens « sortant »).
- **Où le retrouver** : menu Outils, volet « Plan d'actions » de la fiche affaire (bouton « Appel »,
  `/appels?new=1&project=<id>`), liste `LinkedPhoneCalls` de l'onglet Correspondance, carte « Appels à
  traiter » de `OperationalKpis` (les appels de la personne connectée, quel que soit le périmètre du
  tableau de bord).
- **Exports** (`src/lib/phoneCallsExport.ts`) : la liste telle qu'affichée, PDF paysage et Excel à la
  charte (seul un rappel en retard est en rouge). Un rappel en retard = échéance strictement passée sur
  un appel non traité ; une date absente ou illisible n'en est jamais un.
- **Agents et MCP** : ressource `phone_calls` dans `AGENT_RESOURCES` (par défaut pour l'agent
  « secrétaire »), `called_at` posé par le serveur quand l'agent ne le fournit pas.

### Groupement vs agence dans les notes d'honoraires

Une note d'honoraires (`src/pages/ProjectDetail.tsx`, section « Notes
d'honoraires » de la fiche projet) porte la ventilation par mission de TOUT
le groupement de maîtrise d'œuvre — agence, cotraitants, sous-traitants —
alors que la facture brouillon qu'elle génère (`POST /api/notes_honoraires/
:id/facture`) ne porte, elle, que la part de l'agence : les montants
cotraitants/sous-traitants restent hors comptabilité agence par
construction (voir le commentaire du schéma sur `cotraitants_facturation`/
`sous_traitants_facturation`). Le tableau de ventilation portait pourtant
une colonne « Agence » générique et aucun total d'ensemble, laissant croire
que la note se limitait à cette seule colonne.

Deux corrections dans le même tableau :

1. **Colonne « Groupement »**, avant la colonne agence : le total, par
   mission, de l'agence + tous les cotraitants + tous les sous-traitants —
   ce que la note facture réellement à l'ensemble de l'équipe. La colonne
   agence garde son propre total (celui qui alimente la facture brouillon)
   juste à côté, pour que les deux échelles restent visibles l'une contre
   l'autre plutôt que noyées dans le même total.
2. **« Agence » remplacé par le nom réel du cabinet**
   (`settings.agencyName`, déjà chargé par `useSettings()`) : la colonne
   nommée génériquement pouvait laisser croire à une entité distincte du
   cabinet plutôt qu'au cabinet lui-même.

**Noms de cotraitants/sous-traitants désormais dynamiques.** Chaque entrée
de `cotraitants_facturation`/`sous_traitants_facturation` fige un `nom` au
moment où la note est créée (`ct.contact_name || ct.specialty`, voir
`initNoteForm`) — un renommage ultérieur dans le contrat
(`ContactAutocomplete`, `Contrats.tsx`) ne se répercutait donc jamais dans
l'en-tête du tableau, y compris pour une note encore en cours d'édition ou
tout juste rouverte. Les en-têtes (`ctDisplayName`/`stDisplayName` dans
`ProjectDetail.tsx`, `liveName` dans `src/lib/noteHonorairesExport.ts` pour
l'export PDF) relisent désormais le nom courant du contrat par
`contact_id`, et ne retombent sur le `nom` figé que si l'intervenant a
depuis été retiré du contrat (pas de ligne à relire). Le calcul des
montants (bases, plafonds) continue, lui, de faire cette même résolution
par `contact_id` — seul l'affichage du nom manquait ce fil.

### Le contrat MOE fait foi pour les montants du projet

Trois changements qui tiennent au même principe : le contrat est la pièce, la
fiche projet n'en est qu'une lecture.

1. **Répartition par mission dans le contrat.** L'onglet Missions de la modale
   de contrat (`src/pages/Contrats.tsx`) n'est plus une liste de cases à cocher
   sur dix missions figées mais une répartition sur le modèle de celle des
   propositions (`FeeDistributionGrid`, `Proposals.tsx`) : missions renommables,
   supprimables (les missions de base comprises — le découpage MOP ne convient
   pas à un diagnostic ou à une AMO) et créables, groupées par catégorie avec
   un sous-total, et le montant HT déduit de la part appliquée au total des
   honoraires du contrat. `ContratMOEMission.category`
   (`'base' | 'exe' | 'complementaire'`, facultative, une mission sans
   catégorie étant rattachée aux missions de base) porte ce classement dans le
   jsonb `contrats_moe.missions_list` : **aucune migration SQL**, la colonne
   étant déjà du jsonb et `server/routes/contratsMoe.ts` persistant le corps de
   requête sans liste blanche de colonnes. Les deux préréglages visent
   désormais des CATÉGORIES et non plus une liste d'ids figée, qui ne décrivait
   plus le contenu réel d'un contrat dont les missions sont libres.
   `server/routes/proposals.ts` traduit au passage les catégories de la
   proposition acceptée (libellés d'affichage) vers ce vocabulaire fermé.
2. **Les chiffres de l'onglet HONOS ne se saisissent plus** dès qu'un contrat
   est lié à l'affaire (`src/pages/ProjectDetail.tsx`) : honoraires initiaux et
   coût travaux prévisionnel passent en lecture seule, avec un renvoi vers le
   contrat pour les corriger, et la synchronisation depuis le contrat devient
   **inconditionnelle** — elle ne se limitait jusqu'ici qu'aux champs restés
   vides côté projet, ce qui laissait une valeur saisie à la main diverger
   indéfiniment de la pièce contractuelle. Les avenants continuent de
   s'ajouter par-dessus (`honRevises`) sans toucher au montant initial, et
   les deux champs redeviennent saisissables si aucun contrat n'est lié.
3. **Taux d'honoraires à 10 décimales.** `step={0.1}` faisait refuser par la
   validation du navigateur un taux issu d'une fraction (9,166667 % pour 55/6) :
   `step="any"`, et `fmtPct()` affiche jusqu'à dix décimales sans jamais en
   forcer (un taux rond reste écrit « 12 % »).

**TVA par membre du groupement.** Tous les cotraitants ne sont pas assujettis
(micro-entreprise, franchise en base) : `ContratMembreTVA`
(`tva_applicable?`, `tva_rate?`), dont héritent `ContratCotraitant` et
`ContratSousTraitant`, porte donc le régime de chacun plutôt qu'un taux unique
au contrat. Absent vaut « assujetti au taux de droit commun » (20 %), le cas
courant, donc aucun contrat déjà enregistré ne change de comportement. Un
membre dé-assujetti garde son taux en base plutôt que de le perdre si
l'assujettissement est rétabli — c'est `tvaRateOf()` qui le neutralise à
l'affichage et dans le calcul du TTC.

**Cliquer un contrat ouvre l'affaire liée** (liste de `/contrats`), avec
`stopPropagation` sur la rangée d'actions de la carte : elles ne doivent pas
naviguer. Une carte sans `project_id` reste inerte (ni curseur, ni handler)
plutôt que de mener à une route `/projects/undefined`.

**Colonne « Groupement » en deux parties** dans la ventilation d'une note
d'honoraires : le pourcentage de la mission facturé par l'ensemble de l'équipe
dans cette note, puis son montant. L'agence et les cotraitants passent sous une
entête commune « Mandataire et cotraitants » (« Mandataire » seul s'il n'y a
pas de cotraitant) : ce sont les titulaires du marché de maîtrise d'œuvre, par
opposition aux sous-traitants regroupés à leur droite. L'export PDF
(`src/lib/noteHonorairesExport.ts`) rend le même pourcentage dans sa cellule
Groupement, au format « % · € » déjà utilisé par les colonnes d'intervenants,
plutôt qu'en ajoutant une colonne à un tableau déjà large.

### L'avancement se saisit une fois, au niveau du groupement

Le tableau de ventilation d'une note faisait saisir un avancement PAR
intervenant, et en déduisait le total du groupement par addition. C'était le
bon calcul pour personne : une mission s'avance pour toute l'équipe (« sur
cette note je facture 100 % de l'esquisse et 50 % de l'APS »), et ce qui
distingue les membres n'est pas leur avancement mais leur QUOTE-PART de ce
montant (l'agence 60 % de l'esquisse, un cotraitant 40 %).

Trois valeurs seulement sont désormais saisies, tout le reste en découle :

| Saisi | Où | Champ |
|---|---|---|
| Avancement de la mission pour tout le groupement | colonne Groupement | `NoteHonorairePhase.avancement_pct` sur `note.phases` |
| Quote-part d'un membre dans ce montant | colonne du membre | `NoteHonorairePhase.part_pct` (nouveau) |
| Montant réglé à un sous-traitant | colonne du sous-traitant | `montant_phase` |

`recalcNote()` (`src/pages/ProjectDetail.tsx`) recalcule TOUTE la note à chaque
frappe plutôt que la cellule touchée : changer l'avancement du groupement
déplace les montants de tous les membres de la ligne, et un montant de
sous-traitant déplace ceux de tous les membres aussi — un recalcul local serait
faux dans les deux cas.

**La sous-traitance sort de l'enveloppe de la mission, jamais en supplément**,
et c'est ce qui décide de tout le reste du calcul :

```
montant groupement (mission)  = base contractuelle × avancement_pct / 100   ← invariant
reste à partager              = montant groupement − TOUS les sous-traitants de la mission
part nette d'un membre        = reste à partager × part_pct / 100
montant facturé par un membre = sa part nette + ce qu'il reverse à SES sous-traitants
```

Trois conséquences, toutes voulues :

- **Le montant du groupement ne bouge pas** quand on saisit des sous-traitants :
  seul change qui l'encaisse. Le total du pied de tableau est donc la somme des
  montants de mission (base × avancement), **pas** la somme des colonnes — les
  additionner compterait deux fois ce qu'un payeur reverse.
- **Le membre qui règle un sous-traitant voit son montant AUGMENTER** de ce
  qu'il reverse (affiché « dont … ST »), et celui des autres baisser d'autant :
  c'est la seule façon que chacun touche réellement son pourcentage une fois la
  sous-traitance payée. Le contraire — déduire le sous-traitant de la part de
  son payeur — le faisait payer seul une prestation commune.
- **La somme des colonnes des MEMBRES vaut 100 % du montant de la mission**, les
  colonnes sous-traitants n'en étant que le détail. Seul un sous-traitant réglé
  en direct par le maître d'ouvrage (`payeur = 'moa'`) ne revient à aucun membre :
  il sort de l'enveloppe sans être refacturé par personne, et la somme des
  membres vaut alors le montant du groupement moins sa part.

Un sous-traitant est donc plafonné deux fois : par son montant global au contrat
(`cumulStTotal` + ses autres missions) et par l'enveloppe de la mission qu'il
ne peut pas dépasser.

**Tout cela repose sur l'identification du payeur, donc `payeurEffectif()` le
relit sur le CONTRAT** (par `contact_id`), exactement comme les noms
d'intervenants plus haut, et non depuis la valeur figée dans la note à sa
création : désigner ou changer le payeur dans le contrat doit se répercuter
immédiatement, y compris sur une note déjà ouverte. Il rend une clé canonique
(`'agence'`, `'moa'`, ou l'`id` du cotraitant payeur) et accepte aussi bien
l'`id` de contrat que le `contact_id` d'un cotraitant, qu'une note ancienne ou
un import peuvent porter. Un payeur désigné mais introuvable revient à l'agence
(le mandataire) : sans ce repli, le montant du sous-traitant sortait de
l'enveloppe de la mission **sans revenir à personne**, et les montants de TOUS
les membres baissaient — le symptôme exact qui a motivé ce correctif.
`recalcNote()` réécrit `payeur` avec cette valeur résolue, pour que la note
enregistrée, l'export PDF et la facture brouillon lisent la même imputation que
l'écran.

Le pourcentage réellement facturé par chaque membre (montant ÷ montant
groupement) s'affiche sous son montant dès qu'une ligne porte de la
sous-traitance : la quote-part saisie porte sur ce qui reste après
sous-traitance, donc le payeur facture un pourcentage plus élevé que sa part
contractuelle et les autres un plus faible — sans cette mention, la ligne
semblerait contredire le 50/50 du contrat sans dire pourquoi.

Deux conséquences à ne pas défaire :

1. **`groupementPhaseBase()` n'additionne plus les parts des cotraitants.**
   C'est `honRevises × pct de mission / 100` — les honoraires révisés étant le
   montant du contrat pour toute l'équipe (cf. section précédente), la part
   d'un cotraitant en est une FRACTION et l'y ajouter comptait deux fois le
   même argent. Les plafonds par intervenant (`agenceCap`/`ctCap`) disparaissent
   avec ce changement : une part est bornée par le montant groupement lui-même.
   Le plafond qui reste est en pourcentage (`cumulGroupementPct`, 100 % d'une
   mission toutes notes confondues) plus celui du montant global d'un
   sous-traitant (`stCap`).
2. **Une note enregistrée avant ce changement est migrée à l'ouverture**
   (`noteFormFromSaved`), jamais recalculée telle quelle : sans `part_pct`, un
   recalcul direct ramènerait tous ses montants à zéro. Les montants des membres
   sont repris tels quels et les valeurs saisissables déduites à l'envers — le
   reste à partager est la somme des membres moins ce qu'ils reversent, la
   quote-part d'un membre son montant facturé moins ce qu'il reverse, rapporté à
   ce reste, et l'avancement du groupement ce reste plus TOUS les sous-traitants
   (ceux réglés en direct par le maître d'ouvrage compris), rapporté à la base
   contractuelle. La note rouvre ainsi sur exactement les mêmes montants.
   Aucune migration SQL : `phases` est du jsonb.

Les parts d'une mission doivent totaliser 100 % ; l'écart est signalé sous le
montant groupement (« répartition : 80 % ») plutôt que redistribué d'office, et
un bouton « Répartir » remet la ligne sur la répartition du contrat
(`fee_pct` par cotraitant, le solde à l'agence) — qui sert aussi de valeur par
défaut à la création d'une note.

### Tableau de ventilation responsive et export PDF corrigé

Deux défauts distincts repérés sur le même tableau (« Ventilation par
mission » d'une note d'honoraires) : l'un dans l'écran, l'autre dans son
export PDF.

**Écran (`src/pages/ProjectDetail.tsx`).** Le tableau a désormais deux
colonnes par membre (% et €) au lieu d'une, et dépasse vite la largeur de
l'écran dès qu'il y a un cotraitant et plusieurs sous-traitants. `w-full` sur
la balise `<table>` devient `min-w-full` : le tableau garde sa largeur
naturelle sans jamais la plafonner à celle de son conteneur, pour que le
débordement se traduise par le défilement horizontal de
`overflow-x-auto` plutôt que par des colonnes tassées. Le bouton
« Répartir » de la colonne Mission (sticky, donc de largeur fixe pendant le
défilement) devient une icône (`IconRefresh`) plutôt qu'un libellé texte :
chaque caractère de moins sur cette colonne laisse une part de plus aux
colonnes financières sur un écran étroit.

**Export PDF (`src/lib/noteHonorairesExport.ts`).** Deux bugs, une seule
cause commune :

1. **Chevauchement du libellé et de la valeur** sur la page de garde (ex. :
   « Coût prévisionnel des travaux HT : » par-dessus « 190 262,00 € ») — la
   colonne des valeurs démarrait à un x fixe (60 mm) sans rapport avec la
   largeur réelle du libellé le plus long (~52 mm à 9 pt gras, pour 46 mm
   disponibles). La position de cette colonne est désormais dérivée du
   libellé le plus large RÉELLEMENT affiché parmi les champs de la note
   (`champs.filter(([, v]) => v)`) — un projet sans coût prévisionnel
   n'affiche pas cette ligne et ne réserve donc pas sa place.
2. **Un « / » à la place de l'espace des milliers**, partout où un montant
   est affiché (page de garde et annexe), qui donnait par endroits
   l'impression d'un texte tronqué (« 100% · 4/896 » au lieu de
   « 100 % · 4 896,44 € »). Cause : `Intl.NumberFormat('fr-FR', …)` sépare
   les milliers par une espace fine insécable (U+202F) que les polices
   standard de jsPDF (Helvetica/WinAnsi) ne savent pas placer — vérifié sur
   le flux PDF généré, l'opérateur `Tj` porte littéralement le caractère
   "/" à la place de cette espace. `fmt()` la remplace (ainsi que l'espace
   insécable classique, U+00A0, par précaution) par une espace normale,
   un caractère WinAnsi ordinaire correctement mesuré et rendu.

### Pré-tri IA de la veille : propositions avec identifiant AO-IA

Onglet « Propositions IA » de `/appels-offres` (`TenderRssAiProposals.tsx`), à côté de la veille RSS, qui reste
la seule source des annonces (flux RSS, BOAMP, TED : `tender_rss_matches`). L'IA les **note et les propose**, elle ne
change jamais leur statut : écarter, surveiller (puis convertir en appel d'offres) restent des gestes de l'architecte,
avec annulation. Migration `supabase/migrate_tender_rss_ai_triage.sql` (colonnes `ai_*` sur `tender_rss_matches`,
`settings.tender_ai_criteria`) ; une instance non migrée répond 503 au scan et lit des critères vides.

- **Réservé au plan Enterprise**, réserve → exécute → règle comme `tenderAi.ts` (`endpoint_type = 'tender_ai'`), **un
  appel par lot de 12 annonces**, 48 au plus par passage (`more` dit qu'il en reste). Crédit épuisé : le passage s'arrête
  proprement, ce qui est déjà noté reste noté. Route : `POST /api/tender-rss-matches/ai-scan`
  (`server/routes/tenderRssAi.ts`, logique pure dans `server/tenderAiTriage.ts`, `tests/tenderRssAi.test.ts`).
- **Pré-tri sans modèle** : une annonce dont la date limite est dépassée est écartée (note 0) sans appel au modèle ;
  une date absente ou illisible n'écarte jamais.
- **Note 0-100, verdict déduit** (`verdictForScore`) : 70 et plus « pertinent », 40 à 69 « à étudier », en dessous
  « hors cible ». Le modèle rend note, motif et points d'attention, jamais le verdict. Les critères du cabinet (texte
  libre, `settings.tender_ai_criteria`, 2000 caractères, bouton « Mes critères ») sont dans le prompt ; le contenu des
  annonces y est cité comme donnée non fiable.
- **Identifiant `AO-IA-AAAA-NNN`**, attribué seulement à partir de « à étudier », par le serveur (jamais par le
  modèle), à la suite du plus grand numéro de l'année ; unique par cabinet (index partiel, nouvel essai au conflit),
  **stable** : « Tout renoter » (`rescore: true`) change notes et verdicts mais garde les identifiants déjà donnés.
- **Pas encore fait** : scan automatique à chaque relève du poller (coût en jetons non borné par une action humaine),
  notification des annonces « pertinentes ».

### Rédaction assistée de la note méthodologique d'un appel d'offres

Onglet Note méthodologique de `/appels-offres/:id` (`src/pages/TenderDetail.tsx`,
`server/routes/tenderAi.ts`, `server/routes/tenderMethodology.ts`) — réservée
au plan Enterprise comme le reste de l'assistance IA sur les appels d'offres
(`requireEnterprisePlan`). Deux gestes, tous deux sur le patron réserve →
exécute → règle déjà en place pour le chat des agents :

1. **« Préremplir les titres »** (`POST .../methodology/prefill-sections`)
   pose le plan de sections avant toute rédaction. Sans DCE attaché à
   l'appel d'offres, pas d'appel IA : `DEFAULT_METHODOLOGY_TITLES` (une
   structure usuelle de mémoire technique MOE) suffit et ne coûte rien. Un
   DCE attaché fait préférer le sommaire réellement exigé par le règlement
   de consultation quand il en impose un. Les titres déjà présents (comparés
   sans tenir compte de la casse) ne sont jamais dupliqués.
2. **« Rédiger avec IA »** (`POST .../methodology/:noteId/draft-ai`) rédige
   le contenu d'une section en combinant TOUJOURS ce qui est disponible,
   plutôt que de faire choisir entre des sources exclusives (un bouton par
   source avait été essayé, puis abandonné — une note gagne à croiser les
   deux, jamais à choisir) :
   - les spécialités mobilisées ET le nom du cotraitant nommément saisi en
     face de chacune (onglet Partenaires, `tender_specialties.contact_id` →
     `contacts.name`) — sans ce nom, la note ne pouvait citer que des
     intitulés de métier génériques ;
   - le texte des documents DCE de l'affaire (`documents` avec
     `resource_type='tenders'`) — même lecture qu'« Analyser le DCE » ;
   - la bibliothèque documentaire du cabinet (présentation, exemples de
     notes déjà rédigées, présentation des cotraitants habituels...) :
     `documents` avec `resource_type='agency_library'`, une seule ligne
     logique par cabinet — `resource_id` est le `tenant_id` lui-même, pas
     l'id d'une fiche, donc `POST /api/documents` le vérifie par égalité
     directe plutôt que par `assertTenantEntity` (aucune table
     `agency_library` à interroger). Gérée depuis `/settings` (onglet
     Cabinet, `AgencyMethodologyLibraryCard.tsx`) avec le même composant
     `ResourceAttachments` que les autres pièces jointes rattachées
     génériquement.

   Chacune des deux sources documentaires est best-effort et indépendante de
   l'autre : l'absence de l'une n'empêche jamais d'utiliser l'autre, et la
   rédaction reste possible avec le seul contexte de l'affaire si aucune des
   deux n'est disponible. `extractCombinedText()` (`tenderAi.ts`) factorise
   la lecture partagée par ce geste et par « Analyser le DCE »/« Chercher
   dans le DCE ».

### Étude de faisabilité d'une proposition

Volet repliable « Étude de faisabilité » du détail d'une proposition
(`Proposals.tsx`, composant `src/components/proposal/FeasibilityStudy.tsx`),
sur le modèle de la note méthodologique ci-dessus : des rubriques ordonnées
(`proposal_feasibility_sections`, `supabase/migrate_proposal_feasibility.sql`),
une seule étude par proposition (l'étude EST l'ensemble de ses rubriques, sans
table parente). Chaque rubrique porte `content`, `instructions` (consigne libre
pour l'IA, jamais imprimée) et `illustrations` (jsonb, extraits de cartes).

**Seule la rédaction IA est réservée au plan Enterprise.** Rubriques, blocs
d'informations, extraits de cartes, exports et « Préremplir les rubriques »
sans IA restent ouverts à tous (`server/routes/proposalFeasibility.ts`).
`server/routes/proposalFeasibilityAi.ts` porte les deux gestes IA, en réserve
→ exécute → règle (`endpoint_type = 'proposal_ai'`) :

- **Préremplir** pose `DEFAULT_FEASIBILITY_TITLES` sans appel au modèle ; avec
  une pièce jointe à la proposition ET le plan Enterprise, l'IA adapte ce plan
  à l'opération. Jamais de doublon de titre (comparaison sans casse).
- **Rédiger avec IA** combine toujours tout ce qui est disponible : champs de la
  proposition, données publiques du terrain, texte des pièces jointes (les
  images, donc les extraits de cartes, sont ignorées), bibliothèque du cabinet
  (`agency_library`), texte déjà saisi et consigne. Le prompt interdit
  d'inventer une règle d'urbanisme ou un chiffre absent des données : une
  information manquante est écrite « à vérifier ».

**Données du terrain** (`server/feasibilitySiteData.ts`) : géocodage
Géoplateforme, zone du PLU (`getPlu`), Géorisques (`getGeorisques`) et
monuments historiques à moins de 500 m (`findHistoricalMonuments`, extraite de
la route `/api/historical-monuments`). Ces trois fonctions sont exportées par
`server/routes/geoProxy.ts` et appelées directement, sans boucle locale. Chaque
service est en meilleur effort et indépendant des autres ; cache de 10 minutes
par adresse. Exposées à l'écran par `GET /api/proposals/:id/feasibility-site-data`
(adresse ENREGISTRÉE de la proposition, jamais celle du formulaire non sauvé).

**Blocs « Insérer »** (`src/lib/feasibilityBlocks.ts`, pur et testé, partagé
avec le serveur qui en tire le contexte du prompt par
`feasibilityContextForPrompt`) : terrain, urbanisme, risques, patrimoine,
programme, ERP, enveloppe. Un bloc sans donnée rend une chaîne vide plutôt
qu'un titre sans contenu, et l'IA ne voit jamais un libellé vide à compléter.

**Extraits de cartes** (`FeasibilityMapDialog.tsx`, calculs dans
`src/lib/feasibilityMap.ts`, testés) : les cartes de la proposition sont des
iframes, impossibles à capturer, donc l'extrait est recomposé dans un canvas à
partir des tuiles WMTS IGN (plan IGN, photo aérienne, parcellaire : les mêmes
couches que `MapLibreCadastre.tsx`, seules acceptées par le relais). Les tuiles
passent par `GET /api/feasibility/map-tile` (liste fermée de couches, matrice
vérifiée, `mapTileLimiter`) : chargées directement depuis data.geopf.fr, elles
saliraient le canvas faute de garantie CORS. Contour des parcelles choisies sur
la carte cadastrale de la proposition, sinon de la seule parcelle CONTENANT
l'adresse (`pointInGeometry` : le service renvoie les voisines à défaut, qu'il
serait faux de présenter comme le terrain), flèche du nord, barre d'échelle,
source. L'image validée devient un document de la proposition (catégorie
« Faisabilité ») ; retirer l'extrait supprime aussi ce document, en meilleur
effort. Le zonage du PLU n'est pas proposé en fond de carte : aucune couche
raster GPU n'a été vérifiée sur la Géoplateforme.

**Exports** (`src/lib/feasibilityExport.ts`) PDF et Word, au même aspect : logo et
repère « référence | Étude de faisabilité | Indice X » sur la première page
seulement (repère seul ensuite), titre en majuscules, champs en lignes (pas de
tableau de garde) avec indice et date de diffusion, sommaire, rubriques à la
suite sous un titre majuscule souligné, extraits de cartes avec légende,
pagination « P1|2 ». Indice et date vivent dans `proposals.feasibility_indice` /
`feasibility_issue_date` (`supabase/migrate_proposal_feasibility_meta.sql`),
écrits par `PUT /api/proposals/:id/feasibility-meta` ; sans valeur, l'export
prend « A » et la date du jour. Le Word reste modifiable (texte, puces, images).

### Export PDF d'une proposition : mise en page continue

`ProposalExportModal.tsx` ne fabrique plus « une section = une page fixe » (tout ce qui dépassait
une page était tronqué : fin du tableau des caractéristiques, missions proposées). Le document est UN
bloc `[data-pdf-flow]`, haut d'un nombre entier de pages A4, capturé par `jsPDF.html()` en une fois.
`src/lib/pdfPagination.ts` (`paginateFlow`, appelée après chaque rendu et par l'export) repousse sur la
page suivante chaque bloc qui ne tient pas : la coupure de jsPDF, tous les 297 mm, tombe donc toujours
dans une marge. La partie pure (`pageShiftMm`, `pageCountForHeight`) est testée
(`src/lib/__tests__/pdfPagination.test.ts`) ; la partie DOM ne se teste qu'en navigateur.

- **Géométrie** : bande haute de 26 mm (en-tête), bande basse de 20 mm (pied et « P1|N »), contenu entre
  les deux. En-tête, pied et pagination sont du HTML posé par-dessus, page après page (`PageChrome`) ; les
  repères de coupure de l'aperçu portent `data-pdf-screen-only` et sont masqués à l'export. La page de
  garde est une page entière à part (`data-pdf-cover`), hors pagination.
- **Ce qu'on ne coupe pas** : tout bloc `data-pdf-keep`, chaque ligne de tableau (`tbody > tr`,
  `tfoot > tr`), chaque `<P>`. Un titre (`data-pdf-heading`) suit le premier vrai bloc qui le suit (les
  autres titres et les blocs vides sont traversés), une ligne `data-pdf-keep-next` suit sa voisine. Un
  tableau coupé répète son en-tête sur la page suivante. Un bloc plus haut qu'une page entière n'est pas
  déplacé. Le nombre de pages se lit sur le bas du DERNIER contenu, jamais sur la marge basse du corps
  (page blanche sinon). Un espaceur est un `div` (ou une `tr`) `data-pdf-spacer` retiré à chaque
  repagination : ne jamais en garder de référence.
- **Trois réglages** (`ProposalTemplate.layout`, `localStorage['proposalTemplate']`, panneau « Mise en
  page » ; un modèle déjà enregistré reçoit les valeurs par défaut par fusion) : `sectionBreaks` (une
  section s'ouvre sur une page neuve ; vrai par défaut, la première section s'ouvre toujours sur une page
  neuve), `tableDensity` (`normal` | `compact` | `dense`, **compact par défaut**, `DENSITY_TOKENS` :
  marges et corps des cellules, interlignes, espacements des titres) et `cotraitantIdentity` (vrai par
  défaut).
- **Identité des cotraitants** : `loadCotraitantIdentities` / `identityFromContact`
  (`src/lib/pdfLetterhead.ts`, testés) lisent la fiche contact (raison sociale, personne, adresse de
  travail à défaut l'adresse générale, téléphone, e-mail, SIRET, logo) sans rien inventer. La section 05
  devient un tableau Logo / Spécialité / Société et contact / Coordonnées ; les logos de la page de garde
  suivent le même réglage. Les logos sont réduits à 600 x 300 px (`compressProposalLogo`) : jsPDF
  embarque les images à leur résolution native.
- **Tableaux** : « Calcul des honoraires » n'a plus de colonne « Catégorie » (vide sur chaque ligne de
  mission, elle écrasait la désignation) : la catégorie est une ligne de titre. Le tableau de répartition
  est en mise en page automatique, ses montants ne se coupent pas, et ses marges se resserrent dès trois
  intervenants.
- **Pièges propres à jsPDF, à ne pas défaire** : l'espace fine (U+202F) que `Intl` met dans les milliers
  s'imprime « / » et l'insécable avant « € » sans largeur (« 46 /000,00€ ») : `formatCurrency` et
  `formatPercent` n'emploient que des espaces ordinaires, et les cellules de montant portent
  `white-space: nowrap`. Le texte est imprimé environ 1 mm plus bas que sa boîte : les marges de cellule
  sont plus grandes en bas qu'en haut, et aucun texte ne porte `overflow: hidden` (il serait rogné).
  Les SVG sont masqués à l'export (ce sont les icônes), donc le diagramme de Gantt est dessiné en HTML ;
  ☑ et ☐ n'existent pas dans la police du PDF (ils sortaient en « & ») : ce sont des carrés dessinés.
  L'export repagine après avoir masqué ces éléments et après les avoir rétablis.

### Chaque ligne facturée devient un article dans Zoho

`server/zohoSync.ts::zohoLineItems()` ne construisait que des lignes libres
sur la facture Zoho (`name`/`rate`/`quantity`), jamais rattachées au
catalogue d'articles (Items) de Zoho : une ligne facturée n'apparaissait
donc nulle part en dehors de CETTE facture, et deux factures portant la
même prestation ne se retrouvaient jamais reliées à un article commun.

**`zohoItemIdentity(lineDescription, affaire)`** (pure, `zohoSync.ts`) décide
du nom et de la description de l'article correspondant à une ligne :

- Le **numéro et le nom d'affaire** vont dans le **nom** de l'article
  (`"Honoraires ESQ — 26014 Villa Martin"`), pas seulement dans sa
  description : Zoho impose un nom d'article unique par organisation, et
  c'est ce nom qui doit rendre l'affaire repérable d'un coup d'œil dans la
  liste des articles — pas seulement en ouvrant la fiche. Sans le numéro/nom
  d'affaire dans le nom, deux affaires portant la même ligne générique
  (« Honoraires ») auraient sinon partagé le même article, et donc le même
  historique de facturation.
- **L'adresse de l'affaire** va dans la **description** de l'article — une
  information complémentaire, pas un repère d'identification.
- Une facture sans affaire (facture générale, ou antérieure à
  `invoices.client_id`) garde le seul intitulé de la ligne, comme avant
  l'introduction des articles.

**`getOrCreateZohoItem`/`getOrCreateZohoBooksItem`** (respectivement
`zohoInvoice.ts` et `zohoBooks.ts`, dupliqués comme le reste des helpers
Contacts de ces deux fichiers plutôt que partagés — même rationale que
`buildZohoContactPayload`) recherchent l'article par **nom exact** avant
d'en créer un, exactement comme `getOrCreateZohoCustomer` : une même ligne
refacturée sur la MÊME affaire (un second acompte, par exemple) retrouve et
réutilise le même article plutôt que d'en créer un nouveau à chaque facture.
**Best-effort à dessein** : un article est un ajout, jamais une condition à
la facturation — un échec (réseau, quota Zoho) laisse la ligne repartir
libre, sans `item_id`, exactement comme avant l'introduction des articles ;
il ne fait jamais échouer la facture elle-même.

`item_id` fixe l'article facturé, il ne fige pas son prix : `rate`,
`quantity` et `tax_percentage` restent portés par la ligne elle-même, pas
par l'article — Zoho les respecte comme un prix ajusté pour cette facture
précise, exactement comme dans son interface (choisir un article puis
modifier son prix pour cette ligne).

**Avancement par phase d'un acompte.** `zohoPhasesText()` (`zohoSync.ts`) reprend
le bloc « Avancement par phase » de l'aperçu de la facture (une ligne par phase :
`Esquisse (ESQ) : 100% d'avancement, 1 074,45 €`, montants à espace ordinaire car
l'espace fine de fr-FR s'affiche mal chez Zoho). `zohoLineItems(inv, affaire)` en
fait la DESCRIPTION de la première ligne, après l'intitulé de l'opération
(`projects.name`) et son adresse, une information par ligne ; l'intitulé de la
ligne de facture n'y est pas répété, il reste dans son `name`. Pour Zoho Invoice
comme pour Zoho Books. Jamais dans le `name` : c'est lui qui identifie l'article,
donc `buildZohoLineItemsWithArticles` appelle `zohoItemIdentity(line.name, ...)` et
non plus `line.description`, sans quoi chaque avancement créerait un article
distinct. Seules les factures `invoice_type = 'acompte'` portent ce détail
(`phases`, à défaut la phase unique `mission_name`/`advancement_pct` des factures
antérieures) ; les autres gardent leur description.

Le numéro et l'adresse de l'affaire remontent jusqu'à ces fonctions par le
même chemin que `project_name` déjà en place : `server/routes/invoices.ts`
étend son `SELECT` sur `projects` (`name, project_code, address`) à la
création d'une facture, au retry de synchro (`POST
/api/invoices/:id/sync-retry`) et dans la synchro en masse
(`/api/zoho/sync`, `/api/zoho-books/sync`), et les transmet dans l'objet
`ZohoAffaireInfo` (`projectCode`/`projectName`/`projectAddress`) donné au
connecteur actif.

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

`POST /api/team` retrouve un compte déjà existant via `profiles.eq('email',
email)` — ce qui suppose que `profiles.email` est fiable. Ce n'était pas
toujours le cas : le trigger `handle_new_user()` (`supabase/schema.sql`) ne
copiait que le nom depuis `auth.users` à la création d'un compte, jamais
l'email. Un compte né d'une connexion Google (qui ne passe par aucune route
applicative avant que ce trigger s'exécute) se retrouvait donc avec
`profiles.email` vide alors que l'adresse existe bien côté Supabase Auth —
`server/routes/agencySetup.ts::adminRecipients()` contournait déjà ce trou,
mais pour un seul appelant (les notifications de demande de rattachement),
pas pour toute recherche de compte par e-mail.

`supabase/migrate_backfill_profile_email.sql` ferme ça à la source plutôt que
d'ajouter un repli à chaque appelant : le trigger copie désormais
`NEW.email`, avec `ON CONFLICT (id) DO UPDATE SET email = COALESCE(profiles
.email, EXCLUDED.email)` — jamais `DO NOTHING`, pour qu'un profil déjà
upserté plus richement par une route applicative avant l'exécution du
trigger garde ses valeurs ; seul un email resté NULL est complété. La même
migration corrige aussi les comptes déjà créés avant ce correctif.

### Références inter-locataires non validées

`tenantScopedFrom.ts` empêche une requête d'écrire une ligne dans le mauvais
tenant, mais ne dit rien des identifiants qu'un payload se contente de
RÉFÉRENCER — un `project_id` accepté tel quel dans le corps d'une requête peut
pointer vers un projet d'un autre cabinet, tant que rien ne vérifie son
appartenance avant l'écriture. `server/assertTenantEntity.ts` est le helper
générique introduit pour ça (`assertTenantEntity(supabaseAdmin, table, id,
tenantId): Promise<boolean>`).

Balayage complet effectué sur `server/routes/*.ts` : tout `POST`/`PUT` qui
acceptait un identifiant de clé étrangère depuis le corps de la requête
(`project_id`, `contact_id`/`client_id`, `tender_id`, `proposal_id`,
`reception_id`, `plan_id`, `situation_id`, `dpgf_item_id`, `dpgf_id`,
`marche_id`, `assignee_id`/`user_id`) vérifie désormais son appartenance au
cabinet avant l'écriture — `invoices.ts`, `proposals.ts`, `tenders.ts`,
`timeTracking.ts`, `meetings.ts`, `observations.ts`, `visas.ts`,
`tasks.ts`, `reserves.ts`, `rfis.ts`, `situations.ts`,
`projects.ts`, `receptions.ts`, `plans.ts`, `priceLibrary.ts`,
`projectMembers.ts`, `ordresDeService.ts`, `permits.ts`, `maf.ts`,
`marchesEntreprises.ts`, `meetingAttendees.ts`, `milestones.ts`,
`gpaReserves.ts`, `documents.ts`, `dpgf.ts`. `assignee_id`/`user_id` (une
personne, pas une ligne `tenant_id`-scopée comme les autres) se vérifie via
`findMembership()` (`server/tenantMemberships.ts`), pas `assertTenantEntity`.

Volontairement laissés de côté : les intégrations de synchro externe
(`odoo.ts`, `zohoBooks.ts`, `zohoInvoice.ts`, `ragic.ts`, `gmailSync.ts`,
`googleCalendarSync.ts`, `outlookSync.ts`) qui écrivent des FK à partir de
leurs propres lignes locales déjà tenant-scopées — un risque différent, pas
un oubli — et les cas où `project_id` vient d'un paramètre d'URL déjà validé
en amont (routes imbriquées sous `/api/projects/:projectId/...`), qui ne
sont pas la même faille : c'est l'identifiant RÉFÉRENCÉ depuis le corps
d'une requête qui manquait de contrôle, pas celui de la ressource visée par
l'URL elle-même.

### Facturation IA atomique (réserve → exécute → règle)

Le solde IA prépayé (`tenants.ai_credit_balance_eur_cents`) était jusqu'ici lu
une fois avant l'appel au modèle — potentiellement long, plusieurs secondes,
surtout sur une boucle d'appel d'outils (`POST /api/agents/:id/chat` peut
enchaîner jusqu'à six appels au modèle : initial, jusqu'à
`MAX_FUNCTION_ROUNDS` tours d'outils, un tour de clarification) — puis déduit
une seule fois à la toute fin, plafonné à zéro. Une rafale de requêtes
concurrentes contre un solde faible passait donc toutes le contrôle initial
et déclenchait chacune un vrai appel, facturé par le fournisseur, avant
qu'aucune déduction n'ait eu lieu.

**`server.ts` : `reserveAiCredit()` / `settleAiCredit()` / `refundAiCredit()`**
remplacent ce lire-puis-écrire par réserve → exécute → règle, câblés dans
`timedChat()` (`packages/archioffice-agents/src/server/routes.ts`) : CHAQUE
appel au modèle, pas la requête entière, réserve un coût pessimiste avant de
s'exécuter et règle contre l'usage réel juste après.

- **`reserve_ai_credit(tenant_id, montant)`** (SQL,
  `supabase/migrate_ai_billing_atomicity.sql`) fait le contrôle ET l'écriture
  dans la même instruction — sous verrou de ligne Postgres, deux appels
  concurrents contre un solde qui ne couvre pas les deux ne peuvent plus tous
  les deux réussir. Renvoie faux sans jamais avoir appelé le modèle.
- Le montant réservé est pessimiste : `RESERVE_MAX_OUTPUT_TOKENS` (16000,
  aligné sur le `max_tokens` déjà imposé aux adaptateurs Anthropic/Mistral —
  Gemini n'a pas d'équivalent en code, donc c'est ici une hypothèse pour le
  calcul de réserve, jamais une limite réellement appliquée à cet appel) et
  une estimation grossière des jetons d'entrée (longueur des messages / 4).
- **`settle_ai_credit(tenant_id, delta)`** régularise ensuite contre le coût
  réel une fois l'usage connu : remboursement du surplus réservé (le cas
  courant), ou complément si le réel dépasse la réservation — toujours
  plafonné à zéro.
- Un appel qui échoue (réseau, timeout) est intégralement remboursé via
  `refundAiCredit()`, volontairement distinct de `settleAiCredit()` : cette
  dernière passe par `priceEurCents()`, qui plancher même un appel à zéro
  jeton à 1 centime — l'utiliser pour un remboursement aurait laissé un
  centime fantôme sur un appel qui n'a jamais réellement eu lieu.

**Recharge mensuelle du forfait**, même faille : l'ancien
`maybeRefreshMonthlyCredits()` lisait `ai_credit_last_refresh`, puis créditait
si absent/périmé — deux premiers appels du mois exécutés en même temps
lisaient tous les deux l'ancienne date et créditaient tous les deux le
montant mensuel. **`refresh_monthly_ai_credits(tenant_id, montant)`** fait la
vérification et l'écriture dans la même instruction, remplaçant le
lire-puis-écrire.

**Le mode postpaid n'a pas ce garde-fou** — sans solde à protéger contre un
dépassement, `POST /api/agents/:id/chat` y garde l'ancienne comptabilité
globale a posteriori (`deductAiCredit()`, inchangée) plutôt que de réserver
par appel. `POST /api/agents/transcribe`, `POST /api/agents/speak` et
`POST /api/ai/suggest-articles` ne sont pas passés au modèle réserve/règle :
leur coût dépend d'un volume audio dont la conversion en jetons avant l'appel
n'a pas de formule fiable à documenter honnêtement (contrairement au texte,
où `chars/4` est une approximation usuelle) — plutôt que d'inventer un
facteur de conversion, ils gardent le lire-puis-déduire existant, dont
l'exposition financière par appel reste bornée (audio ≤ 10 Mo, texte de
synthèse ≤ `MAX_SPEECH_CHARS`).

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

**Un fournisseur par cabinet.** `tenants.ai_provider` / `ai_model` (`supabase/migrate_tenant_ai_provider.sql`, NULL = suit la plateforme) surchargent le réglage plateforme pour UN cabinet. Tous les appels qui savent pour quel cabinet ils tournent passent par `getTenantAiConfig(supabaseAdmin, tenantId)` (`llm/config.ts`) et non plus par `getPlatformAiConfig`, qui ne sert plus qu'à l'écran plateforme. Un cabinet avec un fournisseur mais sans modèle reçoit le modèle par défaut de CE fournisseur, jamais le modèle plateforme. Réglé par `GET/PUT /api/admin/tenants/:id/ai-provider` (mêmes refus que le réglage plateforme : fournisseur inconnu, modèle hors catalogue, clé absente ; `provider: null` rend le cabinet à la plateforme) depuis la fiche cabinet de `/admin`. La dictée et la synthèse vocale gardent leur repli Gemini quand le fournisseur du cabinet ne sait pas lire ou produire de l'audio.

API keys are never part of this. They stay in the environment, and `PUT /api/admin/ai-provider` refuses a provider whose key is missing rather than let an operator switch the platform onto a 503.

**Two invariants worth keeping:**

1. **A model absent from `MODEL_CATALOG` cannot run.** `resolveLlmProvider()` refuses it, because running a model we can't price means billing a tenant an invented amount. Adding a model means adding its real cost.
2. **Cost is a fact, margin is a knob.** Per-token cost differs ~10x between Gemini Flash and Claude Opus, so it lives per model in the catalogue; `AI_PRICE_MARKUP` is the single commercial lever on top. Every usage row records `provider` and `model` so a charge can be read back with the rate that produced it.

### Nomic : lecture des plans et génération du CCTP

Nomic n'a **pas d'API de chat** : ce n'est pas un quatrième fournisseur de
`llm/`, mais un moteur de lecture (`/v1/parse`) et d'extraction structurée
(`/v1/extract`) de pièces d'ingénierie. Client sans dépendance dans
`packages/archioffice-agents/src/server/nomic.ts`, protocole relevé sur le SDK
officiel : dépôt (`/v1/upload` puis PUT présigné), tâche, `/v1/status/:id`,
résultat par `result_url`.

**Moteur de lecture** (`documentParser.ts`) : `local` (pdf-parse + mammoth +
Tesseract) ou `nomic`, réglé dans `/admin` (« Lecture des documents »,
`GET/PUT /api/admin/document-parser`, stocké dans `platform_settings` sous
`document_parser`, même cache de 30 s que le fournisseur IA). Priorité :
`/admin` → `DOCUMENT_PARSER` → `local` ; basculer sur Nomic sans
`NOMIC_API_KEY` est refusé. Il s'applique à `extractDocumentText`
(pièces jointes de mail, `read_document`, courrier entrant), aux pièces jointes
d'un message d'agent (après la branche vision, qui reste préférée pour une
photo) et à `extractKnowledgeDocText` (analyse du DCE, génération du CCTP).
**Deux règles à garder** : un échec de Nomic retombe sur le moteur local
(`parseWithActiveEngine` rend `null`), et la bibliothèque de connaissances
d'un agent reste TOUJOURS locale (`allowNomic = false`) : relue à chaque tour,
elle serait refacturée à la page à chaque message. `server.ts` dépose le client
Supabase au démarrage (`setDocumentParserSettingsClient`), sur le patron de
`setExternalFileReader`.

**« Générer » dans l'éditeur CCTP** (`CctpGenerateDialog.tsx`,
`POST /api/projects/:projectId/cctp/generate`, `server/routes/cctpGeneration.ts`) :
l'architecte coche jusqu'à 10 pièces de l'affaire et choisit le moteur.
`llm` lit les pièces avec le moteur de lecture actif puis fait rédiger le
modèle IA de la plateforme (réserve → exécute → règle, `endpoint_type =
'cctp_generation'`) ; `nomic` dépose les fichiers bruts et laisse Nomic
Extract remplir le schéma lots > chapitres > articles en voyant le plan
lui-même. Le coût Nomic (lecture et extraction) est porté par le compte Nomic
de l'opérateur et **n'est pas refacturé** aux crédits du cabinet : il n'a pas
de tarif au jeton que `MODEL_CATALOG` pourrait porter, et inventer un montant
est exclu. La route ne réécrit jamais le document : la proposition
(`lotsDepuisGeneration`, `src/lib/cctpGeneration.ts`) s'ajoute APRÈS les lots
existants, quantités et prix à 0, chaque article marqué `genereParIa` (badge
« IA » dans l'arbre, comme « BIB » pour la bibliothèque), puis passe par
l'enregistrement habituel. Seules les pièces dont `project_id` est l'affaire
visée sont lues.

**Moteur « llm » : un lot à la fois.** Un seul appel pour tout le CCTP produisait un
JSON de plusieurs milliers de jetons, plus long que les délais des fournisseurs
(120 s chez Mistral) et des proxys. `CctpGenerateDialog` enchaîne donc, dans le
navigateur : `POST .../cctp/plan` (liste des lots, sans chapitres) puis
`POST .../cctp/generate-lot` par lot, trois à la fois (`cctpLotLimiter`, 60 par
minute et par personne). Chaque appel est facturé séparément (réserve → exécute →
règle) ; un lot en échec n'emporte pas les autres (« Réessayer les lots en
échec », « Insérer les lots obtenus »). Nomic reste sur `POST .../cctp/generate`.
**Cache de prompt** : les pièces (`cachePrefix`, `LlmChatParams`) sont placées en
tête de chaque appel, identiques du plan au dernier lot, avec le même `system`.
Claude les marque `cache_control` (écriture à 125 %, lecture à 10 %, ramenées en
jetons d'entrée équivalents dans `usage`) ; Gemini met en cache implicitement un
préfixe identique ; Mistral reçoit `prompt_cache_key` (`cacheKey`, condensé SHA-256
de cabinet, affaire et pièces, jamais de donnée en clair) et facture les jetons
servis par le cache (`usage.prompt_tokens_details.cached_tokens`) à 10 % : succès
possible mais jamais garanti, blocs de 64 jetons. Le
plan, lancé seul avant les lots, écrit le cache que les lots lisent ensuite. Le
texte extrait des pièces est gardé 15 min en mémoire (`sourceCache`) pour ne pas
relire ni réOCRiser les plans à chaque lot.

### Chantier hors ligne, en plusieurs bâtiments et phases

**Comptes-rendus hors ligne.** `GET /api/projects/:id/reports` n'était lu ni mis en
cache : sans réseau la liste restait vide, et un compte-rendu créé sur le chantier
disparaissait au premier rechargement. `siteReportsCache` et `siteReportNotesCache`
(Dexie v8) suivent le patron des autres caches (`cachedListFirst`), et la file
d'écritures est SUPERPOSÉE à la liste (`superposerEcrituresEnAttente`,
`src/lib/chantierDecoupage.ts`, testée) : création en attente ajoutée, modifications en
attente rejouées par-dessus. Toute modification d'un compte-rendu (`persistReport`),
création, édition et suppression de rubrique passent par `queuedJsonRequest`. Deux
pièges : une modification n'a jamais le même id de file que la création (sinon elle
l'écraserait), et le numéro d'un compte-rendu en attente est provisoire, donc jamais
renvoyé dans une modification. `POST /api/reports/:id/notes` accepte un `id` client
(idempotent).

**Bâtiments et phases.** Même registre que le CCTP/DPGF (`DecoupageDocument`) mais porté
par l'affaire : `projects.chantier_decoupage` (jsonb), écrit par sa propre route
`PUT /api/projects/:id/chantier-decoupage` (`server/routes/chantierDecoupage.ts`), jamais
par l'enregistrement automatique de la fiche (qui l'ignore, sa liste blanche ne le
contient pas). « Reprendre ceux du CCTP / DPGF » copie le registre du DPGF en gardant les
identifiants. `site_reports` et `observations` portent `batiment_id` / `phase_id`
(`supabase/migrate_chantier_decoupage.sql`), sans clé étrangère : retirer un bâtiment
du registre ne supprime rien, les lignes repassent « sans bâtiment ». Une observation
relevée dans un compte-rendu hérite de son bâtiment et de sa phase ; la liste des
comptes-rendus et le tableau des observations se filtrent par bâtiment, phase ou
« sans affectation », l'export PDF porte la ligne « Bâtiment / phase ». Rien n'apparaît
tant que le registre est vide.

### Réunions hors ligne : notes et intervenants

- **Les notes ne dépendent plus de la perte de focus.** `Reunions.tsx` garde chaque frappe dans un brouillon local (`meeting-notes-draft:<id>`, synchrone) et écrit 1 s après la dernière frappe, au changement de réunion et à `pagehide`. L'écriture en file a un id STABLE (`notes:<id>`) : les enregistrements successifs se remplacent, un seul PUT part. À la réouverture, brouillon non parti > écriture en file > valeur du serveur (`resolveMeetingNotes`), et un brouillon retrouvé est renvoyé.
- **Reconnexion** : `offlineQueue.ts` traite 401, 502, 503 et 504 comme le réseau absent (écriture gardée, rejeu plus tard), jamais comme un refus définitif. Une session pas encore renouvelée au retour du réseau ne fait plus perdre une saisie.
- **Intervenants hors ligne** (`src/lib/meetingAttendeesOffline.ts`, entité de file `meetingAttendee`, cache Dexie `meetingAttendeesCache`, v9) : ajout d'un contact existant ou d'un nouveau contact, changement de rôle, retrait. Les identifiants (intervenant, fiche contact) sont générés par l'appareil ; `POST /api/meetings/:id/attendees` et `/new-contact` les acceptent et rejouent sans doublon (200 au rejeu). La liste affichée = cache ou serveur + écritures en file rejouées par-dessus (`applyPendingAttendeeWrites`, testé). Les contacts viennent du cache `db.contacts` sans réseau.

### Compte-rendu de chantier au téléphone

`ChantierModule.tsx` (onglet Comptes-rendus) est le premier écran du chantier : ses
pièces vivent dans `src/components/chantier/`. Règles à garder :

- **Une rangée au bureau, une carte sous 768 px**, par `order-*` et `flex-wrap`, jamais
  deux DOM : `RubriqueRow`, `DecisionRow`, `ObservationRow` (`ReportRows.tsx`). L'ordre
  du DOM reste celui de la rangée de bureau, donc celui du clavier. Champs encadrés et
  cibles de 44 px au doigt (`ROW_FIELD`, `TOUCH_TARGET`, `fields.tsx`).
- **« Présence & suivi des lots »** : tableau à partir de 768 px, une carte par lot
  (`LotTrackingCards.tsx`, `useMediaQuery`, un seul rendu monté) en dessous. Même
  `lot_tracking`, mêmes champs ; le premier choix de statut crée la ligne de présence
  AVEC ce statut (il était ignoré, la ligne naissant « Présent »). Chaque carte est
  repliée par défaut sur le lot et son statut (pastille de couleur), avec un résumé de ce
  qui est saisi ; dépliée, effectif, retards, bâtiments, convocation et pénalité. Lieu et
  heure par lot ne se saisissent qu'au bureau : au téléphone, l'heure « Convocation » de
  la section vaut pour tous les lots.
- **Aucune saisie ne part à chaque frappe** : `DraftInput` et `CommitTextarea`
  n'enregistrent qu'à la sortie du champ. Chaque frappe renvoyait le compte-rendu entier
  au serveur, dont la réponse écrasait la saisie en cours (le lieu « se réinitialisait »,
  les décisions aussi).
- **`Section`** est repliable, état mémorisé par section (`chantier:section:<id>`) ; son
  action passe sous le titre quand la largeur manque au lieu de sortir de l'écran.
- **`QuickCaptureBar`** (téléphone seulement) : « Observation » et « Photo » fixés en bas.
  La photo ouvre l'appareil (`capture="environment"`) et crée l'observation qui la porte.
- Libellés : la nature `reserve` s'affiche « À lever » (`chantierConstants.ts`) ; « réserve »
  est réservé à l'AOR.
- **Deux vues d'une même donnée** : l'onglet **Observations** (`ObservationsTable`) est la vue PAR DÉFAUT
  de tout l'historique du chantier (statut, nature, urgence, lot, bâtiment / phase, CR émis et levé, photos,
  reprise en réserve de l'AOR, suppression) ; « Observations par lot » du compte-rendu n'en est qu'un
  EXTRAIT, celui des observations du jour (`observation_reports`), épuré à l'intitulé, au délai (« Pour le »)
  et aux photos. On y saisit sur le chantier, avec le lot choisi avant d'ajouter ; tout le reste se règle dans
  l'onglet Observations. Le badge « N observations non levées sur l'opération » (`countOpenObservations`,
  `src/lib/observationsOpen.ts`, tout ce qui n'est pas « Levée ») ouvre cet onglet sur « Ouverts seulement »
  (`initialOpenOnly`) pour la revue.
- **Ajout et suppression immédiats, sans doublon** (`ObservationsTable.tsx`, `src/lib/observationsLocal.ts`, testé) :
  une observation ajoutée apparaît tout de suite (« en attente ») au lieu d'attendre le serveur, ce qui évitait de
  re-cliquer et d'en créer deux ; une suppression retire la ligne de l'écran ET du cache hors-ligne avant la requête
  (la ligne revient avec un message si le serveur refuse). Une relecture partie avant l'action et revenue après ne
  ressuscite pas une ligne supprimée et ne fait pas disparaître une création (`reconcileRemote`), et un identifiant
  n'est jamais présent deux fois (`upsertById`, aussi dans `ChantierModule`). Après un ajout ou une suppression, le
  tableau prévient le compte-rendu (`onChanged`), dont les listes se relisent.
- **Réponse** : `observations.reponse` (`supabase/migrate_observations_reponse.sql`), texte libre saisi dans la
  ligne dépliée de l'onglet Observations (flèche à gauche, point si une réponse existe). L'export PDF du CR
  l'imprime sous la description, avec la colonne « Bât. / phase » quand le chantier a un registre et
  qu'une observation y est affectée (`opts.decoupage`).

### Planning de chantier (onglet DET > Planning)

Gantt décomposé par lot, entre « OS & situations » et « Photos » (`PlanningChantierTab.tsx`, sous « Plus » sur
téléphone). Table `project_chantier_planning` (`supabase/migrate_chantier_planning.sql`, une ligne par affaire,
jsonb `PlanningChantier`, hors `SYNC_TABLES`) ; routes `server/routes/planningChantier.ts`
(`GET/PUT /api/projects/:id/planning-chantier`, `POST .../generate`, `tests/planningChantier.test.ts`) ; logique pure
partagée écran / PDF / serveur dans `src/lib/planningChantier.ts` (testée). Une instance non migrée lit un planning
vide (`available: false`) et refuse l'écriture en 503.

- **Une tâche** : lot (`project_lots.id`, vide = tâche générale), dates AAAA-MM-JJ calculées en UTC, avancement,
  `source` (`ia` | `manuel`), jalon. L'état (à venir, en cours, terminée, en retard) **se déduit** (`etatTache`), jamais saisi.
- **Génération IA** : le serveur part du **DPGF et du CCTP de l'opération** quand ils existent (`server/planningSources.ts`,
  testé : par lot, chapitres de travaux avec montant et principaux ouvrages, prescriptions `cctpDescription`, bâtiments et
  phases du registre ; option, variante et pour mémoire exclus ; montant du DPGF si le marché n'est pas chiffré ; case
  « Partir du DPGF et du CCTP » de la fenêtre, `depuis_dpgf`, réponse `sources`), puis ajoute lots, entreprise titulaire et
  montant du marché, `duree_mois`, pièces choisies de l'affaire ; le modèle rend des **semaines**, jamais des dates (`planningDepuisReponse` pose
  lundi à vendredi). Un lot inconnu est écarté, le planning ne crée jamais de lot. La route **ne propose qu'une
  proposition** : `appliquerGeneration` remplace les tâches IA des lots générés et garde, au choix, le manuel.
  Modifier une tâche IA la fait passer en `manuel`. Facturé en réserve → exécute → règle, `endpoint_type = 'planning_generation'`.
- **Marchés rapprochés des lots par intitulé, pas par numéro** (`associerMarches`, `server/planningSources.ts`, testé sur les vrais
  lots d'une affaire où le marché 09 « Peinture » répond au lot 07 et les marchés 10 et 11 au lot 09) : chaque marché va au lot
  dont l'intitulé lui ressemble le plus (le numéro identique ne fait que départager, et seul un marché sans intitulé se rapproche
  par son numéro), les marchés d'un même lot s'additionnent, un marché sans lot (installation de chantier) est donné au modèle
  comme tâche générale. `GET .../planning-chantier` rend `entreprises` (lot → titulaires) pour l'écran.
- **Un DPGF peu chiffré reste exploitable** : aucun « (0 € HT) », un groupe de sous-articles compte pour un poste (« Couverture
  métallique (3 postes) »), les lignes « Nouvel article » sont ignorées, et dans le texte du CCTP les prescriptions des ouvrages
  passent avant le texte générique des chapitres réservés au CCTP (que le plafond de 900 caractères coupe en dernier).
- **Enregistrement automatique** (1,2 s, écritures chaînées, rien avant la fin de la lecture), comme la consultation ACT.
- **PDF** (`planningChantierPdf.ts`, charte du cabinet, « P1|2 ») : complet, ou un lot seul à remettre à son entreprise.
- **Pas encore fait** : glisser-déposer des barres, dépendances entre tâches, liaison avec les jalons de mission.

### Documents joints à l'export PDF du compte-rendu

« Joindre un document au PDF » (en-tête du compte-rendu, `ChantierModule.tsx`) ajoute à la suite du
PDF un compte rendu OPC, une notice, un planning... : PDF repris page par page (texte et vecteurs
conservés), image JPEG ou PNG posée sur une page A4. Logique dans `src/lib/pdfAttachments.ts`
(`checkAttachment`, `appendAttachments` sur `pdf-lib`, testée) ; `exportSiteReportToPDF` reçoit
`attachments`. Cinq documents au plus, 15 Mo chacun. Le même PDF fusionné sert au téléchargement et à la
diffusion par e-mail (plafond serveur de 20 Mo vérifié avant l'envoi). Les fichiers sont choisis sur le
poste et gardés pour la session seulement, par compte-rendu : rien n'est enregistré avec lui. Un PDF
protégé ou corrompu fait échouer l'export en nommant le fichier, jamais d'envoi amputé. La pagination
« P1|2 » ne compte que les pages du compte-rendu lui-même.

### Observations : export PDF, impression, menu collant

`src/lib/observationsExport.ts` exporte la liste telle qu'affichée (filtres, regroupement par lot, colonnes visibles) en PDF paysage à la charte (`exportObservationsToPDF`), téléchargé ou imprimé (`telechargerPdf`, `imprimerPdf`) ; seule une échéance dépassée est en rouge. Les boutons « Exporter PDF » et « Imprimer » sont dans la barre d'outils de `ObservationsTable`. Le menu des sections du chantier (`ChantierModule.tsx`) est `sticky top-0` : il reste visible au défilement.

### Observations : plusieurs lots, TCE, anciennes non levées, intervenants des rubriques

- **Attribution** (`supabase/migrate_observations_multi_lots.sql`, `lot_ids` jsonb et `tce` booléen sur `observations`) : un lot (`lot_id`, cas historique), plusieurs lots (`lot_id` = le premier, `lot_ids` = tous) ou tous (`tce = true`, `lot_id` nul, « Tout corps d'état »). Logique pure dans `src/lib/observationLots.ts` (`selectionToFields` : cocher tous les lots revient à TCE ; `observationTargetsLot`, `groupObservationsByLot`, testés). `POST`/`PUT` d'une observation valident chaque lot contre le cabinet (400 sinon) ; un corps sans `lot_ids` ni `tce` ne touche pas aux lots. Instance non migrée : l'écriture retombe sur les colonnes d'origine, et un TCE ou multi-lots est refusé en 503 plutôt qu'enregistré faux.
- **Corriger l'entreprise** : `ObservationLotPicker` (bouton « 03 · Menuiserie » dans chaque ligne d'observation du compte-rendu et dans la colonne Lot de l'onglet Observations) ouvre une fenêtre de choix (case TCE, lots à cocher, recherche). L'observation change de groupe tout de suite, sans recopie. Un seul lot reprend l'entreprise du lot ; plusieurs lots ou TCE effacent `contact_id` (les lots portent les entreprises). Dans l'onglet Observations groupé par lot, une observation multi-lots figure sous chacun de ses lots, une TCE sous son propre groupe en tête.
- **Diffusion** : `buildDiffusionRecipients` adresse une observation à l'entreprise de chacun des lots visés ; une TCE va à toutes les entreprises titulaires d'un lot (pas aux intervenants sans lot) et s'imprime `[TCE]`. Option **« Joindre les anciennes observations non levées »** (case de l'en-tête du CR et de la fenêtre de diffusion, mémorisée par poste sous `chantier:pdf:previousOpen`) : le PDF les imprime après celles du CR sous « Observations antérieures non levées » (sans photos), et le message de chaque destinataire porte une seconde liste de SES anciennes observations. Sont reprises celles de l'opération ni levées ni refusées et absentes du CR ; le serveur les relit (`include_previous`), le client n'envoie jamais leur contenu.
- **Société d'une rubrique** : `IntervenantCombobox` remplace le champ libre. Liste des entreprises des lots puis des intervenants de l'opération, filtrée à la frappe, **TCE** en tête et une ligne « Créer un nouvel intervenant ». Le texte tapé n'est retenu que s'il correspond à une proposition (une valeur libre déjà enregistrée reste affichée). La création (`NewIntervenantDialog`) reprend la fiche contact du cabinet du même nom, sinon la crée (`POST /api/contacts`, catégorie Entreprise), l'ajoute aux intervenants (`PUT /api/projects/:id/stakeholders`, qui remplace la liste : la liste actuelle est renvoyée en entier) puis la choisit pour la rubrique. TCE s'enregistre simplement « TCE » dans `responsible_company`.
- Tests : `src/lib/__tests__/observationLots.test.ts`, `crDiffusion.test.ts`, `tests/observationMultiLots.test.ts`, `tests/siteReportDiffusion.test.ts`. Le rendu PDF des anciennes observations et les fenêtres n'ont pas été vérifiés dans un navigateur.

### Export PDF du compte-rendu : format, W/D, photos de rubriques

`exportSiteReportToPDF` (`src/lib/siteReportExport.ts`) suit ce qui est saisi à l'écran. La
présence d'un lot se lit dans `attendance` (ligne repérée par l'intitulé du lot, « Présent » par
défaut) et non dans `lot_tracking` (`lotPresenceStatus`, `src/lib/siteReportPresence.ts`, testé).

- **Format** : `SiteReport.pageFormat` (`portrait` par défaut, `landscape`), choisi dans l'en-tête du
  CR (« Format PDF »), colonne `site_reports.pageformat`. Toutes les pages d'un PDF ont la même
  orientation ; les planches de vignettes s'adaptent à la largeur (`thumbsPerRow`).
- **W/D** : `lot_tracking[].concerned` (`W`, `D`, `WD`, jsonb, aucune migration), saisi par lot
  (tableau et cartes mobiles) et imprimé en dernière colonne du suivi des lots.
- **Renommer une rubrique** : le nom de la rubrique (catégorie des entrées) se modifie en place dans l'en-tête de son groupe (`renameRubrique`, `ChantierModule.tsx`). Toutes ses entrées du compte-rendu passent sous le nouveau nom (un nom déjà utilisé les fusionne avec cette rubrique) ; une écriture en file par entrée, `PUT /api/notes/:id` n'écrit que les champs fournis et refuse un nom vide (400).
- **Une seule entête pour les rubriques** : l'export PDF dessine l'entête de colonnes (Date, Texte, Société, Échéance, Statut) UNE fois en haut de la section, puis en haut de chaque page suivante de cette section (`drawRubriquesHead`, `willDrawPage`) ; les tableaux de chaque rubrique n'ont pas la leur (`showHead: 'never'`) mais les mêmes largeurs de colonnes.
- **Photos de rubriques** : `site_report_notes.photos` (`supabase/migrate_site_report_note_photos.sql`,
  tableau d'URL du bucket privé `meeting-photos`), `POST /api/notes/:id/photos` (id client
  idempotent, file hors ligne `siteReportNotePhoto`) et `PUT /api/notes/:id/photos` qui ne sait
  que RETIRER des URL. Le réglage « Photos des rubriques dans le PDF » est propre au poste
  (`localStorage`, `chantier:pdf:rubriquePhotos`, coché par défaut) et passe par
  `includeRubriquePhotos`. Les rubriques reportées d'un CR au suivant ne reprennent pas les photos.

### Écriture du DPGF par les agents et le MCP (`manage_dpgf`)

`manage_dpgf` (`projectWorkTools.ts`, scope `projects`, donc aussi exposé au MCP) ajoute, modifie
ou supprime des LIGNES du DPGF d'une opération, au lieu d'un UPDATE SQL sur `dpgfs` ou de
l'envoi du document entier. L'outil n'est qu'un client de `POST /api/projects/:id/dpgf/lignes`
(`server/routes/dpgf.ts`), qui applique l'opération par `server/dpgfLignes.ts` (pur, testé,
`tests/dpgfLignes.test.ts`) : même jeton, même cabinet que l'écran.

- **Actions** : `add_lignes` (lot, chapitre par numéro ou titre, défaut « DESCRIPTION DES OUVRAGES »,
  jusqu'à 300 lignes par appel, numérotation `<chapitre>.<n>` à la suite, `replace_existing` pour
  écraser une ligne vide « Nouvel article »), `update_ligne` et `delete_ligne` (par `id` ou numéro ;
  la suppression passe par la confirmation en deux temps, un `dry_run` serveur en donne l'aperçu).
  Il ne crée ni DPGF, ni lot, ni chapitre : le lot doit exister (`manage_project_lots`).
- **Jamais touchés** : un chapitre `cctpOnly`, et une ligne qui porte un `cctpDescription`
  (conservée par `replace_existing`, refusée en suppression). Une nouvelle ligne n'a ni
  `batimentId`, ni `phaseId`, ni `trancheId` : `batimentId: ''` voudrait dire « aucun bâtiment, sans
  héritage », l'absence « hérite du chapitre ou du lot ».
- **Un appel est accepté en entier ou refusé en entier** (quantité et prix numériques et positifs,
  lot et chapitre existants) ; erreurs en français, avec la liste des lots ou chapitres disponibles.
  Rejouer `add_lignes` ajoute de nouveau : refaire un import passe par `replace_existing`.
- **Totaux** : `prixTotal` des lignes touchées, `sousTotal` de chaque lot, `totalHT` et `totalTTC`
  (champ `TVA` du document, 20 % à défaut) ; le récapitulatif rend les lignes ajoutées par lot et
  les sous-totaux.
- **Limite de la concurrence, à connaître** : `dpgfs` n'a ni `updated_at` ni version (aucune
  migration n'a été faite) et le texte `data` est trop gros pour une comparaison dans une requête
  PostgREST. La route sérialise donc les écritures par DPGF dans le processus et RELIT le document
  juste avant d'écrire (trois essais, puis 409). Cela couvre des appels d'agent simultanés et la
  plupart des enregistrements de l'application web, pas la fenêtre de quelques millisecondes entre
  la relecture et l'écriture, ni plusieurs instances du serveur. L'autosauvegarde de l'écran réécrit
  de toute façon le document entier : une colonne `updated_at` (ou une fonction SQL atomique) serait
  la vraie réponse, à décider séparément.

### Temps par phase, coût horaire et rentabilité par phase

`time_entries` porte désormais `phase` (code de la mission : ESQ, APS, APD, PC, PRO, DCE, ACT, VISA, DET, AOR, `NULL` = non imputé) et `billable` (vrai par défaut : tout le temps déjà saisi reste facturable), `supabase/migrate_time_phase_cost.sql`. Le pointage, la saisie manuelle et la modification les acceptent (`readPhaseAndBillable`, `server/routes/timeTracking.ts`) : une phase hors liste est refusée en 400, un champ absent d'un `PUT` laisse la valeur enregistrée.

**Le coût horaire est une donnée de gestion, tenue par cabinet** : `tenant_memberships.hourly_cost_cents` (centimes, `NULL` = non renseigné), jamais sur `profiles` qui suit la personne d'un cabinet à l'autre. `GET /api/hourly-costs` et `PUT /api/hourly-costs/:userId` sont réservés aux administrateurs (saisi en euros, stocké en centimes, membre d'un autre cabinet refusé en 404) ; l'écran est `HourlyCostsCard` dans l'onglet admin du suivi du temps. Une instance non migrée lit `available: false` et refuse l'écriture en 503, sans casser le reste.

`src/lib/profitability.ts` (pur, partagé serveur et écran, `src/lib/__tests__/profitability.test.ts`) fait le calcul : budget d'une phase = honoraires révisés x part de la mission du contrat MOE (`MISSION_ID_TO_PHASE`, déplacé hors de `ProjectDetail.tsx`), coût = heures x coût horaire de chaque membre, marge = budget - coût. `GET /api/projects/:projectId/time-by-phase` (administrateurs et managers seulement : le coût du temps ne se lit pas à tous) renvoie heures, heures facturables et coût par phase, et **la liste des membres ayant saisi du temps sans coût horaire** : l'écran (`ProjectProfitability.tsx`, onglet HONOS) le signale au lieu de présenter une marge flatteuse. Les missions qui ne sont pas une phase (OPC...) n'ont pas de budget ; leur temps se saisit sans phase et apparaît sur une ligne « Sans phase ». Tests : `tests/timePhaseCost.test.ts`.

Pas encore couvert, voir ROADMAP.md : plan de charge prévisionnel (table d'affectations reliée aux congés), export FEC, notes de frais et factures fournisseurs.

### Intervenants d'une affaire (agents et MCP)

Les intervenants (`project_stakeholders`, liste « Intervenants » de la fiche) ne sont pas une
ressource de `AGENT_RESOURCES` : ils vivent dans la fiche affaire (`stakeholders_list`) et
s'écrivent par `PUT /api/projects/:id/stakeholders`, qui REMPLACE toute la liste. Un agent
n'avait donc aucun moyen d'y toucher et créait une tâche « mettre à jour les intervenants » à la
place. `manage_project_stakeholders` (`projectStakeholdersTool.ts`, scope `projects`, exposé au
MCP) fait `list`, `add` et `remove` : il relit la liste (`/full`), y applique la demande et
renvoie l'ensemble. Une ligne existante garde son identifiant (les présences de compte rendu s'y
rattachent), un doublon (même contact, même rôle) est ignoré, un contact se désigne par
`contact_id` ou par son nom exact (plusieurs fiches homonymes : refus et liste des candidats),
un rôle est obligatoire. `remove` passe par la confirmation en deux temps de `delete_record`.

### Couverture des agents : outils d'opération, documents, Markdown

Au-delà des ressources CRUD de `AGENT_RESOURCES`, des outils écrits à la main couvrent ce que la
fiche affaire porte en listes ou en routes imbriquées (`projectWorkTools.ts`, scope `projects` ou
`meetings`, exposés au MCP) : `manage_project_lots`, `manage_project_cotraitants`,
`manage_project_members`, `manage_project_journal` (phase en cours et notes de phase),
`manage_observations`, `manage_meeting_attendees`. Même règle partout : rejouer est sans risque,
retirer passe par `needs_confirmation` puis `confirm: true`. **Le changement de phase reste un
geste humain** (checklist de contrôles, `POST /api/projects/:id/phase`). Réglages, équipe et
facturation restent hors des agents.

`AGENT_RESOURCES` gagne `rfis`, `avenants_moe`, `gpa_reserves`, `time_entries` et quatre sous-éléments
d'appel d'offres (`tender_*`). Deux drapeaux : `listParam` (liste lue par parent, `parent_id` dans
`search_records`/`get_record`) et `mergeOnUpdate` : le PUT de ces routes remet à null ou à zéro les
colonnes absentes du corps (notes d'une réunion, valeur et surface d'un appel d'offres...), donc
`update_record` relit l'enregistrement et renvoie TOUTES ses colonnes avec les champs fournis par-dessus.
À ne pas activer sur une route qui reprend le corps tel quel (`...req.body`) ou valide un schéma strict.

`documentTools.ts` : `list_documents` et `read_document` pour le chat (capacité `docsRead`), et
`attach_to` dans un bloc `artifact` pour ranger le fichier généré sur une fiche (seulement un type de
fiche du périmètre d'écriture de l'agent, jeton de la personne). Le MCP garde ses propres versions.

`businessTools.ts` couvre les modules sans route de collection à plat, chacun protégé par un scope
existant (`BUSINESS_TOOL_SCOPES`, aucune migration) : `manage_situations` (scope
`marches_entreprises` : cumul présenté/admis, période déduite, certify/reopen/mark_paid ; il ne
calcule JAMAIS retenue, révision, TVA ni net à payer, et refuse une situation saisie ligne par ligne),
`manage_project_notices` (list/read/write/generate, remplacer un texte rédigé passe par
confirmation, les notices réglementaires restent des brouillons), `manage_consultation` (entreprises
consultées de l'ACT : écrit la consultation ENTIÈRE en ne changeant que `entreprises`, jamais d'envoi
de DCE), `create_invoice_from_note` (scope `invoices`, montants confirmés avant génération) et
`manage_calendar` (scope `meetings` : agenda agrégé réunions + jalons + tâches + Google, création,
déplacement et suppression d'événements Google). Les événements Google passent par
`POST/PATCH/DELETE /api/google-calendar/events` (`server/googleCalendarEvent.ts`, pur et testé :
fuseau Europe/Paris, jour entier à fin exclusive) ; ce sont des événements propres, que
« Synchroniser » (jalons et tâches) ne reprend ni ne supprime. La ressource `invoices` accepte
maintenant les lignes (`items`) et se supprime tant qu'elle est en brouillon (le serveur refuse le
reste) ; le numéro n'est jamais écrit par un agent.

**Réponses d'agent en Markdown** : `client/chatMarkdown.ts` (analyse pure, testée) puis
`ChatMarkdown.tsx` rendent titres, listes, tableaux, gras et liens sans HTML brut. Seuls http(s),
mailto, tel et les chemins relatifs sont des liens ; un lien vers l'application navigue sans recharger.

### Import de notes dans un CR de chantier (agents et MCP)

`import_site_report_notes` (`packages/archioffice-agents/src/server/siteReportNotesTool.ts`) range
des notes déjà structurées dans le BROUILLON d'un CR de chantier : `rubriques` (site_report_notes),
`observations` (rattachées au CR, lot résolu comme `add_site_report_observation`), `decisions` et
`meeting_notes` (ajoutées à la suite du texte existant). L'outil n'interprète rien : l'agent lit
d'abord la source (`read_email`, `read_email_attachment`, `read_document`) et fait le tri. Il suit les
mêmes garde-fous que les autres outils DET : scope `projects`, jeton de la personne (API REST en boucle
locale), jamais sur un CR diffusé, un seul brouillon choisi d'office sinon demande, doublons ignorés
(comparaison sans casse : rejouer un import ne change rien), un lot introuvable ou une ligne refusée
n'arrête pas le reste (`non_importes`, `lots_possibles`). Décisions et notes passent par UN `PUT
/api/reports/:id`, qui réécrit format, intervenants et prochaine réunion depuis le corps : l'outil les
renvoie tels que lus. Exposé au MCP sans code propre : `buildAgentTools(MCP_CAPS)` le reprend.

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

- **Alertes métier** — `server/agentAlerts.ts`. Un cycle (hebdomadaire par défaut,
  `AGENT_ALERTS_INTERVAL_HOURS` pour le changer) relit
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

### Bibliothèque de connaissances des agents

`knowledge_enabled` (`supabase/migrate_agent_knowledge.sql`), une colonne de
plus sur `agents` réglable depuis `/agents/:id/edit`, off par défaut et
jamais héritée d'un template — même traitement que `web_search_enabled`.
Ferme le trou signalé par l'architecte : un agent ne pouvait s'appuyer que
sur `firm_knowledge` (l'historique interne du cabinet) ou sur des documents
joints AU MESSAGE COURANT, jamais sur un document déposé une fois pour
toutes pour lui — une réglementation, un DTU, une notice technique.

**Aucune nouvelle table.** `'agents'` rejoint `ATTACHABLE_RESOURCE_TYPES`
(`server/routes/documents.ts`) : un document de bibliothèque est une ligne
`documents` ordinaire, avec `resource_type = 'agents'` et `resource_id`
l'agent visé. Le dépôt, la liste et la suppression passent par
`<ResourceAttachments resourceType="agents" resourceId={agent.id} />`
(`src/components/ResourceAttachments.tsx`), affiché sur `/agents/:id/edit`
dès que `knowledge_enabled` est coché — le même composant générique que la
fiche permis, sans code dédié.

**Auto-injecté à chaque tour, jamais via un tool.** `buildAgentContext()`
(`packages/archioffice-agents/src/server/context.ts`) lit, quand
`capabilitiesFromAgent(agent).knowledge` est vrai, les documents
`resource_type = 'agents'` de CET agent (`resource_id = currentAgentId`),
en extrait le texte (`extractKnowledgeDocText()` — pdf-parse, mammoth, OCR
en repli sur un PDF scanné ; jamais de vision, une réglementation étant du
texte et non une photo) et les pose dans `ctx.knowledgeDocuments`. Même
principe que `firm_knowledge` : pas de recherche, pas de `tool` que le
modèle appellerait — le contenu est simplement dans le prompt
(`BIBLIOTHÈQUE DE CONNAISSANCES DE CET AGENT`, `systemPrompts.ts`), sous
`docContentsSection`/`firmKnowledgeSection` et donc lu même quand
`system_prompt_override` remplace tout le prompt généré (même raison que
ces deux sections).

**Plafonné pour rester un coût de jetons prévisible, pas un RAG.**
`MAX_KNOWLEDGE_DOCS` (10 documents) et `MAX_KNOWLEDGE_DOC_CHARS` (6000
caractères, tronqué au-delà) bornent ce qui part dans CHAQUE tour de CHAQUE
conversation avec cet agent — volontairement pensé pour des pièces courtes
à moyennes (notices, extraits de DTU), pas pour un corpus réglementaire de
plusieurs centaines de pages : ce dépôt n'a pas de recherche par mots-clés
ni d'embeddings, tout document déposé est relu en entier. `/agents/:id/edit`
le dit explicitement dans le texte d'aide du réglage.

### Apprentissage des agents : proposer, jamais appliquer

Un agent qui se voyait corrigé, ou qui butait sur une capacité qu'il n'avait
pas, n'avait aucun moyen de le retenir au-delà de la conversation en cours —
au tour suivant, il repartait de zéro. `learning_enabled`
(`supabase/migrate_agent_learning.sql`), une colonne de plus sur `agents`
réglable depuis `/agents/:id/edit`, off par défaut et jamais héritée d'un
template (même traitement que `knowledge_enabled`), donne accès à l'outil
`suggerer_amelioration(kind, titre, contenu, capacite_suggeree?)`
(`packages/archioffice-agents/src/server/learningTools.ts`).

**Trois natures de proposition**, jamais appliquées seules — même principe
que `needs_confirmation` sur `create_record` : mémoriser une correction,
signaler une capacité manquante ou rédiger une note change durablement le
comportement d'un agent, ça se confirme, ça ne se déduit jamais.

- `correction` — l'utilisateur vient de corriger une réponse ou une
  hypothèse de l'agent.
- `missing_capability` — l'agent n'a pas pu répondre correctement faute d'un
  outil ou d'un accès qu'il n'a pas ; `capacite_suggeree` nomme la colonne
  concernée (`mail_enabled`, `geo_enabled`...) pour que l'écran de revue
  pointe directement vers `/agents/:id/edit`.
- `knowledge_note` — l'agent propose lui-même une note pour sa mémoire (une
  règle ou une préférence du cabinet apprise en tâche).

**Retours de l'utilisateur depuis le chat** (`supabase/migrate_agent_learning_feedback_kinds.sql`).
Sous chaque réponse d'un agent qui a `learning_enabled`, trois boutons ouvrent
`FeedbackModal` (`AgentChat.tsx`) : `correction` (corriger une erreur), `note`
(un fait à retenir) et `improvement` (une amélioration à apporter). Ils déposent
une proposition `pending` par le MÊME `POST /api/agent-learning-suggestions` que
l'outil (`as_agent_id` revalidé, `learning_enabled` exigé) : une seule file, un
seul écran de revue, aucune seconde route. Les boutons n'apparaissent pas pour un
agent qui n'apprend pas ; l'envoi est confirmé par un message qui rappelle que la
proposition attend la validation d'un administrateur. Une instance qui avait joué
l'ancienne migration porte l'ancienne contrainte sur `kind` : la migration
complémentaire la remplace.

**Seul un administrateur valide.** `PUT /api/agent-learning-suggestions/:id` passe par
`requireRole('admin')`, injecté en dernier paramètre de `registerAgentRoutes` (comme
pour les missions et le RAG) ; sans garde injectée la route répond 403 plutôt que de
s'ouvrir. N'importe quel membre peut en revanche DÉPOSER une proposition : elle reste
`pending` et n'atteint le prompt qu'une fois approuvée. L'écran `/agents/apprentissage`
masque les boutons de validation aux autres rôles
(`tests/agentLearningGuard.test.ts`).

**Une file d'attente, pas une écriture définitive.** L'outil dépose la
proposition dans `agent_learning_suggestions`, statut `pending` — jamais dans
`documents` ni dans le prompt. L'architecte la revoit depuis
`/agents/apprentissage` (`AgentLearning.tsx`) et l'approuve ou la rejette
(`PUT /api/agent-learning-suggestions/:id`) ; `POST` (appelé par l'outil,
`as_agent_id`) revalide l'agent comme `POST /api/feed/posts` revalide
`as_agent_id` — introuvable, inactif ou sans `learning_enabled` est refusé.
Une proposition déjà traitée ne peut pas être retraitée (409).

**Seule une proposition *approuvée* devient mémoire, et jamais pour
`missing_capability`.** `buildAgentContext()` (`context.ts`) relit,
quand `learningEnabled` est vrai, les lignes `agent_learning_suggestions` de
CET agent au statut `approved` de ces natures (`correction`, `note`, `improvement`,
`knowledge_note`), dans
`ctx.learningNotes` — auto-injecté à chaque tour comme
`knowledgeDocuments`, jamais via un `tool`, jamais tant que le statut reste
`pending` (`MÉMOIRE D'APPRENTISSAGE`, `systemPrompts.ts`, plafonné à
`MAX_LEARNING_NOTES`/`MAX_LEARNING_NOTE_CHARS` — du texte court déjà en base,
pas un document à extraire). Une proposition `missing_capability` approuvée
ne déclenche RIEN d'automatique côté agent : approuver documente seulement
que l'architecte a vu la demande, activer la capacité reste un geste
volontaire distinct depuis `/agents/:id/edit` — jamais l'écran de revue lui-
même.

### Pièce jointe illisible : jamais passée sous silence

Incident du 12 octobre 2026 : un `.xls` de suivi de réserves (Stenay) joint au chat de Sophie n'avait
aucun extracteur, `buildAgentContext` l'écartait sans rien dire, et le modèle, qui savait qu'un fichier
était joint, en a inventé le contenu (cinq « réserves AOR » d'un autre projet) puis a créé des tâches
dessus. Trois garde-fous, à ne pas défaire :

- **Les tableurs sont lus** (`spreadsheetText.ts` : `.xls`, `.xlsx`, `.xlsm`, `.ods`, un bloc par onglet,
  noms d'onglets en tête, troncature annoncée), dans le chat (`context.ts`) comme dans
  `extractDocumentText` (outils MCP, pièces jointes de mail).
- **Un document joint non lu est TOUJOURS signalé** : `markUnread()` (`context.ts`) pose « CONTENU NON LU »
  dans `documentContents` pour un fichier introuvable, un format non pris en charge, un fichier vide,
  une erreur de lecture ou un délai dépassé. Plus aucun `return` muet dans cette boucle.
- **Règle de prompt** (`systemPrompts.ts`, `docContentsSection`, valable même avec
  `system_prompt_override`) : seul le contenu présent entre les repères existe, un onglet ou une ligne
  absents se disent, et on cite les lignes exactes reprises avant toute création d'enregistrement.

### Pas de création sans source (tous les agents)

Le prompt seul n'arrête pas un modèle qui hallucine : le contrôle est fait par le SERVEUR
(`packages/archioffice-agents/src/server/provenance.ts`, `tests/provenance.test.ts`). `create_record`,
`create_site_report`, `add_site_report_observation` et `import_site_report_notes` exigent
`source: { type, citation }` ; `executeAgentAction` refuse la création (`SOURCE_NON_VERIFIEE`, avant tout
appel réseau) si la citation (12 caractères utiles au moins) ne figure pas, hors casse, accents et
ponctuation, dans le `SourceCorpus` du tour : messages de la PERSONNE (historique compris), contenu des
documents joints lus, résultats des outils de LECTURE. Exclus : les messages de l'agent lui-même, les
résultats d'outils d'écriture et `consulter_agent`, pour qu'une invention ne puisse pas se citer.

Limites assumées : une image jointe ne se vérifie pas par texte (`image_jointe` accepté tant qu'une image
est jointe) ; une citation exacte prouve que la source existe, pas que l'enregistrement la reprend
fidèlement ; la liaison MCP (conversation hors de ce serveur) n'est pas contrôlée ; `update_record` n'est
pas couvert. La règle est aussi posée dans le prompt (`SOURCE_RULE`), même sous `system_prompt_override`.

### Lecture des pièces jointes de messagerie par les agents

`read_email` (`mail_enabled`) rapportait déjà les pièces jointes d'un
message (nom, taille) mais aucun outil ne pouvait en ouvrir le contenu : un
agent qui avait identifié le bon email (« envoie des documents Blénod-lès-
Pont-à-Mousson ») restait incapable d'exploiter le plan, le diagnostic ou
l'esquisse qui y était joint, faute de tout accès à ces octets — il ne
pouvait que le dire à l'utilisateur, comme cité dans l'incident qui a motivé
cette capacité.

**`mail_attachments_enabled`** (`supabase/migrate_agent_mail_attachments.sql`),
une colonne de plus sur `agents` réglable depuis `/agents/:id/edit`, est un
palier distinct de `mail_enabled` — même principe que `mail_send_enabled`/
`docs_write_enabled` : `capabilitiesFromAgent()` exige les deux
(`mail_enabled` ET `mail_attachments_enabled`), off par défaut et jamais
hérité d'un template. Ouvrir une pièce jointe télécharge des octets
externes et peut déclencher un OCR — plus coûteux qu'une simple lecture de
corps de message — et mérite d'être activé sciemment plutôt qu'allumé
d'office avec la lecture de la boîte.

**`read_email_attachment(id, attachment_id, compte?)`**
(`packages/archioffice-agents/src/server/mailAttachmentTools.ts`) prend le
relais de `read_email`, qui rapporte désormais `attachments[].id` et
`.mimeType` en plus du nom et de la taille (`mailTools.ts`) — sans eux, un
agent qui avait lu un message n'avait aucun moyen de désigner laquelle de
ses pièces jointes ouvrir. Le téléchargement passe par les mêmes routes
internes que l'ouverture d'une pièce jointe côté écran
(`GET /api/gmail/messages/:id/attachments/:attachmentId`,
`.../outlook/...`, `.../mail/imap/messages/:folder/:uid/attachments/:id`) :
aucune nouvelle route serveur n'a été ajoutée, seul un nouvel appelant
interne s'en sert.

**Texte seul, jamais de vision native.** `ctx.documentImages` (vision, voir
plus haut) n'est peuplé qu'AVANT le premier appel au modèle, à partir des
documents joints AU MESSAGE — un résultat d'outil obtenu EN COURS de tour
n'a aujourd'hui aucun moyen d'y ajouter une image. Une pièce jointe scannée
ou photographiée retombe donc sur l'OCR texte (`ocrDocument`, `ocr.ts`),
exactement comme un fournisseur sans vision dans `context.ts` : dégradé,
mais honnête, plutôt qu'un tool qui prétendrait lire une image qu'il ne
transmet pas réellement au modèle. Une pièce jointe trop volumineuse
(20 Mo) est refusée avant tout téléchargement plutôt que de faire échouer
l'extraction après coup, et le contenu extrait est plafonné à 20 000
caractères (`MAX_EXTRACTED_TEXT_CHARS`,
`packages/archioffice-agents/src/server/documentTextExtraction.ts`) — assez
pour un devis ou une notice de plusieurs pages, sans devenir un corpus à
parcourir. L'extraction elle-même (`extractDocumentText`, PDF/DOCX/texte
brut avec repli OCR) vit dans ce module partagé, réutilisé tel quel par
`read_document` ci-dessous : même geste, une seule implémentation.

**Exposée au MCP, avec un pont vers les fiches du cabinet.** Un cas réel l'a
révélé : un email « 71 BLANDAN Devis signe » avec deux PDF en pièces
jointes, retrouvé par `search_emails`, mais impossible à lire ni à rattacher
à l'affaire depuis le connecteur MCP — `read_email_attachment` existait déjà
côté chat interne, mais `MCP_CAPS.mailAttachments`
(`packages/archioffice-agents/src/server/mcp/tools.ts`) était à `false`.
Il est passé à `true` : `read_email_attachment` rejoint `MCP_TOOLS` via
`buildAgentTools()`, sans route ni outil supplémentaire à écrire. Deux
outils MCP écrits à la main complètent le pont :

- **`import_email_attachment(id, attachment_ids | attachment_id, resource,
  resource_id, category?, description?, compte?, force?)`** dépose une ou
  plusieurs pièces jointes d'un email déjà lu directement sur une fiche du
  cabinet — réutilise `getFullMessage`/`downloadAttachmentBytes`
  (`mailAttachmentTools.ts`, désormais exportées) côté lecture et
  `depositDocument` (factorisé hors d'`upload_document`, même `POST
  /api/documents`) côté écriture. Le fichier ne transite jamais en base64
  par le modèle : il va de la messagerie au stockage sans détour. Un
  doublon (même nom, même taille déjà présents sur la fiche) est refusé et
  signalé plutôt que déposé en double, sauf `force: true`.
- **`read_document(resource, resource_id, document_id)`** lit le texte d'une
  pièce déjà attachée à une fiche (import ci-dessus, ou tout document
  existant) avec les mêmes extracteurs et la même limite que
  `read_email_attachment` — préférable à `get_document` (qui renvoie du
  base64 que le modèle ne peut pas lire) pour analyser un PDF ou un DOCX.

### Recherche IMAP : objet ET corps, pas le corps seul

`GET /api/mail/imap/search` (`server/routes/imapMailSync.ts`) posait le
paramètre libre `q` sur le critère IMAP `body` : un mot présent uniquement
dans l'objet d'un message (« Blandan » dans « 71 BLANDAN Devis signe »)
n'était donc jamais trouvé par `search_emails query="Blandan"`, alors que
`subject="Blandan"` le trouvait — un comportement qui ne correspondait à
aucune des deux autres messageries (le `q` libre de Gmail matche déjà
objet + corps + le reste, tout comme `$search` chez Outlook/Graph).
`buildImapSearchCriteria()`, extraite en fonction pure et testable sans
serveur IMAP (`tests/imapSearchCriteria.test.ts`), pose désormais `q` sur
`text` (IMAP SEARCH TEXT, RFC 3501) — qui couvre les en-têtes, objet compris,
ET le corps — au lieu de `body`.

### Courrier entrant : transfert d'un email vers un agent

Jusqu'ici, aucun mécanisme de réception de mail n'existait dans
ArchiOffice : le SMTP configuré (`settings.smtp_*`) est strictement
sortant, et les connecteurs Gmail/Outlook/IMAP ne font que du pull à la
demande sur la boîte d'UN utilisateur humain (`email_connections`,
`user_id NOT NULL`). `server/agentMailInbox.ts` relève désormais
périodiquement une boîte IMAP **partagée**, propriété de la plateforme et
non d'un utilisateur, pour qu'un email transféré à un alias dédié soit pris
en charge par un agent — sans nouveau prestataire webhook, en réutilisant
l'infrastructure IMAP déjà écrite (`ImapFlow`,
`server/mailFullMessage.ts`).

**Un seul alias par cabinet, un agent de triage désigné.** Pas d'alias par
agent : `settings.mail_triage_agent_id`
(`supabase/migrate_agent_mail_inbox.sql`) fixe, par cabinet, quel agent
traite tout ce qui arrive à son alias — réglable depuis `/settings`
(`AgentMailInboxCard.tsx`), avec la même vérification d'appartenance au
tenant que le reste des références inter-ressources de cette table
(`assertTenantEntity`, voir « Références inter-locataires non validées »).
L'alias lui-même se déduit de `tenants.slug` (le seul identifiant
réellement unique sur toute l'instance — `agents.slug` ne l'est que par
cabinet) : `agents+<slug-cabinet>@<domaine>` (`buildMailInboxAlias()`),
affiché dans la même carte.

**Le domaine se règle par cabinet, pas par l'instance.**
`settings.mail_inbox_domain` (`supabase/migrate_mail_inbox_domain.sql`) est saisi
par un administrateur dans la carte « Courrier entrant » (`/settings` > Agents IA),
normalisé et validé côté serveur (`normalizeMailInboxDomain`, 400 si ce n'est pas
un nom de domaine). Vide, il retombe sur `AGENT_MAIL_INBOX_ALIAS_DOMAIN`
(simple repli d'instance, facultatif), sinon la carte affiche un champ à
remplir et pas d'alias. `GET /api/settings` rend aussi `mailInboxAvailable`
(boîte IMAP partagée configurée) pour avertir qu'un domaine saisi ne relève
rien tant que l'opérateur n'a pas branché la boîte. Le routage ne lit que le
slug du `To` : le domaine ne sert qu'à composer l'adresse, c'est au
cabinet de le faire aboutir (MX ou redirection) vers la boîte partagée.

**Prérequis hors code, à ne jamais perdre de vue.** Cette adresse ne
fonctionne que si l'opérateur a réellement provisionné une boîte mail
(ex. chez Infomaniak) qui reçoit tous les sous-adressages `+` dans une
seule boîte IMAP (ou un alias/catch-all redirigé vers elle), avec un
enregistrement MX pointant dessus pour le domaine choisi. Ni le DNS ni la
création de la boîte ne sont du ressort de l'application — seuls les
identifiants IMAP de cette boîte partagée sont configurés côté serveur
(`AGENT_MAIL_INBOX_HOST/PORT/USERNAME/PASSWORD`, comme `SMTP_*`). Le job
reste inactif tant que ces variables manquent, comme le Web Push sans clés
VAPID : rien d'autre ne casse (`isMailInboxConfigured()`).

**Jamais d'action sans expéditeur reconnu.** L'en-tête `From` d'un
transfert n'est pas fiable (falsifiable), donc `processMessage()` ne se
contente pas de le lire : il cherche un `profiles.email` correspondant PUIS
vérifie son appartenance à CE cabinet (`findMembership()`,
`server/tenantMemberships.ts` — pas seulement `profiles.tenant_id` par
défaut, pour couvrir un architecte qui exerce dans plusieurs cabinets, voir
« Plusieurs cabinets pour une même personne »). Sans correspondance, le
message est ignoré silencieusement côté utilisateur (seulement loggé côté
serveur) — jamais d'action, même en lecture seule, pour un expéditeur non
reconnu.

**Le pont d'authentification `mail_at_`.** Traiter l'email avec les VRAIS
droits de la personne reconnue (`create_record`, écriture DPGF... selon ses
capacités) veut dire rejouer `POST /api/agents/:id/chat` en entier —
facturation réserve/règle, boucle d'outils, persistance de conversation —
pas réinventer une exécution parallèle. Mais ce point d'entrée exige un
`Authorization` Bearer validé comme un JWT Supabase, et le poller ne parle
à personne de vivant. `server/agentMailRelayTokens.ts` ajoute un troisième
préfixe reconnu par le middleware `/api` de `server.ts`, à côté des jetons
`mcp_at_` et `tg_at_` déjà dispatchés là : `mail_at_`, résolu par une
nouvelle table `agent_mail_relay_tokens`. Contrairement aux deux autres
(liaisons persistantes, révocables mais valables tant qu'elles ne le sont
pas), un jeton `mail_at_` ne vit que le temps d'UN appel — émis juste avant
de rappeler l'API interne, marqué consommé dès sa résolution (`used_at`),
expiré au bout de 5 minutes s'il n'a pas servi.

**Idempotence.** `agent_mail_inbox_processed(message_id_header, tenant_id,
processed_at)` protège contre un double traitement si le flag `\Seen` ne
tient pas ou si deux relevés se chevauchent — même prudence que
`article_prix_observations.source_ref` pour la remontée de prix BPU. Un
message est marqué `\Seen` dans tous les cas à la fin de son traitement, y
compris un échec (agent introuvable, appel interne en erreur) : un message
illisible ne doit pas être retraité indéfiniment à chaque relevé plutôt que
de bloquer les suivants.

**Corps et pièces jointes.** Le texte envoyé à l'agent réutilise
`extractDocumentText` (`packages/archioffice-agents/src/server/
documentTextExtraction.ts`, déjà écrit pour `read_email_attachment`/
`read_document`) pour chaque pièce jointe — aucune nouvelle logique
d'extraction — avec la même mise en garde que `read_email` : contenu
externe non fiable, jamais des instructions. Plafonné à
`MAX_ATTACHMENTS_PER_MESSAGE` (5) et `MAX_ATTACHMENT_BYTES` (20 Mo, même
plafond que `read_email_attachment`) pour qu'un transfert pathologique ne
bloque jamais tout un relevé.

**Restitution.** L'échange apparaît dans la conversation de l'agent de
triage comme un tour de chat normal (`agent_conversations`/
`agent_messages`, via la route existante) — pas de réponse email dans
cette première version. `notifyUsers()` (`server/push.ts`) prévient
seulement la personne reconnue qu'un email transféré a été traité, avec un
lien direct vers cette conversation.

### Revue matinale des mails par un agent

Chaque matin, l'agent choisi par la personne (Sophie) relit SA boîte, repère les
mails qui attendent une réponse et lui envoie une notification push par mail,
avec une proposition de réponse. Réglage personnel et non par cabinet (une boîte
mail l'est) : `agent_mail_reviews`, une ligne par couple cabinet x personne
(`supabase/migrate_agent_mail_review.sql`), réglée depuis `/settings`
(`AgentMailReviewCard.tsx`, avec « Lancer maintenant » et la dernière revue).

**Un job dédié, pas une exécution planifiée d'agent** : `scheduler.ts` est sans
outil, faute de jeton utilisateur hors session. `server/agentMailReview.ts` lit
les boîtes par la boucle locale (`executeMailTool`, `list_emails` puis
`read_email`) avec un jeton `mail_at_` de la personne, donc avec ses seuls droits.
Le modèle n'a aucun outil et rien n'est jamais ENVOYÉ : un mail piégé ne peut
produire qu'un texte de proposition. Seule écriture dans la boîte : chaque
proposition est enregistrée en BROUILLON (`create_draft`, jeton `mail_at_` propre
aux brouillons, `createReplyDrafts`) dans la boîte où le mail est arrivé, adressé
à l'expéditeur, objet « Re: ». Ce n'est pas une réponse dans le fil (nouveau
message). Meilleur effort : un brouillon qui échoue ne prive pas du push, il en
retire seulement la mention « Brouillon enregistré. ». Limite de débit de la route
de brouillons : 30 par 15 minutes et par personne, partagée avec ses envois.

- **Un seul appel au modèle** pour toute la revue (mails numérotés, sortie JSON
  `{"mails":[{n, reponse_attendue, urgence, raison, proposition}]}`), rattachée
  aux messages par leur numéro et non par un identifiant que le modèle recopierait.
- **Heure locale** (`hour_local` + `timezone`, 8 h Paris par défaut), pas une
  heure UTC : 8 h reste 8 h au passage à l'heure d'été. Lun-ven par défaut ; la
  fenêtre relue court depuis la dernière revue (20 à 72 h), donc le lundi couvre
  le week-end.
- **Écartés avant le modèle** : ses propres envois, les expéditeurs automatiques
  (`noreply`, newsletters...), le trop ancien. L'agent doit avoir `mail_enabled`.
- **Notifications** : une par mail (tag distinct, catégorie « Alertes IA » donc
  coupable depuis les préférences), plus une de synthèse au-delà d'un mail. Rien
  quand aucun mail n'attend de réponse. Lien vers `/mailbox`.
- **Échéance réservée avant la lecture** (mise à jour conditionnelle de
  `next_run_at`) : une revue longue ou un second processus ne la rejoue pas. Une
  revue manuelle ne déplace jamais l'échéance du matin (limitée à une toutes les
  2 minutes). Sans crédit IA, la revue est sautée comme une exécution planifiée.
- **Jeton de relais multi-usage** : `issueMailRelayToken(..., { maxUses })`. Le
  jeton ordinaire reste à usage unique ; `max_uses`/`use_count` ne sont écrites
  que pour une revue (qui rappelle l'API une cinquantaine de fois en quelques
  secondes), avec décompte conditionnel. Durée de vie inchangée : 5 minutes.

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

### Recherche web des agents

`web_search_enabled` (`supabase/migrate_agent_web_search.sql`), une colonne de
plus sur `agents` réglable depuis `/agents/:id/edit`, off par défaut et jamais
héritée d'un template (même traitement que `web_fetch_enabled`). Contrairement
à `fetch_url` ou aux outils cartographiques, ce n'est PAS une déclaration de
fonction que `buildAgentTools()` ajoute et qu'`executeAgentAction()` exécute :
c'est le tool NATIF de recherche web du fournisseur IA actif du cabinet —
`google_search` chez Gemini, `web_search_20250305` chez Claude — exécuté côté
fournisseur. Ni Gemini ni Claude ne renvoient d'appel d'outil à notre charge
pour ça ; ils rendent directement une réponse déjà sourcée.

`LlmProvider.supportsWebSearch` (`llm/types.ts`) dit si le fournisseur actif
sait le faire ; `routes.ts` calcule `webSearchActive = caps.webSearch &&
!!provider.supportsWebSearch` une fois par requête et le passe à la fois à
`provider.chat({ ..., webSearch })` et à `buildAgentSystemPrompt()`, pour que
le prompt ne promette jamais une capacité que le tour n'aura pas.

**Mistral n'est pas de la partie.** `web_search`/`web_search_premium` de
Mistral n'existent que via son API Conversations (`/v1/conversations`) — sa
propre documentation précise que Chat Completions, l'endpoint que
`mistral.ts` appelle, ne les supporte pas : la réponse de Chat Completions ne
porte pas les références de résultat de recherche que ces tools renvoient.
`mistral.ts` ne déclare donc pas `supportsWebSearch`, et la capacité reste
sans effet — dégradé, mais honnête, plutôt qu'un réglage qui échouerait
silencieusement ou ferait échouer l'appel API — tant qu'un cabinet fait
tourner ses agents sur Mistral plutôt que sur Gemini ou Claude.

### Modèles de projet : une trame d'affaire, pas un préremplissage

Un modèle (`project_templates`, `/templates`) ne se limitait à quatre valeurs
de formulaire (nom, statut, budget, description) : il ne créait ni lots, ni
jalons, ni tâches, donc rien de ce qu'il faut réellement ressaisir à chaque
affaire. `supabase/migrate_project_templates_structure.sql` lui ajoute
`operation_type` (`neuf`, `rehabilitation`, `extension`, `maison_individuelle`,
`permis_seul`, `autre`), `marche_type` (`prive`, `public`), trois listes jsonb
(`default_lots`, `default_milestones`, `default_tasks`) et `catalog_key`.

**Application : `POST /api/projects` reçoit `template_id`, rien d'autre.**
`server/projectTemplateApply.ts` relit le modèle en base (vérifié dans le
cabinet, 400 sinon) et crée lots, jalons et tâches APRÈS l'affaire, en
meilleur effort : un échec est rapporté dans `template_applied.failed`, jamais
au prix de l'affaire déjà créée. Un modèle `public` pose `is_public_client`,
et `type_projet` se déduit du type d'opération quand le corps n'en porte pas.
Le client ne fait que désigner le modèle : il ne peut pas faire écrire autre
chose que ce que le cabinet a enregistré.

**Délais relatifs, jamais de dates.** Jalons et tâches portent des décalages en
jours depuis `start_date` (`addDaysIso`, `src/lib/projectTemplates.ts`). Les
listes sont assainies à l'écriture (`sanitizeLots/Milestones/Tasks`,
`server/routes/projectTemplates.ts`) : bornées, typées, priorités filtrées.

**Trois origines.** Saisi à la main ; installé depuis le catalogue de démarrage
(`server/projectTemplateCatalog.ts`, huit trames : neuf, réhabilitation,
extension en privé et en public, maison individuelle, permis de construire
seul) ; ou tiré d'une affaire (`POST /api/project-templates/from-project/:id`,
lots, jalons et tâches en décalages, sans montants). `catalog_key` sous index
unique partiel `(tenant_id, catalog_key)` empêche d'installer deux fois la même
entrée, sans dépendre du nom que le cabinet a pu changer. Le catalogue n'est
qu'une copie de départ : une fois installé, le modèle appartient au cabinet.

**À ne pas défaire.** Les jalons du catalogue portent des intitulés
d'événements (« Dépôt du permis », « Réception des travaux »), jamais le nom
d'une mission du contrat MOE (« Esquisse (ESQ) ») : `ProjectDetail.tsx` crée un
jalon par mission incluse et apparie par titre, un doublon de nom serait fusionné
avec lui (verrouillé par un test). Le public diffère du privé par la procédure
de passation (publication de l'avis, commission d'analyse, notification) et non
par le fond des lots. Les délais d'instruction d'un permis suivent le Code de
l'urbanisme (1 mois DP, 2 mois PC de maison individuelle, 3 mois les autres).

**Les missions MOE suivent le modèle jusque dans les contrats et les
propositions** (`default_missions`, jsonb, `supabase/migrate_project_templates_missions.sql`).
La liste a la forme de `contrats_moe.missions_list` (id, name, pct, incluse,
category) : un contrat MOE la reprend TELLE QUELLE (`contratDefaultsFromTemplate`,
`src/lib/projectTemplates.ts`, avec le type de contrat et le type de maître
d'ouvrage), et une proposition la CONVERTIT en répartition d'honoraires
(`feeDistributionFromTemplate`). Deux conversions à ne pas défaire :

- **Base ET exécution partent sous « Mission base »** dans la proposition : c'est
  la seule catégorie dont le montant suit le total des honoraires (effet de
  synchronisation de `Proposals.tsx`), et c'est déjà ce que fait la répartition
  par défaut des propositions. Seules les missions complémentaires restent à
  part, à chiffrer à la main. L'id `pro` devient `projet`, comme dans
  `feeDistribution.ts`.
- **Un modèle n'invente pas de type de contrat** : extension et maison
  individuelle sont des constructions neuves au contrat, un permis seul aussi
  (c'est sa répartition, esquisse + avant-projet + dossier de permis, qui en
  porte la portée réelle).

La synchronisation de `Proposals.tsx` lit désormais le `default_pct` propre à la
mission avant celui de `DEFAULT_MISSIONS` : sans cela, une mission hors MOP
(diagnostic, dossier de permis) retombait sur une part égale. Le sélecteur de
modèle n'apparaît qu'à la CRÉATION d'un contrat ou d'une proposition, jamais sur
un document existant : le choisir remplace sa répartition. Un modèle tiré d'une
affaire reprend les missions de son contrat MOE principal.

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

**Un article peut concerner un ou plusieurs bâtiments**
(`src/lib/batimentsArticles.ts`, testé dans `tests/batimentsArticles.test.ts`) :
un bardage vertical pour le préau ET le bâtiment A, un bardage horizontal pour
le seul bâtiment A. L'article porte alors `quantitesBatiments` (une quantité
par bâtiment coché) ; sa quantité DPGF en est la somme et son montant la somme
× P.U. Sans `quantitesBatiments`, l'ancien régime vaut toujours : un seul
bâtiment par `batimentId`, hérité du chapitre puis du lot ; `batimentId: ''`
veut dire « aucun bâtiment », sans héritage.

- **Saisie** : dans le DPGF, une colonne « Bâtiments » (liste à cases à cocher,
  `ToolbarMenu` avec `keepOpen` et l'état « mixed ») puis une colonne de
  quantité par bâtiment et la quantité totale. Sur une ligne de lot, de
  chapitre ou d'article à sous-articles, la liste coche ou décoche le bâtiment
  sur tous les articles qu'elle contient. La barre de sélection a la même liste
  pour plusieurs articles à la fois (`basculerBatimentEnMasse`). Le CCTP
  l'offre aussi dans la fiche de l'élément sélectionné.
- **Cocher** garde les quantités déjà saisies ; un nouveau bâtiment part à 0,
  sauf si l'article n'en avait aucun : sa quantité va alors au premier coché.
  Tout décocher rend une quantité simple, sans bâtiment.
- **Export du CCTP** (`src/lib/cctpExport.ts`, menu Exporter de l'onglet CCTP,
  PDF et Word à la charte, **jamais de quantité ni de prix**) : l'opération
  complète, où chaque article dit « Bâtiments concernés : … », ou un CCTP par
  bâtiment (`cctpPourBatiment`) qui ne garde que ses articles. Dans ce dernier,
  un chapitre sans article (généralités) et un texte propre au CCTP sans
  bâtiment valent pour tous ; un article chiffrable sans bâtiment n'entre dans
  aucun, et l'export par bâtiment le signale.
- **Un seul bouton « Exporter » pour tout le dossier PRO** (barre des sous-onglets de
  `ProTab`, `ProExportDialog.tsx`) ; les menus d'export du CCTP, du DPGF, du BPU/DQE et
  de l'estimation sont supprimés. La fenêtre choisit les documents (CCTP, DPGF, DQE, BPU,
  avec raccourcis « CCTP seul », « CCTP + DPGF », « Dossier de consultation »), un format
  par document (PDF, Word ou Excel, ou les deux), le périmètre (tout, ou lots, bâtiments et
  phases) et l'option « Inclure les prix », **décochée par défaut** : DPGF, DQE et BPU sortent
  alors sans P.U., montant ni total (le bordereau est « vierge »). L'**estimation** est à part
  (« document interne ») et porte toujours ses prix. Orchestration dans
  `src/lib/exportDossier.ts` (`produireDossier`), qui donne à chaque exporteur une `Sortie`
  (`exportSortie.ts`) collectant les fichiers au lieu de les télécharger ; `livrer()` envoie un
  fichier tel quel, **plusieurs dans un ZIP** (jszip). Sans `sortie`, les exporteurs
  téléchargent comme avant.
- **Périmètre commun** (`src/lib/exportPerimetre.ts`, testé) : lots désignés par leur
  NUMÉRO, bâtiments et phases par leur CODE, car le CCTP/DPGF et le bordereau ont chacun
  leur registre aux identifiants distincts. Un critère de bâtiment ou de phase est ignoré par
  un document qui n'a pas activé ce découpage. Pour le CCTP (`{ cctp: true }`), les textes
  réservés au CCTP et les chapitres sans article sont gardés, et une sélection de bâtiments
  produit **un CCTP par bâtiment retenu** (`cctpPourBatiment`) ; la case « un fichier par
  bâtiment » le fait aussi sans sélection. Un document sans article dans le périmètre est
  ignoré avec un avertissement. Le BPU Excel garde ses intitulés, références et feuille
  `_meta` (aller-retour de l'import), prix vides comme avant (`vierge`).

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

### Localisations et illustrations des articles de CCTP

Deux aides de la fiche d'un article (`CCTPEditor.tsx`), qui s'enrichissent à mesure
qu'on renseigne le document, sans migration (tout vit dans le jsonb du DPGF) :

- **Localisation** : le champ reste du texte libre, mais propose les localisations déjà
  saisies dans tout le document (`localisationsConnues`, `src/lib/cctpImages.ts`, testé :
  les plus fréquentes d'abord, casse et espaces fusionnés, sous-articles compris), par un
  `<datalist>`. Plus on en saisit, plus la liste est riche.
- **Illustrations** : `Ligne.images` (`ImageArticle` : `documentId`, `fileUrl`, `legende`).
  Chaque image est réduite côté navigateur (JPEG, 1600 px) puis déposée comme document de
  l'affaire, catégorie « CCTP - illustrations » (`cctpImagesUpload.ts`, `POST /api/documents`) ;
  l'article n'en garde que la référence, lue par `SignedImage`. La légende d'une nouvelle image
  reprend la localisation de l'article. Retirer une image la détache de l'article **sans
  supprimer le document** : une duplication d'article partage la même référence, la supprimer
  casserait la copie. Les exports PDF et Word du CCTP (`cctpExport.ts`) impriment les images
  sous le texte de l'article, avec leur légende, y compris dans l'export par bâtiment ;
  `planRender` (pdf.js) n'est chargé que si une image existe.

### Le CCTP n'est pas un document séparé

Le codebase a longtemps porté trois chemins parallèles pour le CCTP, dont
deux morts ou cassés :

1. **Le vrai** : `CCTPEditor.tsx` édite le même arbre que le DPGF
   (`lots > chapitres > lignes`, `GET/POST /api/projects/:projectId/dpgf`,
   `server/routes/dpgf.ts`) — chaque lot, chapitre et article porte un champ
   `cctpDescription` (le texte technique) et un booléen `cctpOnly` (masqué du
   DPGF). C'est la seule table réellement écrite en production.
2. **Une table `cctps` séparée**, avec sa propre route
   `GET/POST /api/projects/:projectId/cctp` (`server/routes/cctps.ts`, aussi
   `PUT/DELETE /api/cctps/:id`, colonnes qui n'existaient même pas sur la
   table) et son propre hook frontend (`src/hooks/useCCTP.ts`,
   `src/types/cctp.ts`) — inutilisé par tout composant en production
   (`CCTPEditor.tsx` ne l'importe pas), sauf UN outil d'agent : `read_cctp`
   (`packages/archioffice-agents/src/server/projectDocTools.ts`) lisait
   cette route morte et rapportait donc systématiquement qu'aucun CCTP
   n'existait, quel que soit le projet demandé — un bug utilisateur réel,
   pas seulement du code mort.
3. **L'ancienne table `specifications`** (depuis retirée du système, voir
   plus bas), qui servait de CCTP avant que `/specifications` ne devienne la
   bibliothèque d'ouvrages (voir plus bas) ; `packages/archioffice-agents/
   src/server/context.ts`'s `firmKnowledge` (scope `firm_knowledge`) y
   puisait encore ses `cctpExcerpts` — du contenu qui ne recevait plus
   d'écriture depuis ce changement, donc de plus en plus périmé au fil du
   temps.

**Correction : `read_cctp` lit maintenant la même route que `read_dpgf`**
(`/api/projects/:projectId/dpgf`) et `summarizeCctp()` en extrait le texte
`cctpDescription` au lieu des champs `description`/`prescriptionsTechniques`
d'un type `Article` qui ne correspondait à aucune donnée réelle.
`firmKnowledge.cctpExcerpts` lit désormais `dpgfs` de la même façon (une
fonction dédiée, `extractCctpExcerpt()`, rejoue la même marche que
`summarizeCctp()` en miniature) plutôt que la table `specifications`.

**Le code mort a été supprimé** : `server/routes/cctps.ts` (et son
enregistrement dans `server.ts`), `src/hooks/useCCTP.ts`, `src/types/cctp.ts`,
et le code CCTP inatteignable de `ProjectDetail.tsx`
(`fetchSpecifications`/`handleCreateSpec`, jamais appelés depuis un rendu, et
l'état `specifications`/`isAddingSpec`/`newSpecTitle` qui allait avec).

Les routes historiques ligne-à-ligne `/api/dpgf/:projectId` et `/api/dpgf`
adossées à `dpgf_items` restent temporairement disponibles pour les situations
et marchés existants, mais renvoient les en-têtes HTTP `Deprecation`, `Sunset`,
`Link` et `Warning`. Tout nouveau code doit utiliser le document structuré
`/api/projects/:projectId/dpgf`, seule source du CCTP, de la DPGF et de
l'estimation. La date cible de retrait est le 31 mars 2027.

**La table `cctps` elle-même n'a pas été supprimée**, à dessein : une
instance de production en porte une ligne, écrite par l'ancien hook mort —
la retirer sans savoir si un cabinet compte dessus serait une perte de
données pour gagner une ligne dans `schema.sql`. Elle reste donc dans
`server/syncTables.ts` et `supabase/migrate_add_sync_infra.sql`, vide de
toute route qui l'écrit ou la lit désormais.

**La table `specifications`, elle, a fini par être retirée du système
entier** — route (`server/routes/specifications.ts`), entrée
`AGENT_RESOURCES`, place dans `server/syncTables.ts` et table elle-même
(`supabase/migrate_drop_specifications.sql`) — sur demande explicite de
l'architecte, malgré les quelques lignes qu'elle portait encore : à la
différence de `cctps` ci-dessus, la perte a été assumée plutôt que
préservée par précaution.

### Archivage des affaires

« Terminée » dit où en est l'affaire, « archivée » dit qu'elle est rangée et en lecture seule. Colonnes
`projects.archived_at`, `archived_by`, `archive_reason`, `retention_until`, `settings.archive_retention_years`
(NULL = 10 ans) et journal `project_archive_log` (`supabase/migrate_project_archive.sql`, additive : `archived_at`
NULL = affaire active). Une instance non migrée garde le comportement d'avant : le garde de lecture seule se tait
(`isProjectArchived` vaut faux sur erreur), l'archivage répond 503, le journal se lit vide.

- **Clôture indicative** (`src/lib/projectArchive.ts`, testé) : statut terminé, factures soldées, réserves levées,
  tâches terminées, DOE visé. Un contrôle en alerte n'interdit rien : `POST /api/projects/:id/archive` répond 409
  `CHECKLIST_OVERRIDE_REQUIRED` (avec la liste) tant qu'aucun `override_reason` n'est fourni, puis archive et journalise
  les contrôles passés outre. Un DOE illisible (atelier absent) est « inconnu », jamais « non visé ».
- **Droits** : archiver, administrateurs et managers ; rouvrir (`POST .../unarchive`, motif obligatoire), administrateurs.
- **Lecture seule** : `PUT /api/projects/:id` répond 409 `PROJECT_ARCHIVED`. Les autres routes d'écriture rattachées à
  l'affaire (documents, tâches, factures...) ne sont PAS encore gardées.
- **Conservation** : `retention_until` = date d'archivage + durée du cabinet (10 ans par défaut, 1 à 50). Aucune purge
  automatique.
- **Écran** : `/projects` masque les archivées par défaut (bascule « Archivées ») ; les autres écrans qui lisent
  `GET /api/projects` comme annuaire les reçoivent toujours. `ProjectArchiveControl` (en-tête de la fiche) porte
  l'archivage et la réouverture.
- **Dossier de clôture** (`server/projectClosure.ts`, rendu partagé `src/lib/closureDossierPdf.ts`, charte du cabinet,
  « P1|2 ») : un PDF qui reprend la fiche, l'archivage (date, conservation, motif), les contrôles de clôture, les
  factures avec leur reste à encaisser, les réserves et l'index des pièces conservées (300 au plus, la troncature est
  dite). `GET /api/projects/:id/closure-dossier` (administrateurs et managers : il porte des montants) le produit à la
  demande, 409 tant que l'affaire n'est pas archivée. **À l'archivage il est déposé tout seul, mais seulement si le
  cabinet a un espace externe actif** (`getActiveConnection`) : document `doc_type = 'DOSSIER_CLOTURE'`, catégorie
  « Clôture », rangé sous `<racine>/<code> - <affaire>/Clôture/`. Sans espace externe rien n'est écrit dans Supabase
  (le quota est justement ce que l'espace externe épargne) et la réponse porte `dossier.reason = 'no_external_storage'` ;
  un espace qui ne répond pas donne `deposit_failed` sans défaire l'archivage. Le dossier ne contient pas les fichiers
  eux-mêmes, seulement leur index.
- **Lecture seule complète** (`server/archivedProjectGuard.ts`, monté dans `server.ts` APRÈS l'authentification et AVANT
  toute route) : une écriture (`POST/PUT/PATCH/DELETE`) qui vise une affaire archivée répond 409 `PROJECT_ARCHIVED`. Le garde
  lit le projet dans le chemin (`/projects/:id/...`), dans le corps (`project_id` d'une création) ou dans la ligne visée
  (`TABLES_RATTACHEES` : tâches, documents, factures, réserves, OS, situations, marchés, notes d'honoraires, RFI, réunions,
  permis, plans, avenants, pointage). Exemptés : lecture, `archive` / `unarchive`, création et suppression de l'affaire,
  génération d'un PDF (`.../pdf`). Un envoi multipart (`POST /api/documents`) n'est lisible qu'après `multer` : sa route
  vérifie elle-même. **Toute NOUVELLE table rattachée à une affaire s'ajoute à `TABLES_RATTACHEES`**, sinon ses lignes
  restent modifiables. Un garde qui échoue laisse passer (journalisé) plutôt que de fermer l'application.
- **Affaires archivées hors du suivi** (`server/archivedProjects.ts`) : les alertes métier (`loadTenantSnapshot`) et les
  suggestions IA ne lisent plus leurs lignes (une alerte déjà ouverte se referme au cycle suivant), le planning, le
  tableau de bord et les sélecteurs de pointage non plus. `GET /api/projects` les rend toujours, avec `archived_at` : les
  pages qui s'en servent comme annuaire résolvent encore leur nom.
- **Durée de conservation** : `settings.archive_retention_years` (1 à 50, vide = 10), carte « Archivage » de `/settings`
  (onglet Cabinet). Elle s'applique aux archivages FUTURS : changer la durée ne recalcule pas `retention_until` des
  affaires déjà archivées. Règle d'alerte `conservation_echeance` (`defaultThresholdDays` 90, gravité info, affaires
  archivées dont la fin de conservation est dans le seuil ou dépassée) : elle prévient, **rien n'est jamais purgé seul**.
- **Archivage en masse** (`GET /api/archive/candidates?months=`, `POST /api/archive/bulk`, administrateurs et managers,
  `BulkArchiveDialog.tsx`, bouton « Archiver les terminées » de `/projects`) : les affaires `Completed` dont la date de
  fin remonte à N mois (une affaire terminée SANS date de fin n'est jamais proposée, le nombre en est donné), 50 au plus
  proposées, 25 au plus archivées par appel. Chaque affaire passe par `archiverAffaire` (le même code que l'archivage à
  l'unité : contrôles, motif, journal, dossier de clôture) ; un motif commun couvre celles en alerte, une affaire en
  échec n'arrête pas les autres, et le résultat dit pour chacune `archivee`, `deja_archivee`, `motif_requis`,
  `introuvable` ou `echec`.
- **Pas encore fait** : exclusion des affaires archivées des écrans qui les listent pour une autre raison (calendrier,
  courrier, documents), recalcul de `retention_until` quand la durée change, purge assistée en fin de conservation.

### Pagination et fan-out sur les listes

`GET /api/projects` et `GET /api/invoices` faisaient tous deux la même
chose : joindre, sur CHAQUE ligne de la liste, des données que seul le
projet ou la facture réellement ouverte finit par utiliser. Pour les
projets, `project_cotraitants(*), project_lots(*), project_stakeholders(*),
project_categories_junction(...)` — utilisé nulle part ailleurs que dans la
modale de `Projects.tsx` pour LE projet sélectionné, et pas du tout par
`ProjectDetail.tsx` (qui appelait déjà `/api/projects/:id/full`, lequel
n'incluait pourtant pas ce join — `project.lots_list` y était donc
silencieusement toujours vide malgré tout le code qui le lit, un bug
préexistant corrigé au passage). Pour les factures, `invoice_items(*)` —
utilisé nulle part dans la LISTE elle-même, seulement par
`InvoiceGenerator.tsx` quand on ouvre une facture précise pour la visualiser
ou la générer.

Une vingtaine de pages (Dashboard, Gantt, Documents, TimeTracking, Contacts,
Calendar, Mailbox, ...) n'appellent `GET /api/projects` que comme un
annuaire id→nom : aucune n'avait besoin de ce fan-out, et le payer sur
chaque appel devient réellement coûteux pour un cabinet avec des années
d'archives.

**Le fan-out a migré vers la lecture d'un seul élément** :
`GET /api/projects/:id/full` porte désormais ce même join (mappé sur
`cotraitants_list`/`lots_list`/`stakeholders_list`/`categories_list`,
exactement comme avant sur la liste) ; `GET /api/invoices/:id` (nouvelle
route) porte les `items`. `Projects.tsx`'s `handleProjectClick` et
`Invoices.tsx`'s `handleOpenGenerator` récupèrent désormais ces données à
l'ouverture plutôt que de compter sur ce que la liste avait déjà — la liste
elle-même ne les porte plus du tout.

**Pagination par curseur, opt-in et rétrocompatible.** `limit`/`cursor` sont
des paramètres de requête optionnels sur les deux listes — un curseur opaque
(base64 de `id` pour les projets, faute de colonne de date de création ; de
`created_at` pour les factures, déjà triées dessus). Sans eux, la route rend
exactement le même tableau qu'avant : aucun des nombreux appelants qui ne
paginent pas n'a besoin d'être touché. Un appelant qui passe les deux reçoit
`{ data, nextCursor }` à la place — `nextCursor: null` signale la dernière
page. Aucune page ne consomme encore ce mode (le tri/filtre des listes reste
géré côté client, via `usePagination`) ; c'est le mécanisme qui manquait,
pas encore son adoption dans l'UI.

Tous les autres endpoints de liste (`/api/documents`, `/api/tasks`,
`/api/contacts`, `/api/tenders`, ...) restent non paginés — voir
ROADMAP.md.

**`tests/fakeSupabaseAdmin.ts`'s `.order()`/`.limit()` sont devenus réels**
(triaient et tronquaient auparavant en no-op, voir le commentaire historique
resté dans le fichier) : les deux routes ci-dessus en dépendent pour un
comportement correct, ce qui n'était vrai d'aucune route avant elles parmi
la cinquantaine d'appels à `.order(...)` du codebase.

### `x-user-role` retiré du frontend

Le frontend envoyait encore l'en-tête `x-user-role` sur la sauvegarde et la
suppression d'un projet (`ProjectDetail.tsx`, `Projects.tsx`), alors que le
serveur ne l'a jamais lu : `DELETE /api/projects/:id` est gardé par
`requireRole('admin')`, qui dérive le rôle de `getSystemRole(tenantId,
userId)` côté serveur, jamais d'un en-tête client. L'en-tête était donc un
reliquat sans effet — retiré pour ne pas laisser croire qu'il joue un rôle
de sécurité. `ROADMAP.md`/`API.md` documentaient encore l'ancienne faille
(« x-user-role est fait confiance sans vérification ») ; corrigé au passage,
avec les mentions « pas de rate limiting » et « CORS reflète n'importe quelle
origine », toutes deux également obsolètes (`server/rateLimit.ts` et
l'allow-list CORS de `server.ts` existent déjà).

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

### Connecteur MCP : changer d'agence sans reconnecter

Un architecte qui exerce dans plusieurs structures (AAZS, AACZ) change d'agence depuis le connecteur par trois outils
(`packages/archioffice-agents/src/server/mcp/agencyTools.ts`) : `list_agencies` (seulement les agences dont la personne est
membre, son rôle, l'agence active), `get_active_agency` et `switch_agency` (`agency_id` exact, ou `query` : nom, code court ou
sigle, ex. « AACZ »). Plusieurs correspondances : `needs_clarification` avec les candidats, rien n'est choisi.

- **Persistance** : `mcp_connections.active_tenant_id` (`supabase/migrate_mcp_active_agency.sql`), propre à UNE connexion.
  NULL = jamais changé : la connexion reste sur le cabinet du consentement (`tenant_id`, celui affiché dans l'interface
  web à ce moment), donc les liaisons existantes ne changent pas. Le cabinet affiché dans le navigateur n'est jamais relu.
  Le renouvellement du jeton conserve la sélection. Instance non migrée : `switch_agency` échoue proprement (rien ne change).
- **Droits revérifiés à chaque appel** (`resolveAccessToken`, annuaire `server/mcpAgencyDirectory.ts` sur
  `tenantMemberships.ts`) : la colonne est une préférence, jamais une autorisation. Appartenance perdue : `AGENCY_ACCESS_DENIED`
  sur les outils de données comme sur `/api` (403), sans repli sur une autre agence ; les trois outils d'agence restent utilisables
  pour en sortir. Codes : `AGENCY_UNKNOWN`, `AGENCY_ACCESS_DENIED`, `AGENCY_NOT_SELECTED`, `AGENCY_SWITCH_NOT_CONFIRMED`,
  `AGENCY_MISMATCH`, `AGENCY_CONFIRMATION_REQUIRED`.
- **Une agence stable par appel** (`mcp/dispatch.ts`) : instantané pris au début de l'appel, transmis aux appels internes par
  `X-Tenant-Id` ; le middleware `/api` n'accepte cet en-tête pour un jeton `mcp_at_` que si la personne est membre maintenant.
  Un `switch_agency` en cours d'exécution ne redirige donc pas un appel déjà démarré. Le ticket `create_upload_url` reprend ce même cabinet.
- **Garde-fou `agency_id`** sur chaque outil de données (refus si différent de l'agence active). Une fois qu'une connexion a
  changé d'agence, `confirm: true` EXIGE `agency_id`. Curseur de `list_projects` préfixé par le cabinet (`AGENCY_MISMATCH` ailleurs).
- **Réponses** : `_meta.agency` ({ id, name, slug }) toujours, champ `agency` en tête d'un résultat objet, second bloc de
  contenu pour une liste (le premier bloc garde sa forme). Instructions MCP : `MCP_INSTRUCTIONS` (`httpServer.ts`).
- Tests : `tests/mcpAgencySwitching.test.ts` (vrai endpoint `/mcp`, données fictives).

### Visibilité des contacts personnels

`contacts.is_personal` (`migrate_contacts_is_personal.sql`) existait déjà
pour exclure un contact de la synchro Google Contacts, mais rien ne
distinguait AUPRÈS DE QUI il restait visible dans l'application elle-même :
un contact personnel (un proche, une référence saisie pour un rappel
d'anniversaire) apparaissait dans la liste de tout le cabinet au même titre
qu'un contact « pro ». `migrate_contacts_personal_visibility.sql` ferme ce
trou avec deux colonnes distinctes, une par moitié du problème :

- **`contacts.owner_user_id`** — à qui appartient un contact personnel.
  Jamais `contacts.created_by` : ce champ texte libre sert déjà à d'autres
  valeurs (`'odoo'`, `'ragic'`, la source d'un import) et n'a jamais été un
  identifiant fiable. Server-side only — absent de `CONTACT_COLUMNS`
  (`server/routes/contacts.ts`), donc jamais accepté depuis le corps d'une
  requête : posé à `req.user.id` à la création d'un contact personnel, à
  `null` sur un contact « pro » (partagé, sans propriétaire).
- **`profiles.show_personal_contacts`** — préférence personnelle, pas par
  cabinet (même principe que `notification_prefs`) : afficher ou non SES
  PROPRES contacts personnels dans sa liste. Réglée depuis `/settings`, lue
  et écrite comme le reste du profil (`GET /api/me` /
  `PUT /api/team/:id`, camelCase `showPersonalContacts`). Un contact
  personnel appartenant à quelqu'un d'autre reste invisible quel que soit ce
  réglage — il ne joue que sur les siens.

`GET /api/contacts` filtre en mémoire (`is_personal` faux → toujours visible ;
vrai → visible seulement si `owner_user_id === req.user.id` ET que la
préférence est active) plutôt que via un `.or()` PostgREST imbriqué : la
liste d'un cabinet reste petite, et ça évite de dépendre de la syntaxe
`and()` dans un `.or()`. `PUT`/`DELETE /api/contacts/:id` refusent en 403
la modification d'un contact personnel appartenant à quelqu'un d'autre —
la liste seule ne suffit pas, l'id peut fuiter ailleurs (un journal
d'activité, un lien partagé entre collègues). Un contact personnel créé
avant l'existence d'`owner_user_id` (`owner_user_id` NULL) est réclamé par
la première personne qui l'édite, plutôt que de rester invisible pour tout
le monde indéfiniment ; basculer un contact de personnel à pro efface
`owner_user_id` (plus de propriétaire à avoir, une fois partagé).

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

### Aperçu d'opération, brouillons, signature et classement des emails

**Volet « Plan d'actions »** (`ProjectOverview.tsx`, colonne D). Quatre gestes
ouvrent une autre page déjà **rattachée à l'opération** par l'adresse, jamais
par une sélection à refaire :

| Bouton | Destination | Rattachement |
|---|---|---|
| Courrier | `/document_templates?project=<id>` | `DocumentTemplates` préremplit le sélecteur d'affaire ET coche « enregistrer dans le projet » |
| Réunion | `/reunions?parent=project:<id>&new=1` | `Reunions.tsx` sélectionne l'affaire (mécanisme `?parent=` des liens d'agent) puis ouvre le formulaire de création ; `new` est posé APRÈS `selectProject`, qui referme ce formulaire |

Sous « Prochains jalons », **« Prochaines tâches »** lit `useTasks({ projectId })` :
les 5 premières tâches non terminées, échéance la plus proche d'abord (sans
échéance en dernier), en rouge si dépassée ; un clic mène à `?tab=TACHES`. Ce sont
bien des TÂCHES (`tasks`), distinctes des jalons (`milestones`) au-dessus.

**Réunions liées** (`src/components/LinkedMeetings.tsx`, logique pure dans
`src/lib/linkedMeetings.ts`, testée) : la même rubrique sur la fiche d'une affaire (volet
Plan d'actions), d'une proposition (rubrique repliable de la modale) et d'un appel d'offres
(onglet « Réunions »). Elle lit `GET /api/meetings?<parent>_id=` (à venir d'abord, puis les
passées) et ouvre une réunion par `/reunions?parent=<kind>:<id>&open=<id>`. Le parent du lien
se déduit de la RÉUNION et non de la fiche (`meetingParent`) : une visite de proposition
rattachée aussi à l'affaire n'est listée par `/reunions` que sous la proposition. `/reunions`
résout `?parent=project:` sur toutes les affaires, terminées comprises (`allProjects`),
même si sa colonne de gauche masque ces dernières.

**Brouillons modifiables** (`CorrespondenceTab.tsx`, `MailDraftEditModal.tsx`,
`server/mailDraft.ts`, `server/routes/mailDrafts.ts`). Un brouillon vit dans la
boîte du fournisseur et n'est **jamais copié en base** : `GET /api/mail/drafts?
account_id=` (20 récents), `GET /api/mail/drafts/:id?account_id=` (À, Cc, objet,
corps) et `PUT /api/mail/drafts/:id` (réécrit, n'envoie jamais). `account_id` est
toujours relu parmi les comptes de l'utilisateur. Gmail : `drafts.update` ; Outlook :
`PATCH /me/messages/:id` (le corps repasse en texte brut) ; IMAP : pas de mise à
jour possible, donc APPEND de la nouvelle version PUIS suppression de l'ancienne
(un échec entre les deux laisse un doublon, jamais un brouillon perdu) et l'uid
change. Aucun lien brouillon → opération n'est stocké (aucune migration) :
l'onglet montre par défaut les brouillons adressés au client de l'affaire ou dont
l'objet/l'extrait mentionne son nom, son code ou sa référence
(`relatedKeywords`), avec un bascule « tous les brouillons ».

**Signature de courrier** : `profiles.mail_signature` (TEXT,
`migrate_profile_mail_signature.sql`), personnelle et non par cabinet (même
principe que `show_personal_contacts`), réglée dans Réglages > Mon profil, lue et
écrite par `GET /api/me` / `PUT /api/team/:id` (`mailSignature`, 2000 caractères
maximum). `MailComposeModal` la pose sous le corps d'un nouveau message ou d'une
réponse ; elle reste modifiable avant l'envoi. Les envois automatiques hors
session (relances, alertes) ne la portent pas : aucune personne à qui l'attribuer.

**Rattacher un email à une opération le classe dans sa boîte d'origine**
(`server/mailFiling.ts`, appelé par `POST /api/mail/links`). Uniquement pour
`local_type = 'project'`, avec un `connection_id`, sauf `file_in_mailbox: false` :

| Fournisseur | Emplacement | Effet |
|---|---|---|
| Gmail | libellé `ArchiOffice/<code> - <nom>` | libellé posé ET `INBOX` retiré (le message quitte la boîte de réception) |
| Outlook | dossier `<code> - <nom>` sous un dossier racine `ArchiOffice` | déplacement |
| IMAP | dossier `ArchiOffice<délimiteur><code> - <nom>` (préfixe `INBOX.` si le serveur l'impose) | déplacement, dossier abonné |

Dossier et libellé sont créés à la demande, retrouvés par leur nom exact sinon ;
`projectFolderName()` retire séparateurs et caractères réservés (`/ \ : * ? " < > | .`)
et plafonne à 60 caractères. Trois règles à ne pas défaire :

1. **Outlook et IMAP renumérotent le message déplacé** (id Graph, uid). C'est le
   NOUVEL identifiant qui est enregistré dans `email_links.external_message_id`
   (rendu aussi dans la réponse) ; sans cela le lien ne rouvrirait plus rien. IMAP
   lit `uidMap` et, sans UIDPLUS, retrouve le message par son Message-ID. Gmail
   garde son id : un libellé n'est pas un déplacement. Le front retire le résultat
   de la liste plutôt que de laisser un bouton sur l'ancien emplacement.
2. **Meilleur effort, jamais bloquant.** Le rattachement est enregistré même si le
   classement échoue ; la réponse porte `filing: { status: 'filed' | 'failed' |
   'skipped', folder?, error? }` et l'écran affiche l'erreur. Cas typique : un compte
   Gmail connecté avant `gmail.modify` ou un jeton Outlook sans `Mail.ReadWrite`
   (proposer de reconnecter, comme pour l'archivage).
3. **Retirer le lien ne remet pas le message en place** : le classement dans la
   boîte est un geste de l'architecte, pas un état que l'application maintient.

### OCR

`packages/archioffice-agents/src/server/ocr.ts` rattrape les documents sans
couche texte : `pdftoppm` (poppler-utils, installé par le Dockerfile) met les
pages en image, `tesseract.js` les reconnaît. Si l'un des deux manque, le
contenu injecté dit explicitement que le document est scanné et illisible,
plutôt que de le laisser passer pour vide.

**Une photo n'est pas un document scanné à plat, et ne doit plus passer par
Tesseract quand le fournisseur actif sait faire mieux.** Jusqu'ici, toute
pièce jointe sans couche texte — un PDF scanné aussi bien qu'une photo de
carte de visite ou de véhicule d'entreprise prise en perspective, avec
reflets et angle de vue — suivait le même chemin OCR. Tesseract, conçu pour
du texte scanné à plat, produit sur une photo réelle un texte incohérent
que le modèle « corrige » ensuite en une donnée plausible mais fausse
(incident constaté : une photo de camionnette d'entreprise de couverture a
donné lieu à un contact inventé — nom, société et téléphone différents de
tout ce qui figurait réellement sur le véhicule). Le modèle ne voyait alors
jamais les pixels de l'image, seulement le bruit OCR.

`LlmProvider.supportsVision` (`llm/types.ts`, vrai pour les trois adaptateurs
— `gemini.ts`, `anthropic.ts` et `mistral.ts`, dont les alias `-latest`
pointent vers des versions vision-capables de Large/Medium/Small, voir
docs.mistral.ai/studio/conversations/vision) dit si le fournisseur actif sait
lire une image jointe au message (`LlmMessage.images`, envoyée en vision
native — `inlineData` chez Gemini, un bloc `image` chez Claude, un
`image_url` en data URI chez Mistral). `buildAgentContext()` (`context.ts`)
route en conséquence chaque pièce sans couche texte : image directe
(`.jpg`/`.png`/`.webp`) ou page de PDF scanné rasterisée en PNG partent dans
`ctx.documentImages` quand `supportsVision` est vrai, jamais par Tesseract ;
sans fournisseur vision, le chemin OCR d'origine reste inchangé — dégradé,
mais honnête, plutôt que d'envoyer une image qu'il ignorerait ou refuserait.
`ctx.documentImages` est distinct de `ctx.documentContents` : ce dernier
reste du texte injecté dans le prompt système, les images voyagent en pièce
jointe réelle du message utilisateur (`routes.ts`).

Ça ne suffit pas à éliminer toute erreur de lecture — une photo floue ou mal
cadrée reste une photo floue ou mal cadrée pour un modèle vision. D'où la
section IMAGES JOINTES du prompt (`systemPrompts.ts`) : ne rapporter que ce
qui est clairement lisible, dire explicitement « illisible » pour un champ
incertain plutôt que de le compléter par la valeur la plus plausible, et ne
jamais transcrire une donnée qui semblerait cohérente avec le type de
document sans être individuellement repérable dans l'image.

### Documents produits par un agent

`server/artifacts.ts` fabrique les fichiers demandés dans un bloc
```` ```artifact ```` (docx, pdf, xlsx, csv). Tous portent la charte du cabinet
lue dans `settings` par `server/agencyIdentity.ts` : logo et coordonnées en
en-tête, adresse et SIRET en pied de page, pagination « P1|2 » en bas à droite.

### Pièces jointes polymorphes et MCP

`documents` ne se rattachait jusqu'ici qu'à un projet (`project_id`) : une
fiche sans projet — un permis (PC/DP/AT), un appel d'offres, un devis — n'avait
aucun moyen de porter un fichier, alors que le cas déclencheur (un CERFA rempli
et ses notices sur une fiche `permits`) en avait justement besoin.
`supabase/migrate_documents_attachments.sql` ajoute `resource_type` (défaut
`'projects'`) et `resource_id`, backfillé depuis `project_id` : toute ligne
existante garde son sens, et l'onglet Documents d'une affaire continue de
filtrer par `project_id` sans y toucher. `mime_type`/`size_bytes` rejoignent
aussi `documents` elle-même (`document_versions` n'avait que `size_bytes`) :
les lire à la demande aurait voulu rouvrir la dernière version à chaque appel.

**`ATTACHABLE_RESOURCE_TYPES`** (`server/routes/documents.ts`) est une liste
explicite plutôt qu'un import d'`AGENT_RESOURCES` : certaines clés de ce
jeu-là (`references`, `articles_type`...) ont un `basePath` qui ne
correspond PAS au nom réel de leur table, et `assertTenantEntity()` prend le
nom de table tel quel — une liste vérifiée à la main évite un `.from()` sur
la mauvaise table. `POST /api/documents` valide `resource_id` avec
`assertTenantEntity` dès que `resource_type !== 'projects'`, exactement
comme le fait déjà `project_id`. Le dossier logique sur l'espace de stockage
du cabinet (`folderPathForResource`) niche sous le projet de la ressource
quand elle en porte un (un permis a toujours un `project_id`), et retombe
sur un sous-dossier nommé d'après la ressource sinon (devis, appels
d'offres, qui n'ont pas encore d'affaire).

**Le MCP ArchiOffice** (`packages/archioffice-agents/src/server/mcp/tools.ts`)
gagne six outils écrits à la main — `upload_document`, `list_documents`,
`get_document`, `read_document`, `import_email_attachment`,
`delete_document` — aucun ne rentrant dans le moule générique
`create_record`/`update_record` (un upload porte un fichier binaire encodé
en base64, pas un objet JSON). Ils réutilisent tels quels
`POST/GET/DELETE /api/documents` : `upload_document`/`import_email_attachment`
partagent `depositDocument()`, qui reconstruit un `FormData`/`Blob` en
mémoire (Node 22, pas de dépendance ajoutée) plutôt que d'ouvrir une route
JSON parallèle, et `get_document`/`read_document` partagent
`downloadAttachedDocumentBytes()`, qui repasse par
`GET /api/storage/signed-url` (le même mécanisme que l'ouverture d'un
document côté navigateur) avant de retélécharger les octets — aucune
nouvelle route de lecture de fichier n'a donc été nécessaire.
`import_email_attachment` (voir « Lecture des pièces jointes de messagerie
par les agents » plus haut) est le seul des six à combiner cette écriture
avec une lecture côté messagerie (`mailAttachmentTools.ts`).
Limite commune 25 Mo (`MAX_MCP_FILE_BYTES`), plus basse que la limite serveur
(50 Mo, `server/documentUpload.ts`) : chez `upload_document`/`get_document`,
un fichier voyage en base64 dans l'appel JSON-RPC lui-même, environ un tiers
plus volumineux que l'original — `import_email_attachment`/`read_document`
n'ont pas ce détour (octets ou texte extrait directement) mais gardent la
même limite, par cohérence avec le reste de cette famille d'outils.
`delete_document` suit la même confirmation en deux temps que
`delete_record`/`consulter_agent` (`needs_confirmation` puis `confirm: true`)
— exception délibérée à la règle « jamais de suppression depuis une liaison
externe » : retirer UNE pièce jointe n'a pas les conséquences de supprimer
la fiche elle-même.

`DOCUMENT_RESOURCE_TYPES` (mcp/tools.ts) est une copie à la main de
`ATTACHABLE_RESOURCE_TYPES` : ce paquet n'importe rien du serveur hôte (même
raison que la copie de `parseStorageRef` dans `context.ts`), donc pas de
source commune possible — les deux listes doivent être maintenues ensemble.

**Côté écran**, `src/components/ResourceAttachments.tsx` est le pendant
générique : liste/dépose/supprime les pièces jointes d'une fiche donnée
(`resourceType`/`resourceId`), câblé pour l'instant sur la fiche permis
(`ProjectDetail.tsx`, ligne dépliable). Les autres ressources attachables
pourront le réutiliser tel quel quand leur propre écran de détail existera.

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

### Icône et écran de lancement de la PWA (Android)

Les icônes de `public/` sont **opaques, fond blanc** : l'ancien PNG transparent
plein cadre s'affichait sur fond noir au splash Android et, déclaré aussi
`maskable`, était rogné par le masque (logo trop grand). `icon-192/512.png`
(« any », logo à 62 %), `icon-maskable-512.png` (logo à 56 %, zone de sécurité)
et `apple-touch-icon.png` sont régénérés ainsi ; ne pas remettre de
transparence ni réutiliser l'icône « any » comme `maskable`.

Le nom affiché au splash est celui du manifeste, sans mécanisme de traduction :
`GET /manifest.webmanifest` (`server.ts`, production) le sert localisé d'après
`Accept-Language` (`server/manifestLocale.ts`, fr/en, repli anglais, testé).
Android fige nom et icône à l'installation du WebAPK : un appareil déjà
installé doit réinstaller l'application, ou attendre la mise à jour que Chrome
déclenche seul.

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

### Arborescence lisible des fichiers (client Electron) et accès à l'Explorateur

En mode hors ligne (`OFFLINE_MODE=true`, toujours le cas dans Electron), les fichiers de la GED et des
plans ne sont plus rangés sous un nom aléatoire mais dans une arborescence que l'on ouvre à la main dans
l'Explorateur, sur le dossier de stockage choisi au premier lancement (typiquement un partage NAS commun à
plusieurs postes) : `<bucket>/<cabinet>/<code - affaire>/<phase>/<fichier>`.

- **Chemins** : `server/externalStorage/localTreePath.ts` (`readableObjectPath`, pur, testé). Accents repliés
  en ASCII (« Réhabilitation » devient « Rehabilitation ») : l'export vers le cloud (`initialExport`) ignore
  sans bruit les clés non ASCII. Longueurs bornées (dossier 50, fichier 80, chemin 190) pour la limite de 260
  caractères de Windows. Le premier segment reste le `tenantId` : c'est la frontière d'autorisation.
- **Pas d'écrasement silencieux** : le gateway (`server/offlineGateway.ts`) honore `x-upsert: false` par une
  écriture exclusive (`wx`) et répond 409. `storeBusinessFile` (`storeInReadableTree`) réessaie avec un suffixe
  numéroté (50 tentatives) sur ce seul conflit.
- **Références** : `objectPathFromRef` (`server/storagePaths.ts`) décode l'URL stockée ; `deleteFromStorage`
  l'utilise (un chemin encodé ne se supprimait plus).
- **Migration des fichiers existants** (`server/storageTreeMigration.ts`, routes
  `server/routes/desktopStorage.ts`, carte `StorageTreeMigrationCard.tsx` dans Réglages, administrateurs) :
  simuler, copier (jamais déplacer, empreinte sha256 vérifiée, reprise possible, journal
  `.archioffice-migration.json` à côté du dossier de stockage), puis repointer `file_url`. Les anciens
  fichiers ne sont supprimés que par un geste séparé (simulation puis confirmation), à faire quand tous les
  postes sont à jour : un poste resté sur l'ancienne version a encore besoin des anciens chemins. Les routes
  répondent 404 hors client de bureau.
- **Explorateur et ouverture** : boutons « Afficher dans l'Explorateur » et « Ouvrir » (`Documents.tsx`,
  `src/lib/localFiles.ts`). Le renderer ne fournit jamais de chemin de disque : le serveur
  (`GET /api/storage/local-file`) vérifie l'appartenance au cabinet et rend une clé `{bucket, path}` ; le
  processus principal (`electron/fileAccess.cjs`, IPC `desktop:reveal-file` / `desktop:open-file`) reconstruit
  le chemin (realpath, rejet des liens symboliques et de `..`) et n'ouvre qu'une liste blanche d'extensions.
- **Limites connues** : seuls `documents` et `plans` sont rangés ; `meeting-photos` et autres buckets, ainsi que
  `receptions.document_url`, ne sont pas migrés ; boutons seulement dans `Documents.tsx`. Comportement sous
  Windows/NAS réel et acceptation par Supabase Storage des noms avec espaces non vérifiés ici.
- Tests : `localTreePath`, `readableTreeStorage`, `storageTreeMigration`, `desktopStorageRoutes`,
  `electronFileAccess`, `src/lib/__tests__/localFiles.test.ts`.

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

### Stockage sur l'espace du cabinet

Les documents et les plans d'un cabinet peuvent vivre sur SON espace de
stockage (Nextcloud, kDrive — Google Drive et Dropbox à suivre) plutôt que dans
Supabase Storage, dont les octets sont facturés à l'opérateur et plafonnés par
plan (`storage_mb`, `src/lib/billing.ts`).

**Le périmètre est volontairement étroit** : les buckets `documents` (GED,
versions, visas) et `plans`, les seuls qui pèsent. `logos` reste public par
construction, et `support-attachments` reste chez nous — le superadmin
plateforme doit pouvoir les lire depuis `/admin/support`, ce qu'un drive de
cabinet lui interdirait.

**Une couche de politique, pas une primitive mutée.** `uploadToStorage` /
`deleteFromStorage` (`server.ts`) ne changent ni de signature ni de
comportement : les dix modules de routes hors périmètre les appellent toujours
tels quels. `createBusinessFileStore()`
(`server/externalStorage/storeBusinessFile.ts`) se pose au-dessus et n'est
utilisée que par `documents.ts`, `plans.ts` et `visas.ts`. `AsyncLocalStorage`
ne pouvait pas servir de source du cabinet ici : `server/tenantContext.ts` rend
`null` dès qu'une requête ne porte pas `X-Tenant-Id`, et le mode de panne
aurait été « écrit silencieusement sur Supabase », invisible en test.

**Échec bruyant, jamais de repli silencieux.** Un dépôt qui échoue chez le
fournisseur rend 502 ; se rabattre sur Supabase remplirait précisément le quota
que le cabinet cherche à éviter et laisserait deux fichiers de la même affaire
à deux endroits sans que rien ne l'explique.

**La référence est une URI dans `file_url`** :
`archioffice+external://<fournisseur>/<connexion>/<base64url(identifiant)>?name=`.
Pas de colonnes dédiées : `file_url` circule seule dans quatre tables et une
douzaine de fichiers frontend qui ne passent que `doc.file_url`.
`parseStorageRef()` rend `null` dessus, donc ses deux copies dans
`packages/archioffice-agents` dégradent proprement. La colonne
`storage_backend` existe malgré tout, **uniquement** comme filtre SQL dérivé :
une requête PostgREST ne sait pas analyser une URI, et le quota en a besoin.

**Aucun lien public n'est créé chez le fournisseur.** Élargir le partage d'un
fichier dans le drive du cabinet sans qu'il l'ait demandé n'est pas acceptable.
La lecture passe par un jeton HMAC **sans état**
(`server/externalStorage/externalTicket.ts`, clé dérivée de
`MAIL_ENCRYPTION_KEY`) : `openSignedUrl()` ouvre par `window.open()` et
`<SignedImage>` pose l'URL dans un `src`, deux navigations sans JWT possible, et
deux requêtes successives atterrissent sur des conteneurs différents — une Map
par processus rejouerait le piège documenté dans `server/oauthState.ts`. Quand
un fournisseur sait produire un lien temporaire propre au porteur (Dropbox), la
route redirige en 302 ; sinon elle streame, **en retransmettant les requêtes
`Range`** — pdf.js (`PlanAnnotator`) découpe les gros plans, les ignorer
casserait l'affichage sans rien dire.

**L'arborescence est `<racine>/<code affaire> - <nom affaire>/<phase>`**, avec
`Plans` et `VISA` comme sous-dossiers pour les deux autres écritures du
périmètre. Les phases sont celles que l'écran Documents affiche déjà, donc
l'architecte retrouve dans son drive le classement qu'il voit dans
l'application. `external_storage_folders` mémorise chaque niveau (index unique
`(connection_id, folder_key)`, donc upsert idempotent) : sans ce cache, chaque
dépôt coûterait deux à six appels d'API. Un dossier renommé ou supprimé côté
drive fait échouer le dépôt en `ExternalFolderMissingError` ; on oublie alors le
sous-arbre et on rejoue **une** fois. Conséquence assumée : un dossier renommé à
la main voit réapparaître un dossier au nom d'origine à côté du sien — on ne
poursuit pas les renommages. Les fichiers déjà déposés ne bougent pas, étant
référencés par leur propre identifiant.

**Ne pas réutiliser `sanitizeFilename` pour les noms de dossiers** : sa règle
`[^a-zA-Z0-9._-] → _` transforme « Général » en « G_n_ral ». Acceptable pour un
chemin d'objet Supabase que personne ne regarde, pas pour une arborescence que
l'architecte ouvre dans son propre Drive. D'où
`server/externalStorage/folderNaming.ts`.

**Le quota cesse de compter ces octets, des deux côtés à la fois** :
`checkStorageQuota` (le plafond) et `GET /api/billing/status` (la jauge) passent
tous deux par `tenantSupabaseStorageBytes()`. Les filtrer d'un seul côté
donnerait un écran qui monte sans jamais bloquer. `checkQuota(…, 'documents')`
ne bouge pas : c'est un plafond sur le NOMBRE de documents, un élément de
l'offre, pas un coût d'hébergement.

**Déconnecter et révoquer sont deux gestes distincts.** Une référence n'est
résoluble que tant que la connexion existe ET porte de quoi s'authentifier.
`POST /api/external-storage/:id/disable` arrête les écritures en gardant les
identifiants ; `DELETE /api/external-storage/:id` les efface **sans supprimer
la ligne**, et l'écran avertit alors que les fichiers déjà déposés ne seront
plus consultables depuis ArchiOffice. La ligne n'est supprimée que par la
cascade de `tenantPurge.ts`, à la fermeture du cabinet — qui **ne supprime
jamais** dans le drive du cabinet : ce sont ses fichiers, sur son espace.

**Google Drive demande le scope `drive.file`, pas `drive`.** `drive` est un
*restricted scope* chez Google : il impose une évaluation de sécurité CASA et un
audit annuel à toute application publiée. `drive.file` n'est pas restreint et
donne exactement ce qu'il faut — créer des dossiers et des fichiers, et gérer
ceux qu'on a créés. La contrepartie, assumée et dite dans l'UI : l'application
ne VOIT pas ce qu'elle n'a pas créé, donc la racine est créée par ArchiOffice
(son identifiant est mémorisé sur la connexion) et on ne peut pas pointer un
dossier existant choisi à la main. C'est précisément le cache de dossiers qui
rend ce scope exploitable. Deux paramètres sont obligatoires sur CHAQUE appel
(`supportsAllDrives`, `includeItemsFromAllDrives`) sous peine de 404 dès qu'un
cabinet travaille sur un Drive partagé, l'apostrophe doit être échappée dans une
requête `q` (« L'Atelier » est un nom d'affaire courant), et la suppression est
une mise à la corbeille (`PATCH {trashed:true}`), jamais une destruction.

**Dropbox : deux pièges, tous deux silencieux.** `token_access_type=offline`
sur l'URL de consentement, sans quoi aucun refresh token n'est délivré et la
connexion meurt au bout de quatre heures sans rien annoncer. Et l'en-tête
`Dropbox-API-Arg` doit être en **ASCII strict** : il porte le chemin du fichier,
donc le nom de l'affaire, et un « Réhabilitation Château » non échappé fait
rejeter la requête en 400 — d'où `toAsciiJsonHeader()`. L'identifiant mémorisé
est l'`id:xxxxxxx` renvoyé à l'écriture et non le chemin, pour qu'un fichier
déplacé à la main dans le Dropbox du cabinet reste consultable. C'est aussi le
seul des trois fournisseurs à produire un lien de lecture temporaire (quatre
heures, propre au porteur, sans élargir le partage) : la route de lecture y
redirige en 302 plutôt que de streamer.

**Trois effets de bord traités, et qui ne doivent pas être défaits.** L'export
ZIP RGPD (`server/tenantExport.ts`) verse les fichiers externes sous
`fichiers/externe/` et nomme dans `manifest.json` ceux qu'il n'a pas pu lire :
un export à motif légal ne peut pas mentir par omission, et il ne parcourait
jusqu'ici que les buckets Supabase. `tenantPurge.ts` ne supprime **jamais** dans
l'espace du cabinet — ces fichiers vivent sur un compte qui lui appartient, et
l'effacement RGPD porte sur les données que NOUS détenons ; seule disparaît la
connexion, donc la capacité à les rouvrir. Et `external_storage_connections`
n'entre **pas** dans `SYNC_TABLES` : propager des identifiants chiffrés vers une
installation locale dont la `MAIL_ENCRYPTION_KEY` diffère serait à la fois
inutile et un essaimage de secrets.

**Les agents IA lisent ces fichiers par un pont, pas par un import.** Le package
`@zinkh/archioffice-agents` n'importe rien depuis `server/` ; `server.ts` lui
dépose donc un lecteur au démarrage (`setExternalFileReader`), sur le patron de
`initOAuthStateStore()`. Sans ce pont, un agent rapporterait simplement qu'une
pièce jointe est vide dès qu'un cabinet a branché son espace.

**Nextcloud et kDrive partagent un seul adaptateur WebDAV**
(`server/externalStorage/providers/webdav.ts`, `MKCOL`/`PROPFIND`/`PUT`/`GET`/
`DELETE` en `fetch`, aucune dépendance npm ajoutée). Ils ne diffèrent que par
l'URL de base saisie par le cabinet. Trois pièges traités : le chemin s'encode
**segment par segment** (un `encodeURIComponent` global détruirait les barres
obliques), `MKCOL` répondant 405 vaut succès (la collection existe déjà), et un
`PUT` écrase sans prévenir — d'où la recherche d'un nom libre avant dépôt.
C'est une URL fournie par le cabinet, donc l'adaptateur ne
passe plus par `fetch` mais par `pinnedRequest` (`server/externalStorage/pinnedHttp.ts`, `https.request`
sans dépendance), qui applique le garde SSRF (`resolvePublicUrl`, `server/ssrfGuard.ts`) à l'enregistrement
**et** à chaque appel, avec trois protections : **HTTPS obligatoire** (le mot de passe d'application part en
Basic Auth ; `http://` est refusé en 400 à la saisie comme à l'usage), **connexion épinglée** sur l'adresse
publique validée (une seconde résolution DNS hostile ne peut plus viser une adresse interne ; le certificat
reste vérifié contre le nom d'hôte) et **redirections suivies à la main**, de même origine uniquement (ni autre
hôte, ni retour en http, donc l'en-tête Authorization ne part jamais ailleurs), trois sauts au plus. Le garde
reconnaît aussi les adresses IPv4 encapsulées en IPv6 sous leur forme hexadécimale (`::ffff:7f00:1`).
Après chaque dépôt, `verifyUploadedSize` relit la taille annoncée par le serveur (PROPFIND, `getcontentlength`) :
une divergence supprime le fichier et fait échouer le dépôt ; une taille absente ou une vérification en échec ne
bloquent rien. `WEBDAV_VERIFY_UPLOAD=off` coupe ce contrôle pour un serveur dont la taille annoncée diffère de
celle déposée (chiffrement côté serveur). Conseil de mise en service : créer le mot de passe d'application
pour un compte dédié, limité au dossier racine d'ArchiOffice. Un serveur WebDAV sur le réseau interne (NAS) reste
refusé par ce garde : pour un NAS, voir le projet de fournisseur « dossier local » du client Electron.
Tests : `tests/webdavHardening.test.ts`, `tests/externalStorageConnections.test.ts`.

### Synchronisation desktop (Explorateur Windows, Finder macOS) : socle serveur

Les documents d'affaire sont exposés à deux clients natifs à venir (Cloud Files API sous Windows,
File Provider sous macOS) par `/api/desktop/v1` (`server/routes/desktopSync.ts`, `server/desktop/*`).
Le contrat complet, ses écarts avec le code d'origine et ce qui reste à faire sont dans
`docs/desktop-sync-contract.md`. Migration `supabase/migrate_desktop_sync.sql` (hors `SYNC_TABLES`) ;
une instance non migrée répond 503 `DESKTOP_SYNC_UNAVAILABLE` sur ce préfixe seulement.

- **Jeton d'appareil `ds_at_…`**, rattaché à la PERSONNE (`desktop_devices`, SHA-256 seul stocké, rendu une fois,
  90 jours glissants, révocable). Le middleware `/api` de `server.ts` ne le laisse atteindre QUE `/api/desktop/v1`
  (403 `DEVICE_SCOPE` ailleurs : à ne pas aligner sur `mcp_at_`, qui ouvre toute l'API) et exige `X-Tenant-Id`,
  revérifié contre les adhésions (sauf `/roots` et `/devices`). Un appareil n'en enregistre pas un autre.
- **Règle CAO : les octets d'un fichier CAO, BIM ou 3D ne vont jamais dans Supabase Storage.**
  `src/lib/cadFiles.ts` (`CAD_EXTENSIONS`, liste unique) ; `server/desktop/uploads.ts` répond 409
  `EXTERNAL_STORAGE_REQUIRED` à l'ouverture d'un dépôt, le revérifie à la fin (le dépôt peut durer des heures) et
  `PATCH` refuse de renommer un fichier Supabase en `.dwg`. Pas de repli : un espace externe en panne fait échouer
  le dépôt. Mode hors ligne (`OFFLINE_MODE`) exempté, les octets restant sur le poste. **Appliquée aussi au web** : la
  branche Supabase de `storeBusinessFile` (documents, plans, visas, DOE) refuse un CAO en 409
  `EXTERNAL_STORAGE_REQUIRED` avant le quota (`tests/cadRuleDocuments.test.ts`). Le mode de verrouillage se règle
  dans Réglages > Cabinet (`settings.desktop_lock_mode`, `PUT /api/settings` valide `off`, `advisory`, `enforced`).
  `tests/desktopSyncUploads.test.ts` compte les écritures vers Supabase Storage ; retirer la règle fait échouer 11 tests.
- **Version technique et indice de diffusion sont deux choses.** Un dépôt crée `version + 1` et laisse l'indice
  (`A`, `B`...) intact ; il n'avance que sur demande (`bumpIndice`, `POST /nodes/:id/bump-indice`). L'ancien
  `PUT /api/documents/:id` fait avancer l'indice à CHAQUE fichier envoyé : un enregistrement automatique de Word
  y brûlerait une lettre.
- **Concurrence** : `baseVersion` obligatoire pour modifier un document existant ; `409 VERSION_CONFLICT` rend la
  version courante et le nœud. À la fin d'un dépôt la mise à jour est CONDITIONNELLE sur la version lue, et le fichier
  déjà stocké est retiré si elle échoue. Le client dépose son fichier en copie `conflit` (`conflict_of`), le serveur
  ne fusionne jamais.
- **Journal de changements écrit par des déclencheurs SQL**, pas par les routes : plusieurs chemins écrivent dans
  `documents` (dépôts, DOE, agents, MCP, migration de stockage). `desktop_changes.tenant_id` n'a volontairement PAS de
  clé étrangère (la suppression en cascade d'un cabinet déclenche ces écritures et échouerait) ; `tenantPurge.ts`
  nettoie APRÈS la suppression du cabinet. Le curseur est un `seq` ; `desktop_changes_prune` relève un plancher
  (`desktop_sync_state`) et un curseur plus ancien reçoit 410 `CURSOR_EXPIRED`. L'événement porte l'ÉTAT courant : un
  `upsert` dont le document a disparu est rendu comme `delete`. Verrou et contenu sont des natures distinctes à la
  compaction, sinon un `lock` masquerait un `upsert` récent.
- **Verrous** (`settings.desktop_lock_mode` : `off`, `advisory` par défaut, `enforced`) : le verrou d'un autre bloque
  (423) seulement en `enforced`. Huit heures sans renouvellement, reprise d'un verrou expiré par mise à jour
  conditionnelle, rupture réservée aux administrateurs et managers. Chaque requête de `locks.ts` porte `tenant_id`.
- **Suppression logique** (`documents.deleted_at`) pour les appareils : jamais de `DELETE` définitif, rôles `admin`,
  `manager`, `pm` comme sur l'écran. Les dossiers (affaire, phase) se déduisent des documents, on n'en crée pas.
- **Arborescence calculée par le serveur** (`server/desktop/nodes.ts`, mêmes chemins que le stockage externe) : le
  client ne calcule aucun chemin. Les noms sont valides pour Windows et macOS (`safeNodeName`) et uniques par dossier
  sans tenir compte de la casse (`uniqueSiblingNames`, suffixe ` (2)`). Un renommage ou un changement de phase ne
  déplace PAS le fichier chez le fournisseur (WebDAV : l'identifiant est le chemin relatif).
- **Dépôt par morceaux** sur le disque temporaire du serveur (`DESKTOP_UPLOAD_DIR`, 24 h, purge opportuniste),
  `complete` idempotent ; limite actuelle de 200 Mo (`DESKTOP_MAX_UPLOAD_MB`) parce que `storeBusinessFile` exige un
  `Buffer`.
- **Tests** : `tests/desktopSync{Devices,Routes,Uploads}.test.ts`, `src/lib/__tests__/{cadFiles,desktopNodes}.test.ts`
  et `tests/desktopSyncMigration.pg.test.ts` (déclencheurs, purge, cascade, rejeu ; ignoré sans `PGHOST`). Le faux
  Supabase est partagé par fichier et les identifiants se répètent d'un test à l'autre : relire une ligne par
  `(tenant_id, id)`, jamais par `id` seul.

### Mouvement, gestes et préférences d'accessibilité

Les animations suivent les principes d'interface fluide d'Apple, sans toucher
à l'identité Tabler (couleurs, bordures, rayons) : seul le mouvement change.

- **Ressort par défaut, jamais une durée fixe.** `src/main.tsx` enveloppe
  l'application dans `<MotionConfig reducedMotion="user" transition={DEFAULT_SPRING}>`.
  Les réglages partagés (`DEFAULT_SPRING`, `PANEL_SPRING`, `FLICK_SPRING`,
  `projectMomentum()`) vivent dans `src/lib/motion.ts` : `bounce: 0` par
  défaut, un léger rebond seulement quand un geste a lancé l'élément.
- **« Réduire les animations » est respecté** : Motion ne garde alors que les
  fondus (`reducedMotion="user"`), et `src/index.css` coupe `animate-pulse` et
  l'enfoncement des boutons. `prefers-reduced-transparency` retire les flous,
  `prefers-contrast: more` renforce bordures et textes secondaires.
- **Les modales naissent de leur déclencheur.** `launchOriginRef`
  (`src/lib/launchOrigin.ts`) pose le `transform-origin` d'une modale sur le
  dernier point d'appui. Une nouvelle modale animée en `scale` le reçoit par
  `ref={launchOriginRef}` (référence stable, calculée une fois au montage).
- **Retour à l'appui, survol réservé à la souris.** `.btn:active` s'enfonce en
  50 ms ; les `:hover` de `.btn-*` sont sous `@media (hover: hover)`, comme la
  variante `hover:` de Tailwind 4, pour ne pas rester affichés sur tablette.
- **Panneaux qu'on referme d'un geste** : le menu mobile
  (`src/components/MobileNavDrawer.tsx`) et, sur téléphone, la fiche de
  réserve (`ReserveDetail.tsx`, glissée par son en-tête). Le panneau suit le
  doigt 1:1, résiste au-delà de sa butée, et la décision au relâché se prend
  sur le point d'arrivée PROJETÉ (`projectMomentum`), pas sur la position du
  doigt ; le ressort de retour repart de la vitesse du geste.
- **Hauteurs d'écran en `dvh`**, jamais `100vh`/`h-screen` pour une mise en
  page : sur Safari iOS, `100vh` inclut la barre d'adresse et coupe le bas.
- **Glisser-déposer au pointeur, jamais en HTML5 natif** (`draggable`,
  `onDragStart`...), qui ne suit pas le doigt sur téléphone. Kanban et
  calendrier passent par `useDragToZone` (`src/hooks/useDragToZone.ts`), le
  planning (Gantt) par `useBarDrag` ; les deux s'appuient sur
  `startPressDrag` (`src/lib/pressDrag.ts`) : à la souris le glisser démarre
  après quelques pixels, au doigt après un appui de 220 ms (un doigt qui bouge
  avant fait défiler la page), Échap annule, et le clic qui suit un glisser
  est avalé. Une copie soulevée suit le pointeur 1:1 depuis le point saisi ;
  au relâché, `onDrop` doit mettre à jour l'état **de façon optimiste et
  synchrone** (il est appelé dans un `flushSync`) pour que la copie puisse
  rejoindre la nouvelle place de l'élément. `project: true` (Kanban) choisit
  la colonne sur le point projeté du geste ; pas sur une grille serrée comme
  les jours d'un mois. Une tâche déposée va en bas de sa colonne : l'ordre à
  l'intérieur d'une colonne n'est pas enregistré.
- **Pas d'apparition en cascade sur les pages de travail** (liste des
  affaires, équipe, notifications) : elle rejouait à chaque visite d'une page
  consultée des dizaines de fois par jour. Réservée aux moments rares
  (page d'accueil publique). Les ajouts discrets restent : arrivée d'un
  nouveau message dans le chat des agents (seulement s'il date de moins de
  4 s, jamais l'historique rechargé), étapes de l'accueil qui glissent dans
  le sens du parcours, libellés « Enregistré » en fondu (`SwapText`,
  `src/components/ui/SwapText.tsx`).
- **Couche plateforme mobile** (`index.html`, `src/index.css`, bloc
  « Téléphone et tablette ») : `viewport-fit=cover` (sans lui, tous les
  `env(safe-area-inset-*)` valent 0 : la barre de raccourcis mobile passait
  sous l'indicateur d'accueil), en-tête et menu mobile rembourrés par les
  insets ; champs à 16 px sous `(pointer: coarse)` pour qu'iOS ne zoome pas
  (jamais `maximum-scale=1`) ; `overscroll-behavior: none` sur la racine ;
  `touch-action: manipulation` et `user-select: none` sur les contrôles seuls ;
  hauteurs en `dvh` (modales) ou `svh` (pages de connexion). `theme-color` suit
  le thème APPLIQUÉ (`theme-provider.tsx`), posé par classe et non par le
  réglage système.
- **Typographie : 11 px minimum, tailles en `rem`.** Les tailles arbitraires
  s'écrivent `text-[0.6875rem]` et non `text-[11px]`, pour suivre la taille de
  texte choisie dans le navigateur (le corps est à `0.875rem`) ; 10 px n'est
  toléré que dans une pastille de taille fixe (initiales dans un cercle
  `w-5 h-5`). `--tracking-wider` est ramené à 0,03 em dans `@theme`, et `h1`/
  `h2` sont légèrement resserrés. Les majuscules et couleurs Tabler restent.

### Suggestions IA : un moteur de règles, pas un seul type d'alerte

`src/lib/copilotSuggestions.ts` (testé, `src/lib/__tests__/copilotSuggestions.test.ts`) alimente la carte « Suggestions IA » du tableau de bord ET la pastille du chat, par une seule route, `GET /api/copilot/suggestions` (le tableau de bord ne recalcule plus rien). Sans appel au modèle ni crédit : des règles sur les données du cabinet. Vingt-sept règles : factures en retard, tâches en retard (par projet, ou internes), jalons en retard, réserves en retard de levée, permis dont le délai d'instruction expire (DP 1 mois, PC 3, AT 4, délai de droit commun à vérifier), appels d'offres à remettre sous 7 jours, tâches à échéance sous 3 jours, projets en retard d'avancement, factures à échéance sous 7 jours, réunions sans compte rendu, devis sans réponse (15 jours), contrats signés non facturés (45 jours), tâches sans responsable, affaires en cours sans contrat MOE, lots sans entreprise, fiches d'affaire incomplètes, factures en brouillon depuis 7 jours, observations de chantier en retard, OS sans accusé de réception (7 jours), situations de travaux à vérifier (10 jours), qualification d'une entreprise titulaire expirée ou sous 30 jours (jamais signalée sans qualification enregistrée), entreprises titulaires sans coordonnées ou sans SIRET valide, collaborateur à plus de 15 tâches ouvertes, entreprises notifiées sans attestation d'assurance (marché notifié ou signé, ni résilié ni subséquent ; l'attestation est la pièce « assurance » cochée dans l'ACT, ou un document de l'affaire dont le nom, la description ou le type cite assurance ou décennale et qui est rattaché à la fiche de l'entreprise ou la nomme), validité de l'attestation d'assurance (expirée ou sous 30 jours), RGE exigé par un lot (entreprise titulaire sans qualification RGE, expirée ou sous 30 jours). Volontairement absents : honoraires consommés et temps sans coût horaire (données de gestion réservées aux administrateurs, la route est ouverte à tous les rôles), attestation MAF et affaire inactive (pas de donnée fiable).

À ne pas défaire : un plafond par type (3) et un tour de rôle entre les règles, puis le rouge avant l'orange, 10 suggestions au plus. Une donnée facultative non lue (`meetings`, `reserves`, `contracts`, `permits`, `lots` : table absente ou en erreur) vaut `undefined` et la règle se tait : jamais « sans contrat » parce que la lecture a échoué. Une date absente ou illisible n'est jamais un retard. Les brouillons envoyés au chat sont internes (plan de rattrapage, point, liste de contrôle) et ne s'adressent au client que pour une relance de paiement ; l'IA propose, la personne relit, rien n'est modifié sans confirmation. Textes : `ai_suggestion_*`, `ai_draft_*`, `ai_field_*` (fr et en).

### Chat des agents : pièces jointes, rappels, nouvelle discussion

Panneau (`AgentChat.tsx`) et page (`AgentChatPage.tsx`) partagent les mêmes briques. Règles à garder :

- **Trombone = menu** (`DocumentPicker`) : prendre une photo (`capture`, visible au doigt seulement, `pointer-coarse:`), choisir un fichier, ou reprendre un document de la GED. Le téléversement passe par `uploadChatDocument` (`chatUpload.ts`, `POST /api/documents`, catégorie « Assistant IA »). Avant, seul le glisser-déposer envoyait un fichier : rien n'existait sur téléphone. Les pièces jointes sont une rangée dans le flux (`AttachedDocChips`), pas une couche en position absolue.
- **Contrôles de saisie à 44 px** (trombone, micro, champ, envoi) sur un même axe ; libellé du champ « Votre message… » (16 px au doigt, donc on raccourcit le texte plutôt que la police).
- **Rappels IA repliés** derrière une ligne d'alerte avec une flèche (état mémorisé dans `localStorage`, `agent_chat_suggestions_open`) ; cliquer « Rédiger un rappel » referme la liste et remplit le champ.
- **« Nouvelle discussion »** (clé `agent_chat_clear`, bouton d'en-tête) **supprime** la conversation en cours après confirmation : l'historique des discussions n'existe pas encore (voir ROADMAP.md, « Saved conversation history »). Ne pas laisser croire à un archivage.
- **Bouton « Arrêter »** (`ChatRequestStatus`) : petite pastille, zone de touche de 44 px par `before:-inset-2`.
- **Le bouton flottant « Assistants IA » est masqué sur `/agents/:id/chat`** (il recouvrait l'envoi). Le panneau se tient 88 px au-dessus du bas, au-dessus de la pastille mobile de 60 px (`MobileShortcutBar`, boutons de 48 px).

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

### Attestation d'assurance et RGE exigé par un lot

`supabase/migrate_assurance_rge_lots.sql` ajoute l'organisme `assurance` aux qualifications d'une entreprise (`contact_qualifications`, qui porte déjà début et fin de validité, saisie depuis la fiche contact comme Qualibat) et `project_lots.rge_required` (faux par défaut, case « RGE exigé » de `LotsManager`, `PUT /api/lots/:id`). **Une attestation d'assurance n'est pas une qualification professionnelle** : `resumeQualifications` l'ignore, sinon une assurance valide rendrait « valide » une entreprise dont le Qualibat a expiré (pastille de l'ACT, alerte `qualification_expiree`). Lecture dédiée : `resumeAssurance`, et `resumeRge` pour le RGE (`estQualificationRge` : organisme RGE, Qualit'EnR, Certibat, ou « RGE » cité dans le libellé, les domaines ou la référence). Sans date de fin saisie, la validité est inconnue et rien n'est signalé ; une attestation saisie sur la fiche vaut présence pour la règle « sans attestation ». Pour un lot RGE, l'absence de toute qualification RGE EST signalée (c'est le lot qui l'exige) ; l'entreprise vient de la fiche du lot, à défaut du marché du même numéro (`lot_numero`, « 02 » = « 2 »). Instance non migrée : la lecture des lots retombe sur les colonnes d'origine, la règle RGE se tait.

**Valeur de départ de « RGE exigé »** (`rgeExigeParDefaut`, `src/lib/rgeLots.ts`, testé) : coché à la création d'un lot dont le titre cite isolation ou chauffage (hors isolation phonique ou acoustique), par l'application d'un modèle de projet (`TemplateLot.rge_required` l'emporte quand le modèle le porte) et par `POST /api/projects/:id/lots` (sauf valeur envoyée). Même valeur de départ pour les lots importés du CCTP (nouveaux lots par `POST`, lots existants renommés par `PUT /api/lots/:id` : un lot qui passe d'un titre sans RGE à « isolation » ou « chauffage » est coché, une case décochée à la main n'est jamais recochée tant que le titre reste dans la même famille) et pour la liste de lots d'une affaire (`POST` et `PUT /api/projects/:id`, lignes NOUVELLES seulement : `replaceList` reçoit un `forNew`). Toujours modifiable ; un lot existant n'est jamais requalifié autrement que par un renommage. Sans la migration, la création et le renommage retombent sur les colonnes d'origine (`replaceList` a déjà supprimé la liste : il réessaie sans la colonne plutôt que de perdre les lots).
