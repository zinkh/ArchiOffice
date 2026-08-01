// Phase 7 extraction — moved verbatim out of server.ts's "─── DPGF Items
// CRUD ───" and "─── DPGFs CRUD ───" sections (dpgf_items are children of a
// parent dpgfs row — kept together as one domain module). GET
// /api/dpgf/:projectId joins from the Projects section (server/routes/projects.ts)
// this same lot — it's the read counterpart of the mutations already here,
// just never extracted alongside them. GET/POST /api/projects/:projectId/dpgf
// joins in a later lot: a different route shape (one JSON blob per project,
// upserted wholesale) than the per-field CRUD below, but the same `dpgfs`
// table — same relationship as GET/POST /api/projects/:projectId/cctp to
// server/routes/cctps.ts's per-field CCTP CRUD.
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  getUserName: (tenantId: string, userId: string, email?: string) => Promise<string>;
  logActivity: (tenantId: string, userId: string, userName: string, action: string, target: string, targetId: string, targetType: string, category: string) => void;
}

export function registerDpgfRoutes(app: Express, { supabaseAdmin, getTenantId, getUserName, logActivity }: RouteDeps) {
  app.get('/api/projects/:projectId/dpgf', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { projectId } = req.params;
      const { data: dpgf, error } = await supabaseAdmin.from('dpgfs').select('*').eq('project_id', projectId).eq('tenant_id', tenantId).single();
      if (error && error.code !== 'PGRST116') throw error;
      if (dpgf) {
        res.json(typeof (dpgf as any).data === 'string' ? JSON.parse((dpgf as any).data) : (dpgf as any).data);
      } else {
        res.status(404).json({ error: "DPGF not found" });
      }
    } catch (error) {
      console.error("[GET /api/projects/:projectId/dpgf]", error);
      res.status(500).json({ error: "Failed to fetch DPGF" });
    }
  });

  app.post('/api/projects/:projectId/dpgf', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { projectId } = req.params;
      const data = req.body;
      const id = data.id === 'new' ? crypto.randomUUID() : (data.id || crypto.randomUUID());
      data.id = id;
      const { data: existing } = await supabaseAdmin.from('dpgfs').select('id').eq('project_id', projectId).eq('tenant_id', tenantId).single();
      if (existing) {
        await supabaseAdmin.from('dpgfs').update({ data: JSON.stringify(data) }).eq('project_id', projectId).eq('tenant_id', tenantId);
      } else {
        await supabaseAdmin.from('dpgfs').insert({ id, tenant_id: tenantId, project_id: projectId, data: JSON.stringify(data) });
        const { data: project } = await supabaseAdmin.from('projects').select('name').eq('id', projectId).eq('tenant_id', tenantId).maybeSingle();
        const projectName = (project as any)?.name || '';
        const userName = await getUserName(tenantId, req.user.id, req.user.email);
        logActivity(tenantId, req.user.id, userName, `Création du DPGF du projet "${projectName}"`, projectName, id, 'dpgf', 'Situations/DPGF');
      }
      res.json(data);
    } catch (error) {
      console.error("[POST /api/projects/:projectId/dpgf]", error);
      res.status(500).json({ error: "Failed to save DPGF" });
    }
  });

  app.get('/api/dpgf/:projectId', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'dpgf_items').select('*').eq('project_id', req.params.projectId);
      if (error) throw error;
      res.json(data);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to fetch dpgf items" }); }
  });

  app.post('/api/dpgf', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id: bodyId, project_id, dpgf_id, lot_number, lot_title, item_number, description, unit, quantity, unit_price } = req.body;
      const id = bodyId || crypto.randomUUID();
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'dpgf_items')
        .insert({ id, project_id, dpgf_id, lot_number, lot_title, item_number, description, unit, quantity, unit_price })
        .select().single();
      if (error) throw error;
      res.status(201).json(data);
    } catch (e: any) {
      console.error('[POST /api/dpgf]', e);
      res.status(500).json({ error: 'Failed to create DPGF item: ' + e.message });
    }
  });

  app.put('/api/dpgf/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { lot_number, lot_title, item_number, description, unit, quantity, unit_price } = req.body;
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'dpgf_items')
        .update({ lot_number, lot_title, item_number, description, unit, quantity, unit_price })
        .eq('id', req.params.id).select().single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) {
      console.error('[PUT /api/dpgf/:id]', e);
      res.status(500).json({ error: 'Failed to update DPGF item: ' + e.message });
    }
  });

  app.delete('/api/dpgf/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'dpgf_items').delete().eq('id', req.params.id);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) {
      console.error('[DELETE /api/dpgf/:id]', e);
      res.status(500).json({ error: 'Failed to delete DPGF item' });
    }
  });

  app.post('/api/dpgfs', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id: bodyId, project_id, title, version } = req.body;
      const id = bodyId || crypto.randomUUID();
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'dpgfs').insert({ id, project_id, title, version }).select().single();
      if (error) throw error;
      res.status(201).json(data);
    } catch (e: any) {
      console.error('[POST /api/dpgfs]', e);
      res.status(500).json({ error: 'Failed to create DPGF: ' + e.message });
    }
  });

  app.put('/api/dpgfs/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { title, version } = req.body;
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'dpgfs').update({ title, version }).eq('id', req.params.id).select().single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) {
      console.error('[PUT /api/dpgfs/:id]', e);
      res.status(500).json({ error: 'Failed to update DPGF: ' + e.message });
    }
  });

  app.delete('/api/dpgfs/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'dpgfs').delete().eq('id', req.params.id);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) {
      console.error('[DELETE /api/dpgfs/:id]', e);
      res.status(500).json({ error: 'Failed to delete DPGF' });
    }
  });
}
