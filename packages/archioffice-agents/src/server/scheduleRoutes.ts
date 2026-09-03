// ── API des exécutions planifiées ───────────────────────────────────────────
// CRUD des planifications + déclenchement manuel + historique des exécutions.
// Séparé de routes.ts, qui porte déjà le chat et la configuration des agents.
import { computeNextRun, runSchedule, type AgentSchedule, type SchedulerDeps } from './scheduler.js';

type GetTenantId = (userId: string) => Promise<string>;

const FREQUENCIES = ['daily', 'weekly', 'monthly'];

function normalizeInput(body: any): Partial<AgentSchedule> | { error: string } {
  const frequency = String(body.frequency || 'weekly');
  if (!FREQUENCIES.includes(frequency)) return { error: `frequency doit valoir ${FREQUENCIES.join(', ')}` };
  const hour = parseInt(String(body.hour_utc ?? 6), 10);
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) return { error: 'hour_utc doit être compris entre 0 et 23' };
  const weekday = body.weekday == null ? null : parseInt(String(body.weekday), 10);
  if (weekday !== null && (!Number.isFinite(weekday) || weekday < 0 || weekday > 6)) return { error: 'weekday doit être compris entre 0 (dimanche) et 6' };
  const dayOfMonth = body.day_of_month == null ? null : parseInt(String(body.day_of_month), 10);
  // Plafond à 28 : au-delà, « le 31 de chaque mois » n'a pas de sens huit
  // mois sur douze (la contrainte de la table dit la même chose).
  if (dayOfMonth !== null && (!Number.isFinite(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 28)) return { error: 'day_of_month doit être compris entre 1 et 28' };
  return {
    name: String(body.name || '').trim(),
    prompt: String(body.prompt || '').trim(),
    frequency: frequency as AgentSchedule['frequency'],
    hour_utc: hour,
    weekday: frequency === 'weekly' ? (weekday ?? 1) : null,
    day_of_month: frequency === 'monthly' ? (dayOfMonth ?? 1) : null,
    enabled: body.enabled !== false,
    notify_email: !!body.notify_email,
  };
}

export function registerAgentScheduleRoutes(
  app: any,
  supabaseAdmin: any,
  getTenantId: GetTenantId,
  deps: SchedulerDeps = {}
): void {
  // GET /api/agent-schedules
  app.get('/api/agent-schedules', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await supabaseAdmin
        .from('agent_schedules').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: true });
      if (error) throw error;
      res.json(data || []);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/agent-schedules
  app.post('/api/agent-schedules', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const input = normalizeInput(req.body);
      if ('error' in input) return res.status(400).json({ error: input.error });
      if (!input.name || !input.prompt) return res.status(400).json({ error: 'name et prompt sont requis' });
      const agentId = String(req.body.agent_id || '');
      const { data: agent } = await supabaseAdmin
        .from('agents').select('id').eq('id', agentId).eq('tenant_id', tenantId).maybeSingle();
      if (!agent) return res.status(404).json({ error: 'Agent introuvable pour ce cabinet' });

      const { data, error } = await supabaseAdmin.from('agent_schedules').insert({
        ...input,
        tenant_id: tenantId,
        agent_id: agentId,
        created_by: req.user.id,
        next_run_at: computeNextRun(input as AgentSchedule, new Date()).toISOString(),
      }).select().single();
      if (error) throw error;
      res.status(201).json(data);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // PUT /api/agent-schedules/:id
  app.put('/api/agent-schedules/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const input = normalizeInput(req.body);
      if ('error' in input) return res.status(400).json({ error: input.error });
      if (!input.name || !input.prompt) return res.status(400).json({ error: 'name et prompt sont requis' });
      const { data, error } = await supabaseAdmin.from('agent_schedules').update({
        ...input,
        // La cadence a pu changer : la prochaine échéance est recalculée à
        // partir de la nouvelle, jamais conservée telle quelle.
        next_run_at: input.enabled ? computeNextRun(input as AgentSchedule, new Date()).toISOString() : null,
        updated_at: new Date().toISOString(),
      }).eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // DELETE /api/agent-schedules/:id
  app.delete('/api/agent-schedules/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { error } = await supabaseAdmin.from('agent_schedules').delete().eq('id', req.params.id).eq('tenant_id', tenantId);
      if (error) throw error;
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // POST /api/agent-schedules/:id/run — déclenchement manuel
  app.post('/api/agent-schedules/:id/run', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: schedule } = await supabaseAdmin
        .from('agent_schedules').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).maybeSingle();
      if (!schedule) return res.status(404).json({ error: 'Planification introuvable' });
      const result = await runSchedule(supabaseAdmin, schedule as AgentSchedule, deps);
      res.json(result);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // GET /api/agent-schedules/:id/runs
  app.get('/api/agent-schedules/:id/runs', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await supabaseAdmin
        .from('agent_schedule_runs').select('*')
        .eq('tenant_id', tenantId).eq('schedule_id', req.params.id)
        .order('started_at', { ascending: false }).limit(20);
      if (error) throw error;
      res.json(data || []);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
}
