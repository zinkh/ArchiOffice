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
import { createOAuthState, consumeOAuthState, oauthErrorParam } from '../oauthState';
import { fetchWithTimeout } from '../fetchWithTimeout';
import { encryptSecret, decryptSecretMaybe } from '../secretsCrypto';
import {
  ZOHO_TIMEOUT_MS, ZOHO_MAX_PUSH_PER_RUN, ZOHO_PAGE_SIZE, ZOHO_MAX_PULL_PAGES,
  mapZohoStatus, zohoDate, zohoLineItems, localInvoicesByZohoId, isRateLimited,
  zohoInvoiceToLocalRow,
} from '../zohoSync';

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
      // Books' own token, never zoho_refresh_token — see the note on
      // /api/zoho-books/callback below.
      refresh_token: decryptSecretMaybe(settings.zoho_books_refresh_token),
      client_id: settings.zoho_client_id,
      client_secret: settings.zoho_client_secret,
      grant_type: 'refresh_token',
    });
    const tokenRes = await fetchWithTimeout(`https://accounts.zoho.${dc}/oauth/v2/token`, { method: 'POST', body: params }, ZOHO_TIMEOUT_MS);
    const body = await tokenRes.json() as any;
    if (!body?.access_token) {
      // Zoho answers 200 with an { error } body for a dead/invalid refresh
      // token, so the status code alone tells us nothing — surface the reason
      // instead of a bare "failed", which is unactionable for the admin.
      throw new Error(`Échec du rafraîchissement du jeton Zoho Books${body?.error ? ` (${body.error})` : ''}`);
    }
    zohoBooksAccessTokenCache.set(tenantId, { token: body.access_token, expiresAt: now + (body.expires_in || 3600) * 1000 });
    return body.access_token;
  }

  // Books redirects to its OWN path, not Zoho Invoice's /api/zoho/callback:
  // both URIs have to be registered in the Zoho API console, or Zoho rejects
  // the consent request with "Invalid Redirect Uri" before the user ever sees
  // the grant screen. GET /api/zoho-books/callback-url below exposes this so
  // the Paramètres page can show the admin exactly what to register.
  function getZohoBooksCallbackUrl(req: any): string {
    // Lets the admin pin the exact registered URI, mirroring ZOHO_REDIRECT_URI
    // for Zoho Invoice. Separate var: the two paths differ, so one value can't
    // serve both.
    if (process.env.ZOHO_BOOKS_REDIRECT_URI) return process.env.ZOHO_BOOKS_REDIRECT_URI;
    // 'https' fallback: behind a proxy that doesn't set x-forwarded-proto,
    // req.protocol reports the internal 'http' hop and the resulting
    // redirect_uri no longer matches the registered https one.
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    const host = req.headers['x-forwarded-host'] || req.get('host');
    return `${proto}://${host}/api/zoho-books/callback`;
  }

  // GET /api/zoho-books/status
  app.get('/api/zoho-books/status', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: settings } = await supabaseAdmin.from('settings').select('zoho_client_id, zoho_client_secret, zoho_org_id, zoho_books_org_id, zoho_data_center, zoho_books_refresh_token').eq('tenant_id', tenantId).single();
      res.json({
        // Books' own token: reading zoho_refresh_token here reported "connected"
        // as soon as Zoho *Invoice* was connected, so the UI hid the Connect
        // button and every Books call then failed on a token that had no
        // ZohoBooks scope.
        connected: !!(settings as any)?.zoho_books_refresh_token,
        has_credentials: !!((settings as any)?.zoho_client_id && (settings as any)?.zoho_client_secret && ((settings as any)?.zoho_books_org_id || (settings as any)?.zoho_org_id)),
      });
    } catch (error: any) {
      console.error("[GET /api/zoho-books/status]", error);
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/zoho-books/callback-url  — the redirect URI this server will
  // actually send Zoho, for the admin to register in the Zoho API console.
  app.get('/api/zoho-books/callback-url', (req, res) => {
    res.json({ url: getZohoBooksCallbackUrl(req) });
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
      authUrl.searchParams.set('state', await createOAuthState(tenantId));
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
    const consumed = await consumeOAuthState(state);
    const tenantId = consumed?.tenantId;
    if (oauthError || !code || !tenantId) {
      // `state` misses when the nonce expired (10 min), was already consumed, or
      // was minted by a server process that has since restarted — distinct from
      // Zoho refusing the grant, and worth telling the user apart.
      const reason = oauthError ? oauthErrorParam(oauthError) : (!code ? 'no_code' : 'expired_state');
      console.error('[GET /api/zoho-books/callback] no grant', { reason });
      return res.redirect(`/settings?zoho_books_error=${reason}`);
    }
    try {
      const { data: settings } = await supabaseAdmin.from('settings').select('zoho_client_id, zoho_client_secret, zoho_data_center').eq('tenant_id', tenantId).single();
      const dc = (settings as any)?.zoho_data_center || 'com';
      const redirectUri = getZohoBooksCallbackUrl(req);
      const params = new URLSearchParams({
        code, client_id: (settings as any).zoho_client_id,
        client_secret: (settings as any).zoho_client_secret,
        redirect_uri: redirectUri, grant_type: 'authorization_code',
      });
      const tokenRes = await fetchWithTimeout(`https://accounts.zoho.${dc}/oauth/v2/token`, { method: 'POST', body: params }, ZOHO_TIMEOUT_MS);
      const body = await tokenRes.json() as any;
      if (!body?.refresh_token) {
        // Zoho answers 200 with an { error } body here (invalid_client,
        // invalid_code, redirect_uri mismatch, ...). Logging and forwarding the
        // code is the only way an admin can tell which of their console
        // settings is wrong — the old bare `zoho_books_error=1` said nothing.
        console.error('[GET /api/zoho-books/callback] token exchange failed', { status: tokenRes.status, error: body?.error });
        return res.redirect(`/settings?zoho_books_error=${oauthErrorParam(body?.error)}`);
      }
      zohoBooksAccessTokenCache.delete(tenantId);
      // zoho_books_refresh_token, not zoho_refresh_token: the two integrations
      // ask for different scopes, so storing both in one column meant
      // connecting Books silently broke Zoho Invoice and vice versa.
      await supabaseAdmin.from('settings').update({ zoho_books_refresh_token: encryptSecret(body.refresh_token) }).eq('tenant_id', tenantId);
      res.redirect('/settings?zoho_books_connected=1');
    } catch (error: any) {
      console.error('[GET /api/zoho-books/callback]', error?.message || error);
      res.redirect('/settings?zoho_books_error=1');
    }
  });

  // DELETE /api/zoho-books/disconnect
  app.delete('/api/zoho-books/disconnect', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      zohoBooksAccessTokenCache.delete(tenantId);
      // Only Books' token — this used to null zoho_refresh_token, so
      // disconnecting Books also disconnected Zoho Invoice.
      await supabaseAdmin.from('settings').update({ zoho_books_refresh_token: null }).eq('tenant_id', tenantId);
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
      if (!(settings as any)?.zoho_books_refresh_token) {
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

      let pushed = 0, pulled = 0, remaining = 0;
      const errors: string[] = [];

      // Push local invoices not yet in Zoho Books
      try {
        const { data: localInvoices, error: localInvoicesErr } = await supabaseAdmin
          .from('invoices')
          .select('*, projects(name)')
          .eq('tenant_id', tenantId)
          .or('zoho_invoice_id.is.null,zoho_invoice_id.eq.');
        // See the matching note in zohoInvoice.ts: a failed query used to be
        // silently treated as "no invoices to push".
        if (localInvoicesErr) throw new Error(`Lecture des factures locales échouée: ${localInvoicesErr.message}`);

        const invoicesArr = (localInvoices || []).map((inv: any) => ({ ...inv, project_name: inv.projects?.name || null }));
        // Bounded per run — see the matching note in zohoInvoice.ts.
        const toPush = invoicesArr.slice(0, ZOHO_MAX_PUSH_PER_RUN);
        remaining = invoicesArr.length - toPush.length;

        for (const inv of toPush) {
          try {
            // This payload used to read client_name, number and date — none of
            // which are columns on `invoices` (see supabase/schema.sql). Every
            // invoice therefore went to Zoho Books as customer "Client", with
            // its UUID as the invoice number and today's date, carrying a single
            // untaxed line. These are the real columns, mapped the same way the
            // Zoho Invoice push maps them.
            const payload = {
              customer_name: inv.project_name || inv.description || 'Client',
              invoice_number: inv.invoice_number || undefined,
              date: zohoDate(inv.issue_date) || new Date().toISOString().split('T')[0],
              due_date: zohoDate(inv.due_date),
              line_items: zohoLineItems(inv),
              notes: inv.description || undefined,
            };
            const resp = await fetchWithTimeout(`${apiBase}/invoices?organization_id=${orgId}`, {
              method: 'POST', headers, body: JSON.stringify(payload),
            }, ZOHO_TIMEOUT_MS);
            const respData = await resp.json() as any;
            const zohoId = respData?.invoice?.invoice_id;
            if (zohoId) {
              await supabaseAdmin.from('invoices').update({ zoho_invoice_id: zohoId }).eq('id', inv.id).eq('tenant_id', tenantId);
              pushed++;
            } else if (isRateLimited(resp.status, respData)) {
              // Zoho's limiter only reopens on a timer — continuing would burn
              // the rest of the request on calls that are all going to be refused.
              remaining += toPush.length - pushed;
              errors.push('Limite de requêtes Zoho atteinte. Relancez la synchronisation dans quelques minutes.');
              break;
            } else if (respData?.message) {
              errors.push(`Envoi échoué (${inv.invoice_number || inv.id}): ${respData.message}`);
            }
          } catch (err: any) {
            console.error("[POST /api/zoho-books/sync]", err);
            errors.push(`Envoi échoué (${inv.invoice_number || inv.id}): ${err.message}`);
          }
        }
      } catch (err: any) {
        console.error("[POST /api/zoho-books/sync]", err);
        errors.push(`Envoi échoué: ${err.message}`);
      }

      // Pull status updates from Zoho Books
      try {
        // Paginated: this used to fetch one default-sized page and stop, so a
        // tenant past that first page silently stopped receiving status updates.
        const zohoInvoices: any[] = [];
        for (let page = 1; page <= ZOHO_MAX_PULL_PAGES; page++) {
          const resp = await fetchWithTimeout(
            `${apiBase}/invoices?organization_id=${orgId}&status=all&page=${page}&per_page=${ZOHO_PAGE_SIZE}`,
            { headers },
            ZOHO_TIMEOUT_MS,
          );
          const respData = await resp.json() as any;
          zohoInvoices.push(...(respData?.invoices || []));
          if (!respData?.page_context?.has_more_page) break;
        }

        // One query for the whole batch instead of one per Zoho invoice.
        const localByZohoId = await localInvoicesByZohoId(
          supabaseAdmin, tenantId, zohoInvoices.map((z: any) => z.invoice_id),
        );
        for (const zohoInv of zohoInvoices) {
          const local = localByZohoId.get(zohoInv.invoice_id);
          if (!local) {
            // A Zoho Books invoice ArchiOffice has never recorded — see the
            // matching note in zohoInvoice.ts. This used to `continue` here too,
            // so nothing already in Zoho Books at connection time ever appeared
            // in ArchiOffice.
            const { error: importErr } = await supabaseAdmin
              .from('invoices').insert(zohoInvoiceToLocalRow(zohoInv, tenantId));
            if (importErr) {
              console.error("[POST /api/zoho-books/sync] import", importErr);
              errors.push(`Import échoué (${zohoInv.invoice_number || zohoInv.invoice_id}): ${importErr.message}`);
            } else {
              pulled++;
            }
            continue;
          }
          // Shared with the Zoho Invoice route: this used to keep its own map to
          // lowercase values ('paid', 'sent', 'cancelled'), none of which are
          // valid for invoices.status ('Draft' | 'Sent' | 'Paid' | 'Overdue'),
          // so a Books pull wrote statuses the app couldn't render.
          const newStatus = mapZohoStatus(zohoInv.status);
          if (newStatus && newStatus !== local.status) {
            await supabaseAdmin.from('invoices').update({ status: newStatus }).eq('id', local.id).eq('tenant_id', tenantId);
            pulled++;
          }
        }
      } catch (err: any) {
        console.error("[POST /api/zoho-books/sync]", err);
        errors.push(`Récupération échouée: ${err.message}`);
      }

      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Synchronisation Zoho Books (${pushed} envoyée(s), ${pulled} reçue(s))`, '', tenantId, 'integration', 'Intégrations');
      res.json({ pushed, pulled, remaining, errors });
    } catch (error: any) {
      console.error('[Zoho Books sync error]', error.message);
      res.status(500).json({ error: error.message || 'Sync échouée' });
    }
  });
}
