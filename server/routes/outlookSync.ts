// Outlook/Microsoft 365 connector for the "Correspondance" tab and the
// Mailbox page — same OAuth shape as server/routes/gmailSync.ts (full-
// redirect, refresh_token stored per user, state nonce from server/
// oauthState.ts since Microsoft's redirect back can't carry our JWT), but
// against the Microsoft identity platform (Azure AD / Entra ID app
// registration) and the Microsoft Graph API instead of Google's.
//
// Requires the tenant's own Azure AD app registration (AZURE_CLIENT_ID /
// AZURE_CLIENT_SECRET) — unlike Gmail this can't piggyback on an existing
// client already used elsewhere in ArchiOffice, since there was no prior
// Microsoft integration. Uses the "common" authority so both personal
// Microsoft accounts and work/school (Microsoft 365) accounts can connect.
//
// Deliberately read-only and non-persistent, same as the Gmail/IMAP
// connectors: messages are listed/searched live on demand and never stored
// here — only an explicit "attach" (server/mailLinks.ts) persists
// anything, and only the metadata needed to render a list.
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';
import { createOAuthState, consumeOAuthState } from '../oauthState';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  getUserName: (tenantId: string, userId: string, email?: string) => Promise<string>;
  logActivity: (tenantId: string, userId: string, userName: string, action: string, target: string, targetId: string, targetType: string, category: string) => void;
}

const OUTLOOK_SCOPE = 'offline_access https://graph.microsoft.com/Mail.Read';
const AUTHORITY = 'https://login.microsoftonline.com/common/oauth2/v2.0';
const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const SEARCH_LIMIT = 20;
const INBOX_PAGE_SIZE = 25;
const MESSAGE_SELECT = 'subject,from,toRecipients,receivedDateTime,bodyPreview';

// Only a same-origin relative path is safe to redirect to — same guard as
// gmailSync.ts, reject anything that could send the post-consent redirect
// off ArchiOffice.
function sanitizeReturnTo(value: unknown): string {
  if (typeof value !== 'string') return '/';
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/';
  return value;
}

export function registerOutlookSyncRoutes(app: Express, { supabaseAdmin, getTenantId, getUserName, logActivity }: RouteDeps) {
  const accessTokenCache = new Map<string, { token: string; expiresAt: number }>();

  async function getConnection(tenantId: string, userId: string) {
    const { data } = await tenantScopedFrom(supabaseAdmin, tenantId, 'email_connections')
      .select('*').eq('user_id', userId).eq('provider', 'microsoft').maybeSingle();
    return data as any;
  }

  async function getAccessToken(connection: any): Promise<string> {
    const now = Date.now();
    const cached = accessTokenCache.get(connection.user_id);
    if (cached && cached.expiresAt > now + 60000) return cached.token;

    const clientId = process.env.AZURE_CLIENT_ID;
    const clientSecret = process.env.AZURE_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error('AZURE_CLIENT_ID / AZURE_CLIENT_SECRET non configurés');

    const resp = await fetch(`${AUTHORITY}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: connection.refresh_token,
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
        scope: OUTLOOK_SCOPE,
      }).toString(),
    });
    const data: any = await resp.json();
    if (!resp.ok || !data.access_token) throw new Error(data.error_description || data.error || 'Échec du rafraîchissement du token Microsoft');
    // Microsoft rotates refresh tokens on each use — persist the new one or
    // the connection stops working once the original expires/is revoked.
    if (data.refresh_token && data.refresh_token !== connection.refresh_token) {
      connection.refresh_token = data.refresh_token;
      tenantScopedFrom(supabaseAdmin, connection.tenant_id, 'email_connections')
        .update({ refresh_token: data.refresh_token }).eq('id', connection.id)
        .then(() => {}, (err: any) => console.error('[Outlook refresh_token persist]', err.message));
    }
    accessTokenCache.set(connection.user_id, { token: data.access_token, expiresAt: now + (data.expires_in || 3600) * 1000 });
    return data.access_token;
  }

  function getRedirectUri(req: any): string {
    if (process.env.OUTLOOK_REDIRECT_URI) return process.env.OUTLOOK_REDIRECT_URI;
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    const host = req.headers['x-forwarded-host'] || req.get('host');
    return `${proto}://${host}/api/outlook/callback`;
  }

  // GET /api/outlook/status
  app.get('/api/outlook/status', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const connection = await getConnection(tenantId, req.user.id);
      res.json({
        connected: !!connection,
        email: connection?.external_account_email || null,
        last_synced_at: connection?.last_synced_at || null,
      });
    } catch (error: any) {
      console.error('[GET /api/outlook/status]', error);
      res.status(500).json({ error: 'Failed to get Outlook status' });
    }
  });

  // GET /api/outlook/auth — returns the consent URL for an authenticated
  // fetch to call; the frontend navigates there itself.
  app.get('/api/outlook/auth', async (req: any, res: any) => {
    try {
      const clientId = process.env.AZURE_CLIENT_ID;
      if (!clientId) return res.status(503).json({ error: 'AZURE_CLIENT_ID non configuré' });
      const tenantId = await getTenantId(req.user.id);
      const authUrl = new URL(`${AUTHORITY}/authorize`);
      authUrl.searchParams.set('client_id', clientId);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('redirect_uri', getRedirectUri(req));
      authUrl.searchParams.set('response_mode', 'query');
      authUrl.searchParams.set('scope', OUTLOOK_SCOPE);
      authUrl.searchParams.set('prompt', 'consent');
      const returnTo = sanitizeReturnTo(req.query.returnTo);
      authUrl.searchParams.set('state', createOAuthState(tenantId, req.user.id, returnTo));
      res.json({ url: authUrl.toString() });
    } catch (error: any) {
      console.error('[GET /api/outlook/auth]', error);
      res.status(500).json({ error: 'Erreur lors de la connexion à Outlook' });
    }
  });

  // GET /api/outlook/callback — no JWT (bare browser navigation from
  // Microsoft); tenant+user recovered from the one-time state nonce.
  // Registered in server.ts's AUTH_EXEMPT list.
  app.get('/api/outlook/callback', async (req: any, res: any) => {
    const { code, error: oauthError, state } = req.query as any;
    const consumed = consumeOAuthState(state);
    const tenantId = consumed?.tenantId;
    const userId = consumed?.userId;
    const returnTo = sanitizeReturnTo(consumed?.returnTo);
    if (oauthError || !code || !tenantId || !userId) {
      return res.redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}outlook_error=1`);
    }
    try {
      const clientId = process.env.AZURE_CLIENT_ID;
      const clientSecret = process.env.AZURE_CLIENT_SECRET;
      const tokenResp = await fetch(`${AUTHORITY}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId as string,
          client_secret: clientSecret as string,
          redirect_uri: getRedirectUri(req),
          grant_type: 'authorization_code',
          scope: OUTLOOK_SCOPE,
        }).toString(),
      });
      const tokenData: any = await tokenResp.json();
      if (!tokenResp.ok || !tokenData.refresh_token) {
        throw new Error(tokenData.error_description || tokenData.error || 'Pas de refresh_token dans la réponse Microsoft');
      }

      let email: string | null = null;
      try {
        const meResp = await fetch(`${GRAPH_BASE}/me?$select=mail,userPrincipalName`, {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });
        if (meResp.ok) {
          const me = await meResp.json();
          email = me.mail || me.userPrincipalName || null;
        }
      } catch { /* non-fatal — connection still works without the display email */ }

      accessTokenCache.delete(userId);
      const existing = await getConnection(tenantId, userId);
      const row = {
        refresh_token: tokenData.refresh_token,
        access_token: tokenData.access_token,
        expires_at: new Date(Date.now() + (tokenData.expires_in || 3600) * 1000).toISOString(),
        external_account_email: email,
        scopes: OUTLOOK_SCOPE,
      };
      if (existing) {
        await tenantScopedFrom(supabaseAdmin, tenantId, 'email_connections').update(row).eq('id', existing.id);
      } else {
        await tenantScopedFrom(supabaseAdmin, tenantId, 'email_connections').insert({
          id: crypto.randomUUID(),
          user_id: userId,
          provider: 'microsoft',
          auth_type: 'oauth',
          ...row,
        });
      }
      res.redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}outlook_connected=1`);
    } catch (error: any) {
      console.error('[Outlook callback error]', error.message);
      res.redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}outlook_error=1`);
    }
  });

  // DELETE /api/outlook/disconnect
  app.delete('/api/outlook/disconnect', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      accessTokenCache.delete(req.user.id);
      await tenantScopedFrom(supabaseAdmin, tenantId, 'email_connections').delete().eq('user_id', req.user.id).eq('provider', 'microsoft');
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, 'Déconnexion de Outlook', '', tenantId, 'integration', 'Intégrations');
      res.json({ success: true });
    } catch (error: any) {
      console.error('[DELETE /api/outlook/disconnect]', error);
      res.status(500).json({ error: 'Failed to disconnect Outlook' });
    }
  });

  function mapGraphMessage(m: any) {
    return {
      id: m.id,
      subject: m.subject || '',
      from: m.from?.emailAddress?.address || '',
      to: (m.toRecipients || []).map((r: any) => r.emailAddress?.address).filter(Boolean).join(', '),
      date: m.receivedDateTime || null,
      snippet: m.bodyPreview || '',
    };
  }

  // GET /api/outlook/search?email=<adresse> — live search, never persisted.
  app.get('/api/outlook/search', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const connection = await getConnection(tenantId, req.user.id);
      if (!connection) return res.status(400).json({ error: 'Outlook non connecté.' });
      const { email } = req.query as { email?: string };
      if (!email) return res.status(400).json({ error: 'email requis' });

      const accessToken = await getAccessToken(connection);
      const escaped = email.replace(/'/g, "''");
      const url = new URL(`${GRAPH_BASE}/me/messages`);
      url.searchParams.set('$filter', `from/emailAddress/address eq '${escaped}' or toRecipients/any(r:r/emailAddress/address eq '${escaped}')`);
      url.searchParams.set('$top', String(SEARCH_LIMIT));
      url.searchParams.set('$select', MESSAGE_SELECT);
      url.searchParams.set('$orderby', 'receivedDateTime desc');

      const resp = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
      const data: any = await resp.json();
      if (!resp.ok) throw new Error(data.error?.message || 'Échec de la recherche Outlook');

      res.json((data.value || []).map(mapGraphMessage));
    } catch (error: any) {
      console.error('[GET /api/outlook/search]', error.message);
      res.status(500).json({ error: error.message || 'Échec de la recherche Outlook' });
    }
  });

  // GET /api/outlook/messages?pageToken=&maxResults= — plain inbox listing
  // (most recent first, no address filter) for the Mailbox page. pageToken
  // here is simply Graph's own `@odata.nextLink` URL, fetched as-is.
  app.get('/api/outlook/messages', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const connection = await getConnection(tenantId, req.user.id);
      if (!connection) return res.status(400).json({ error: 'Outlook non connecté.' });
      const { pageToken } = req.query as { pageToken?: string };
      const maxResults = Math.min(parseInt(String(req.query.maxResults || INBOX_PAGE_SIZE), 10) || INBOX_PAGE_SIZE, 50);

      const accessToken = await getAccessToken(connection);
      let url: string;
      if (pageToken) {
        url = pageToken;
      } else {
        const u = new URL(`${GRAPH_BASE}/me/mailFolders/inbox/messages`);
        u.searchParams.set('$top', String(maxResults));
        u.searchParams.set('$select', MESSAGE_SELECT);
        u.searchParams.set('$orderby', 'receivedDateTime desc');
        url = u.toString();
      }

      const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      const data: any = await resp.json();
      if (!resp.ok) throw new Error(data.error?.message || "Échec de la récupération de la boîte de réception Outlook");

      res.json({ messages: (data.value || []).map(mapGraphMessage), nextPageToken: data['@odata.nextLink'] || null });
    } catch (error: any) {
      console.error('[GET /api/outlook/messages]', error.message);
      res.status(500).json({ error: error.message || "Échec de la récupération de la boîte de réception Outlook" });
    }
  });
}
