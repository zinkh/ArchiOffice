// Phase 7 extraction — moved out of server.ts's "Reserves" section, part of
// the "suivi de chantier" cluster (see ordresDeService.ts). Distinct from
// Observations (server/routes/observations.ts, lot 3) — reserves are
// tied to a réception (OPR) and auto-numbered per project.
import type { Express } from 'express';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  getUserName: (tenantId: string, userId: string, email?: string) => Promise<string>;
  logActivity: (tenantId: string, userId: string, userName: string, action: string, target: string, targetId: string, targetType: string, category: string) => void;
}

export function registerReserveRoutes(app: Express, { supabaseAdmin, getTenantId, getUserName, logActivity }: RouteDeps) {
  app.get("/api/reserves", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { project_id } = req.query;
      const { data, error } = await supabaseAdmin.from('reserves').select('*').eq('tenant_id', tenantId).eq('project_id', project_id as string);
      if (error) throw error;
      res.json(data);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to fetch reserves" }); }
  });

  app.post("/api/reserves", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id: bodyId, project_id, reception_id, title, batiment, local, status, lots, entreprises, created_at, due_date, plan_id, x, y } = req.body;
      // Get the next number for this project
      const { data: lastRow } = await supabaseAdmin.from('reserves').select('number').eq('tenant_id', tenantId).eq('project_id', project_id).order('number', { ascending: false }).limit(1).single();
      const nextNumber = ((lastRow as any)?.number || 0) + 1;
      const id = bodyId || crypto.randomUUID();
      const { data, error } = await supabaseAdmin.from('reserves').insert({
        id, tenant_id: tenantId, project_id, reception_id, title, batiment, local,
        status: status || 'A faire', lots, entreprises, created_at, due_date, plan_id, x, y, number: nextNumber
      }).select().single();
      if (error) throw error;
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Création de la réserve N° ${nextNumber} "${title}"`, title || '', id, 'reserve', 'Réserves/Observations');
      res.json(data);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to create reserve" }); }
  });

  app.delete("/api/reserves/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: reserve } = await supabaseAdmin.from('reserves').select('title, number').eq('id', req.params.id).eq('tenant_id', tenantId).maybeSingle();
      const { error } = await supabaseAdmin.from('reserves').delete().eq('id', req.params.id).eq('tenant_id', tenantId);
      if (error) throw error;
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Suppression de la réserve N° ${(reserve as any)?.number} "${(reserve as any)?.title || ''}"`, (reserve as any)?.title || '', req.params.id, 'reserve', 'Réserves/Observations');
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to delete reserve" }); }
  });

  app.put("/api/reserves/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { title, batiment, local, status, lots, entreprises, created_at, due_date, plan_id, x, y } = req.body;
      const { error } = await supabaseAdmin.from('reserves').update({ title, batiment, local, status, lots, entreprises, created_at, due_date, plan_id, x, y }).eq('id', req.params.id).eq('tenant_id', tenantId);
      if (error) throw error;
      res.json({ id: req.params.id, title, batiment, local, status, lots, entreprises, created_at, due_date, plan_id, x, y });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to update reserve" }); }
  });
}
