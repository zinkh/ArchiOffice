// Point d'entrée unique du multi-comptes mail — remplace les six routes
// GET .../status et DELETE .../disconnect que gmailSync.ts, outlookSync.ts
// et imapMailSync.ts exposaient chacun pour « le » compte de leur
// fournisseur (au singulier). Toute l'app (Mailbox, Correspondance,
// Réglages, outils d'agent) passe désormais par ici pour savoir quelles
// boîtes sont connectées et laquelle est le défaut.
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';
import { listMailAccounts, setDefaultMailAccount } from '../mailAccounts';
import { clearMailAccountCaches } from '../mailTokenCache';
import { encryptSecret } from '../secretsCrypto';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  getUserName: (tenantId: string, userId: string, email?: string) => Promise<string>;
  logActivity: (tenantId: string, userId: string, userName: string, action: string, target: string, targetId: string, targetType: string, category: string) => void;
}

export function registerMailAccountRoutes(app: Express, { supabaseAdmin, getTenantId, getUserName, logActivity }: RouteDeps) {
  // GET /api/mail/accounts — toutes les boîtes connectées de l'utilisateur,
  // tous fournisseurs confondus, jamais de secret dans la réponse.
  app.get('/api/mail/accounts', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const accounts = await listMailAccounts(supabaseAdmin, tenantId, req.user.id);
      res.json(accounts);
    } catch (error: any) {
      console.error('[GET /api/mail/accounts]', error);
      res.status(500).json({ error: 'Failed to list mail accounts' });
    }
  });

  // PUT /api/mail/accounts/:id — renommer, et pour un compte IMAP,
  // renseigner le SMTP qui lui permet d'écrire (IMAP seul n'a pas de
  // capacité d'envoi — cf. migrate_multi_mail_calendar.sql).
  app.put('/api/mail/accounts/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { data: existing } = await tenantScopedFrom(supabaseAdmin, tenantId, 'email_connections')
        .select('id, provider').eq('id', id).eq('user_id', req.user.id).maybeSingle();
      if (!existing) return res.status(404).json({ error: 'Compte introuvable' });

      const patch: Record<string, unknown> = {};
      if (typeof req.body.displayName === 'string') patch.display_name = req.body.displayName.trim() || null;

      const { smtpHost, smtpPort, smtpUsername, smtpPassword } = req.body;
      if (smtpHost !== undefined || smtpPort !== undefined || smtpUsername !== undefined || smtpPassword !== undefined) {
        if (existing.provider !== 'infomaniak') {
          return res.status(400).json({ error: 'Le SMTP ne se règle que pour un compte IMAP.' });
        }
        if (smtpHost) patch.smtp_host = String(smtpHost);
        if (smtpPort) patch.smtp_port = parseInt(String(smtpPort), 10);
        if (smtpUsername) patch.smtp_username = String(smtpUsername);
        if (smtpPassword) patch.smtp_password_encrypted = encryptSecret(String(smtpPassword));
      }

      if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'Aucun champ à modifier' });
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'email_connections').update(patch).eq('id', id);
      if (error) throw error;
      res.json({ success: true });
    } catch (error: any) {
      console.error('[PUT /api/mail/accounts/:id]', error);
      res.status(500).json({ error: 'Failed to update mail account' });
    }
  });

  // POST /api/mail/accounts/:id/default — désigne ce compte comme adresse
  // par défaut de l'utilisateur (effacer-puis-poser, comme
  // server/routes/documentTemplates.ts:set-default).
  app.post('/api/mail/accounts/:id/default', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const ok = await setDefaultMailAccount(supabaseAdmin, tenantId, req.user.id, req.params.id);
      if (!ok) return res.status(404).json({ error: 'Compte introuvable' });
      res.json({ success: true });
    } catch (error: any) {
      console.error('[POST /api/mail/accounts/:id/default]', error);
      res.status(500).json({ error: 'Failed to set default mail account' });
    }
  });

  // DELETE /api/mail/accounts/:id — déconnecte un compte, quel que soit son
  // fournisseur. Si c'était le défaut, le compte le plus ancien restant en
  // hérite, pour que l'utilisateur ne se retrouve jamais sans défaut tant
  // qu'il lui reste au moins une boîte connectée.
  app.delete('/api/mail/accounts/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { data: existing } = await tenantScopedFrom(supabaseAdmin, tenantId, 'email_connections')
        .select('id, provider, is_default, external_account_email').eq('id', id).eq('user_id', req.user.id).maybeSingle();
      if (!existing) return res.status(404).json({ error: 'Compte introuvable' });

      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'email_connections').delete().eq('id', id);
      if (error) throw error;
      clearMailAccountCaches(id);

      if (existing.is_default) {
        const { data: rows } = await tenantScopedFrom(supabaseAdmin, tenantId, 'email_connections')
          .select('id').eq('user_id', req.user.id).order('created_at', { ascending: true }).limit(1);
        if (rows && rows[0]) {
          await tenantScopedFrom(supabaseAdmin, tenantId, 'email_connections').update({ is_default: true }).eq('id', rows[0].id);
        }
      }

      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Déconnexion de la messagerie (${existing.external_account_email || existing.provider})`, '', tenantId, 'integration', 'Intégrations');
      res.json({ success: true });
    } catch (error: any) {
      console.error('[DELETE /api/mail/accounts/:id]', error);
      res.status(500).json({ error: 'Failed to disconnect mail account' });
    }
  });
}
