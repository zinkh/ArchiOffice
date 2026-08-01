// Phase 7 extraction — moved out of server.ts's Lots section (project_lots
// table — market trade packages like Gros œuvre, Charpente, Électricité).
import type { Express } from 'express';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
}

export function registerLotRoutes(app: Express, { supabaseAdmin, getTenantId }: RouteDeps) {
  app.get("/api/projects/:projectId/lots", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { projectId } = req.params;
      const { data: lots, error } = await supabaseAdmin.from('project_lots').select('*').eq('project_id', projectId).eq('tenant_id', tenantId);
      if (error) throw error;
      res.json(lots);
    } catch (error) {
      console.error("[GET /api/projects/:projectId/lots]", error);
      res.status(500).json({ error: "Failed to fetch lots" });
    }
  });

  app.post("/api/projects/:projectId/lots", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { projectId } = req.params;
      const { id: bodyId, lot_number, lot_title } = req.body;
      const lotId = bodyId || crypto.randomUUID();
      const { error } = await supabaseAdmin.from('project_lots').insert({ id: lotId, tenant_id: tenantId, project_id: projectId, lot_number, lot_title });
      if (error) throw error;
      res.status(201).json({ id: lotId });
    } catch (error) {
      console.error("[POST /api/projects/:projectId/lots]", error);
      res.status(500).json({ error: "Failed to create lot" });
    }
  });

  app.delete("/api/lots/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { error } = await supabaseAdmin.from('project_lots').delete().eq('id', id).eq('tenant_id', tenantId);
      if (error) throw error;
      res.json({ success: true });
    } catch (error) {
      console.error("[DELETE /api/lots/:id]", error);
      res.status(500).json({ error: "Failed to delete lot" });
    }
  });
}
