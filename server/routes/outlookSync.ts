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
// Messages are listed/searched/read live on demand and never stored here —
// only an explicit "attach" (server/mailLinks.ts) or "link a folder"
// (server/mailFolderLinks.ts) persists anything, and only metadata, never
// a body.
//
// Scope covers read, archive/delete, and send in one grant:
// `Mail.ReadWrite` (superset of `Mail.Read`) + `Mail.Send`, requested
// together even though send doesn't ship until later in this same change —
// two separate re-authorization prompts a few weeks apart is worse UX than
// one, for no implementation savings either way. A connection made before
// this scope existed still carries a `Mail.Read`-only token — a
// modify/send call against it 403s in a shape isInsufficientScopeError()
// recognizes, surfaced as { code: 'INSUFFICIENT_SCOPE' } so the frontend
// can prompt reconnecting (src/hooks/useMailConnections.ts).
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';
import { createOAuthState, consumeOAuthState } from '../oauthState';
import { fetchOutlookFullMessage } from '../mailFullMessage';
import { normalizeOutlookFolders } from '../mailFolders';
import { isInsufficientScopeError } from '../mailProviderErrors';
import { mailAttachmentUpload, ATTACHMENT_MAX_FILE_BYTES } from '../mailAttachmentUpload';
import { encryptSecret, decryptSecretMaybe } from '../secretsCrypto';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  getUserName: (tenantId: string, userId: string, email?: string) => Promise<string>;
  logActivity: (tenantId: string, userId: string, userName: string, action: string, target: string, targetId: string, targetType: string, category: string) => void;
}

const OUTLOOK_SCOPE = 'offline_access https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send';
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

    const currentRefreshToken = decryptSecretMaybe(connection.refresh_token);
    const resp = await fetch(`${AUTHORITY}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: currentRefreshToken,
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
    if (data.refresh_token && data.refresh_token !== currentRefreshToken) {
      connection.refresh_token = data.refresh_token;
      tenantScopedFrom(supabaseAdmin, connection.tenant_id, 'email_connections')
        .update({ refresh_token: encryptSecret(data.refresh_token) }).eq('id', connection.id)
        .then(() => {}, (err: any) => console.error('[Outlook refresh_token persist]', err.message));
    }
    accessTokenCache.set(connection.user_id, { token: data.access_token, expiresAt: now + (data.expires_in || 3600) * 1000 });
    return data.access_token;
  }

  // Every handler that calls a ReadWrite/Send-scoped Graph endpoint goes
  // through this so an INSUFFICIENT_SCOPE response is never one-off code.
  function respondToOutlookError(res: any, status: number, data: any, fallbackMessage: string) {
    if (isInsufficientScopeError('microsoft', status, data)) {
      return res.status(403).json({ error: 'Permissions insuffisantes — reconnectez Outlook.', code: 'INSUFFICIENT_SCOPE' });
    }
    res.status(500).json({ error: data?.error?.message || fallbackMessage });
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
        id: connection?.id || null,
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
      authUrl.searchParams.set('state', await createOAuthState(tenantId, req.user.id, returnTo));
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
    const consumed = await consumeOAuthState(state);
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
        refresh_token: encryptSecret(tokenData.refresh_token),
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

  // GET /api/outlook/messages?pageToken=&maxResults=&folderId= — folder
  // listing (defaults to inbox) for the Mailbox page. pageToken here is
  // simply Graph's own `@odata.nextLink` URL, fetched as-is.
  app.get('/api/outlook/messages', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const connection = await getConnection(tenantId, req.user.id);
      if (!connection) return res.status(400).json({ error: 'Outlook non connecté.' });
      const { pageToken, folderId } = req.query as { pageToken?: string; folderId?: string };
      const maxResults = Math.min(parseInt(String(req.query.maxResults || INBOX_PAGE_SIZE), 10) || INBOX_PAGE_SIZE, 50);

      const accessToken = await getAccessToken(connection);
      let url: string;
      if (pageToken) {
        url = pageToken;
      } else {
        const u = new URL(`${GRAPH_BASE}/me/mailFolders/${encodeURIComponent(folderId || 'inbox')}/messages`);
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

  // GET /api/outlook/folders
  app.get('/api/outlook/folders', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const connection = await getConnection(tenantId, req.user.id);
      if (!connection) return res.status(400).json({ error: 'Outlook non connecté.' });
      const accessToken = await getAccessToken(connection);
      const url = new URL(`${GRAPH_BASE}/me/mailFolders`);
      url.searchParams.set('$top', '100');
      const resp = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
      const data: any = await resp.json();
      if (!resp.ok) throw new Error(data.error?.message || 'Échec de la récupération des dossiers Outlook');
      res.json(normalizeOutlookFolders(data.value || []));
    } catch (error: any) {
      console.error('[GET /api/outlook/folders]', error.message);
      res.status(500).json({ error: error.message || 'Échec de la récupération des dossiers Outlook' });
    }
  });

  // GET /api/outlook/messages/:id — full body (sanitized) + attachment
  // metadata, fetched live and never stored.
  app.get('/api/outlook/messages/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const connection = await getConnection(tenantId, req.user.id);
      if (!connection) return res.status(400).json({ error: 'Outlook non connecté.' });
      const accessToken = await getAccessToken(connection);
      const message = await fetchOutlookFullMessage(accessToken, req.params.id);
      res.json(message);
    } catch (error: any) {
      console.error('[GET /api/outlook/messages/:id]', error.message);
      res.status(error.status === 404 ? 404 : 500).json({ error: error.message || 'Échec de la récupération du message Outlook' });
    }
  });

  // GET /api/outlook/messages/:id/attachments/:attachmentId — Graph inlines
  // small attachments as base64 contentBytes in the $expand=attachments
  // response already consumed by fetchOutlookFullMessage, so this re-fetches
  // just that one attachment rather than caching anything.
  app.get('/api/outlook/messages/:id/attachments/:attachmentId', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const connection = await getConnection(tenantId, req.user.id);
      if (!connection) return res.status(400).json({ error: 'Outlook non connecté.' });
      const accessToken = await getAccessToken(connection);
      const resp = await fetch(`${GRAPH_BASE}/me/messages/${req.params.id}/attachments/${req.params.attachmentId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data: any = await resp.json();
      if (!resp.ok) throw new Error(data.error?.message || 'Échec du téléchargement de la pièce jointe');
      const buffer = Buffer.from(data.contentBytes, 'base64');
      res.setHeader('Content-Type', data.contentType || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${String(data.name || 'piece-jointe').replace(/"/g, '')}"`);
      res.send(buffer);
    } catch (error: any) {
      console.error('[GET /api/outlook/messages/:id/attachments/:attachmentId]', error.message);
      res.status(500).json({ error: error.message || 'Échec du téléchargement de la pièce jointe' });
    }
  });

  // POST /api/outlook/messages/:id/move — real mailbox action (requires
  // Mail.ReadWrite, requested above). destinationId accepts either a real
  // folder id or a well-known name ("archive", "deleteditems").
  app.post('/api/outlook/messages/:id/move', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const connection = await getConnection(tenantId, req.user.id);
      if (!connection) return res.status(400).json({ error: 'Outlook non connecté.' });
      const { destinationId } = req.body;
      if (!destinationId) return res.status(400).json({ error: 'destinationId requis' });
      const accessToken = await getAccessToken(connection);
      const resp = await fetch(`${GRAPH_BASE}/me/messages/${req.params.id}/move`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ destinationId }),
      });
      const data: any = resp.status === 204 ? {} : await resp.json();
      if (!resp.ok) return respondToOutlookError(res, resp.status, data, 'Échec du déplacement');
      res.json({ success: true });
    } catch (error: any) {
      console.error('[POST /api/outlook/messages/:id/move]', error.message);
      res.status(500).json({ error: error.message || 'Échec du déplacement' });
    }
  });

  // DELETE /api/outlook/messages/:id — Graph moves to Deleted Items by
  // default rather than a permanent purge, matching Gmail's trash (not
  // .delete) and IMAP's move-to-Trash for reversible-by-default parity.
  app.delete('/api/outlook/messages/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const connection = await getConnection(tenantId, req.user.id);
      if (!connection) return res.status(400).json({ error: 'Outlook non connecté.' });
      const accessToken = await getAccessToken(connection);
      const resp = await fetch(`${GRAPH_BASE}/me/messages/${req.params.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data: any = resp.status === 204 ? {} : await resp.json();
      if (!resp.ok) return respondToOutlookError(res, resp.status, data, 'Échec de la suppression');
      res.json({ success: true });
    } catch (error: any) {
      console.error('[DELETE /api/outlook/messages/:id]', error.message);
      res.status(500).json({ error: error.message || 'Échec de la suppression' });
    }
  });

  // POST /api/outlook/send — new compose, structured JSON (no manual MIME
  // needed, unlike Gmail).
  app.post('/api/outlook/send', mailAttachmentUpload, async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const connection = await getConnection(tenantId, req.user.id);
      if (!connection) return res.status(400).json({ error: 'Outlook non connecté.' });
      const { to, cc, subject, text, html } = req.body;
      if (!to || !subject) return res.status(400).json({ error: 'to et subject requis' });

      const files = (req.files || []) as Express.Multer.File[];
      const totalSize = files.reduce((sum, f) => sum + f.size, 0);
      if (totalSize > ATTACHMENT_MAX_FILE_BYTES) {
        return res.status(400).json({ error: `Pièces jointes trop volumineuses (limite ${ATTACHMENT_MAX_FILE_BYTES / 1024 / 1024} Mo au total)` });
      }

      const toRecipients = String(to).split(',').map((a: string) => ({ emailAddress: { address: a.trim() } })).filter((r: any) => r.emailAddress.address);
      const ccRecipients = cc ? String(cc).split(',').map((a: string) => ({ emailAddress: { address: a.trim() } })).filter((r: any) => r.emailAddress.address) : undefined;
      const message = {
        subject,
        body: { contentType: html ? 'HTML' : 'Text', content: html || text || '' },
        toRecipients,
        ccRecipients,
        attachments: files.map(f => ({
          '@odata.type': '#microsoft.graph.fileAttachment',
          name: f.originalname,
          contentType: f.mimetype,
          contentBytes: f.buffer.toString('base64'),
        })),
      };

      const accessToken = await getAccessToken(connection);
      const resp = await fetch(`${GRAPH_BASE}/me/sendMail`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, saveToSentItems: true }),
      });
      if (resp.status !== 202) {
        const data: any = await resp.json().catch(() => ({}));
        return respondToOutlookError(res, resp.status, data, "Échec de l'envoi");
      }

      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Email envoyé via Outlook à ${to}`, subject, '', 'email', 'Correspondance');
      res.json({ success: true });
    } catch (error: any) {
      console.error('[POST /api/outlook/send]', error.message);
      res.status(500).json({ error: error.message || "Échec de l'envoi" });
    }
  });

  // POST /api/outlook/messages/:id/reply — Graph's own native reply
  // endpoint threads the message itself; unlike Gmail this deliberately
  // does NOT reconstruct In-Reply-To/References by hand, since Graph
  // already knows how to do this correctly for its own messages.
  app.post('/api/outlook/messages/:id/reply', mailAttachmentUpload, async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const connection = await getConnection(tenantId, req.user.id);
      if (!connection) return res.status(400).json({ error: 'Outlook non connecté.' });
      const { comment, replyAll } = req.body;

      const files = (req.files || []) as Express.Multer.File[];
      const totalSize = files.reduce((sum, f) => sum + f.size, 0);
      if (totalSize > ATTACHMENT_MAX_FILE_BYTES) {
        return res.status(400).json({ error: `Pièces jointes trop volumineuses (limite ${ATTACHMENT_MAX_FILE_BYTES / 1024 / 1024} Mo au total)` });
      }

      const accessToken = await getAccessToken(connection);
      const endpoint = replyAll === 'true' || replyAll === true ? 'replyAll' : 'reply';
      if (files.length === 0) {
        // Simple case: Graph's reply/replyAll accepts a plain { comment }.
        const resp = await fetch(`${GRAPH_BASE}/me/messages/${req.params.id}/${endpoint}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ comment: comment || '' }),
        });
        if (resp.status !== 202) {
          const data: any = await resp.json().catch(() => ({}));
          return respondToOutlookError(res, resp.status, data, 'Échec de la réponse');
        }
      } else {
        // With attachments, Graph requires the createReply → patch
        // attachments → send flow instead of the one-shot reply endpoint.
        const createResp = await fetch(`${GRAPH_BASE}/me/messages/${req.params.id}/${endpoint === 'replyAll' ? 'createReplyAll' : 'createReply'}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ comment: comment || '' }),
        });
        const draft: any = await createResp.json();
        if (!createResp.ok) return respondToOutlookError(res, createResp.status, draft, 'Échec de la réponse');

        for (const f of files) {
          await fetch(`${GRAPH_BASE}/me/messages/${draft.id}/attachments`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              '@odata.type': '#microsoft.graph.fileAttachment',
              name: f.originalname,
              contentType: f.mimetype,
              contentBytes: f.buffer.toString('base64'),
            }),
          });
        }
        const sendResp = await fetch(`${GRAPH_BASE}/me/messages/${draft.id}/send`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (sendResp.status !== 202) {
          const data: any = await sendResp.json().catch(() => ({}));
          return respondToOutlookError(res, sendResp.status, data, "Échec de l'envoi de la réponse");
        }
      }

      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, 'Réponse envoyée via Outlook', '', req.params.id, 'email', 'Correspondance');
      res.json({ success: true });
    } catch (error: any) {
      console.error('[POST /api/outlook/messages/:id/reply]', error.message);
      res.status(500).json({ error: error.message || 'Échec de la réponse' });
    }
  });
}
