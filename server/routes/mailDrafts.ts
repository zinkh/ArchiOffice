// POST /api/mail/drafts — voir server/mailDraft.ts pour le rationale. Choisit
// le compte comme /api/send-email (défaut de l'utilisateur), mais sans repli
// sur le SMTP du cabinet : un brouillon vit dans UNE boîte précise, jamais
// nulle part de générique. Les trois fournisseurs (Gmail, Outlook, IMAP)
// savent désormais créer un brouillon — voir mailDraft.ts pour le détail
// spécifique à chacun.
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';
import { createDraftViaAccount } from '../mailDraft';
import { sendEmailLimiter } from '../rateLimit';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
}

export function registerMailDraftRoutes(app: Express, { supabaseAdmin, getTenantId }: RouteDeps) {
  app.post('/api/mail/drafts', sendEmailLimiter, async (req: any, res: any) => {
    try {
      const { to, cc, subject, text, account_id } = req.body || {};
      const hasCrlf = (v: unknown) => typeof v === 'string' && /[\r\n]/.test(v);
      if (hasCrlf(to) || hasCrlf(subject) || hasCrlf(cc)) {
        return res.status(400).json({ error: 'Caractères invalides (retour à la ligne).' });
      }
      if (!to || !subject) return res.status(400).json({ error: 'to et subject sont requis.' });

      const tenantId = await getTenantId(req.user.id);
      const query = tenantScopedFrom(supabaseAdmin, tenantId, 'email_connections')
        .select('*').eq('user_id', req.user.id);
      if (account_id) query.eq('id', account_id);
      const { data: accounts } = await query.order('is_default', { ascending: false }).limit(1);
      const account = accounts?.[0];
      if (!account) {
        return res.status(400).json({ error: "Aucune messagerie connectée ne permet de créer un brouillon (voir Réglages → Mes boîtes mail)." });
      }

      const result = await createDraftViaAccount(supabaseAdmin, account, { to, cc, subject, text });
      res.json({ success: true, id: result.id, via: account.provider, compte: account.external_account_email });
    } catch (e: any) {
      res.status(500).json({ error: e.message || 'Échec de la création du brouillon.' });
    }
  });
}
