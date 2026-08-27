// Gmail connector for the "Correspondance" tab (ProjectDetail, Contacts)
// and the Mailbox page — same OAuth shape as server/routes/
// googleCalendarSync.ts (full-redirect, refresh_token stored, state nonce
// from server/oauthState.ts since Google's redirect back can't carry our
// JWT), reusing the same Google OAuth client (VITE_GOOGLE_CLIENT_ID /
// GOOGLE_CLIENT_SECRET).
//
// Scope covers read, archive/trash, and send: `gmail.modify` is a superset
// of `gmail.readonly` (read + write, short of permanent delete) so there's
// no need to request both — only `gmail.modify` + `gmail.send` are asked
// for, in one reconsent, even though send doesn't ship until later in this
// same change: two separate re-authorization prompts a few weeks apart is
// worse UX than one, for no implementation savings either way. An account
// connected before this scope existed still has a token scoped to the old
// `gmail.readonly` alone — calls to archive/trash/send will 403 with a
// shape isInsufficientScopeError() recognizes, surfaced to the frontend as
// { code: 'INSUFFICIENT_SCOPE' } so it can prompt reconnecting instead of
// showing a dead-end error (src/hooks/useMailConnections.ts).
//
// Message content is fetched live on demand (list, full body, attachments)
// and never persisted here — only an explicit "attach" (server/
// mailLinks.ts, POST /api/mail/links) or "link a folder" (server/
// mailFolderLinks.ts) stores anything, and only metadata, never a body.
import type { Express } from 'express';
import MailComposer from 'nodemailer/lib/mail-composer';
import { tenantScopedFrom } from '../tenantScopedFrom';
import { createOAuthState, consumeOAuthState } from '../oauthState';
import { fetchGmailFullMessage } from '../mailFullMessage';
import { normalizeGmailLabels } from '../mailFolders';
import { isInsufficientScopeError } from '../mailProviderErrors';
import { mailAttachmentUpload, ATTACHMENT_MAX_FILE_BYTES } from '../mailAttachmentUpload';
import { encryptSecret, decryptSecretMaybe } from '../secretsCrypto';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  getUserName: (tenantId: string, userId: string, email?: string) => Promise<string>;
  logActivity: (tenantId: string, userId: string, userName: string, action: string, target: string, targetId: string, targetType: string, category: string) => void;
}

const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send';
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
        refresh_token: decryptSecretMaybe(connection.refresh_token),
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

  // Every handler below that calls a modify/send-scoped Gmail endpoint goes
  // through this so an INSUFFICIENT_SCOPE response is never one-off code.
  function respondToGmailError(res: any, resp: Response, data: any, fallbackMessage: string) {
    if (isInsufficientScopeError('google', resp.status, data)) {
      return res.status(403).json({ error: 'Permissions insuffisantes — reconnectez Gmail.', code: 'INSUFFICIENT_SCOPE' });
    }
    res.status(500).json({ error: data?.error?.message || fallbackMessage });
  }

  // GET /api/gmail/status
  app.get('/api/gmail/status', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const connection = await getConnection(tenantId, req.user.id);
      res.json({
        connected: !!connection,
        id: connection?.id || null,
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
      authUrl.searchParams.set('state', await createOAuthState(tenantId, req.user.id, returnTo));
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
    const consumed = await consumeOAuthState(state);
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
        refresh_token: encryptSecret(tokenData.refresh_token),
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

  // GET /api/gmail/folders — Gmail's labels, filtered/normalized to
  // something that reads as "folders" (server/mailFolders.ts).
  app.get('/api/gmail/folders', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const connection = await getConnection(tenantId, req.user.id);
      if (!connection) return res.status(400).json({ error: 'Gmail non connecté.' });
      const accessToken = await getAccessToken(connection);
      const resp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/labels', { headers: { Authorization: `Bearer ${accessToken}` } });
      const data: any = await resp.json();
      if (!resp.ok) throw new Error(data.error?.message || 'Échec de la récupération des labels Gmail');
      res.json(normalizeGmailLabels(data.labels || []));
    } catch (error: any) {
      console.error('[GET /api/gmail/folders]', error.message);
      res.status(500).json({ error: error.message || 'Échec de la récupération des dossiers Gmail' });
    }
  });

  // Shared by /search (filtered by an address) and /messages (folder
  // listing) — lists message ids for a query/label, then fetches header
  // metadata only (never the body) for each.
  async function fetchGmailMessages(accessToken: string, opts: { q?: string; labelIds?: string[] }, maxResults: number, pageToken?: string) {
    const headers = { Authorization: `Bearer ${accessToken}` };

    const listUrl = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
    if (opts.q) listUrl.searchParams.set('q', opts.q);
    (opts.labelIds || []).forEach(id => listUrl.searchParams.append('labelIds', id));
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
      const { messages } = await fetchGmailMessages(accessToken, { q: `from:${email} OR to:${email}` }, SEARCH_LIMIT);
      res.json(messages);
    } catch (error: any) {
      console.error('[GET /api/gmail/search]', error.message);
      res.status(500).json({ error: error.message || 'Échec de la recherche Gmail' });
    }
  });

  // GET /api/gmail/messages?pageToken=&maxResults=&labelId= — folder/label
  // listing (defaults to INBOX) for the Mailbox page, live and never
  // persisted. pageToken/nextPageToken drive "load more".
  app.get('/api/gmail/messages', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const connection = await getConnection(tenantId, req.user.id);
      if (!connection) return res.status(400).json({ error: 'Gmail non connecté.' });
      const { pageToken, labelId } = req.query as { pageToken?: string; labelId?: string };
      const maxResults = Math.min(parseInt(String(req.query.maxResults || INBOX_PAGE_SIZE), 10) || INBOX_PAGE_SIZE, 50);

      const accessToken = await getAccessToken(connection);
      const { messages, nextPageToken } = await fetchGmailMessages(accessToken, { labelIds: [labelId || 'INBOX'] }, maxResults, pageToken);
      res.json({ messages, nextPageToken });
    } catch (error: any) {
      console.error('[GET /api/gmail/messages]', error.message);
      res.status(500).json({ error: error.message || "Échec de la récupération de la boîte de réception Gmail" });
    }
  });

  // GET /api/gmail/messages/:id — full body (sanitized) + attachment
  // metadata, fetched live and never stored.
  app.get('/api/gmail/messages/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const connection = await getConnection(tenantId, req.user.id);
      if (!connection) return res.status(400).json({ error: 'Gmail non connecté.' });
      const accessToken = await getAccessToken(connection);
      const message = await fetchGmailFullMessage(accessToken, req.params.id);
      res.json(message);
    } catch (error: any) {
      console.error('[GET /api/gmail/messages/:id]', error.message);
      res.status(error.status === 404 ? 404 : 500).json({ error: error.message || 'Échec de la récupération du message Gmail' });
    }
  });

  // GET /api/gmail/messages/:id/attachments/:attachmentId?filename=&mimeType=
  // — filename/mimeType come from the full-message fetch's attachment list
  // (Gmail's attachment endpoint itself returns only size+data).
  app.get('/api/gmail/messages/:id/attachments/:attachmentId', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const connection = await getConnection(tenantId, req.user.id);
      if (!connection) return res.status(400).json({ error: 'Gmail non connecté.' });
      const accessToken = await getAccessToken(connection);
      const resp = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${req.params.id}/attachments/${req.params.attachmentId}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const data: any = await resp.json();
      if (!resp.ok) throw new Error(data.error?.message || 'Échec du téléchargement de la pièce jointe');
      const buffer = Buffer.from(data.data, 'base64url');
      const filename = String(req.query.filename || 'piece-jointe');
      const mimeType = String(req.query.mimeType || 'application/octet-stream');
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/"/g, '')}"`);
      res.send(buffer);
    } catch (error: any) {
      console.error('[GET /api/gmail/messages/:id/attachments/:attachmentId]', error.message);
      res.status(500).json({ error: error.message || 'Échec du téléchargement de la pièce jointe' });
    }
  });

  // POST /api/gmail/messages/:id/archive — removes the INBOX label. Real
  // mailbox action (requires gmail.modify, requested above).
  app.post('/api/gmail/messages/:id/archive', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const connection = await getConnection(tenantId, req.user.id);
      if (!connection) return res.status(400).json({ error: 'Gmail non connecté.' });
      const accessToken = await getAccessToken(connection);
      const resp = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${req.params.id}/modify`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ removeLabelIds: ['INBOX'] }),
      });
      const data: any = await resp.json();
      if (!resp.ok) return respondToGmailError(res, resp, data, "Échec de l'archivage");
      res.json({ success: true });
    } catch (error: any) {
      console.error('[POST /api/gmail/messages/:id/archive]', error.message);
      res.status(500).json({ error: error.message || "Échec de l'archivage" });
    }
  });

  // POST /api/gmail/messages/:id/trash — moves to Trash (reversible),
  // deliberately never the permanent .delete endpoint.
  app.post('/api/gmail/messages/:id/trash', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const connection = await getConnection(tenantId, req.user.id);
      if (!connection) return res.status(400).json({ error: 'Gmail non connecté.' });
      const accessToken = await getAccessToken(connection);
      const resp = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${req.params.id}/trash`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data: any = resp.status === 204 ? {} : await resp.json();
      if (!resp.ok) return respondToGmailError(res, resp, data, 'Échec de la suppression');
      res.json({ success: true });
    } catch (error: any) {
      console.error('[POST /api/gmail/messages/:id/trash]', error.message);
      res.status(500).json({ error: error.message || 'Échec de la suppression' });
    }
  });

  // POST /api/gmail/send — compose (no threadId/inReplyTo) or reply
  // (threadId + inReplyTo/references from the original message's
  // messageIdHeader, fetched via GET /api/gmail/messages/:id beforehand).
  // Builds a real RFC822 message with nodemailer's MailComposer (already a
  // dependency for the SMTP path) rather than adding a second MIME-building
  // library, base64url-encodes it for Gmail's raw-message send API.
  app.post('/api/gmail/send', mailAttachmentUpload, async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const connection = await getConnection(tenantId, req.user.id);
      if (!connection) return res.status(400).json({ error: 'Gmail non connecté.' });
      const { to, cc, subject, text, html, threadId, inReplyTo, references } = req.body;
      if (!to || !subject) return res.status(400).json({ error: 'to et subject requis' });

      const files = (req.files || []) as Express.Multer.File[];
      const totalSize = files.reduce((sum, f) => sum + f.size, 0);
      if (totalSize > ATTACHMENT_MAX_FILE_BYTES) {
        return res.status(400).json({ error: `Pièces jointes trop volumineuses (limite ${ATTACHMENT_MAX_FILE_BYTES / 1024 / 1024} Mo au total)` });
      }

      const composer = new MailComposer({
        from: connection.external_account_email || undefined,
        to, cc: cc || undefined, subject, text, html,
        inReplyTo: inReplyTo || undefined,
        references: references || undefined,
        attachments: files.map(f => ({ filename: f.originalname, content: f.buffer, contentType: f.mimetype })),
      });
      const message: Buffer = await new Promise((resolve, reject) => {
        composer.compile().build((err: any, msg: Buffer) => (err ? reject(err) : resolve(msg)));
      });

      const accessToken = await getAccessToken(connection);
      const resp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw: message.toString('base64url'), ...(threadId ? { threadId } : {}) }),
      });
      const data: any = await resp.json();
      if (!resp.ok) return respondToGmailError(res, resp, data, "Échec de l'envoi");

      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Email envoyé via Gmail à ${to}`, subject, data.id, 'email', 'Correspondance');
      res.json({ success: true, id: data.id, threadId: data.threadId });
    } catch (error: any) {
      console.error('[POST /api/gmail/send]', error.message);
      res.status(500).json({ error: error.message || "Échec de l'envoi" });
    }
  });
}
