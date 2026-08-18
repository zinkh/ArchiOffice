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
import { createOAuthState, consumeOAuthState } from '../oauthState';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  getUserName: (tenantId: string, userId: string, email?: string) => Promise<string>;
  logActivity: (tenantId: string, userId: string, userName: string, action: string, target: string, targetId: string, targetType: string, category: string) => void;
}

export function registerZohoInvoiceRoutes(app: Express, { supabaseAdmin, getTenantId, getUserName, logActivity }: RouteDeps) {
  let zohoAccessTokenCache: { token: string; expiresAt: number } | null = null;

  async function getZohoAccessToken(settings: any): Promise<string> {
    const now = Date.now();
    if (zohoAccessTokenCache && zohoAccessTokenCache.expiresAt > now + 60000) {
      return zohoAccessTokenCache.token;
    }
    const dc = settings.zoho_data_center || 'com';
    const params = new URLSearchParams({
      refresh_token: settings.zoho_refresh_token,
      client_id: settings.zoho_client_id,
      client_secret: settings.zoho_client_secret,
      grant_type: 'refresh_token',
    });
    const resp = await axios.post(
      `https://accounts.zoho.${dc}/oauth/v2/token`,
      params.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    const { access_token, expires_in } = resp.data;
    if (!access_token) throw new Error('Zoho token refresh failed: ' + JSON.stringify(resp.data));
    zohoAccessTokenCache = { token: access_token, expiresAt: now + (expires_in || 3600) * 1000 };
    return access_token;
  }

  async function getOrCreateZohoCustomer(apiBase: string, headers: any, name: string): Promise<string> {
    try {
      const search = await axios.get(`${apiBase}/contacts`, {
        headers,
        params: { contact_name_contains: name, per_page: 5 }
      });
      const contacts: any[] = search.data.contacts || [];
      if (contacts.length > 0) return contacts[0].contact_id;
    } catch (_) {
      console.error("[getOrCreateZohoCustomer]", _);}
    const create = await axios.post(`${apiBase}/contacts`, {
      contact_name: name,
      contact_type: 'customer'
    }, { headers });
    return create.data.contact.contact_id;
  }

  function mapZohoStatus(zohoStatus: string): string | null {
    const map: Record<string, string> = {
      draft: 'Draft', sent: 'Sent', paid: 'Paid', overdue: 'Overdue', void: 'Draft'
    };
    return map[zohoStatus] ?? null;
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
      authUrl.searchParams.set('state', createOAuthState(tenantId));
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
    const consumed = consumeOAuthState(state);
    const tenantId = consumed?.tenantId;
    if (oauthError || !code || !tenantId) {
      return res.redirect('/settings?zoho_error=1');
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
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );
      const { refresh_token } = resp.data;
      if (!refresh_token) throw new Error('No refresh_token in response');
      zohoAccessTokenCache = null; // invalidate cache
      await supabaseAdmin.from('settings').update({ zoho_refresh_token: refresh_token }).eq('tenant_id', tenantId);
      res.redirect('/settings?zoho_connected=1');
    } catch (error: any) {
      console.error('[Zoho callback error]', error.message);
      res.redirect('/settings?zoho_error=1');
    }
  });

  // DELETE /api/zoho/disconnect
  app.delete('/api/zoho/disconnect', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      zohoAccessTokenCache = null;
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

      const accessToken = await getZohoAccessToken(settings);
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
      const { data: localInvoices } = await supabaseAdmin.from('invoices').select('*, projects(name)').eq('tenant_id', tenantId).or('zoho_invoice_id.is.null,zoho_invoice_id.eq.');
      const invoicesArr = (localInvoices || []).map((inv: any) => ({ ...inv, project_name: inv.projects?.name || null }));

      for (const inv of invoicesArr) {
        try {
          const customerName = inv.project_name || inv.description || 'Client';
          const customerId = await getOrCreateZohoCustomer(apiBase, headers, customerName);
          const lineItems = (inv.items && inv.items.length)
            ? inv.items.map((item: any) => ({
                description: item.description,
                quantity: item.quantity || 1,
                rate: item.unit_price ?? item.amount ?? 0,
                tax_percentage: item.vat_rate || 0,
              }))
            : [{
                description: inv.description || 'Honoraires',
                quantity: 1,
                rate: inv.amount || 0,
                tax_percentage: inv.vat_rate || 0,
              }];

          const payload: any = {
            customer_id: customerId,
            date: (inv.issue_date || new Date().toISOString()).split('T')[0],
            due_date: inv.due_date ? inv.due_date.split('T')[0] : undefined,
            line_items: lineItems,
            notes: inv.description || undefined,
          };
          if (inv.invoice_number) payload.invoice_number = inv.invoice_number;

          const resp = await axios.post(`${apiBase}/invoices`, payload, { headers });
          const zohoId = resp.data?.invoice?.invoice_id;
          if (zohoId) {
            await supabaseAdmin.from('invoices').update({ zoho_invoice_id: zohoId }).eq('id', inv.id).eq('tenant_id', tenantId);
            pushed++;
          }
        } catch (err: any) {
          console.error("[POST /api/zoho/sync]", err);
          errors.push(`Envoi échoué (${inv.invoice_number || inv.id}): ${err.response?.data?.message || err.message}`);
        }
      }

      // 2. Pull status updates from Zoho
      try {
        const resp = await axios.get(`${apiBase}/invoices`, { headers, params: { per_page: 200 } });
        const zohoInvoices: any[] = resp.data?.invoices || [];
        for (const zohoInv of zohoInvoices) {
          const { data: local } = await supabaseAdmin.from('invoices').select('id, status').eq('zoho_invoice_id', zohoInv.invoice_id).eq('tenant_id', tenantId).single();
          if (local) {
            const newStatus = mapZohoStatus(zohoInv.status);
            if (newStatus && newStatus !== (local as any).status) {
              await supabaseAdmin.from('invoices').update({ status: newStatus }).eq('id', (local as any).id).eq('tenant_id', tenantId);
              pulled++;
            }
          }
        }
      } catch (err: any) {
        console.error("[POST /api/zoho/sync]", err);
        errors.push(`Récupération échouée: ${err.response?.data?.message || err.message}`);
      }

      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Synchronisation Zoho (${pushed} envoyée(s), ${pulled} reçue(s))`, '', tenantId, 'integration', 'Intégrations');
      res.json({ pushed, pulled, errors });
    } catch (error: any) {
      console.error('[Zoho sync error]', error.message);
      res.status(500).json({ error: error.message || 'Sync échouée' });
    }
  });
}
