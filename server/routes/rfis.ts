// Phase 7 extraction — moved out of server.ts's "RFIs (demandes
// d'information)" section, part of the "suivi de chantier" cluster (see
// ordresDeService.ts).
import type { Express } from 'express';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
}

export function registerRfiRoutes(app: Express, { supabaseAdmin, getTenantId }: RouteDeps) {
  app.get("/api/rfis", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { project_id } = req.query;
      let query = supabaseAdmin.from('rfis').select('*').eq('tenant_id', tenantId);
      if (project_id) query = query.eq('project_id', project_id as string);
      const { data, error } = await query;
      if (error) {
        if ((error as any).code === '42P01') { res.json([]); return; }
        throw error;
      }
      res.json(data);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to fetch RFIs" }); }
  });

  app.post("/api/rfis", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { project_id, question, asked_by, asked_date, due_date, status, answer, answered_date } = req.body;
      const { data, error } = await supabaseAdmin.from('rfis').insert({
        id: crypto.randomUUID(), tenant_id: tenantId, project_id, question,
        asked_by: asked_by || null, asked_date: asked_date || new Date().toISOString().split('T')[0],
        due_date: due_date || null, status: status || 'en_attente',
        answer: answer || null, answered_date: answered_date || null, created_at: new Date().toISOString()
      }).select().single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to create RFI" }); }
  });

  app.put("/api/rfis/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { question, asked_by, asked_date, due_date, status, answer, answered_date } = req.body;
      const { data, error } = await supabaseAdmin.from('rfis').update({
        question, asked_by: asked_by || null, asked_date, due_date: due_date || null,
        status, answer: answer || null, answered_date: answered_date || null
      }).eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to update RFI" }); }
  });

  app.delete("/api/rfis/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { error } = await supabaseAdmin.from('rfis').delete().eq('id', req.params.id).eq('tenant_id', tenantId);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to delete RFI" }); }
  });
}
