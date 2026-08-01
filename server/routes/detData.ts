// Phase 7 pilot extraction — see projectTemplates.ts for context. Moved
// verbatim out of server.ts's "─── DET Data (Comptes Rendus de Réunions)
// ───" section.
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
}

export function registerDetDataRoutes(app: Express, { supabaseAdmin, getTenantId }: RouteDeps) {
  app.get('/api/projects/:projectId/det', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'det_data').select('*').eq('project_id', req.params.projectId).order('created_at');
      if (error) throw error;
      res.json(data || []);
    } catch (e: any) {
      console.error('[GET /api/projects/:projectId/det]', e);
      res.status(500).json({ error: 'Failed to fetch DET data' });
    }
  });

  app.post('/api/projects/:projectId/det', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id: bodyId, info, observations, intervenants } = req.body;
      const id = bodyId || crypto.randomUUID();
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'det_data')
        .insert({ id, project_id: req.params.projectId, info, observations, intervenants })
        .select().single();
      if (error) throw error;
      res.status(201).json(data);
    } catch (e: any) {
      console.error('[POST /api/projects/:projectId/det]', e);
      res.status(500).json({ error: 'Failed to create CR: ' + e.message });
    }
  });

  app.put('/api/projects/:projectId/det/:crId', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { info, observations, intervenants } = req.body;
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'det_data')
        .update({ info, observations, intervenants })
        .eq('id', req.params.crId).select().single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) {
      console.error('[PUT /api/projects/:projectId/det/:crId]', e);
      res.status(500).json({ error: 'Failed to update CR: ' + e.message });
    }
  });

  app.delete('/api/projects/:projectId/det/:crId', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'det_data').delete().eq('id', req.params.crId);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) {
      console.error('[DELETE /api/projects/:projectId/det/:crId]', e);
      res.status(500).json({ error: 'Failed to delete CR' });
    }
  });
}
