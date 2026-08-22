// Generic IMAP connector for the "Correspondance" tab, defaulting to
// Infomaniak (mail.infomaniak.com:993) but working with any standard IMAP
// server: Infomaniak's own API (developer.infomaniak.com) only covers
// mailbox *hosting* administration (create mailboxes, aliases, auto-replies)
// — there is no REST endpoint to list or search actual messages, so reading
// a real Infomaniak inbox has to go over IMAP itself, unlike Gmail (server/
// routes/gmailSync.ts) which has a proper OAuth + REST API for that.
//
// Because this uses a real mailbox password rather than a revocable OAuth
// refresh_token, the password is encrypted at rest (server/secretsCrypto.ts)
// before being stored in email_connections.
//
// Same read-only, non-persistent principle as the Gmail connector: messages
// are searched live on demand, nothing is stored here beyond the connection
// itself — only an explicit "attach" (server/mailLinks.ts) persists
// metadata for display.
import type { Express } from 'express';
import { ImapFlow } from 'imapflow';
import { tenantScopedFrom } from '../tenantScopedFrom';
import { encryptSecret, decryptSecret } from '../secretsCrypto';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  getUserName: (tenantId: string, userId: string, email?: string) => Promise<string>;
  logActivity: (tenantId: string, userId: string, userName: string, action: string, target: string, targetId: string, targetType: string, category: string) => void;
}

const SEARCH_LIMIT = 20;
const INBOX_DEFAULT_LIMIT = 25;
const INBOX_MAX_LIMIT = 100;
const CONNECT_TIMEOUT_MS = 10000;
// imapflow's own `connectionTimeout` bounds the connect phase, but a TCP
// handshake that's silently dropped by a firewall (SYN sent, nothing back —
// as opposed to an active refusal) can still leave requests hanging well
// past that budget in some environments. This is a second, unconditional
// backstop around every ImapFlow operation in this file so the HTTP
// response is never held open indefinitely: on expiry it force-closes the
// client (safe to call at any point, even mid-connect) and rejects.
const HARD_TIMEOUT_MS = 15000;

function withHardTimeout<T>(client: ImapFlow, promise: Promise<T>, ms = HARD_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      try { client.close(); } catch { /* already closed / never opened */ }
      const err: any = new Error('Délai dépassé : le serveur IMAP ne répond pas.');
      err.code = 'HARD_TIMEOUT';
      reject(err);
    }, ms);
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      err => { clearTimeout(timer); reject(err); },
    );
  });
}

// Backstop around the *entire* request, not just the ImapFlow calls —
// withHardTimeout above only covers the IMAP operations themselves, but a
// report of these routes hanging indefinitely with no error at all (even
// past that budget) means something earlier in the handler is stuck instead
// (most likely getTenantId/getConnection's Supabase round trip). This
// middleware guarantees every /api/mail/imap/* request gets *a* response
// within REQUEST_TIMEOUT_MS no matter where in the handler it stalls.
const REQUEST_TIMEOUT_MS = 20000;

function withRequestTimeout(req: any, res: any, next: any) {
  res.setTimeout(REQUEST_TIMEOUT_MS, () => {
    console.error(`[imapMailSync] Request timed out after ${REQUEST_TIMEOUT_MS}ms: ${req.method} ${req.originalUrl}`);
    send(res, 504, { error: 'Délai dépassé : le serveur ne répond pas. Réessayez.' });
  });
  next();
}

// Every response in this file goes through this — once withRequestTimeout's
// deadline has already answered the request, the original (now-late)
// handler eventually finishing and calling res.json()/res.status().json()
// again would throw ERR_HTTP_HEADERS_SENT, which inside an async handler
// becomes an unhandled rejection that can crash the whole process. Guarding
// on headersSent here makes that late completion a silent no-op instead.
function send(res: any, status: number, body: any) {
  if (res.headersSent) return;
  res.status(status).json(body);
}

function friendlyImapError(error: any): string {
  const msg = String(error?.message || error);
  if (error?.code === 'HARD_TIMEOUT') return msg;
  if (/auth/i.test(msg) || error?.authenticationFailed) return "Échec de l'authentification : vérifiez l'adresse et le mot de passe.";
  if (/ENOTFOUND|EAI_AGAIN/.test(msg)) return "Serveur IMAP introuvable : vérifiez l'hôte.";
  if (/ECONNREFUSED/.test(msg)) return "Connexion refusée : vérifiez l'hôte et le port.";
  if (/ETIMEDOUT|timed out/i.test(msg)) return 'Délai dépassé : le serveur IMAP ne répond pas.';
  return msg || 'Échec de la connexion IMAP';
}

export function registerImapMailSyncRoutes(app: Express, { supabaseAdmin, getTenantId, getUserName, logActivity }: RouteDeps) {
  async function getConnection(tenantId: string, userId: string) {
    const { data } = await tenantScopedFrom(supabaseAdmin, tenantId, 'email_connections')
      .select('*').eq('user_id', userId).eq('provider', 'infomaniak').maybeSingle();
    return data as any;
  }

  // GET /api/mail/imap/status
  app.get('/api/mail/imap/status', withRequestTimeout, async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const connection = await getConnection(tenantId, req.user.id);
      send(res, 200, {
        connected: !!connection,
        email: connection?.external_account_email || connection?.imap_username || null,
        host: connection?.imap_host || null,
        last_synced_at: connection?.last_synced_at || null,
      });
    } catch (error: any) {
      console.error('[GET /api/mail/imap/status]', error);
      send(res, 500, { error: 'Failed to get IMAP status' });
    }
  });

  // POST /api/mail/imap/connect — { host, port, username, password }.
  // Tests the credentials with a verify-only connection before storing
  // anything, so a typo doesn't silently save a broken connection.
  app.post('/api/mail/imap/connect', withRequestTimeout, async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { host, port, username, password } = req.body;
      if (!host || !port || !username || !password) {
        return send(res, 400, { error: 'host, port, username et password requis' });
      }
      const portNum = parseInt(String(port), 10);
      if (!Number.isFinite(portNum) || portNum <= 0 || portNum > 65535) {
        return send(res, 400, { error: 'Port invalide' });
      }

      const client = new ImapFlow({
        host: String(host),
        port: portNum,
        secure: true,
        auth: { user: String(username), pass: String(password) },
        logger: false,
        verifyOnly: true,
        connectionTimeout: CONNECT_TIMEOUT_MS,
      });
      try {
        await withHardTimeout(client, client.connect());
      } catch (err: any) {
        return send(res, 400, { error: friendlyImapError(err) });
      }

      const passwordEncrypted = encryptSecret(String(password));
      const existing = await getConnection(tenantId, req.user.id);
      const row = {
        imap_host: String(host),
        imap_port: portNum,
        imap_username: String(username),
        imap_password_encrypted: passwordEncrypted,
        external_account_email: String(username),
      };
      if (existing) {
        await tenantScopedFrom(supabaseAdmin, tenantId, 'email_connections').update(row).eq('id', existing.id);
      } else {
        await tenantScopedFrom(supabaseAdmin, tenantId, 'email_connections').insert({
          id: crypto.randomUUID(),
          user_id: req.user.id,
          provider: 'infomaniak',
          auth_type: 'imap',
          ...row,
        });
      }
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, 'Connexion à la messagerie (IMAP)', '', tenantId, 'integration', 'Intégrations');
      send(res, 200, { success: true });
    } catch (error: any) {
      console.error('[POST /api/mail/imap/connect]', error.message);
      send(res, 500, { error: error.message || 'Échec de la connexion IMAP' });
    }
  });

  // DELETE /api/mail/imap/disconnect
  app.delete('/api/mail/imap/disconnect', withRequestTimeout, async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      await tenantScopedFrom(supabaseAdmin, tenantId, 'email_connections').delete().eq('user_id', req.user.id).eq('provider', 'infomaniak');
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, 'Déconnexion de la messagerie (IMAP)', '', tenantId, 'integration', 'Intégrations');
      send(res, 200, { success: true });
    } catch (error: any) {
      console.error('[DELETE /api/mail/imap/disconnect]', error);
      send(res, 500, { error: 'Failed to disconnect IMAP' });
    }
  });

  // GET /api/mail/imap/search?email=<adresse> — live search across INBOX
  // and the Sent folder (if any), envelope metadata only, never persisted.
  app.get('/api/mail/imap/search', withRequestTimeout, async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const connection = await getConnection(tenantId, req.user.id);
      if (!connection) return send(res, 400, { error: 'Messagerie IMAP non connectée.' });
      const { email } = req.query as { email?: string };
      if (!email) return send(res, 400, { error: 'email requis' });

      const password = decryptSecret(connection.imap_password_encrypted);
      const client = new ImapFlow({
        host: connection.imap_host,
        port: connection.imap_port,
        secure: true,
        auth: { user: connection.imap_username, pass: password },
        logger: false,
        connectionTimeout: CONNECT_TIMEOUT_MS,
      });

      const results: any[] = [];
      try {
        await withHardTimeout(client, (async () => {
          await client.connect();

          const mailboxes = await client.list();
          const sentBox = mailboxes.find(m => m.specialUse === '\\Sent');
          const folders = ['INBOX', ...(sentBox ? [sentBox.path] : [])];

          for (const folder of folders) {
            if (results.length >= SEARCH_LIMIT) break;
            try {
              await client.mailboxOpen(folder);
            } catch {
              continue; // folder may not exist / not selectable — skip it
            }
            const uids = await client.search({ or: [{ from: email }, { to: email }] }, { uid: true });
            if (!uids || uids.length === 0) continue;
            const recentUids = uids.slice(-SEARCH_LIMIT).reverse();
            for await (const msg of client.fetch(recentUids, { envelope: true, uid: true }, { uid: true })) {
              const addr = (list?: { name?: string; address?: string }[]) =>
                (list || []).map(a => a.address).filter(Boolean).join(', ');
              results.push({
                uid: msg.uid,
                folder,
                subject: msg.envelope?.subject || '',
                from: addr(msg.envelope?.from),
                to: addr(msg.envelope?.to),
                date: msg.envelope?.date || null,
              });
              if (results.length >= SEARCH_LIMIT) break;
            }
          }
        })());
      } finally {
        try { await client.logout(); } catch { /* connection may already be closed, or force-closed by the hard timeout */ }
      }

      await tenantScopedFrom(supabaseAdmin, tenantId, 'email_connections').update({ last_synced_at: new Date().toISOString() }).eq('id', connection.id);
      send(res, 200, results);
    } catch (error: any) {
      console.error('[GET /api/mail/imap/search]', error.message);
      send(res, 500, { error: friendlyImapError(error) });
    }
  });

  // GET /api/mail/imap/messages?limit= — plain INBOX listing (most recent
  // first, no address filter) for the Mailbox page. Not cursor-paginated —
  // "load more" on the frontend just re-requests with a larger `limit`,
  // which is cheap enough at this scale and keeps the server stateless.
  app.get('/api/mail/imap/messages', withRequestTimeout, async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const connection = await getConnection(tenantId, req.user.id);
      if (!connection) return send(res, 400, { error: 'Messagerie IMAP non connectée.' });
      const limit = Math.min(Math.max(parseInt(String(req.query.limit || INBOX_DEFAULT_LIMIT), 10) || INBOX_DEFAULT_LIMIT, 1), INBOX_MAX_LIMIT);

      const password = decryptSecret(connection.imap_password_encrypted);
      const client = new ImapFlow({
        host: connection.imap_host,
        port: connection.imap_port,
        secure: true,
        auth: { user: connection.imap_username, pass: password },
        logger: false,
        connectionTimeout: CONNECT_TIMEOUT_MS,
      });

      const results: any[] = [];
      try {
        await withHardTimeout(client, (async () => {
          await client.connect();
          const mailbox = await client.mailboxOpen('INBOX');
          if (mailbox.exists > 0) {
            const start = Math.max(1, mailbox.exists - limit + 1);
            const addr = (list?: { name?: string; address?: string }[]) =>
              (list || []).map(a => a.address).filter(Boolean).join(', ');
            for await (const msg of client.fetch(`${start}:*`, { envelope: true, uid: true }, { uid: true })) {
              results.push({
                uid: msg.uid,
                folder: 'INBOX',
                subject: msg.envelope?.subject || '',
                from: addr(msg.envelope?.from),
                to: addr(msg.envelope?.to),
                date: msg.envelope?.date || null,
              });
            }
          }
        })());
      } finally {
        try { await client.logout(); } catch { /* connection may already be closed, or force-closed by the hard timeout */ }
      }

      results.reverse(); // fetch returns ascending sequence order — newest last
      await tenantScopedFrom(supabaseAdmin, tenantId, 'email_connections').update({ last_synced_at: new Date().toISOString() }).eq('id', connection.id);
      send(res, 200, results);
    } catch (error: any) {
      console.error('[GET /api/mail/imap/messages]', error.message);
      send(res, 500, { error: friendlyImapError(error) });
    }
  });
}
