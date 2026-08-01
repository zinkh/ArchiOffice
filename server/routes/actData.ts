// Phase 7 pilot extraction — see projectTemplates.ts for context. Moved
// verbatim out of server.ts's "─── ACT Data (Analyse Comparative des
// Offres) ───" section.
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
}

export function registerActDataRoutes(app: Express, { supabaseAdmin, getTenantId }: RouteDeps) {
  app.get('/api/projects/:projectId/act', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'act_data').select('*').eq('project_id', req.params.projectId).single();
      if (error && error.code !== 'PGRST116') throw error;
      res.json(data || null);
    } catch (e: any) {
      console.error('[GET /api/projects/:projectId/act]', e);
      res.status(500).json({ error: 'Failed to fetch ACT data' });
    }
  });

  app.put('/api/projects/:projectId/act', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { companies, lots, scoring_criteria, weights, consultation, act_phase } = req.body;
      const { data: existing } = await tenantScopedFrom(supabaseAdmin, tenantId, 'act_data').select('id').eq('project_id', req.params.projectId).single();
      const payload = { companies, lots, scoring_criteria, weights, consultation, act_phase, updated_at: new Date().toISOString() };
      if (existing) {
        const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'act_data').update(payload).eq('id', existing.id).select().single();
        if (error) throw error;
        res.json(data);
      } else {
        const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'act_data')
          .insert({ id: crypto.randomUUID(), project_id: req.params.projectId, ...payload })
          .select().single();
        if (error) throw error;
        res.status(201).json(data);
      }
    } catch (e: any) {
      console.error('[PUT /api/projects/:projectId/act]', e);
      res.status(500).json({ error: 'Failed to save ACT data: ' + e.message });
    }
  });
}
