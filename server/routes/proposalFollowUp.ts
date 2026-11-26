import type { Express } from 'express';
import { canArchiveProposal, followUpDate } from '../../src/lib/proposalFollowUp';
import type { RouteDeps } from './proposals';

export function registerProposalFollowUpRoutes(app: Express, deps: Pick<RouteDeps, 'supabaseAdmin' | 'getTenantId' | 'getUserName' | 'logActivity'>) {
  const { supabaseAdmin: db, getTenantId, getUserName, logActivity } = deps;
  app.post('/api/proposals/:id/follow-up', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: p, error } = await db.from('proposals').select('*').eq('tenant_id', tenantId).eq('id', req.params.id).maybeSingle();
      if (error) throw error;
      if (!p) return res.status(404).json({ error: 'Proposition introuvable.' });
      const action = req.body?.action;
      const now = new Date().toISOString();
      let patch: Record<string, any>;
      if (action === 'restore') {
        if (!p.archived_at) return res.status(409).json({ error: 'Cette proposition est déjà active.' });
        patch = { archived_at: null, archive_reason: null, next_follow_up_at: p.status === 'Sent' && !p.last_response_at ? followUpDate(now) : null };
      } else {
        if (p.archived_at) return res.status(409).json({ error: 'Restaurez la proposition avant de poursuivre.' });
        if (action === 'sent') {
          if (!['Draft', 'Sent'].includes(p.status)) return res.status(409).json({ error: 'Cette proposition est clôturée.' });
          patch = { status: 'Sent', sent_at: p.sent_at || now, next_follow_up_at: p.last_response_at ? null : followUpDate(now) };
        } else if (action === 'reminded') {
          if (p.status !== 'Sent' || p.last_response_at || p.signature_status === 'completed') return res.status(409).json({ error: 'Cette proposition ne nécessite plus de relance.' });
          patch = { last_reminder_at: now, reminder_count: (p.reminder_count || 0) + 1, next_follow_up_at: followUpDate(now) };
        } else if (action === 'responded') {
          if (p.status !== 'Sent') return res.status(409).json({ error: 'Seules les propositions envoyées sont concernées.' });
          patch = { last_response_at: now, next_follow_up_at: null };
        } else if (action === 'archive') {
          if (!canArchiveProposal(p)) return res.status(409).json({ error: 'Archivage réservé aux propositions sans réponse et sans signature en cours.' });
          patch = { archived_at: now, archive_reason: 'no_response', next_follow_up_at: null };
        } else if (action === 'schedule') {
          if (p.status !== 'Sent' || p.last_response_at || p.signature_status === 'completed') return res.status(409).json({ error: 'Cette proposition ne nécessite plus de relance.' });
          const date = req.body?.date;
          if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) return res.status(400).json({ error: 'Date de relance invalide.' });
          patch = { next_follow_up_at: new Date(date + 'T09:00:00Z').toISOString() };
        } else return res.status(400).json({ error: 'Action de suivi inconnue.' });
      }
      let update = db.from('proposals').update(patch).eq('tenant_id', tenantId).eq('id', p.id).eq('status', p.status);
      for (const key of ['archived_at', 'last_response_at', 'last_reminder_at', 'signature_status']) update = p[key] == null ? update.is(key, null) : update.eq(key, p[key]);
      const { data, error: updateError } = await update.select().maybeSingle();
      if (updateError) throw updateError;
      if (!data) return res.status(409).json({ error: 'La proposition a changé. Actualisez son suivi.' });
      const name = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, name, 'Suivi de proposition : ' + action, p.title, p.id, 'proposal', 'Devis');
      res.json(data);
    } catch { res.status(500).json({ error: 'Suivi indisponible. Vérifiez que la migration du suivi des propositions est appliquée.' }); }
  });
}
