// POST /api/mail/drafts — voir server/mailDraft.ts pour le rationale. Choisit
// le compte comme /api/send-email (défaut de l'utilisateur), mais sans repli
// sur le SMTP du cabinet : un brouillon vit dans UNE boîte précise, jamais
// nulle part de générique. Les trois fournisseurs (Gmail, Outlook, IMAP)
// savent désormais créer un brouillon — voir mailDraft.ts pour le détail
// spécifique à chacun.
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';
import { createDraftViaAccount, listDraftsViaAccount, getDraftViaAccount, updateDraftViaAccount } from '../mailDraft';
import { sendEmailLimiter } from '../rateLimit';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
}

export function registerMailDraftRoutes(app: Express, { supabaseAdmin, getTenantId }: RouteDeps) {
  // Compte de l'utilisateur désigné par account_id (jamais celui d'un autre).
  async function loadAccount(req: any, accountId: unknown) {
    if (!accountId || typeof accountId !== 'string') return null;
    const tenantId = await getTenantId(req.user.id);
    const { data } = await tenantScopedFrom(supabaseAdmin, tenantId, 'email_connections')
      .select('*').eq('user_id', req.user.id).eq('id', accountId).limit(1);
    return data?.[0] || null;
  }

  // GET /api/mail/drafts?account_id= : brouillons récents d'une boîte.
  app.get('/api/mail/drafts', async (req: any, res: any) => {
    try {
      const account = await loadAccount(req, req.query.account_id);
      if (!account) return res.status(400).json({ error: 'Compte de messagerie introuvable.' });
      res.json(await listDraftsViaAccount(supabaseAdmin, account));
    } catch (e: any) {
      res.status(500).json({ error: e.message || 'Échec de la lecture des brouillons.' });
    }
  });

  // GET /api/mail/drafts/:id?account_id= : destinataires, objet et corps.
  app.get('/api/mail/drafts/:id', async (req: any, res: any) => {
    try {
      const account = await loadAccount(req, req.query.account_id);
      if (!account) return res.status(400).json({ error: 'Compte de messagerie introuvable.' });
      res.json(await getDraftViaAccount(supabaseAdmin, account, req.params.id));
    } catch (e: any) {
      res.status(e.status === 404 ? 404 : 500).json({ error: e.message || 'Échec de la lecture du brouillon.' });
    }
  });

  // PUT /api/mail/drafts/:id : réécrit destinataires, objet et corps. Ne
  // l'envoie jamais : c'est la même prudence que POST ci-dessous.
  app.put('/api/mail/drafts/:id', sendEmailLimiter, async (req: any, res: any) => {
    try {
      const { to, cc, subject, text, account_id } = req.body || {};
      const hasCrlf = (v: unknown) => typeof v === 'string' && /[\r\n]/.test(v);
      if (hasCrlf(to) || hasCrlf(subject) || hasCrlf(cc)) {
        return res.status(400).json({ error: 'Caractères invalides (retour à la ligne).' });
      }
      if (!to || !subject) return res.status(400).json({ error: 'to et subject sont requis.' });
      const account = await loadAccount(req, account_id);
      if (!account) return res.status(400).json({ error: 'Compte de messagerie introuvable.' });
      const result = await updateDraftViaAccount(supabaseAdmin, account, req.params.id, { to, cc, subject, text });
      res.json({ success: true, id: result.id });
    } catch (e: any) {
      res.status(500).json({ error: e.message || 'Échec de la mise à jour du brouillon.' });
    }
  });

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
