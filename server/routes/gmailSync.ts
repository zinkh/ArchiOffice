// Gmail connector for the "Correspondance" tab (ProjectDetail, Contacts) —
// same OAuth shape as server/routes/googleCalendarSync.ts (full-redirect,
// access_type=offline + stored refresh_token, state nonce from
// server/oauthState.ts since Google's redirect back can't carry our JWT),
// reusing the same Google OAuth client (VITE_GOOGLE_CLIENT_ID /
// GOOGLE_CLIENT_SECRET) with an additional Gmail scope.
//
// Deliberately read-only and non-persistent: messages are searched live on
// demand and never stored here — only an explicit "attach" (server/
// mailLinks.ts, POST /api/mail/links) persists anything, and only the
// metadata needed to render a list (never the body). Sending mail is
// unrelated to this file — it stays on the existing tenant SMTP path
// (server/routes/sendEmail.ts).
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';
import { createOAuthState, consumeOAuthState } from '../oauthState';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  getUserName: (tenantId: string, userId: string, email?: string) => Promise<string>;
  logActivity: (tenantId: string, userId: string, userName: string, action: string, target: string, targetId: string, targetType: string, category: string) => void;
}

const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const SEARCH_LIMIT = 20;
const INBOX_PAGE_SIZE = 25;

// Only a same-origin relative path is safe to redirect to — reject anything
// that could send the post-consent redirect off ArchiOffice (open redirect),
// including protocol-relative URLs (//evil.com) and backslash tricks.
function sanitizeReturnTo(value: unknown): string {
  if (typeof value !== 'string') return '/';
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/';
  return value;
}

export function registerGmailSyncRoutes(app: Express, { supabaseAdmin, getTenantId, getUserName, logActivity }: RouteDeps) {
  const accessTokenCache = new Map<string, { token: string; expiresAt: number }>();

  async function getConnection(tenantId: string, userId: string) {
    const { data } = await tenantScopedFrom(supabaseAdmin, tenantId, 'email_connections')
      .select('*').eq('user_id', userId).eq('provider', 'google').maybeSingle();
    return data as any;
  }

  async function getAccessToken(connection: any): Promise<string> {
    const now = Date.now();
    const cached = accessTokenCache.get(connection.user_id);
    if (cached && cached.expiresAt > now + 60000) return cached.token;

    const clientId = process.env.VITE_GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId) throw new Error('VITE_GOOGLE_CLIENT_ID non configuré');

    const resp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: connection.refresh_token,
        client_id: clientId,
        ...(clientSecret ? { client_secret: clientSecret } : {}),
        grant_type: 'refresh_token',
      }).toString(),
    });
    const data: any = await resp.json();
    if (!resp.ok || !data.access_token) throw new Error(data.error_description || data.error || 'Échec du rafraîchissement du token Google');
    accessTokenCache.set(connection.user_id, { token: data.access_token, expiresAt: now + (data.expires_in || 3600) * 1000 });
    return data.access_token;
  }

  function getRedirectUri(req: any): string {
    if (process.env.GMAIL_REDIRECT_URI) return process.env.GMAIL_REDIRECT_URI;
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    const host = req.headers['x-forwarded-host'] || req.get('host');
    return `${proto}://${host}/api/gmail/callback`;
  }

  // GET /api/gmail/status
  app.get('/api/gmail/status', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const connection = await getConnection(tenantId, req.user.id);
      res.json({
        connected: !!connection,
        email: connection?.external_account_email || null,
        last_synced_at: connection?.last_synced_at || null,
      });
    } catch (error: any) {
      console.error('[GET /api/gmail/status]', error);
      res.status(500).json({ error: 'Failed to get Gmail status' });
    }
  });

  // GET /api/gmail/auth — returns the consent URL for an authenticated
  // fetch to call; the frontend navigates there itself.
  app.get('/api/gmail/auth', async (req: any, res: any) => {
    try {
      const clientId = process.env.VITE_GOOGLE_CLIENT_ID;
      if (!clientId) return res.status(503).json({ error: 'VITE_GOOGLE_CLIENT_ID non configuré' });
      const tenantId = await getTenantId(req.user.id);
      const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      authUrl.searchParams.set('client_id', clientId);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('redirect_uri', getRedirectUri(req));
      authUrl.searchParams.set('scope', `${GMAIL_SCOPE} email`);
      authUrl.searchParams.set('access_type', 'offline');
      authUrl.searchParams.set('prompt', 'consent');
      const returnTo = sanitizeReturnTo(req.query.returnTo);
      authUrl.searchParams.set('state', createOAuthState(tenantId, req.user.id, returnTo));
      res.json({ url: authUrl.toString() });
    } catch (error: any) {
      console.error('[GET /api/gmail/auth]', error);
      res.status(500).json({ error: 'Erreur lors de la connexion à Gmail' });
    }
  });

  // GET /api/gmail/callback — no JWT (bare browser navigation from
  // Google); tenant+user recovered from the one-time state nonce.
  // Registered in server.ts's AUTH_EXEMPT list.
  app.get('/api/gmail/callback', async (req: any, res: any) => {
    const { code, error: oauthError, state } = req.query as any;
    const consumed = consumeOAuthState(state);
    const tenantId = consumed?.tenantId;
    const userId = consumed?.userId;
    const returnTo = sanitizeReturnTo(consumed?.returnTo);
    if (oauthError || !code || !tenantId || !userId) {
      return res.redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}gmail_error=1`);
    }
    try {
      const clientId = process.env.VITE_GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
      const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId as string,
          ...(clientSecret ? { client_secret: clientSecret } : {}),
          redirect_uri: getRedirectUri(req),
          grant_type: 'authorization_code',
        }).toString(),
      });
      const tokenData: any = await tokenResp.json();
      if (!tokenResp.ok || !tokenData.refresh_token) {
        throw new Error(tokenData.error_description || tokenData.error || 'Pas de refresh_token dans la réponse Google');
      }

      let email: string | null = null;
      try {
        const userinfoResp = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });
        if (userinfoResp.ok) email = (await userinfoResp.json()).email || null;
      } catch { /* non-fatal — connection still works without the display email */ }

      accessTokenCache.delete(userId);
      const existing = await getConnection(tenantId, userId);
      const row = {
        refresh_token: tokenData.refresh_token,
        access_token: tokenData.access_token,
        expires_at: new Date(Date.now() + (tokenData.expires_in || 3600) * 1000).toISOString(),
        external_account_email: email,
        scopes: GMAIL_SCOPE,
      };
      if (existing) {
        await tenantScopedFrom(supabaseAdmin, tenantId, 'email_connections').update(row).eq('id', existing.id);
      } else {
        await tenantScopedFrom(supabaseAdmin, tenantId, 'email_connections').insert({
          id: crypto.randomUUID(),
          user_id: userId,
          provider: 'google',
          auth_type: 'oauth',
          ...row,
        });
      }
      res.redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}gmail_connected=1`);
    } catch (error: any) {
      console.error('[Gmail callback error]', error.message);
      res.redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}gmail_error=1`);
    }
  });

  // DELETE /api/gmail/disconnect
  app.delete('/api/gmail/disconnect', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      accessTokenCache.delete(req.user.id);
      await tenantScopedFrom(supabaseAdmin, tenantId, 'email_connections').delete().eq('user_id', req.user.id).eq('provider', 'google');
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, 'Déconnexion de Gmail', '', tenantId, 'integration', 'Intégrations');
      res.json({ success: true });
    } catch (error: any) {
      console.error('[DELETE /api/gmail/disconnect]', error);
      res.status(500).json({ error: 'Failed to disconnect Gmail' });
    }
  });

  // Shared by /search (filtered by an address) and /messages (plain inbox
  // listing) — lists message ids for a query, then fetches header metadata
  // only (never the body) for each. `q` follows Gmail's search syntax.
  async function fetchGmailMessages(accessToken: string, q: string, maxResults: number, pageToken?: string) {
    const headers = { Authorization: `Bearer ${accessToken}` };

    const listUrl = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
    if (q) listUrl.searchParams.set('q', q);
    listUrl.searchParams.set('maxResults', String(maxResults));
    if (pageToken) listUrl.searchParams.set('pageToken', pageToken);
    const listResp = await fetch(listUrl.toString(), { headers });
    const listData: any = await listResp.json();
    if (!listResp.ok) throw new Error(listData.error?.message || 'Échec de la récupération Gmail');

    const messages = (listData.messages || []) as { id: string; threadId: string }[];
    const results = await Promise.all(messages.map(async (m) => {
      const getUrl = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}`);
      getUrl.searchParams.set('format', 'metadata');
      ['Subject', 'From', 'To', 'Date'].forEach(h => getUrl.searchParams.append('metadataHeaders', h));
      const getResp = await fetch(getUrl.toString(), { headers });
      const getData: any = await getResp.json();
      if (!getResp.ok) return null;
      const headerValue = (name: string) => getData.payload?.headers?.find((h: any) => h.name === name)?.value || '';
      return {
        id: m.id,
        threadId: m.threadId,
        subject: headerValue('Subject'),
        from: headerValue('From'),
        to: headerValue('To'),
        date: headerValue('Date'),
        snippet: getData.snippet || '',
      };
    }));

    return { messages: results.filter(Boolean), nextPageToken: listData.nextPageToken || null };
  }

  // GET /api/gmail/search?email=<adresse> — live search, never persisted.
  app.get('/api/gmail/search', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const connection = await getConnection(tenantId, req.user.id);
      if (!connection) return res.status(400).json({ error: 'Gmail non connecté.' });
      const { email } = req.query as { email?: string };
      if (!email) return res.status(400).json({ error: 'email requis' });

      const accessToken = await getAccessToken(connection);
      const { messages } = await fetchGmailMessages(accessToken, `from:${email} OR to:${email}`, SEARCH_LIMIT);
      res.json(messages);
    } catch (error: any) {
      console.error('[GET /api/gmail/search]', error.message);
      res.status(500).json({ error: error.message || 'Échec de la recherche Gmail' });
    }
  });

  // GET /api/gmail/messages?pageToken=&maxResults= — plain inbox listing
  // (most recent first, no address filter) for the Mailbox page, live and
  // never persisted. pageToken/nextPageToken drive "load more".
  app.get('/api/gmail/messages', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const connection = await getConnection(tenantId, req.user.id);
      if (!connection) return res.status(400).json({ error: 'Gmail non connecté.' });
      const { pageToken } = req.query as { pageToken?: string };
      const maxResults = Math.min(parseInt(String(req.query.maxResults || INBOX_PAGE_SIZE), 10) || INBOX_PAGE_SIZE, 50);

      const accessToken = await getAccessToken(connection);
      const { messages, nextPageToken } = await fetchGmailMessages(accessToken, 'in:inbox', maxResults, pageToken);
      res.json({ messages, nextPageToken });
    } catch (error: any) {
      console.error('[GET /api/gmail/messages]', error.message);
      res.status(500).json({ error: error.message || "Échec de la récupération de la boîte de réception Gmail" });
    }
  });
}
