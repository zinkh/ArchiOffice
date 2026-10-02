// ── API de la revue matinale des mails ──────────────────────────────────────
// Réglage PERSONNEL (une boîte mail l'est) : chaque route ne lit et n'écrit
// que la ligne de la personne connectée, dans le cabinet actif. Voir
// server/agentMailReview.ts pour le job lui-même.
import type { Express } from 'express';
import { assertTenantEntity } from '../assertTenantEntity';
import { tenantScopedFrom } from '../tenantScopedFrom';
import { computeNextReviewRun, executeMailReview, type MailReview, type MailReviewDeps } from '../agentMailReview';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  reviewDeps: MailReviewDeps;
}

/** Une revue relit des boîtes et appelle le modèle : pas plus d'un déclenchement manuel toutes les deux minutes. */
const MANUAL_RUN_COOLDOWN_MS = 2 * 60 * 1000;
const DEFAULT_HOUR = 8;
const DEFAULT_MAX_MAILS = 8;

export function registerAgentMailReviewRoutes(app: Express, { supabaseAdmin, getTenantId, reviewDeps }: RouteDeps) {
  const loadReview = async (tenantId: string, userId: string): Promise<MailReview | null> => {
    const { data } = await tenantScopedFrom(supabaseAdmin, tenantId, 'agent_mail_reviews')
      .select('*').eq('user_id', userId).maybeSingle();
    return (data as MailReview) || null;
  };

  // GET /api/agent-mail-review — le réglage de la personne, ou null.
  app.get('/api/agent-mail-review', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      res.json(await loadReview(tenantId, req.user.id));
    } catch (e: any) {
      console.error('[GET /api/agent-mail-review]', e);
      res.status(500).json({ error: e.message });
    }
  });

  // PUT /api/agent-mail-review — crée ou met à jour le réglage de la personne.
  app.put('/api/agent-mail-review', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { enabled, agent_id, hour_local, weekdays_only, max_mails } = req.body || {};

      const hour = hour_local == null ? DEFAULT_HOUR : parseInt(String(hour_local), 10);
      if (!Number.isFinite(hour) || hour < 0 || hour > 23) return res.status(400).json({ error: 'hour_local doit être compris entre 0 et 23' });
      const maxMails = max_mails == null ? DEFAULT_MAX_MAILS : parseInt(String(max_mails), 10);
      if (!Number.isFinite(maxMails) || maxMails < 1 || maxMails > 20) return res.status(400).json({ error: 'max_mails doit être compris entre 1 et 20' });

      const agentId = String(agent_id || '');
      if (!agentId || !(await assertTenantEntity(supabaseAdmin, 'agents', agentId, tenantId))) {
        return res.status(404).json({ error: 'Agent introuvable pour ce cabinet' });
      }
      const { data: agent } = await tenantScopedFrom(supabaseAdmin, tenantId, 'agents')
        .select('is_active, mail_enabled').eq('id', agentId).maybeSingle();
      if (!agent?.is_active) return res.status(400).json({ error: 'Cet agent est désactivé' });
      if (!agent.mail_enabled) {
        return res.status(400).json({ error: "Cet agent n'a pas accès à la messagerie : activez-la dans sa configuration." });
      }

      const existing = await loadReview(tenantId, req.user.id);
      const settings = {
        agent_id: agentId,
        enabled: enabled !== false,
        hour_local: hour,
        weekdays_only: weekdays_only !== false,
        max_mails: maxMails,
        timezone: existing?.timezone || 'Europe/Paris',
      };
      const row = {
        ...settings,
        next_run_at: computeNextReviewRun(settings, new Date()).toISOString(),
        updated_at: new Date().toISOString(),
      };

      const result = existing
        ? await tenantScopedFrom(supabaseAdmin, tenantId, 'agent_mail_reviews').update(row).eq('id', existing.id).select().single()
        : await tenantScopedFrom(supabaseAdmin, tenantId, 'agent_mail_reviews').insert({ ...row, user_id: req.user.id }).select().single();
      if (result.error) throw result.error;
      res.json(result.data);
    } catch (e: any) {
      console.error('[PUT /api/agent-mail-review]', e);
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/agent-mail-review/run — lance la revue maintenant, sans toucher à l'échéance du matin.
  app.post('/api/agent-mail-review/run', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const review = await loadReview(tenantId, req.user.id);
      if (!review) return res.status(404).json({ error: "La revue n'est pas encore configurée." });
      if (review.last_run_at && Date.now() - new Date(review.last_run_at).getTime() < MANUAL_RUN_COOLDOWN_MS) {
        return res.status(429).json({ error: 'Une revue vient d\'être lancée : réessayez dans quelques minutes.' });
      }
      const outcome = await executeMailReview(supabaseAdmin, review, reviewDeps, { scheduled: false });
      res.json(outcome);
    } catch (e: any) {
      console.error('[POST /api/agent-mail-review/run]', e);
      res.status(500).json({ error: e.message });
    }
  });
}
