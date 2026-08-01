// Phase 7 extraction — moved out of server.ts's inline Milestones CRUD
// section (between Veille RSS and Specifications). Generic milestones
// shared across projects/tenders/proposals via optional foreign keys.
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
}

export function registerMilestoneRoutes(app: Express, { supabaseAdmin, getTenantId }: RouteDeps) {
  app.get("/api/milestones", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { project_id, tender_id, proposal_id } = req.query;
      const query = tenantScopedFrom(supabaseAdmin, tenantId, 'milestones').select('*').order('due_date', { ascending: true });
      if (project_id) query.eq('project_id', project_id as string);
      else if (tender_id) query.eq('tender_id', tender_id as string);
      else if (proposal_id) query.eq('proposal_id', proposal_id as string);
      const { data, error } = await query;
      if (error) throw error;
      res.json(data);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to fetch milestones" }); }
  });

  app.post("/api/milestones", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { project_id, tender_id, proposal_id, title, due_date, completed, duration_days, dependencies } = req.body;
      const id = crypto.randomUUID();
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'milestones').insert({ id, project_id: project_id || null, tender_id: tender_id || null, proposal_id: proposal_id || null, title, due_date, completed: !!completed, duration_days: duration_days ?? null, dependencies: dependencies || [] }).select().single();
      if (error) throw error;
      res.status(201).json(data);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to create milestone: " + e.message }); }
  });

  app.put("/api/milestones/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { title, due_date, completed, duration_days, dependencies } = req.body;
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'milestones').update({ title, due_date, completed: !!completed, duration_days: duration_days ?? null, dependencies: dependencies || [] }).eq('id', id);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to update milestone: " + e.message }); }
  });

  app.delete("/api/milestones/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'milestones').delete().eq('id', id);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to delete milestone: " + e.message }); }
  });
}
