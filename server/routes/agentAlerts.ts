// ── API des alertes métier ──────────────────────────────────────────────────
// Lecture et traitement des alertes produites par server/agentAlerts.ts, et
// réglage des règles (activation, seuil, gravité, notification par email).
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';
import { ALERT_RULES, ALERT_RULES_BY_CODE, effectiveSettings, runAlertCycleForTenant, type AlertSeverity, type RuleSetting } from '../agentAlerts';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
}

const SEVERITIES: AlertSeverity[] = ['info', 'warning', 'critical'];

export function registerAgentAlertRoutes(app: Express, { supabaseAdmin, getTenantId }: RouteDeps) {
  // GET /api/agent-alert-rules — catalogue des règles + réglage du cabinet.
  app.get('/api/agent-alert-rules', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data } = await tenantScopedFrom(supabaseAdmin, tenantId, 'agent_alert_rules')
        .select('code, enabled, threshold_days, severity, notify_email');
      const settings = effectiveSettings((data || []) as RuleSetting[]);
      res.json(ALERT_RULES.map(rule => {
        const setting = settings.find(s => s.code === rule.code)!;
        return {
          ...setting,
          label: rule.label,
          description: rule.description,
          default_threshold_days: rule.defaultThresholdDays,
        };
      }));
    } catch (e: any) {
      console.error('[GET /api/agent-alert-rules]', e);
      res.status(500).json({ error: e.message });
    }
  });

  // PUT /api/agent-alert-rules/:code — réglage d'une règle.
  app.put('/api/agent-alert-rules/:code', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { code } = req.params;
      const rule = ALERT_RULES_BY_CODE.get(code);
      if (!rule) return res.status(404).json({ error: 'Règle inconnue' });

      const { enabled, threshold_days, severity, notify_email } = req.body;
      if (severity && !SEVERITIES.includes(severity)) {
        return res.status(400).json({ error: `severity doit valoir ${SEVERITIES.join(', ')}` });
      }
      const threshold = threshold_days == null || threshold_days === '' ? null : parseInt(String(threshold_days), 10);
      if (threshold !== null && (!Number.isFinite(threshold) || threshold < 0 || threshold > 3650)) {
        return res.status(400).json({ error: 'threshold_days doit être un nombre de jours entre 0 et 3650' });
      }

      const row = {
        tenant_id: tenantId,
        code,
        enabled: enabled !== false,
        threshold_days: threshold,
        severity: severity || rule.defaultSeverity,
        notify_email: !!notify_email,
        updated_at: new Date().toISOString(),
      };
      const { data, error } = await supabaseAdmin
        .from('agent_alert_rules').upsert(row, { onConflict: 'tenant_id,code' }).select().single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) {
      console.error('[PUT /api/agent-alert-rules/:code]', e);
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/agent-alerts?status=open
  app.get('/api/agent-alerts', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const status = String(req.query.status || 'open');
      let query = tenantScopedFrom(supabaseAdmin, tenantId, 'agent_alerts')
        .select('*').order('detected_at', { ascending: false }).limit(200);
      if (status !== 'all') query = query.eq('status', status);
      const { data, error } = await query;
      if (error) throw error;
      res.json(data || []);
    } catch (e: any) {
      console.error('[GET /api/agent-alerts]', e);
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/agent-alerts/:id/status — { status: acknowledged | resolved | open }
  app.post('/api/agent-alerts/:id/status', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const status = String(req.body?.status || '');
      if (!['open', 'acknowledged', 'resolved'].includes(status)) {
        return res.status(400).json({ error: 'status invalide' });
      }
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'agent_alerts')
        .update({ status, resolved_at: status === 'resolved' ? new Date().toISOString() : null })
        .eq('id', req.params.id).select().single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) {
      console.error('[POST /api/agent-alerts/:id/status]', e);
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/agent-alerts/refresh — relance immédiate du cycle pour ce cabinet.
  app.post('/api/agent-alerts/refresh', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const created = await runAlertCycleForTenant(supabaseAdmin, tenantId);
      res.json({ created });
    } catch (e: any) {
      console.error('[POST /api/agent-alerts/refresh]', e);
      res.status(500).json({ error: e.message });
    }
  });
}
