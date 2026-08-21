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
const CONNECT_TIMEOUT_MS = 10000;

function friendlyImapError(error: any): string {
  const msg = String(error?.message || error);
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
  app.get('/api/mail/imap/status', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const connection = await getConnection(tenantId, req.user.id);
      res.json({
        connected: !!connection,
        email: connection?.external_account_email || connection?.imap_username || null,
        host: connection?.imap_host || null,
        last_synced_at: connection?.last_synced_at || null,
      });
    } catch (error: any) {
      console.error('[GET /api/mail/imap/status]', error);
      res.status(500).json({ error: 'Failed to get IMAP status' });
    }
  });

  // POST /api/mail/imap/connect — { host, port, username, password }.
  // Tests the credentials with a verify-only connection before storing
  // anything, so a typo doesn't silently save a broken connection.
  app.post('/api/mail/imap/connect', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { host, port, username, password } = req.body;
      if (!host || !port || !username || !password) {
        return res.status(400).json({ error: 'host, port, username et password requis' });
      }
      const portNum = parseInt(String(port), 10);
      if (!Number.isFinite(portNum) || portNum <= 0 || portNum > 65535) {
        return res.status(400).json({ error: 'Port invalide' });
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
        await client.connect();
      } catch (err: any) {
        return res.status(400).json({ error: friendlyImapError(err) });
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
      res.json({ success: true });
    } catch (error: any) {
      console.error('[POST /api/mail/imap/connect]', error.message);
      res.status(500).json({ error: error.message || 'Échec de la connexion IMAP' });
    }
  });

  // DELETE /api/mail/imap/disconnect
  app.delete('/api/mail/imap/disconnect', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      await tenantScopedFrom(supabaseAdmin, tenantId, 'email_connections').delete().eq('user_id', req.user.id).eq('provider', 'infomaniak');
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, 'Déconnexion de la messagerie (IMAP)', '', tenantId, 'integration', 'Intégrations');
      res.json({ success: true });
    } catch (error: any) {
      console.error('[DELETE /api/mail/imap/disconnect]', error);
      res.status(500).json({ error: 'Failed to disconnect IMAP' });
    }
  });

  // GET /api/mail/imap/search?email=<adresse> — live search across INBOX
  // and the Sent folder (if any), envelope metadata only, never persisted.
  app.get('/api/mail/imap/search', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const connection = await getConnection(tenantId, req.user.id);
      if (!connection) return res.status(400).json({ error: 'Messagerie IMAP non connectée.' });
      const { email } = req.query as { email?: string };
      if (!email) return res.status(400).json({ error: 'email requis' });

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
      } finally {
        try { await client.logout(); } catch { /* connection may already be closed */ }
      }

      await tenantScopedFrom(supabaseAdmin, tenantId, 'email_connections').update({ last_synced_at: new Date().toISOString() }).eq('id', connection.id);
      res.json(results);
    } catch (error: any) {
      console.error('[GET /api/mail/imap/search]', error.message);
      res.status(500).json({ error: friendlyImapError(error) });
    }
  });
}
