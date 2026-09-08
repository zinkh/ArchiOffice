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
import { resolveMailAccount, isFirstMailAccountForUser } from '../mailAccounts';
import { encryptSecret, decryptSecret } from '../secretsCrypto';
import { fetchImapFullMessage, fetchImapAttachment } from '../mailFullMessage';
import { normalizeImapMailboxes } from '../mailFolders';

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
  // Plusieurs boîtes IMAP par utilisateur sont possibles depuis le support
  // multi-comptes (server/mailAccounts.ts) : accountId (query ou body)
  // désigne un compte précis, sinon le défaut de l'utilisateur.
  async function getConnection(tenantId: string, userId: string, accountId?: string | null) {
    return resolveMailAccount(supabaseAdmin, tenantId, userId, 'infomaniak', accountId);
  }

  // POST /api/mail/imap/connect — { host, port, username, password,
  // smtpHost?, smtpPort?, smtpUsername?, smtpPassword? }. Tests the IMAP
  // credentials with a verify-only connection before storing anything, so a
  // typo doesn't silently save a broken connection. The optional smtp*
  // fields are what let this account actually send — IMAP itself has no
  // send capability (the protocol doesn't have one), so without them this
  // account can only be read from (see migrate_multi_mail_calendar.sql).
  app.post('/api/mail/imap/connect', withRequestTimeout, async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { host, port, username, password, smtpHost, smtpPort, smtpUsername, smtpPassword } = req.body;
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

      // Une même adresse se reconnecte (mise à jour des identifiants) ; une
      // adresse différente devient un compte de plus.
      const { data: existing } = await tenantScopedFrom(supabaseAdmin, tenantId, 'email_connections')
        .select('id').eq('user_id', req.user.id).eq('provider', 'infomaniak').eq('external_account_email', String(username)).maybeSingle();
      const row: Record<string, unknown> = {
        imap_host: String(host),
        imap_port: portNum,
        imap_username: String(username),
        imap_password_encrypted: encryptSecret(String(password)),
        external_account_email: String(username),
      };
      if (smtpHost && smtpUsername && smtpPassword) {
        row.smtp_host = String(smtpHost);
        row.smtp_port = parseInt(String(smtpPort || 465), 10);
        row.smtp_username = String(smtpUsername);
        row.smtp_password_encrypted = encryptSecret(String(smtpPassword));
      }
      if (existing) {
        await tenantScopedFrom(supabaseAdmin, tenantId, 'email_connections').update(row).eq('id', existing.id);
      } else {
        const isFirst = await isFirstMailAccountForUser(supabaseAdmin, tenantId, req.user.id);
        await tenantScopedFrom(supabaseAdmin, tenantId, 'email_connections').insert({
          id: crypto.randomUUID(),
          user_id: req.user.id,
          provider: 'infomaniak',
          auth_type: 'imap',
          is_default: isFirst,
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

  // GET /api/mail/imap/search?email=&from=&to=&subject=&q=&dateFrom=&dateTo=
  //   &folder=&limit= — live search, envelope metadata only, never persisted.
  // `email` alone (from OR to) is the original shape, still used by
  // CorrespondenceTab.tsx, searching INBOX + Sent; every other param is
  // additive for the Mailbox page's advanced search panel. When `folder` is
  // given, search is scoped to just that one mailbox instead of the
  // INBOX+Sent default (matching how /messages already takes a single
  // `folder`). `q` maps to a body search — IMAP SEARCH has no single
  // "subject or body" operator to combine with the other AND'd criteria
  // below without also restructuring how they combine, so free text here
  // only matches body content, not subject (use the `subject` field for
  // that). There's also no hasAttachment param: IMAP SEARCH has no
  // attachment-presence criterion without fetching and inspecting each
  // message's BODYSTRUCTURE, which isn't worth the cost here.
  app.get('/api/mail/imap/search', withRequestTimeout, async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const connection = await getConnection(tenantId, req.user.id, req.query.accountId || req.body?.accountId);
      if (!connection) return send(res, 400, { error: 'Messagerie IMAP non connectée.' });
      const { email, from, to, subject, q, dateFrom, dateTo, folder } = req.query as Record<string, string | undefined>;
      if (!email && !from && !to && !subject && !q && !dateFrom && !dateTo) {
        return send(res, 400, { error: 'Au moins un critère de recherche est requis.' });
      }
      const limit = Math.min(Math.max(parseInt(String(req.query.limit || SEARCH_LIMIT), 10) || SEARCH_LIMIT, 1), 50);

      const criteria: Record<string, any> = {};
      if (email) criteria.or = [{ from: email }, { to: email }];
      if (from) criteria.from = from;
      if (to) criteria.to = to;
      if (subject) criteria.subject = subject;
      if (q) criteria.body = q;
      if (dateFrom) criteria.since = new Date(dateFrom);
      if (dateTo) criteria.before = new Date(dateTo);

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

          let folders: string[];
          if (folder) {
            folders = [folder];
          } else {
            const mailboxes = await client.list();
            const sentBox = mailboxes.find(m => m.specialUse === '\\Sent');
            folders = ['INBOX', ...(sentBox ? [sentBox.path] : [])];
          }

          for (const f of folders) {
            if (results.length >= limit) break;
            try {
              await client.mailboxOpen(f);
            } catch {
              continue; // folder may not exist / not selectable — skip it
            }
            const uids = await client.search(criteria, { uid: true });
            if (!uids || uids.length === 0) continue;
            const recentUids = uids.slice(-limit).reverse();
            for await (const msg of client.fetch(recentUids, { envelope: true, uid: true }, { uid: true })) {
              const addr = (list?: { name?: string; address?: string }[]) =>
                (list || []).map(a => a.address).filter(Boolean).join(', ');
              results.push({
                uid: msg.uid,
                folder: f,
                subject: msg.envelope?.subject || '',
                from: addr(msg.envelope?.from),
                to: addr(msg.envelope?.to),
                date: msg.envelope?.date || null,
              });
              if (results.length >= limit) break;
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

  // GET /api/mail/imap/messages?limit=&folder= — folder listing (defaults
  // to INBOX), most recent first, for the Mailbox page. Not cursor-
  // paginated — "load more" on the frontend just re-requests with a larger
  // `limit`, which is cheap enough at this scale and keeps the server
  // stateless.
  app.get('/api/mail/imap/messages', withRequestTimeout, async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const connection = await getConnection(tenantId, req.user.id, req.query.accountId || req.body?.accountId);
      if (!connection) return send(res, 400, { error: 'Messagerie IMAP non connectée.' });
      const limit = Math.min(Math.max(parseInt(String(req.query.limit || INBOX_DEFAULT_LIMIT), 10) || INBOX_DEFAULT_LIMIT, 1), INBOX_MAX_LIMIT);
      const folder = String(req.query.folder || 'INBOX');

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
          const mailbox = await client.mailboxOpen(folder);
          if (mailbox.exists > 0) {
            const start = Math.max(1, mailbox.exists - limit + 1);
            const addr = (list?: { name?: string; address?: string }[]) =>
              (list || []).map(a => a.address).filter(Boolean).join(', ');
            for await (const msg of client.fetch(`${start}:*`, { envelope: true, uid: true }, { uid: true })) {
              results.push({
                uid: msg.uid,
                folder,
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

  // GET /api/mail/imap/folders
  app.get('/api/mail/imap/folders', withRequestTimeout, async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const connection = await getConnection(tenantId, req.user.id, req.query.accountId || req.body?.accountId);
      if (!connection) return send(res, 400, { error: 'Messagerie IMAP non connectée.' });
      const password = decryptSecret(connection.imap_password_encrypted);
      const client = new ImapFlow({
        host: connection.imap_host,
        port: connection.imap_port,
        secure: true,
        auth: { user: connection.imap_username, pass: password },
        logger: false,
        connectionTimeout: CONNECT_TIMEOUT_MS,
      });
      let mailboxes: any[] = [];
      try {
        mailboxes = await withHardTimeout(client, (async () => {
          await client.connect();
          return client.list();
        })());
      } finally {
        try { await client.logout(); } catch { /* connexion déjà fermée, ou coupée par le hard timeout */ }
      }
      send(res, 200, normalizeImapMailboxes(mailboxes));
    } catch (error: any) {
      console.error('[GET /api/mail/imap/folders]', error.message);
      send(res, 500, { error: friendlyImapError(error) });
    }
  });

  // GET /api/mail/imap/messages/:folder/:uid — corps complet (assaini) +
  // métadonnées des pièces jointes, jamais mis en cache.
  app.get('/api/mail/imap/messages/:folder/:uid', withRequestTimeout, async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const connection = await getConnection(tenantId, req.user.id, req.query.accountId || req.body?.accountId);
      if (!connection) return send(res, 400, { error: 'Messagerie IMAP non connectée.' });
      const uid = parseInt(req.params.uid, 10);
      if (!Number.isFinite(uid)) return send(res, 400, { error: 'uid invalide' });
      const message = await fetchImapFullMessage(connection as any, req.params.folder, uid);
      send(res, 200, message);
    } catch (error: any) {
      console.error('[GET /api/mail/imap/messages/:folder/:uid]', error.message);
      send(res, 500, { error: friendlyImapError(error) });
    }
  });

  // GET /api/mail/imap/messages/:folder/:uid/attachments/:attachmentId —
  // re-fetch et re-parse le message pour extraire une pièce jointe (pas de
  // mise en cache, cf. server/mailFullMessage.ts).
  app.get('/api/mail/imap/messages/:folder/:uid/attachments/:attachmentId', withRequestTimeout, async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const connection = await getConnection(tenantId, req.user.id, req.query.accountId || req.body?.accountId);
      if (!connection) return send(res, 400, { error: 'Messagerie IMAP non connectée.' });
      const uid = parseInt(req.params.uid, 10);
      if (!Number.isFinite(uid)) return send(res, 400, { error: 'uid invalide' });
      const attachment = await fetchImapAttachment(connection as any, req.params.folder, uid, req.params.attachmentId);
      if (!attachment) return send(res, 404, { error: 'Pièce jointe introuvable' });
      if (res.headersSent) return;
      res.setHeader('Content-Type', attachment.mimeType || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${attachment.filename.replace(/"/g, '')}"`);
      res.send(attachment.buffer);
    } catch (error: any) {
      console.error('[GET /api/mail/imap/messages/:folder/:uid/attachments/:attachmentId]', error.message);
      send(res, 500, { error: friendlyImapError(error) });
    }
  });

  // POST /api/mail/imap/messages/:folder/:uid/move — { destination:
  // 'archive'|'trash' }. Real mailbox action: full credentials are already
  // stored for IMAP (unlike Gmail/Outlook, no separate OAuth scope to
  // widen). client.messageMove() already falls back to COPY + \Deleted +
  // EXPUNGE internally when the server lacks the MOVE extension (RFC 6851)
  // — no need to reimplement that fallback here.
  app.post('/api/mail/imap/messages/:folder/:uid/move', withRequestTimeout, async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const connection = await getConnection(tenantId, req.user.id, req.query.accountId || req.body?.accountId);
      if (!connection) return send(res, 400, { error: 'Messagerie IMAP non connectée.' });
      const uid = parseInt(req.params.uid, 10);
      if (!Number.isFinite(uid)) return send(res, 400, { error: 'uid invalide' });
      const destination = req.body?.destination === 'trash' ? 'trash' : req.body?.destination === 'archive' ? 'archive' : null;
      if (!destination) return send(res, 400, { error: "destination doit être 'archive' ou 'trash'" });
      const wantedSpecialUse = destination === 'archive' ? '\\Archive' : '\\Trash';

      const password = decryptSecret(connection.imap_password_encrypted);
      const client = new ImapFlow({
        host: connection.imap_host,
        port: connection.imap_port,
        secure: true,
        auth: { user: connection.imap_username, pass: password },
        logger: false,
        connectionTimeout: CONNECT_TIMEOUT_MS,
      });

      try {
        await withHardTimeout(client, (async () => {
          await client.connect();
          const mailboxes = await client.list();
          const target = mailboxes.find(m => m.specialUse === wantedSpecialUse);
          if (!target) throw new Error(destination === 'archive' ? "Aucun dossier Archive détecté sur ce compte." : "Aucun dossier Corbeille détecté sur ce compte.");
          await client.mailboxOpen(req.params.folder);
          const moved = await client.messageMove(uid, target.path, { uid: true });
          if (!moved) throw new Error('Échec du déplacement');
        })());
      } finally {
        try { await client.logout(); } catch { /* connexion déjà fermée, ou coupée par le hard timeout */ }
      }
      send(res, 200, { success: true });
    } catch (error: any) {
      console.error('[POST /api/mail/imap/messages/:folder/:uid/move]', error.message);
      send(res, 500, { error: friendlyImapError(error) });
    }
  });
}
