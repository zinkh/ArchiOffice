// Phase 7 extraction — moved out of server.ts's "─── Zoho Invoice
// Integration ───" section. Reads/writes the `invoices` table only to sync
// its `status`/`zoho_invoice_id` fields — it never creates, edits, or
// deletes an invoice's actual content, so this is lower-risk than the
// still-deferred Invoices CRUD domain itself despite touching the same
// table. Does not use tenantScopedFrom: several calls filter by
// zoho_invoice_id (not id) or update `settings`, which tenantScopedFrom's
// simple .eq('id', ...) chaining wasn't designed around — kept as the
// original explicit `.eq('tenant_id', tenantId)` chains instead.
//
// OAuth flow fix (found while writing this batch's tests): /api/zoho/auth
// used to res.redirect() straight to Zoho, and the frontend triggered it
// via `window.location.href = '/api/zoho/auth'` — a bare browser
// navigation, which never carries our app's JWT, so the auth middleware
// 401'd before the handler ever ran. It now returns { url } as JSON for an
// authenticated fetch to call, and the frontend navigates to that URL
// itself (see src/pages/Settings.tsx). The callback route is exempted from
// auth in server.ts (AUTH_EXEMPT) since Zoho's redirect back can't carry a
// JWT either; it recovers the tenant from the one-time `state` nonce
// instead (server/oauthState.ts) — using the bare tenantId as state, like
// before, would let anyone who learns a tenant's UUID hijack the OAuth
// grant for that tenant.
import type { Express } from 'express';
import axios from 'axios';
import { createOAuthState, consumeOAuthState, oauthErrorParam } from '../oauthState';
import { encryptSecret, decryptSecretMaybe } from '../secretsCrypto';
import {
  ZOHO_TIMEOUT_MS, ZOHO_MAX_PUSH_PER_RUN, ZOHO_PAGE_SIZE, ZOHO_MAX_PULL_PAGES,
  mapZohoStatus, zohoDate, zohoLineItems, localInvoicesByZohoId, isRateLimited,
  zohoInvoiceToLocalRow,
} from '../zohoSync';
import { loadInvoiceClientContact, resolveOrCreateContactFromExternal, type ClientContactInfo } from '../invoiceClientContact';

/**
 * A Zoho Invoice contact payload from our own client info — shared by the
 * per-invoice push (pushInvoiceToZohoInvoice) and the bulk backlog push
 * (getOrCreateZohoCustomer below), so a customer created either way carries
 * the same mentions. Zoho Invoice's contact object has no native French
 * SIRET field, so it's recorded in `notes` — still visible on the contact
 * record in Zoho, rather than silently dropped.
 */
function buildZohoContactPayload(info: ClientContactInfo) {
  const hasAddress = !!(info.address || info.city || info.zip || info.country);
  return {
    contact_name: info.name,
    company_name: info.name,
    contact_type: 'customer',
    email: info.email || undefined,
    phone: info.phone || undefined,
    billing_address: hasAddress ? {
      address: info.address || undefined, city: info.city || undefined,
      zip: info.zip || undefined, country: info.country || undefined,
    } : undefined,
    notes: info.siret ? `SIRET : ${info.siret}` : undefined,
  };
}

/** Best-effort: a contact that vanished or errors out just falls back to the bare name on the invoice. */
async function fetchZohoContactDetail(apiBase: string, headers: any, contactId: string | undefined): Promise<any | null> {
  if (!contactId) return null;
  try {
    const resp = await axios.get(`${apiBase}/contacts/${contactId}`, { headers, timeout: ZOHO_TIMEOUT_MS });
    return resp.data?.contact || null;
  } catch {
    return null;
  }
}

/**
 * Zoho's contact detail has no native SIRET field either (see
 * buildZohoContactPayload above) — read back from the same `notes`
 * convention this integration writes on push, so a round trip (push then
 * pull, or a contact a human typed the SIRET into by hand the same way)
 * doesn't lose it.
 */
function zohoContactToClientInfo(contact: any, fallbackName: string): ClientContactInfo {
  const addr = contact?.billing_address || {};
  const notesSiret = typeof contact?.notes === 'string' ? contact.notes.match(/SIRET\s*:\s*(\S+)/i)?.[1] : undefined;
  return {
    name: contact?.contact_name || contact?.company_name || fallbackName,
    email: contact?.email || undefined,
    phone: contact?.phone || contact?.mobile || undefined,
    address: addr.address || undefined,
    city: addr.city || undefined,
    zip: addr.zip || undefined,
    country: addr.country || undefined,
    siret: notesSiret,
  };
}

/**
 * The local contact a pulled Zoho invoice's customer resolves to — matched
 * or created via resolveOrCreateContactFromExternal. One extra Zoho call
 * (contact detail), only for a customer this pull hasn't resolved yet.
 */
async function resolveZohoCustomerAsLocalContact(
  apiBase: string, headers: any, supabaseAdmin: any, tenantId: string,
  customerId: string | undefined, customerName: string | undefined,
): Promise<string | null> {
  if (!customerId && !customerName) return null;
  const detail = await fetchZohoContactDetail(apiBase, headers, customerId);
  const info = zohoContactToClientInfo(detail, customerName || '');
  return resolveOrCreateContactFromExternal(supabaseAdmin, tenantId, info);
}

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  getUserName: (tenantId: string, userId: string, email?: string) => Promise<string>;
  logActivity: (tenantId: string, userId: string, userName: string, action: string, target: string, targetId: string, targetType: string, category: string) => void;
}

/**
 * Pushes ONE invoice to Zoho Invoice at creation time, for
 * server/invoiceAccountingSync.ts — distinct from the bulk `/api/zoho/sync`
 * loop above (which pushes a backlog and has its own rate-limit/pagination
 * concerns). No token cache here: this runs at most once per invoice
 * creation, not per sync run, so the extra token refresh is not worth the
 * cross-request cache's staleness/leak surface (see the module header on
 * why that cache is keyed by tenant).
 *
 * Idempotent by construction: `reference_number` carries the caller's
 * `idempotencyKey` (the local invoice id), and Zoho invoices are searched by
 * it before creating — a retry after a lost response (network cut after
 * Zoho accepted the invoice but before we read the reply) finds and reuses
 * the same Zoho invoice instead of creating a second one.
 */
export async function pushInvoiceToZohoInvoice(
  supabaseAdmin: any,
  tenantId: string,
  inv: any,
  idempotencyKey: string,
): Promise<{ external_id: string; invoice_number: string; status: string }> {
  const { data: settings } = await supabaseAdmin.from('settings').select('*').eq('tenant_id', tenantId).single();
  const s = settings as any;
  if (!s?.zoho_refresh_token) throw new Error('Zoho Invoice non connecté');

  const dc = s.zoho_data_center || 'com';
  const params = new URLSearchParams({
    refresh_token: decryptSecretMaybe(s.zoho_refresh_token),
    client_id: s.zoho_client_id,
    client_secret: s.zoho_client_secret,
    grant_type: 'refresh_token',
  });
  const tokenResp = await axios.post(
    `https://accounts.zoho.${dc}/oauth/v2/token`, params.toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: ZOHO_TIMEOUT_MS },
  );
  const accessToken = tokenResp.data?.access_token;
  if (!accessToken) throw new Error(`Échec du rafraîchissement du jeton Zoho${tokenResp.data?.error ? ` (${tokenResp.data.error})` : ''}`);

  const apiBase = `https://invoice.zoho.${dc}/api/v3`;
  const headers = {
    Authorization: `Zoho-oauthtoken ${accessToken}`,
    'X-com-zoho-invoice-organizationid': s.zoho_org_id,
    'Content-Type': 'application/json',
  };

  // Idempotency check: an invoice already carrying this reference_number
  // means a previous attempt succeeded on Zoho's side even if we never saw
  // the response — reuse it rather than create a duplicate.
  const existing = await axios.get(`${apiBase}/invoices`, {
    headers, params: { reference_number: idempotencyKey, per_page: 1 }, timeout: ZOHO_TIMEOUT_MS,
  });
  const already = (existing.data?.invoices || [])[0];
  if (already) {
    return { external_id: already.invoice_id, invoice_number: already.invoice_number, status: mapZohoStatus(already.status) || 'Draft' };
  }

  // The invoice's Maître d'Ouvrage, resolved from invoices.client_id (or its
  // project's client) — falls back to the old bare-name behaviour only when
  // neither the invoice nor its project has a contact at all, so an invoice
  // that predates client_id (or a general one with no contact chosen) still
  // pushes rather than failing outright.
  const clientInfo = await loadInvoiceClientContact(supabaseAdmin, tenantId, inv);
  const customerName = clientInfo?.name || inv.project_name || inv.description || 'Client';
  const search = await axios.get(`${apiBase}/contacts`, {
    headers, params: { contact_name: customerName, per_page: ZOHO_PAGE_SIZE }, timeout: ZOHO_TIMEOUT_MS,
  });
  const match = (search.data.contacts || []).find(
    (c: any) => typeof c?.contact_name === 'string' && c.contact_name.trim() === customerName.trim(),
  );
  const customerId = match
    ? match.contact_id
    : (await axios.post(
        `${apiBase}/contacts`,
        buildZohoContactPayload(clientInfo || { name: customerName }),
        { headers, timeout: ZOHO_TIMEOUT_MS },
      )).data.contact.contact_id;

  const payload: any = {
    customer_id: customerId,
    reference_number: idempotencyKey,
    date: zohoDate(inv.issue_date) || new Date().toISOString().split('T')[0],
    due_date: zohoDate(inv.due_date),
    line_items: zohoLineItems(inv),
    notes: inv.description || undefined,
  };
  const resp = await axios.post(`${apiBase}/invoices`, payload, { headers, timeout: ZOHO_TIMEOUT_MS });
  const created = resp.data?.invoice;
  if (!created?.invoice_id) throw new Error(resp.data?.message || 'Création Zoho échouée');
  return { external_id: created.invoice_id, invoice_number: created.invoice_number, status: mapZohoStatus(created.status) || 'Draft' };
}

export function registerZohoInvoiceRoutes(app: Express, { supabaseAdmin, getTenantId, getUserName, logActivity }: RouteDeps) {
  // Keyed by tenantId — this cache is shared by every request the process
  // handles across every tenant. A single unkeyed value here previously meant
  // whichever tenant refreshed last "won" the cache for up to an hour: any
  // other tenant syncing within that window would silently reuse the first
  // tenant's Zoho access token and operate against their Zoho account instead
  // of its own.
  const zohoAccessTokenCache = new Map<string, { token: string; expiresAt: number }>();

  async function getZohoAccessToken(tenantId: string, settings: any): Promise<string> {
    const now = Date.now();
    const cached = zohoAccessTokenCache.get(tenantId);
    if (cached && cached.expiresAt > now + 60000) {
      return cached.token;
    }
    const dc = settings.zoho_data_center || 'com';
    const params = new URLSearchParams({
      refresh_token: decryptSecretMaybe(settings.zoho_refresh_token),
      client_id: settings.zoho_client_id,
      client_secret: settings.zoho_client_secret,
      grant_type: 'refresh_token',
    });
    const resp = await axios.post(
      `https://accounts.zoho.${dc}/oauth/v2/token`,
      params.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: ZOHO_TIMEOUT_MS }
    );
    const { access_token, expires_in } = resp.data;
    if (!access_token) {
      // Zoho answers 200 with an { error } body for a dead/invalid refresh
      // token, so the status code alone tells us nothing. Surface just the
      // code: this message reaches the browser through /api/zoho/sync's error
      // response, and the raw body it used to stringify carries the client_id
      // and other request echoes with it.
      throw new Error(`Échec du rafraîchissement du jeton Zoho${resp.data?.error ? ` (${resp.data.error})` : ''}. Reconnectez Zoho dans les Paramètres.`);
    }
    zohoAccessTokenCache.set(tenantId, { token: access_token, expiresAt: now + (expires_in || 3600) * 1000 });
    return access_token;
  }

  async function getOrCreateZohoCustomer(apiBase: string, headers: any, info: ClientContactInfo): Promise<string> {
    // contact_name_contains matched substrings, so an invoice for "Dupont" bound
    // itself to an existing "Dupont-Martin" — the wrong client, silently, and
    // permanently once the invoice carried that contact_id. Ask Zoho for the
    // exact name and verify it, since contact_name is what we'd create anyway.
    const search = await axios.get(`${apiBase}/contacts`, {
      headers,
      params: { contact_name: info.name, per_page: ZOHO_PAGE_SIZE },
      timeout: ZOHO_TIMEOUT_MS,
    });
    const match = (search.data.contacts || []).find(
      (c: any) => typeof c?.contact_name === 'string' && c.contact_name.trim() === info.name.trim(),
    );
    if (match) return match.contact_id;

    // Note there's no try/catch around the search: swallowing a failed lookup
    // meant a transient Zoho error created a duplicate contact every time it
    // happened. Letting it throw fails this one invoice and leaves the next
    // sync able to find the contact that already exists.
    const create = await axios.post(`${apiBase}/contacts`, buildZohoContactPayload(info), { headers, timeout: ZOHO_TIMEOUT_MS });
    return create.data.contact.contact_id;
  }

  // GET /api/zoho/status
  app.get('/api/zoho/status', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: settings } = await supabaseAdmin.from('settings').select('zoho_client_id, zoho_client_secret, zoho_org_id, zoho_data_center, zoho_refresh_token').eq('tenant_id', tenantId).single();
      res.json({
        connected: !!(settings as any)?.zoho_refresh_token,
        has_credentials: !!((settings as any)?.zoho_client_id && (settings as any)?.zoho_client_secret && (settings as any)?.zoho_org_id),
      });
    } catch (error) {
      console.error("[GET /api/zoho/status]", error);
      res.status(500).json({ error: 'Failed to get Zoho status' });
    }
  });

  function getZohoRedirectUri(req: any): string {
    // ZOHO_REDIRECT_URI env var wins — lets the admin hardcode the exact registered URI
    if (process.env.ZOHO_REDIRECT_URI) return process.env.ZOHO_REDIRECT_URI;
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    const host  = req.headers['x-forwarded-host']  || req.get('host');
    return `${proto}://${host}/api/zoho/callback`;
  }

  // GET /api/zoho/callback-url  — returns the redirect URI the server will actually use
  app.get('/api/zoho/callback-url', (req, res) => {
    res.json({ url: getZohoRedirectUri(req) });
  });

  // GET /api/zoho/auth  — returns the Zoho OAuth consent-screen URL for the
  // authenticated caller's tenant. Called via an authenticated fetch (not a
  // bare navigation, which can't carry the JWT); the frontend then navigates
  // to the returned URL itself.
  app.get('/api/zoho/auth', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: settings } = await supabaseAdmin.from('settings').select('*').eq('tenant_id', tenantId).single();
      if (!(settings as any)?.zoho_client_id || !(settings as any)?.zoho_client_secret || !(settings as any)?.zoho_org_id) {
        return res.status(400).json({ error: 'Veuillez d\'abord enregistrer vos identifiants Zoho dans les Paramètres.' });
      }
      const dc = (settings as any).zoho_data_center || 'com';
      const redirectUri = getZohoRedirectUri(req);
      const scope = 'ZohoInvoice.invoices.READ,ZohoInvoice.invoices.CREATE,ZohoInvoice.invoices.UPDATE,ZohoInvoice.contacts.READ,ZohoInvoice.contacts.CREATE';
      const authUrl = new URL(`https://accounts.zoho.${dc}/oauth/v2/auth`);
      authUrl.searchParams.set('client_id', (settings as any).zoho_client_id);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('scope', scope);
      authUrl.searchParams.set('access_type', 'offline');
      authUrl.searchParams.set('prompt', 'consent');
      // One-time nonce mapping back to this tenant — see server/oauthState.ts.
      authUrl.searchParams.set('state', await createOAuthState(tenantId));
      res.json({ url: authUrl.toString() });
    } catch (error) {
      console.error("[GET /api/zoho/auth]", error);
      res.status(500).json({ error: 'Erreur lors de la connexion à Zoho' });
    }
  });

  // GET /api/zoho/callback  — Zoho redirects here after user grants access.
  // No JWT on this request (see the module header comment) — the tenant
  // comes from the one-time state nonce issued by /api/zoho/auth above.
  app.get('/api/zoho/callback', async (req: any, res: any) => {
    const { code, error: oauthError, state } = req.query as any;
    const consumed = await consumeOAuthState(state);
    const tenantId = consumed?.tenantId;
    if (oauthError || !code || !tenantId) {
      // `state` misses when the nonce expired (10 min), was already consumed, or
      // was minted by a server process that has since restarted — distinct from
      // Zoho refusing the grant, and worth telling the user apart.
      const reason = oauthError ? oauthErrorParam(oauthError) : (!code ? 'no_code' : 'expired_state');
      console.error('[GET /api/zoho/callback] no grant', { reason });
      return res.redirect(`/settings?zoho_error=${reason}`);
    }
    try {
      const { data: settings } = await supabaseAdmin.from('settings').select('*').eq('tenant_id', tenantId).single();
      const dc = (settings as any)?.zoho_data_center || 'com';
      const redirectUri = getZohoRedirectUri(req);
      const params = new URLSearchParams({
        code,
        client_id: (settings as any).zoho_client_id,
        client_secret: (settings as any).zoho_client_secret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      });
      const resp = await axios.post(
        `https://accounts.zoho.${dc}/oauth/v2/token`,
        params.toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: ZOHO_TIMEOUT_MS }
      );
      const { refresh_token } = resp.data;
      if (!refresh_token) {
        // Zoho answers 200 with an { error } body here (invalid_client,
        // invalid_code, redirect_uri mismatch, ...), so axios doesn't throw.
        // Logging and forwarding the code is the only way an admin can tell
        // which of their console settings is wrong — the old bare
        // `zoho_error=1` said nothing.
        console.error('[GET /api/zoho/callback] token exchange failed', { error: resp.data?.error });
        return res.redirect(`/settings?zoho_error=${oauthErrorParam(resp.data?.error)}`);
      }
      zohoAccessTokenCache.delete(tenantId); // invalidate cache
      await supabaseAdmin.from('settings').update({ zoho_refresh_token: encryptSecret(refresh_token) }).eq('tenant_id', tenantId);
      res.redirect('/settings?zoho_connected=1');
    } catch (error: any) {
      // Unlike the Books flow (plain fetch), axios throws on a non-2xx — and
      // Zoho returns 400 with { error: "invalid_client" } for exactly the
      // misconfigurations an admin needs to see. Without this, every one of
      // them landed here and became an indistinguishable `zoho_error=1`.
      const zohoError = error.response?.data?.error;
      console.error('[Zoho callback error]', error.response?.data ?? error.message);
      res.redirect(`/settings?zoho_error=${oauthErrorParam(zohoError)}`);
    }
  });

  // DELETE /api/zoho/disconnect
  app.delete('/api/zoho/disconnect', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      zohoAccessTokenCache.delete(tenantId);
      await supabaseAdmin.from('settings').update({ zoho_refresh_token: null }).eq('tenant_id', tenantId);
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, 'Déconnexion de Zoho', '', tenantId, 'integration', 'Intégrations');
      res.json({ success: true });
    } catch (error) {
      console.error("[DELETE /api/zoho/disconnect]", error);
      res.status(500).json({ error: 'Failed to disconnect Zoho' });
    }
  });

  // POST /api/zoho/sync  — bidirectional sync
  app.post('/api/zoho/sync', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: settings } = await supabaseAdmin.from('settings').select('*').eq('tenant_id', tenantId).single();
      if (!(settings as any)?.zoho_refresh_token) {
        return res.status(400).json({ error: 'Zoho non connecté. Veuillez vous connecter dans les Paramètres.' });
      }

      const accessToken = await getZohoAccessToken(tenantId, settings);
      const dc = (settings as any).zoho_data_center || 'com';
      const apiBase = `https://invoice.zoho.${dc}/api/v3`;
      const headers = {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        'X-com-zoho-invoice-organizationid': (settings as any).zoho_org_id,
        'Content-Type': 'application/json',
      };

      const errors: string[] = [];
      let pushed = 0;
      let pulled = 0;

      // 1. Push local invoices not yet in Zoho
      const { data: localInvoices, error: localInvoicesErr } = await supabaseAdmin
        .from('invoices').select('*, projects(name)').eq('tenant_id', tenantId)
        .or('zoho_invoice_id.is.null,zoho_invoice_id.eq.');
      // A failed query (e.g. a column PostgREST doesn't recognise — this table
      // was missing zoho_invoice_id in production for a while, see
      // supabase/migrate_add_invoices_zoho_invoice_id.sql) used to be silently
      // treated as "no invoices to push", which let a completely broken sync
      // report success. Throw instead.
      if (localInvoicesErr) throw new Error(`Lecture des factures locales échouée: ${localInvoicesErr.message}`);
      const invoicesArr = (localInvoices || []).map((inv: any) => ({ ...inv, project_name: inv.projects?.name || null }));
      // Bounded per run: the browser is waiting on this request, and each push
      // costs up to 3 Zoho calls. Each id is persisted as it goes, so the next
      // sync picks up exactly where this one stopped.
      const toPush = invoicesArr.slice(0, ZOHO_MAX_PUSH_PER_RUN);
      let remaining = invoicesArr.length - toPush.length;

      for (const inv of toPush) {
        try {
          const clientInfo = await loadInvoiceClientContact(supabaseAdmin, tenantId, inv);
          const customerName = clientInfo?.name || inv.project_name || inv.description || 'Client';
          const customerId = await getOrCreateZohoCustomer(apiBase, headers, clientInfo || { name: customerName });

          const payload: any = {
            customer_id: customerId,
            date: zohoDate(inv.issue_date) || new Date().toISOString().split('T')[0],
            due_date: zohoDate(inv.due_date),
            line_items: zohoLineItems(inv),
            notes: inv.description || undefined,
          };
          if (inv.invoice_number) payload.invoice_number = inv.invoice_number;

          const resp = await axios.post(`${apiBase}/invoices`, payload, { headers, timeout: ZOHO_TIMEOUT_MS });
          const zohoId = resp.data?.invoice?.invoice_id;
          if (zohoId) {
            await supabaseAdmin.from('invoices').update({ zoho_invoice_id: zohoId }).eq('id', inv.id).eq('tenant_id', tenantId);
            pushed++;
          }
        } catch (err: any) {
          console.error("[POST /api/zoho/sync]", err);
          if (isRateLimited(err.response?.status, err.response?.data)) {
            // Zoho's limiter only reopens on a timer — continuing would burn the
            // rest of the request on calls that are all going to be refused.
            remaining += toPush.length - pushed;
            errors.push('Limite de requêtes Zoho atteinte. Relancez la synchronisation dans quelques minutes.');
            break;
          }
          errors.push(`Envoi échoué (${inv.invoice_number || inv.id}): ${err.response?.data?.message || err.message}`);
        }
      }

      // 2. Pull status updates from Zoho
      try {
        // Paginated: this used to request a single page of 200 and stop, so a
        // tenant past 200 invoices in Zoho silently stopped receiving status
        // updates for everything after the first page.
        const zohoInvoices: any[] = [];
        for (let page = 1; page <= ZOHO_MAX_PULL_PAGES; page++) {
          const resp = await axios.get(`${apiBase}/invoices`, {
            headers,
            params: { page, per_page: ZOHO_PAGE_SIZE },
            timeout: ZOHO_TIMEOUT_MS,
          });
          zohoInvoices.push(...(resp.data?.invoices || []));
          if (!resp.data?.page_context?.has_more_page) break;
        }

        // One query for the whole batch instead of one per Zoho invoice.
        const localByZohoId = await localInvoicesByZohoId(
          supabaseAdmin, tenantId, zohoInvoices.map((z: any) => z.invoice_id),
        );
        for (const zohoInv of zohoInvoices) {
          const local = localByZohoId.get(zohoInv.invoice_id);
          if (!local) {
            // A Zoho invoice ArchiOffice has never recorded — most commonly one
            // created directly in Zoho, or a pre-existing invoice from before
            // this tenant connected the integration. The pull used to silently
            // skip these (`continue`), so nothing already sitting in Zoho at
            // connection time ever showed up in ArchiOffice — only invoices
            // pushed FROM here and then re-pulled came back with status updates.
            //
            // The customer isn't just a name here: without a matching or new
            // local contact, an imported invoice would carry no Maître
            // d'Ouvrage identity at all — no SIRET, address or phone, and no
            // way to attach one short of typing it by hand. One extra call
            // per genuinely new customer (never per invoice already known)
            // fetches the full Zoho contact so the local one is created with
            // real legal details instead of a bare name.
            const clientId = await resolveZohoCustomerAsLocalContact(apiBase, headers, supabaseAdmin, tenantId, zohoInv.customer_id, zohoInv.customer_name);
            const { error: importErr } = await supabaseAdmin
              .from('invoices').insert(zohoInvoiceToLocalRow(zohoInv, tenantId, clientId));
            if (importErr) {
              console.error("[POST /api/zoho/sync] import", importErr);
              errors.push(`Import échoué (${zohoInv.invoice_number || zohoInv.invoice_id}): ${importErr.message}`);
            } else {
              pulled++;
            }
            continue;
          }
          const newStatus = mapZohoStatus(zohoInv.status);
          if (newStatus && newStatus !== local.status) {
            await supabaseAdmin.from('invoices').update({ status: newStatus }).eq('id', local.id).eq('tenant_id', tenantId);
            pulled++;
          }
        }
      } catch (err: any) {
        console.error("[POST /api/zoho/sync]", err);
        errors.push(`Récupération échouée: ${err.response?.data?.message || err.message}`);
      }

      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Synchronisation Zoho (${pushed} envoyée(s), ${pulled} reçue(s))`, '', tenantId, 'integration', 'Intégrations');
      // `remaining` lets the UI say another run is needed instead of leaving the
      // user to guess why not everything went across.
      res.json({ pushed, pulled, remaining, errors });
    } catch (error: any) {
      console.error('[Zoho sync error]', error.message);
      res.status(500).json({ error: error.message || 'Sync échouée' });
    }
  });
}
