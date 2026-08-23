// Phase 7 extraction — moved out of server.ts's "─── Zoho Books
// Integration ───" section. Same profile as zohoInvoice.ts: syncs
// `invoices.status`/`zoho_invoice_id` only, no invoice content
// create/edit/delete, so lower-risk than the still-deferred Invoices CRUD
// domain despite touching the same table. Explicit `.eq('tenant_id', ...)`
// chains kept as-is rather than tenantScopedFrom, matching zohoInvoice.ts.
//
// OAuth flow fix (found while writing this batch's tests): the callback
// route used to call getTenantId(req.user.id) and never set/read a `state`
// param at all — but Zoho's redirect back is a bare browser navigation that
// carries neither our app's JWT nor req.user. It's fixed the same way as
// zohoInvoice.ts: /api/zoho-books/auth now returns { url } as JSON (called
// via authenticated fetch) with a one-time state nonce (server/
// oauthState.ts), and the callback (exempted from auth in server.ts)
// recovers the tenant from that nonce instead.
import type { Express } from 'express';
import { createOAuthState, consumeOAuthState } from '../oauthState';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  getUserName: (tenantId: string, userId: string, email?: string) => Promise<string>;
  logActivity: (tenantId: string, userId: string, userName: string, action: string, target: string, targetId: string, targetType: string, category: string) => void;
}

export function registerZohoBooksRoutes(app: Express, { supabaseAdmin, getTenantId, getUserName, logActivity }: RouteDeps) {
  // Keyed by tenantId — see the matching comment in zohoInvoice.ts. An
  // unkeyed single value here let one tenant's cached Zoho token leak to
  // whichever other tenant synced next within the ~1h expiry window.
  const zohoBooksAccessTokenCache = new Map<string, { token: string; expiresAt: number }>();

  async function getZohoBooksAccessToken(tenantId: string, settings: any): Promise<string> {
    const now = Date.now();
    const cached = zohoBooksAccessTokenCache.get(tenantId);
    if (cached && cached.expiresAt > now + 60000) {
      return cached.token;
    }
    const dc = settings.zoho_data_center || 'com';
    const params = new URLSearchParams({
      refresh_token: settings.zoho_refresh_token,
      client_id: settings.zoho_client_id,
      client_secret: settings.zoho_client_secret,
      grant_type: 'refresh_token',
    });
    const tokenRes = await fetch(`https://accounts.zoho.${dc}/oauth/v2/token`, { method: 'POST', body: params });
    const { access_token, expires_in } = await tokenRes.json() as any;
    if (!access_token) throw new Error('Failed to refresh Zoho Books access token');
    zohoBooksAccessTokenCache.set(tenantId, { token: access_token, expiresAt: now + (expires_in || 3600) * 1000 });
    return access_token;
  }

  function getZohoBooksCallbackUrl(req: any): string {
    const proto = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    return `${proto}://${host}/api/zoho-books/callback`;
  }

  // GET /api/zoho-books/status
  app.get('/api/zoho-books/status', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: settings } = await supabaseAdmin.from('settings').select('zoho_client_id, zoho_client_secret, zoho_org_id, zoho_books_org_id, zoho_data_center, zoho_refresh_token').eq('tenant_id', tenantId).single();
      res.json({
        connected: !!(settings as any)?.zoho_refresh_token,
        has_credentials: !!((settings as any)?.zoho_client_id && (settings as any)?.zoho_client_secret && ((settings as any)?.zoho_books_org_id || (settings as any)?.zoho_org_id)),
      });
    } catch (error: any) {
      console.error("[GET /api/zoho-books/status]", error);
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/zoho-books/auth  — returns the Zoho OAuth consent-screen URL
  // (Books scope) for the authenticated caller's tenant. Called via an
  // authenticated fetch; the frontend navigates to the returned URL itself.
  app.get('/api/zoho-books/auth', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: settings } = await supabaseAdmin.from('settings').select('zoho_client_id, zoho_data_center').eq('tenant_id', tenantId).single();
      if (!(settings as any)?.zoho_client_id) {
        return res.status(400).json({ error: 'Zoho credentials not configured' });
      }
      const dc = (settings as any).zoho_data_center || 'com';
      const redirectUri = getZohoBooksCallbackUrl(req);
      const authUrl = new URL(`https://accounts.zoho.${dc}/oauth/v2/auth`);
      authUrl.searchParams.set('client_id', (settings as any).zoho_client_id);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('scope', 'ZohoBooks.fullaccess.all');
      authUrl.searchParams.set('access_type', 'offline');
      authUrl.searchParams.set('prompt', 'consent');
      // One-time nonce mapping back to this tenant — see server/oauthState.ts.
      authUrl.searchParams.set('state', createOAuthState(tenantId));
      res.json({ url: authUrl.toString() });
    } catch (error: any) {
      console.error("[GET /api/zoho-books/auth]", error);
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/zoho-books/callback  — Zoho redirects here after user grants
  // access. No JWT on this request — the tenant comes from the one-time
  // state nonce issued by /api/zoho-books/auth above.
  app.get('/api/zoho-books/callback', async (req: any, res: any) => {
    const { code, error: oauthError, state } = req.query as any;
    const consumed = consumeOAuthState(state);
    const tenantId = consumed?.tenantId;
    if (oauthError || !code || !tenantId) return res.redirect('/settings?zoho_books_error=1');
    try {
      const { data: settings } = await supabaseAdmin.from('settings').select('zoho_client_id, zoho_client_secret, zoho_data_center').eq('tenant_id', tenantId).single();
      const dc = (settings as any)?.zoho_data_center || 'com';
      const redirectUri = getZohoBooksCallbackUrl(req);
      const params = new URLSearchParams({
        code, client_id: (settings as any).zoho_client_id,
        client_secret: (settings as any).zoho_client_secret,
        redirect_uri: redirectUri, grant_type: 'authorization_code',
      });
      const tokenRes = await fetch(`https://accounts.zoho.${dc}/oauth/v2/token`, { method: 'POST', body: params });
      const { refresh_token } = await tokenRes.json() as any;
      if (!refresh_token) return res.redirect('/settings?zoho_books_error=1');
      zohoBooksAccessTokenCache.delete(tenantId);
      await supabaseAdmin.from('settings').update({ zoho_refresh_token: refresh_token }).eq('tenant_id', tenantId);
      res.redirect('/settings?zoho_books_connected=1');
    } catch {
      console.error("[GET /api/zoho-books/callback] Unhandled error");
      res.redirect('/settings?zoho_books_error=1');
    }
  });

  // DELETE /api/zoho-books/disconnect
  app.delete('/api/zoho-books/disconnect', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      zohoBooksAccessTokenCache.delete(tenantId);
      await supabaseAdmin.from('settings').update({ zoho_refresh_token: null }).eq('tenant_id', tenantId);
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, 'Déconnexion de Zoho Books', '', tenantId, 'integration', 'Intégrations');
      res.json({ success: true });
    } catch (error: any) {
      console.error("[DELETE /api/zoho-books/disconnect]", error);
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/zoho-books/sync  — sync invoices/estimates with Zoho Books
  app.post('/api/zoho-books/sync', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: settings } = await supabaseAdmin.from('settings').select('*').eq('tenant_id', tenantId).single();
      if (!(settings as any)?.zoho_refresh_token) {
        return res.status(400).json({ error: 'Zoho Books non connecté' });
      }
      const dc = (settings as any).zoho_data_center || 'com';
      const orgId = (settings as any).zoho_books_org_id || (settings as any).zoho_org_id;
      const apiBase = `https://books.zoho.${dc}/api/v3`;
      const accessToken = await getZohoBooksAccessToken(tenantId, settings as any);
      const headers = {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        'Content-Type': 'application/json',
      };

      let pushed = 0, pulled = 0;
      const errors: string[] = [];

      // Push local invoices not yet in Zoho Books
      try {
        const { data: localInvoices } = await supabaseAdmin
          .from('invoices')
          .select('*, projects(name)')
          .eq('tenant_id', tenantId)
          .or('zoho_invoice_id.is.null,zoho_invoice_id.eq.');

        for (const inv of (localInvoices || [])) {
          try {
            const payload = {
              customer_name: (inv as any).client_name || 'Client',
              invoice_number: (inv as any).number || (inv as any).id,
              date: (inv as any).date || new Date().toISOString().split('T')[0],
              due_date: (inv as any).due_date,
              line_items: [{ name: `Facture ${(inv as any).number || (inv as any).id}`, rate: (inv as any).amount || 0, quantity: 1 }],
            };
            const resp = await fetch(`${apiBase}/invoices?organization_id=${orgId}`, {
              method: 'POST', headers, body: JSON.stringify(payload),
            });
            const respData = await resp.json() as any;
            const zohoId = respData?.invoice?.invoice_id;
            if (zohoId) {
              await supabaseAdmin.from('invoices').update({ zoho_invoice_id: zohoId }).eq('id', (inv as any).id).eq('tenant_id', tenantId);
              pushed++;
            } else if (respData?.message) {
              errors.push(`Push ${(inv as any).id}: ${respData.message}`);
            }
          } catch (err: any) {
            console.error("[POST /api/zoho-books/sync]", err);
            errors.push(`Push ${(inv as any).id}: ${err.message}`);
          }
        }
      } catch (err: any) {
        console.error("[POST /api/zoho-books/sync]", err);
        errors.push(`Envoi échoué: ${err.message}`);
      }

      // Pull status updates from Zoho Books
      try {
        const resp = await fetch(`${apiBase}/invoices?organization_id=${orgId}&status=all`, { headers });
        const respData = await resp.json() as any;
        const zohoInvoices: any[] = respData?.invoices || [];
        for (const zohoInv of zohoInvoices) {
          const { data: local } = await supabaseAdmin.from('invoices').select('id, status').eq('zoho_invoice_id', zohoInv.invoice_id).eq('tenant_id', tenantId).single();
          if (local) {
            const statusMap: Record<string, string> = { paid: 'paid', sent: 'sent', draft: 'draft', overdue: 'overdue', void: 'cancelled' };
            const newStatus = statusMap[zohoInv.status] ?? null;
            if (newStatus && newStatus !== (local as any).status) {
              await supabaseAdmin.from('invoices').update({ status: newStatus }).eq('id', (local as any).id).eq('tenant_id', tenantId);
              pulled++;
            }
          }
        }
      } catch (err: any) {
        console.error("[POST /api/zoho-books/sync]", err);
        errors.push(`Récupération échouée: ${err.message}`);
      }

      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Synchronisation Zoho Books (${pushed} envoyée(s), ${pulled} reçue(s))`, '', tenantId, 'integration', 'Intégrations');
      res.json({ pushed, pulled, errors });
    } catch (error: any) {
      console.error('[Zoho Books sync error]', error.message);
      res.status(500).json({ error: error.message || 'Sync échouée' });
    }
  });
}
