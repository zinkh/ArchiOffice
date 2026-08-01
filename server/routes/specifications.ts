// Phase 7 extraction — moved out of server.ts's inline Specifications
// (CCTP) CRUD section. Distinct from server/routes/cctps.ts, which handles
// update/delete on a different table (`cctps`) — this one is the
// `specifications` table.
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  getUserName: (tenantId: string, userId: string, email?: string) => Promise<string>;
  logActivity: (tenantId: string, userId: string, userName: string, action: string, target: string, targetId: string, targetType: string, category: string) => void;
}

export function registerSpecificationRoutes(app: Express, { supabaseAdmin, getTenantId, getUserName, logActivity }: RouteDeps) {
  app.get("/api/specifications", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'specifications').select('*').order('last_updated', { ascending: false });
      if (error) throw error;
      res.json((data || []).map((s: any) => ({ ...s, is_template: !!s.is_template })));
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: "Failed to fetch specifications" });
    }
  });

  app.post("/api/specifications", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id: bodyId, project_id, title, content, is_template } = req.body;
      const id = bodyId || crypto.randomUUID();
      const last_updated = new Date().toISOString();
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'specifications').insert({ id, project_id, title, content, last_updated, is_template: !!is_template });
      if (error) throw error;
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Création du CCTP "${title}"`, title, id, 'specification', 'CCTP');
      res.status(201).json({ id, last_updated });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to create specification: " + e.message }); }
  });

  app.put("/api/specifications/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { title, content, is_template } = req.body;
      const last_updated = new Date().toISOString();
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'specifications').update({ title, content, last_updated, is_template: !!is_template }).eq('id', id);
      if (error) throw error;
      res.json({ success: true, last_updated });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to update specification: " + e.message }); }
  });

  app.delete("/api/specifications/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { data: spec } = await tenantScopedFrom(supabaseAdmin, tenantId, 'specifications').select('title').eq('id', id).maybeSingle();
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'specifications').delete().eq('id', id);
      if (error) throw error;
      const title = (spec as any)?.title || '';
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Suppression du CCTP "${title}"`, title, id, 'specification', 'CCTP');
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to delete specification: " + e.message }); }
  });
}
