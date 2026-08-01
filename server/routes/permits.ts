// Phase 7 extraction — moved out of server.ts's "Permits (PC / DP / AT)"
// section, part of the "suivi de chantier" cluster (see ordresDeService.ts).
import type { Express } from 'express';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
}

export function registerPermitRoutes(app: Express, { supabaseAdmin, getTenantId }: RouteDeps) {
  app.get("/api/permits", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { project_id } = req.query;
      let query = supabaseAdmin.from('permits').select('*').eq('tenant_id', tenantId);
      if (project_id) query = query.eq('project_id', project_id as string);
      const { data, error } = await query;
      if (error) {
        if ((error as any).code === '42P01') { res.json([]); return; }
        throw error;
      }
      res.json(data);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to fetch permits" }); }
  });

  app.post("/api/permits", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { project_id, type, reference, submission_date, decision_date, status, notes } = req.body;
      const { data, error } = await supabaseAdmin.from('permits').insert({
        id: crypto.randomUUID(), tenant_id: tenantId, project_id, type, reference: reference || null,
        submission_date: submission_date || null, decision_date: decision_date || null,
        status: status || 'en_instruction', notes: notes || null, created_at: new Date().toISOString()
      }).select().single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to create permit" }); }
  });

  app.put("/api/permits/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { type, reference, submission_date, decision_date, status, notes } = req.body;
      const { data, error } = await supabaseAdmin.from('permits').update({
        type, reference: reference || null, submission_date: submission_date || null,
        decision_date: decision_date || null, status, notes: notes || null
      }).eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to update permit" }); }
  });

  app.delete("/api/permits/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { error } = await supabaseAdmin.from('permits').delete().eq('id', req.params.id).eq('tenant_id', tenantId);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to delete permit" }); }
  });
}
