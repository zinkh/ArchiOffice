// Phase 7 extraction — moved out of server.ts's "GPA reserves" section,
// part of the "suivi de chantier" cluster (see ordresDeService.ts). Same
// mechanism as OPR `reserves` (server/routes/reserves.ts), kept in a
// separate table since OPR and GPA reserves are distinct tracking sets.
import type { Express } from 'express';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  getUserName: (tenantId: string, userId: string, email?: string) => Promise<string>;
  logActivity: (tenantId: string, userId: string, userName: string, action: string, target: string, targetId: string, targetType: string, category: string) => void;
}

export function registerGpaReserveRoutes(app: Express, { supabaseAdmin, getTenantId, getUserName, logActivity }: RouteDeps) {
  app.get("/api/gpa-reserves", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { project_id } = req.query;
      let query = supabaseAdmin.from('gpa_reserves').select('*').eq('tenant_id', tenantId);
      if (project_id) query = query.eq('project_id', project_id as string);
      const { data, error } = await query;
      if (error) {
        if ((error as any).code === '42P01') { res.json([]); return; }
        throw error;
      }
      res.json(data);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to fetch GPA reserves" }); }
  });

  app.post("/api/gpa-reserves", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id: bodyId, project_id, reception_id, title, batiment, local, status, lots, entreprises, created_at, due_date, plan_id, x, y } = req.body;
      const { data: lastRow } = await supabaseAdmin.from('gpa_reserves').select('number').eq('tenant_id', tenantId).eq('project_id', project_id).order('number', { ascending: false }).limit(1).single();
      const nextNumber = ((lastRow as any)?.number || 0) + 1;
      const id = bodyId || crypto.randomUUID();
      const { data, error } = await supabaseAdmin.from('gpa_reserves').insert({
        id, tenant_id: tenantId, project_id, reception_id, title, batiment, local,
        status: status || 'A faire', lots, entreprises, created_at, due_date, plan_id, x, y, number: nextNumber
      }).select().single();
      if (error) throw error;
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Création de la réserve GPA N° ${nextNumber} "${title}"`, title || '', id, 'gpa_reserve', 'Réserves GPA');
      res.json(data);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to create GPA reserve" }); }
  });

  app.delete("/api/gpa-reserves/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: reserve } = await supabaseAdmin.from('gpa_reserves').select('title, number').eq('id', req.params.id).eq('tenant_id', tenantId).maybeSingle();
      const { error } = await supabaseAdmin.from('gpa_reserves').delete().eq('id', req.params.id).eq('tenant_id', tenantId);
      if (error) throw error;
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Suppression de la réserve GPA N° ${(reserve as any)?.number} "${(reserve as any)?.title || ''}"`, (reserve as any)?.title || '', req.params.id, 'gpa_reserve', 'Réserves GPA');
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to delete GPA reserve" }); }
  });

  app.put("/api/gpa-reserves/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { title, batiment, local, status, lots, entreprises, created_at, due_date, plan_id, x, y } = req.body;
      const { error } = await supabaseAdmin.from('gpa_reserves').update({ title, batiment, local, status, lots, entreprises, created_at, due_date, plan_id, x, y }).eq('id', req.params.id).eq('tenant_id', tenantId);
      if (error) throw error;
      res.json({ id: req.params.id, title, batiment, local, status, lots, entreprises, created_at, due_date, plan_id, x, y });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to update GPA reserve" }); }
  });
}
