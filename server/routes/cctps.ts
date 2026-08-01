// Phase 7 extraction — moved verbatim out of server.ts's "─── CCTPs CRUD
// (missing update/delete) ───" section, plus the promised future slice:
// GET/POST /api/projects/:projectId/cctp — a different route shape (one
// JSON blob per project, upserted wholesale) than the per-field CRUD below,
// but the same `cctps` table.
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
}

export function registerCctpRoutes(app: Express, { supabaseAdmin, getTenantId }: RouteDeps) {
  app.get('/api/projects/:projectId/cctp', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { projectId } = req.params;
      const { data: cctp, error } = await supabaseAdmin.from('cctps').select('*').eq('project_id', projectId).eq('tenant_id', tenantId).single();
      if (error && error.code !== 'PGRST116') throw error;
      if (cctp) {
        res.json(typeof (cctp as any).data === 'string' ? JSON.parse((cctp as any).data) : (cctp as any).data);
      } else {
        res.status(404).json({ error: "CCTP not found" });
      }
    } catch (error) {
      console.error("[GET /api/projects/:projectId/cctp]", error);
      res.status(500).json({ error: "Failed to fetch CCTP" });
    }
  });

  app.post('/api/projects/:projectId/cctp', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { projectId } = req.params;
      const data = req.body;
      const id = data.id === 'new' ? crypto.randomUUID() : (data.id || crypto.randomUUID());
      data.id = id;
      const { data: existing } = await supabaseAdmin.from('cctps').select('id').eq('project_id', projectId).eq('tenant_id', tenantId).single();
      if (existing) {
        await supabaseAdmin.from('cctps').update({ data: JSON.stringify(data) }).eq('project_id', projectId).eq('tenant_id', tenantId);
      } else {
        await supabaseAdmin.from('cctps').insert({ id, tenant_id: tenantId, project_id: projectId, data: JSON.stringify(data) });
      }
      res.json(data);
    } catch (error) {
      console.error("[POST /api/projects/:projectId/cctp]", error);
      res.status(500).json({ error: "Failed to save CCTP" });
    }
  });

  app.put('/api/cctps/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { title, content, lot, is_template } = req.body;
      const last_updated = new Date().toISOString();
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'cctps')
        .update({ title, content, lot, is_template: !!is_template, last_updated })
        .eq('id', req.params.id).select().single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) {
      console.error('[PUT /api/cctps/:id]', e);
      res.status(500).json({ error: 'Failed to update CCTP: ' + e.message });
    }
  });

  app.delete('/api/cctps/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'cctps').delete().eq('id', req.params.id);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) {
      console.error('[DELETE /api/cctps/:id]', e);
      res.status(500).json({ error: 'Failed to delete CCTP' });
    }
  });
}
