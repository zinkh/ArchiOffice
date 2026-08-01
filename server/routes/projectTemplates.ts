// Phase 7 pilot extraction — moved verbatim out of server.ts's inline route
// registration (previously the "─── Project Templates ───" section) as the
// first slice of the incremental server.ts layering split. Picked as the
// starting domain per the plan: small (4 routes), self-contained (only
// depends on getTenantId/supabaseAdmin, no cross-domain helpers), low
// traffic. Behavior is unchanged from the original inline version — only
// the read-back/update/delete queries now go through tenantScopedFrom()
// instead of a hand-written `.eq('tenant_id', tenantId)` on each call.
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
}

export function registerProjectTemplateRoutes(app: Express, { supabaseAdmin, getTenantId }: RouteDeps) {
  app.get('/api/project-templates', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'project_templates').select('*').order('name');
      if (error) throw error;
      res.json(data || []);
    } catch (e: any) {
      console.error('[GET /api/project-templates]', e);
      res.status(500).json({ error: 'Failed to fetch project templates' });
    }
  });

  app.post('/api/project-templates', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id: bodyId, name, description, default_status, default_budget, default_description } = req.body;
      const id = bodyId || crypto.randomUUID();
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'project_templates')
        .insert({ id, name, description, default_status: default_status || 'Planning', default_budget: default_budget || 0, default_description })
        .select().single();
      if (error) throw error;
      res.status(201).json(data);
    } catch (e: any) {
      console.error('[POST /api/project-templates]', e);
      res.status(500).json({ error: 'Failed to create project template: ' + e.message });
    }
  });

  app.put('/api/project-templates/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { name, description, default_status, default_budget, default_description } = req.body;
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'project_templates')
        .update({ name, description, default_status, default_budget, default_description })
        .eq('id', req.params.id).select().single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) {
      console.error('[PUT /api/project-templates/:id]', e);
      res.status(500).json({ error: 'Failed to update project template: ' + e.message });
    }
  });

  app.delete('/api/project-templates/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'project_templates').delete().eq('id', req.params.id);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) {
      console.error('[DELETE /api/project-templates/:id]', e);
      res.status(500).json({ error: 'Failed to delete project template' });
    }
  });
}
