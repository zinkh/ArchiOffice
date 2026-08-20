import express from "express";
import path from "path";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import helmet from "helmet";
import { contentSecurityPolicy as helmetCsp } from "helmet";
import { captureWithContext } from "./server/sentryContext";
import { registerProjectTemplateRoutes } from "./server/routes/projectTemplates";
import { registerActDataRoutes } from "./server/routes/actData";
import { registerDetDataRoutes } from "./server/routes/detData";
import { registerDpgfRoutes } from "./server/routes/dpgf";
import { registerSituationRoutes } from "./server/routes/situations";
import { registerCctpRoutes } from "./server/routes/cctps";
import { registerCustomReferenceRoutes } from "./server/routes/customReferences";
import { registerProjectMemberRoutes } from "./server/routes/projectMembers";
import { registerProjectPhaseHistoryRoutes } from "./server/routes/projectPhaseHistory";
import { registerGlobalSearchRoutes } from "./server/routes/globalSearch";
import { registerObservationRoutes } from "./server/routes/observations";
import { registerMeetingRoutes } from "./server/routes/meetings";
import { registerMeetingAttendeeRoutes } from "./server/routes/meetingAttendees";
import { registerDocumentTemplateRoutes } from "./server/routes/documentTemplates";
import { registerContratsMoeRoutes } from "./server/routes/contratsMoe";
import { registerNotesHonorairesRoutes } from "./server/routes/notesHonoraires";
import { registerProfileRoutes } from "./server/routes/profile";
import { registerActivityFeedRoutes } from "./server/routes/activityFeed";
import { registerMessagingRoutes } from "./server/routes/messaging";
import { registerContactSyncRoutes } from "./server/routes/contactSync";
import { registerGeoProxyRoutes } from "./server/routes/geoProxy";
import { registerMafRoutes } from "./server/routes/maf";
import { registerTimeTrackingRoutes } from "./server/routes/timeTracking";
import { registerLeaveRoutes } from "./server/routes/leave";
import { registerTenderRoutes } from "./server/routes/tenders";
import { registerTenderRssRoutes } from "./server/routes/tenderRss";
import { registerMilestoneRoutes } from "./server/routes/milestones";
import { registerSpecificationRoutes } from "./server/routes/specifications";
import { registerContactRoutes } from "./server/routes/contacts";
import { registerSuperAdminRoutes } from "./server/routes/superAdmin";
import { registerMarchesEntreprisesRoutes } from "./server/routes/marchesEntreprises";
import { registerBillingRoutes } from "./server/routes/billing";
import { registerZohoInvoiceRoutes } from "./server/routes/zohoInvoice";
import { registerGoogleCalendarSyncRoutes } from "./server/routes/googleCalendarSync";
import { registerZohoBooksRoutes } from "./server/routes/zohoBooks";
import { registerRagicRoutes } from "./server/routes/ragic";
import { registerOdooRoutes } from "./server/routes/odoo";
import { registerSuperpdpRoutes } from "./server/routes/superpdp";
import { registerChorusProRoutes } from "./server/routes/chorusPro";
import { registerRegistrationRoutes } from "./server/routes/registration";
import { registerAgencySetupRoutes } from "./server/routes/agencySetup";
import { registerTeamRoutes } from "./server/routes/team";
import { registerProposalRoutes } from "./server/routes/proposals";
import { registerInvoiceRoutes } from "./server/routes/invoices";
import { registerOrdresDeServiceRoutes } from "./server/routes/ordresDeService";
import { registerVisaRoutes } from "./server/routes/visas";
import { registerReceptionRoutes } from "./server/routes/receptions";
import { registerReserveRoutes } from "./server/routes/reserves";
import { registerGpaReserveRoutes } from "./server/routes/gpaReserves";
import { registerPermitRoutes } from "./server/routes/permits";
import { registerRfiRoutes } from "./server/routes/rfis";
import { registerProjectRoutes } from "./server/routes/projects";
import { registerPlanRoutes } from "./server/routes/plans";
import { registerDocumentRoutes } from "./server/routes/documents";
import { registerTaskRoutes } from "./server/routes/tasks";
import { registerSendEmailRoutes } from "./server/routes/sendEmail";
import { registerSiteReportRoutes } from "./server/routes/siteReports";
import { registerSettingsRoutes } from "./server/routes/settings";
import { registerUploadRoutes } from "./server/routes/uploads";
import { registerStorageAccessRoutes } from "./server/routes/storageAccess";
import { registerLotRoutes } from "./server/routes/lots";
import { registerAiSuggestionRoutes } from "./server/routes/aiSuggestions";
import { registerCopilotSuggestionRoutes } from "./server/routes/copilotSuggestions";
import { getNextDocNumber as getNextDocNumberImpl } from "./server/getNextDocNumber";
import { getNextAffaireInvoiceNumber as getNextAffaireInvoiceNumberImpl } from "./server/getNextAffaireInvoiceNumber";
import { sanitizeFilename } from "./server/sanitizeFilename";
import { fetchWithTimeout } from "./server/fetchWithTimeout";
import multer from "multer";
import fs from "fs";
import { createClient } from "@supabase/supabase-js";
import * as Sentry from "@sentry/node";
import { startTenderRssPolling } from "./server/tenderRssPoller";
import { startTenantPurge } from "./server/tenantPurge";
import { startNotificationArchiver } from "./server/notificationArchiver";

// Memory storage — files are held in req.file.buffer, uploaded to Supabase Storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB max
});

// Keep /tmp/uploads only as a static fallback for legacy URLs already in the DB
const uploadDir = '/tmp/uploads';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

dotenv.config();

// Builds and fully configures the Express app (all middleware + all ~340
// routes) without binding a port — the production entry point (startServer(),
// below) adds the .listen() call. Exported so Supertest can drive the app
// in-process; see tests/testServer.ts.
// Hostname allow-list shared by the CORS and Host-header-redirect middleware
// below — both used to trust whatever the client/proxy sent verbatim
// (reflected Origin, unchecked Host), which lets an arbitrary site get a CORS
// grant or poison a redirect target. archioffice.fr and any tenant subdomain
// (e.g. aacz.archioffice.fr) are legitimate; APP_URL covers non-default
// deployments; localhost/127.0.0.1 covers dev and the Electron desktop client
// (which loads this same server from http://127.0.0.1:<port>).
function isKnownAppHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === 'archioffice.fr' || h.endsWith('.archioffice.fr')) return true;
  if (h === 'localhost' || h === '127.0.0.1') return true;
  if (process.env.APP_URL) {
    try {
      if (h === new URL(process.env.APP_URL).hostname.toLowerCase()) return true;
    } catch { /* malformed APP_URL — ignore */ }
  }
  return false;
}

export async function createApp() {
  const app = express();
  app.set('trust proxy', 1); // trust X-Forwarded-Proto/Host from reverse proxies

  // Baseline security headers (X-Content-Type-Options, HSTS, Referrer-Policy,
  // X-Frame-Options, etc.) — none of this app's own resource loading is
  // cross-origin, so these are safe to turn on wholesale. What's NOT safe to
  // turn on blind:
  //  - contentSecurityPolicy: the app talks to a wide, hard-to-fully-enumerate
  //    set of external hosts from the browser (MapLibre/IGN tiles,
  //    Géorisques, APICARTO, Supabase, the Stancer payment page, Zoho/Chorus
  //    Pro OAuth). A default-src-'self' CSP would break several of those
  //    without a careful per-host audit this pass didn't do — so CSP is left
  //    off except for the one directive that's safe in isolation and closes
  //    the actual finding (missing clickjacking protection): frame-ancestors.
  //  - crossOriginEmbedderPolicy: would block loading any cross-origin
  //    resource (map tiles, Supabase Storage images) that doesn't send back
  //    a matching CORP/CORS header — this app relies on exactly that kind of
  //    loading, so COEP stays off.
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: { frameAncestors: ["'self'"], defaultSrc: helmetCsp.dangerouslyDisableDefaultSrc },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: false,
  }));

  // CORS headers — must run before any redirect so that redirect responses also
  // carry Access-Control-Allow-Origin (browsers check CORS on redirect responses too).
  // Only grant CORS to known ArchiOffice origins (plus true same-origin callers,
  // e.g. the Electron client talking to its own loopback server) — reflecting
  // any Origin back with credentials:true previously let any site read
  // authenticated responses via a victim's browser.
  app.use((req: any, res: any, next: any) => {
    const origin = req.headers.origin as string | undefined;
    if (origin) {
      let allowed = `${req.protocol}://${req.headers.host}` === origin;
      if (!allowed) {
        try {
          const originUrl = new URL(origin);
          allowed = originUrl.protocol === 'https:' && isKnownAppHostname(originUrl.hostname);
        } catch { /* not a valid absolute origin — ignore */ }
      }
      if (allowed) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
      }
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  // Redirect HTTP → HTTPS so the HTML page and all its assets share the same origin.
  app.use((req, res, next) => {
    // req.headers.host is client/proxy-controlled — reject anything outside the
    // known hostnames before using it to build a redirect target, otherwise an
    // attacker-supplied Host (paired with a spoofed X-Forwarded-Proto: http)
    // could redirect victims to an arbitrary domain.
    const host = req.headers.host || '';
    const hostname = host.split(':')[0];
    if (!isKnownAppHostname(hostname)) {
      return res.status(400).send('Invalid host header');
    }
    if (req.headers['x-forwarded-proto'] === 'http') {
      return res.redirect(301, `https://${host}${req.url}`);
    }
    // Canonicalize bare apex → www so all assets and the HTML share the same origin.
    // Only the exact apex domain is redirected — tenant subdomains (e.g.
    // aacz.archioffice.fr) and www itself must pass through untouched.
    if (host === 'archioffice.fr') {
      return res.redirect(301, `https://www.archioffice.fr${req.url}`);
    }
    next();
  });


  // Serve legacy /uploads/ files (existing DB rows that still point to /tmp paths)
  app.use('/uploads', express.static(uploadDir));
  const PORT = parseInt(process.env.PORT || '3000', 10);

  // Offline desktop mode: SUPABASE_URL points back at this same server, so
  // supabaseAdmin's .from()/.auth/.storage calls loop back here instead of
  // reaching the real Supabase — see the offline-mode plan for why this is
  // additive only and never touches the routes/helpers below.
  if (process.env.OFFLINE_MODE === 'true') {
    const { createOfflineGateway } = await import('./server/offlineGateway');
    app.use(createOfflineGateway({
      postgrestUrl: process.env.OFFLINE_POSTGREST_URL || 'http://127.0.0.1:5555',
      pgUrl: process.env.OFFLINE_PG_URL,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    }));
  }

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ limit: '10mb', extended: true }));

  // Debug middleware for API routes
  app.use("/api/*", (req, res, next) => {
    console.log(`[API DEBUG] ${req.method} ${req.originalUrl}`);
    next();
  });

  // Supabase auth middleware — vérifie le JWT sur toutes les routes /api sauf /api/health
  const supabaseAdmin = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // Ensure Supabase Storage buckets exist at startup (after supabaseAdmin is initialized).
  // In offline mode this call loops back into this same server's /storage/v1 shim
  // (see server/offlineGateway.ts), so it must wait until app.listen() below is
  // actually accepting connections — otherwise the loopback request fails outright.
  if (process.env.OFFLINE_MODE !== 'true') {
    await ensureStorageBuckets();
  } else {
    // Application-level local login (distinct from the /auth/v1 shim, which only
    // satisfies supabaseAdmin's own internal calls) — see server/localAuthRoutes.ts.
    const { createLocalAuthRouter } = await import('./server/localAuthRoutes');
    app.use('/api/auth', createLocalAuthRouter(supabaseAdmin));

    // First-run "log into your existing cloud account" flow — see
    // server/cloudLinkRoutes.ts. Mounted alongside local-auth (a first-run
    // install picks one or the other, both routers coexist harmlessly).
    const { createCloudLinkRouter } = await import('./server/cloudLinkRoutes');
    app.use('/api/auth', createCloudLinkRouter(supabaseAdmin));

    // If already linked, start the background sync engine (server/cloudSync.ts).
    const { readCloudLinkState } = await import('./server/cloudLinkState');
    const linkState = readCloudLinkState();
    if (linkState?.importCompleted) {
      try {
        const { startCloudSync } = await import('./server/cloudSync');
        const { createCloudSyncRouter } = await import('./server/cloudSyncRoutes');
        const cloudSync = await startCloudSync(supabaseAdmin, linkState);
        app.use('/api/sync', createCloudSyncRouter(cloudSync));
      } catch (err: any) {
        // A cloud-sync startup failure (e.g. the stored refresh token is no
        // longer valid, or the machine is offline right now) shouldn't take
        // the whole app down — the install still works fully offline
        // against its local data either way; sync just won't run this session.
        console.error('[cloudSync] Failed to start background sync:', err.message);
      }
    }
  }

  // Résolution tenant_id depuis profiles (mis en cache par request).
  // N'auto-provisionne plus de tenant "fantôme" : un compte sans agence doit
  // passer par /api/agency-setup (créer ou rejoindre une agence) — voir
  // src/pages/AgencySetup.tsx et la garde dans ProtectedLayout (src/App.tsx).
  async function getTenantId(userId: string): Promise<string> {
    const { data } = await supabaseAdmin
      .from('profiles')
      .select('tenant_id')
      .eq('id', userId)
      .single();

    if (data?.tenant_id) return data.tenant_id;

    const err: any = new Error("Ce compte n'est rattaché à aucune agence. Veuillez d'abord créer ou rejoindre une agence.");
    err.status = 409;
    err.code = 'NO_TENANT';
    throw err;
  }

  async function getSystemRole(tenantId: string, userId: string): Promise<string | null> {
    const { data } = await supabaseAdmin.from('profiles').select('system_role').eq('id', userId).eq('tenant_id', tenantId).single();
    return (data as any)?.system_role ?? null;
  }

  // Centralized route guard for admin-only endpoints — checks the caller's
  // system_role in `profiles` (never a client-supplied value: a route that
  // trusted e.g. a request header for this was the exact bug this middleware
  // was introduced to close, see DELETE /api/projects/:id). Mount it as
  // middleware: app.delete("/path", requireRole('admin'), handler).
  function requireRole(...roles: string[]) {
    return async (req: any, res: any, next: any) => {
      try {
        const tenantId = await getTenantId(req.user.id);
        const role = await getSystemRole(tenantId, req.user.id);
        if (!role || !roles.includes(role)) {
          return res.status(403).json({ error: `Réservé aux rôles : ${roles.join(', ')}` });
        }
        req.tenantId = tenantId;
        next();
      } catch (e: any) {
        console.error("[server.ts:1270]", e);
        res.status(e.status || 500).json({ error: e.message || 'Failed to verify role' });
      }
    };
  }

  // ─── Billing / Plan quota ──────────────────────────────────────────────────

  const PLAN_LIMITS: Record<string, { projects: number; users: number; documents: number }> = {
    trial:      { projects: 3,   users: 1,   documents: 10  },
    starter:    { projects: 10,  users: 2,   documents: 100 },
    pro:        { projects: 999, users: 10,  documents: 999 },
    enterprise: { projects: 999, users: 999, documents: 999 },
    expired:    { projects: 0,   users: 0,   documents: 0   },
  };

  // ─── AI Token Pricing ────────────────────────────────────────────────────────
  // Recalibrated for the gemini-3-flash-preview migration (see server.ts's
  // genai.models.generateContent call and archioffice-agents' chat route).
  // gemini-2.5-flash cost Google $0.30/M input; the old €0.40 default was a
  // ~1.333x markup on that. gemini-3-flash-preview costs $0.50/$3.00 per M
  // input/output — both prices below apply that same ~1.333x markup to the
  // new cost (output used to run at a ~0.66x markup, i.e. below cost,
  // subsidized by the input side; now deliberately unsubsidized, same factor
  // on both).
  const AI_PRICE_EUR_PER_M_INPUT  = parseFloat(process.env.AI_PRICE_INPUT_PER_M  || '0.67');
  const AI_PRICE_EUR_PER_M_OUTPUT = parseFloat(process.env.AI_PRICE_OUTPUT_PER_M || '4.00');

  function calcCostEurCents(inputTokens: number, outputTokens: number): number {
    const cost = (inputTokens / 1_000_000) * AI_PRICE_EUR_PER_M_INPUT
               + (outputTokens / 1_000_000) * AI_PRICE_EUR_PER_M_OUTPUT;
    return Math.max(1, Math.ceil(cost * 100));
  }

  // Monthly AI credit included per plan (EUR cents). Topped up once per month.
  const PLAN_AI_MONTHLY_CREDIT_CENTS: Record<string, number> = {
    trial: 0, starter: 50, pro: 200, enterprise: 1000,
  };

  // Prepaid credit packs
  const AI_CREDIT_PACKS: Record<string, { amount_cents: number; label: string }> = {
    pack_10: { amount_cents: 1000, label: '10 €' },
    pack_25: { amount_cents: 2500, label: '25 €' },
    pack_50: { amount_cents: 5000, label: '50 €' },
  };

  // Top up plan monthly allowance on first AI call of each month
  async function maybeRefreshMonthlyCredits(tenantId: string, plan: string): Promise<void> {
    const included = PLAN_AI_MONTHLY_CREDIT_CENTS[plan] ?? 0;
    const { data: tenant } = await supabaseAdmin.from('tenants')
      .select('ai_credit_last_refresh').eq('id', tenantId).single();
    const lastRefresh = (tenant as any)?.ai_credit_last_refresh;
    const firstOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
    if (!lastRefresh || lastRefresh < firstOfMonth) {
      if (included > 0) {
        await supabaseAdmin.rpc('increment_ai_credits', { p_tenant_id: tenantId, p_amount_cents: included });
      }
      await supabaseAdmin.from('tenants')
        .update({ ai_credit_last_refresh: new Date().toISOString() }).eq('id', tenantId);
    }
  }

  // Deduct cost from tenant balance and log usage
  async function deductAiCredit(params: {
    tenantId: string; userId: string;
    agentId: string | null; conversationId: string | null;
    endpointType: 'agent' | 'suggest_articles';
    inputTokens: number; outputTokens: number;
  }): Promise<{ newBalance: number; costCents: number }> {
    const costCents = calcCostEurCents(params.inputTokens, params.outputTokens);
    await supabaseAdmin.rpc('deduct_ai_credits', { p_tenant_id: params.tenantId, p_amount_cents: costCents });
    const { data: t } = await supabaseAdmin.from('tenants')
      .select('ai_credit_balance_eur_cents').eq('id', params.tenantId).single();
    const newBalance = (t as any)?.ai_credit_balance_eur_cents ?? 0;
    await supabaseAdmin.from('agent_token_usage').insert({
      tenant_id: params.tenantId, agent_id: params.agentId,
      user_id: params.userId, conversation_id: params.conversationId,
      tokens_used: params.inputTokens + params.outputTokens,
      input_tokens: params.inputTokens, output_tokens: params.outputTokens,
      cost_eur_cents: costCents, endpoint_type: params.endpointType,
    });
    return { newBalance, costCents };
  }

  async function getTenantPlan(tenantId: string): Promise<{ plan: string; trial_ends_at: string | null; is_expired: boolean }> {
    const { data } = await supabaseAdmin.from('tenants').select('plan, trial_ends_at').eq('id', tenantId).single();
    if (!data) return { plan: 'trial', trial_ends_at: null, is_expired: false };
    const isTrial = (data as any).plan === 'trial';
    const isExpired = isTrial && (data as any).trial_ends_at && new Date((data as any).trial_ends_at) < new Date();
    return {
      plan: isExpired ? 'expired' : (data as any).plan,
      trial_ends_at: (data as any).trial_ends_at ?? null,
      is_expired: !!isExpired,
    };
  }

  async function checkQuota(tenantId: string, resource: 'projects' | 'users' | 'documents'): Promise<void> {
    const { plan, is_expired } = await getTenantPlan(tenantId);
    if (is_expired) {
      const err: any = new Error("Votre période d'essai a expiré. Veuillez souscrire à un abonnement.");
      err.status = 402;
      throw err;
    }
    const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.trial;
    const limit = limits[resource];
    if (limit >= 999) return;
    let count = 0;
    if (resource === 'projects') {
      const { count: c } = await supabaseAdmin.from('projects').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId);
      count = c ?? 0;
    } else if (resource === 'users') {
      const { count: c } = await supabaseAdmin.from('profiles').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId);
      count = c ?? 0;
    } else if (resource === 'documents') {
      const { count: c } = await supabaseAdmin.from('documents').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId);
      count = c ?? 0;
    }
    if (count >= limit) {
      const err: any = new Error(`Limite du plan atteinte : ${limit} ${resource}. Passez à un plan supérieur.`);
      err.status = 402;
      throw err;
    }
  }

  // ─── Supabase Storage helpers ───────────────────────────────────────────────

  // These hold business documents (CCTP, plans, CVs, chat/feed attachments,
  // meeting-site photos) — private, unlike "logos" (agency branding/avatars),
  // which is meant to be public. uploadToStorage() below still returns a
  // getPublicUrl()-shaped string for these (that call just builds a URL
  // string; it doesn't check the bucket's actual public/private flag), so
  // every existing DB row keeps working as a stable object *reference* — see
  // server/storagePaths.ts and server/routes/storageAccess.ts, which exchange
  // that reference for a short-lived signed URL after checking the caller's
  // tenant owns it.
  async function ensureStorageBuckets() {
    for (const bucket of ['documents', 'plans', 'cv', 'message-attachments', 'feed-attachments', 'meeting-photos']) {
      const { data: existing } = await supabaseAdmin.storage.getBucket(bucket);
      if (!existing) {
        const { error } = await supabaseAdmin.storage.createBucket(bucket, { public: false, fileSizeLimit: 52428800 });
        if (error && !error.message.includes('already exists')) {
          console.error(`[storage] Failed to create bucket "${bucket}":`, error.message);
        } else {
          console.log(`[storage] Created bucket "${bucket}"`);
        }
      } else if ((existing as any).public) {
        // Migrates a bucket created by an older deploy (when these were
        // still `public: true`) — existing object URLs keep resolving the
        // same way, they just now require a signed URL instead of being
        // fetchable directly.
        const { error } = await supabaseAdmin.storage.updateBucket(bucket, { public: false });
        if (error) {
          console.error(`[storage] Failed to make bucket "${bucket}" private:`, error.message);
        } else {
          console.log(`[storage] Migrated bucket "${bucket}" to private`);
        }
      }
    }
  }

  async function uploadToStorage(bucket: string, storagePath: string, buffer: Buffer, mimetype: string): Promise<string> {
    const { error } = await supabaseAdmin.storage
      .from(bucket)
      .upload(storagePath, buffer, { contentType: mimetype, upsert: false });
    if (error) throw new Error(`Storage upload failed: ${error.message}`);
    const { data } = supabaseAdmin.storage.from(bucket).getPublicUrl(storagePath);
    return data.publicUrl;
  }

  async function deleteFromStorage(bucket: string, fileUrl: string) {
    const marker = `/object/public/${bucket}/`;
    const path = fileUrl.includes(marker) ? fileUrl.split(marker)[1] : fileUrl;
    await supabaseAdmin.storage.from(bucket).remove([path]).catch(() => {});
  }

  // ───────────────────────────────────────────────────────────────────────────

  // The local-auth routes are only ever registered when OFFLINE_MODE=true (see
  // above), so these entries are inert in the normal cloud deployment.
  const AUTH_EXEMPT = [
    "/api/health", "/api/public", "/api/billing/webhook",
    "/api/auth/local-status", "/api/auth/local-setup", "/api/auth/local-login",
    "/api/auth/cloud-link-status", "/api/auth/cloud-link", "/api/auth/cloud-link-import",
    // Zoho's and Google's OAuth redirects back to us are a bare browser
    // navigation — they can't carry our app's JWT. These recover the
    // tenant (and, for Google Calendar, the user) from a one-time state
    // nonce instead (server/oauthState.ts), not from req.user.
    "/api/zoho/callback", "/api/zoho-books/callback", "/api/google-calendar/callback",
    // Called by Ragic itself (external, no JWT) — authenticated via a
    // `secret` query param checked against the tenant's own ragic_api_key
    // inside the handler, not via our session auth. Was missing here, so
    // the auth middleware 401'd it before that check ever ran.
    "/api/ragic/webhook",
  ];

  app.use("/api", async (req: any, res: any, next: any) => {
    // Strip the query string before matching: req.originalUrl includes it
    // (req.path, the alternative, is relative to this middleware's "/api"
    // mount point and would silently break every other entry in the list
    // instead). The Zoho OAuth callbacks below always arrive as e.g.
    // /api/zoho/callback?code=...&state=..., so matching the raw
    // originalUrl could never succeed for them.
    const pathOnly = req.originalUrl.split("?")[0];
    if (AUTH_EXEMPT.some(p => pathOnly === p || pathOnly.startsWith(p + "/"))) {
      return next();
    }
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "Authentification requise" });
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !user) return res.status(401).json({ error: "Token invalide" });
    req.user = user;
    next();
  });

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  async function requireTenantAdmin(userId: string): Promise<string> {
    const tenantId = await getTenantId(userId);
    if ((await getSystemRole(tenantId, userId)) !== 'admin') {
      const err: any = new Error("Réservé aux administrateurs de l'agence");
      err.status = 403;
      throw err;
    }
    return tenantId;
  }

  async function isAdmin(tenantId: string, userId: string): Promise<boolean> {
    return (await getSystemRole(tenantId, userId)) === 'admin';
  }

  // Allows: the person themselves, a tenant admin, or the target's direct manager (profiles.manager_id).
  async function requireManagerOf(tenantId: string, targetUserId: string, actingUserId: string): Promise<void> {
    if (targetUserId === actingUserId) return;
    const { data: acting } = await supabaseAdmin.from('profiles').select('system_role').eq('id', actingUserId).eq('tenant_id', tenantId).single();
    if (acting?.system_role === 'admin') return;
    const { data: target } = await supabaseAdmin.from('profiles').select('manager_id').eq('id', targetUserId).eq('tenant_id', tenantId).single();
    if (target?.manager_id === actingUserId) return;
    const err: any = new Error("Réservé au manager de cette personne ou à un administrateur");
    err.status = 403;
    throw err;
  }

  // Resolves the set of profile ids that report to `managerId` (direct reports only).
  // If `includeAllForAdmin` is true and the manager is a tenant admin, returns every profile in the tenant instead.
  async function resolveReportIds(tenantId: string, managerId: string, includeAllForAdmin: boolean): Promise<string[]> {
    if (includeAllForAdmin) {
      const { data: acting } = await supabaseAdmin.from('profiles').select('system_role').eq('id', managerId).eq('tenant_id', tenantId).single();
      if (acting?.system_role === 'admin') {
        const { data: all } = await supabaseAdmin.from('profiles').select('id').eq('tenant_id', tenantId);
        return (all || []).map((p: any) => p.id);
      }
    }
    const { data: reports } = await supabaseAdmin.from('profiles').select('id').eq('tenant_id', tenantId).eq('manager_id', managerId);
    return (reports || []).map((p: any) => p.id);
  }

  // Callers are expected to reject implausible ranges before this point (see
  // POST /api/leave_requests) — this cap is a second line of defense so a
  // pathological date pair (e.g. years apart) can't block the event loop by
  // iterating day-by-day for the life of the request.
  const BUSINESS_DAYS_MAX_SPAN = 3660; // ~10 years
  function businessDaysBetween(startDateStr: string, endDateStr: string): number {
    let count = 0;
    let d = new Date(startDateStr + 'T00:00:00Z');
    const end = new Date(endDateStr + 'T00:00:00Z');
    let iterations = 0;
    while (d <= end) {
      if (++iterations > BUSINESS_DAYS_MAX_SPAN) {
        const err: any = new Error('Intervalle de dates trop grand');
        err.status = 400;
        throw err;
      }
      const day = d.getUTCDay();
      if (day !== 0 && day !== 6) count++;
      d.setUTCDate(d.getUTCDate() + 1);
    }
    return count;
  }

  // ── Activity Feed ──────────────────────────────────────────────────────────

  const logActivity = async (tenantId: string, userId: string, userName: string, action: string, target: string, targetId: string, targetType: string, category: string) => {
    try {
      const { error } = await supabaseAdmin.from('activities').insert({
        id: crypto.randomUUID(),
        tenant_id: tenantId,
        user_id: userId,
        user_name: userName,
        action,
        target,
        target_id: targetId,
        target_type: targetType,
        category,
        created_at: new Date().toISOString()
      });
      if (error) console.error('[logActivity] insert failed:', error);
    } catch (e) {
      console.error('[logActivity] unexpected error:', e);
    }
  };

  const getUserName = async (tenantId: string, userId: string, email?: string): Promise<string> => {
    // profiles is the live source of truth for a user's display name — team_members
    // is no longer written to anywhere (POST/PUT /api/team both write to profiles).
    const { data: me } = await supabaseAdmin.from('profiles').select('name').eq('id', userId).eq('tenant_id', tenantId).maybeSingle();
    return (me as any)?.name || email?.split('@')[0] || 'Utilisateur';
  };

  // ── End Activity Feed ───────────────────────────────────────────────────────

  // Auto-numbering (PREFIX-YEAR-SEQ) shared by notesHonoraires.ts,
  // proposals.ts and invoices.ts — bound to supabaseAdmin here since
  // server/getNextDocNumber.ts is a standalone module, not a createApp() closure.
  const getNextDocNumber = (tenantId: string, settingCol: string, countTable: string, defaultPrefix: string) =>
    getNextDocNumberImpl(supabaseAdmin, tenantId, settingCol, countTable, defaultPrefix);

  // Per-affaire business-reference numbering for acompte invoices — see
  // server/getNextAffaireInvoiceNumber.ts. Bound to supabaseAdmin the same
  // way as getNextDocNumber above.
  const getNextAffaireInvoiceNumber = (tenantId: string, projectId: string) =>
    getNextAffaireInvoiceNumberImpl(supabaseAdmin, tenantId, projectId);

  // Phase 7 pilot: Project Templates / ACT Data / DET Data now live in
  // server/routes/*.ts — see those files for why they were picked first
  // (small, self-contained, low traffic) and server/tenantScopedFrom.ts for
  // the shared data-access helper they use instead of a hand-written
  // `.eq('tenant_id', tenantId)` on each query.
  registerProjectTemplateRoutes(app, { supabaseAdmin, getTenantId });
  registerActDataRoutes(app, { supabaseAdmin, getTenantId });
  registerDetDataRoutes(app, { supabaseAdmin, getTenantId });
  registerDpgfRoutes(app, { supabaseAdmin, getTenantId, getUserName, logActivity });
  registerSituationRoutes(app, { supabaseAdmin, getTenantId, getUserName, logActivity });
  registerCctpRoutes(app, { supabaseAdmin, getTenantId });
  registerCustomReferenceRoutes(app, { supabaseAdmin, getTenantId });
  registerProjectMemberRoutes(app, { supabaseAdmin, getTenantId });
  registerProjectPhaseHistoryRoutes(app, { supabaseAdmin, getTenantId, getUserName, logActivity });
  registerGlobalSearchRoutes(app, { supabaseAdmin, getTenantId });
  registerObservationRoutes(app, { supabaseAdmin, getTenantId, getUserName, logActivity });
  registerMeetingRoutes(app, { supabaseAdmin, getTenantId, getUserName, logActivity, uploadToStorage, deleteFromStorage });
  registerMeetingAttendeeRoutes(app, { supabaseAdmin, getTenantId });
  registerDocumentTemplateRoutes(app, { supabaseAdmin, getTenantId, getUserName, logActivity });
  registerContratsMoeRoutes(app, { supabaseAdmin, getTenantId, captureWithContext });
  registerNotesHonorairesRoutes(app, { supabaseAdmin, getTenantId, captureWithContext, getNextDocNumber });
  registerProfileRoutes(app, { supabaseAdmin, getTenantId, uploadToStorage, deleteFromStorage });
  registerActivityFeedRoutes(app, { supabaseAdmin, getTenantId, getUserName, uploadToStorage, captureWithContext });
  registerMessagingRoutes(app, { supabaseAdmin, getTenantId, uploadToStorage });
  registerContactSyncRoutes(app, { supabaseAdmin, getTenantId });
  registerGeoProxyRoutes(app);
  registerMafRoutes(app, { supabaseAdmin, getTenantId });
  registerTimeTrackingRoutes(app, { supabaseAdmin, getTenantId, getUserName, logActivity, requireManagerOf, resolveReportIds, isAdmin, requireTenantAdmin });
  registerLeaveRoutes(app, { supabaseAdmin, getTenantId, getUserName, logActivity, requireManagerOf, resolveReportIds, isAdmin, requireTenantAdmin, businessDaysBetween });
  registerTenderRoutes(app, { supabaseAdmin, getTenantId, getUserName, logActivity, captureWithContext });
  registerTenderRssRoutes(app, { supabaseAdmin, getTenantId, getUserName, logActivity });
  registerMilestoneRoutes(app, { supabaseAdmin, getTenantId });
  registerSpecificationRoutes(app, { supabaseAdmin, getTenantId, getUserName, logActivity });
  registerContactRoutes(app, { supabaseAdmin, getTenantId, getUserName, logActivity });
  registerSuperAdminRoutes(app, { supabaseAdmin });
  registerMarchesEntreprisesRoutes(app, { supabaseAdmin, getTenantId });
  registerBillingRoutes(app, { supabaseAdmin, getTenantId, PLAN_LIMITS, PLAN_AI_MONTHLY_CREDIT_CENTS, AI_CREDIT_PACKS });
  registerZohoInvoiceRoutes(app, { supabaseAdmin, getTenantId, getUserName, logActivity });
  registerGoogleCalendarSyncRoutes(app, { supabaseAdmin, getTenantId, getUserName, logActivity });
  registerZohoBooksRoutes(app, { supabaseAdmin, getTenantId, getUserName, logActivity });
  registerRagicRoutes(app, { supabaseAdmin, getTenantId });
  registerOdooRoutes(app, { supabaseAdmin, getTenantId, getUserName, logActivity });
  registerSuperpdpRoutes(app, { supabaseAdmin, getTenantId });
  registerChorusProRoutes(app, { supabaseAdmin, getTenantId, getUserName, logActivity });
  registerRegistrationRoutes(app, { supabaseAdmin });
  registerAgencySetupRoutes(app, { supabaseAdmin });
  registerTeamRoutes(app, { supabaseAdmin, getTenantId, requireTenantAdmin, checkQuota });
  registerProposalRoutes(app, { supabaseAdmin, getTenantId, getUserName, logActivity, captureWithContext, getNextDocNumber, upload });
  registerInvoiceRoutes(app, { supabaseAdmin, getTenantId, getUserName, logActivity, captureWithContext, getNextDocNumber, getNextAffaireInvoiceNumber });
  registerOrdresDeServiceRoutes(app, { supabaseAdmin, getTenantId, getUserName, logActivity });
  registerVisaRoutes(app, { supabaseAdmin, getTenantId, uploadToStorage });
  registerReceptionRoutes(app, { supabaseAdmin, getTenantId });
  registerReserveRoutes(app, { supabaseAdmin, getTenantId, getUserName, logActivity });
  registerGpaReserveRoutes(app, { supabaseAdmin, getTenantId, getUserName, logActivity });
  registerPermitRoutes(app, { supabaseAdmin, getTenantId });
  registerRfiRoutes(app, { supabaseAdmin, getTenantId });
  registerProjectRoutes(app, { supabaseAdmin, getTenantId, getUserName, logActivity, checkQuota, captureWithContext, requireRole });
  registerPlanRoutes(app, { supabaseAdmin, getTenantId, uploadToStorage, deleteFromStorage });
  registerDocumentRoutes(app, { supabaseAdmin, getTenantId, getUserName, logActivity, checkQuota, uploadToStorage, deleteFromStorage, requireRole });
  registerTaskRoutes(app, { supabaseAdmin, getTenantId, getUserName, logActivity });
  registerSendEmailRoutes(app, { supabaseAdmin, getTenantId });
  registerSiteReportRoutes(app, { supabaseAdmin, getTenantId, getUserName, logActivity, captureWithContext });
  registerSettingsRoutes(app, { supabaseAdmin, getTenantId, requireTenantAdmin });
  registerUploadRoutes(app, { supabaseAdmin, getTenantId, uploadToStorage, requireRole });
  registerStorageAccessRoutes(app, { supabaseAdmin, getTenantId });
  registerLotRoutes(app, { supabaseAdmin, getTenantId });
  registerAiSuggestionRoutes(app, { supabaseAdmin, getTenantId, getTenantPlan, maybeRefreshMonthlyCredits, deductAiCredit });
  registerCopilotSuggestionRoutes(app, { supabaseAdmin, getTenantId });

  // Phase 7: DPGF (items + parents) and Situations (+ detail lines) now live
  // in server/routes/dpgf.ts and server/routes/situations.ts — registered
  // above alongside the other extracted domains.

  // Phase 7: CCTPs update/delete now live in server/routes/cctps.ts.

  // Phase 7: Custom References now live in server/routes/customReferences.ts.

  // Phase 7: Project Members, Project Phase History, and Global Search now
  // live in server/routes/projectMembers.ts, projectPhaseHistory.ts, and
  // globalSearch.ts.

  // ── Agents IA ─────────────────────────────────────────────────────────────
  // Logique métier dans @zinkh/archioffice-agents (package privé, licence propriétaire)
  const { registerAgentRoutes } = await import('@zinkh/archioffice-agents/server');
  registerAgentRoutes(app, supabaseAdmin, getTenantId, getTenantPlan, {
    deductAiCredit,
    maybeRefreshMonthlyCredits,
    PLAN_AI_MONTHLY_CREDIT_CENTS,
    baseUrl: `http://127.0.0.1:${PORT}`,
  });


  // Must be registered after all routes but before the SPA fallback below —
  // catches anything that reaches Express's default error handling (routes
  // that call next(err), or throw outside a try/catch) that the per-route
  // catch blocks above didn't already report via captureConsoleIntegration.
  Sentry.setupExpressErrorHandler(app);

  const distPath = path.join(process.cwd(), "dist");
  const isProduction = process.env.NODE_ENV === "production" || fs.existsSync(path.join(distPath, "index.html"));

  // Vite middleware for development (dynamic import so vite devDep is not needed in production)
  if (!isProduction) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "custom",
    });
    app.use(vite.middlewares);

    // Custom SPA fallback for dev
    app.use("*", async (req, res, next) => {
      if (req.path.startsWith("/api/")) return next();
      if (req.path.match(/\.[a-zA-Z0-9]+$/)) {
        return res.status(404).send("Not found");
      }
      try {
        const url = req.originalUrl;
        let template = fs.readFileSync(path.resolve(process.cwd(), "index.html"), "utf-8");
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({ "Content-Type": "text/html" }).end(template);
      } catch (e) {
        console.error("[server.ts:10601]", e);
        vite.ssrFixStacktrace(e as Error);
        next(e);
      }
    });

  } else {
    // Production serving
    app.use(express.static(distPath));

    // Specifically handle missing assets (like CSS, JS, etc.) to avoid sending index.html and causing loops
    app.use((req, res, next) => {
      // If request has a file extension, do not fall back to index.html
      if (req.path.match(/\.[a-zA-Z0-9]+$/)) {
        return res.status(404).send("Not found");
      }
      next();
    });

    // SPA fallback for production
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  return { app, supabaseAdmin, ensureStorageBuckets, PORT };
}

// Thin wrapper kept separate from createApp() so Supertest (and anything else
// that just needs a handle on `app`) can import createApp() without binding a
// real port — see tests/testServer.ts. Production startup is unchanged: this
// is still the only thing invoked at module load.
async function startServer() {
  const { app, supabaseAdmin, ensureStorageBuckets, PORT } = await createApp();
  // In offline (Electron) mode this server is the local Supabase gateway for
  // supabaseAdmin itself (server/offlineGateway.ts) — it has no reason to be
  // reachable from the LAN/Wi-Fi, so bind it to loopback only there. Docker/
  // cloud deployments still need 0.0.0.0 to accept the container's incoming
  // traffic.
  const host = process.env.OFFLINE_MODE === 'true' ? '127.0.0.1' : '0.0.0.0';
  // Start listening after all middleware is set up
  app.listen(PORT, host, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    if (process.env.OFFLINE_MODE === 'true') {
      ensureStorageBuckets();
    }
    // Veille RSS des appels d'offres — sondage périodique (server/tenderRssPoller.ts).
    // Démarré ici (pas plus tôt) car en mode offline, supabaseAdmin boucle sur le
    // shim REST de ce même serveur, qui n'accepte les requêtes qu'une fois à l'écoute.
    startTenderRssPolling(supabaseAdmin);
    // RGPD — purge automatisée des cabinets dont le délai de grâce de
    // fermeture (30 jours, server/routes/settings.ts) est écoulé.
    startTenantPurge(supabaseAdmin);
    // Auto-archivage du flux d'activité selon la durée de rétention réglée
    // par catégorie (server/notificationArchiver.ts).
    startNotificationArchiver(supabaseAdmin);
  });
}

// Vitest sets process.env.VITEST — skip the real listen() when this module is
// merely imported for its createApp() export (Supertest drives the app
// in-process instead; see tests/testServer.ts). Production entry point is
// unaffected: nothing outside a Vitest run ever sets this variable.
if (!process.env.VITEST) {
  startServer().catch((err) => {
    console.error("Failed to start server:", err);
    Sentry.captureException(err);
    process.exit(1);
  });
}
