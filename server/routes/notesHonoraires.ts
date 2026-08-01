// Phase 7 extraction — moved out of server.ts's "── Notes d'honoraires ──"
// section. getNextDocNumber (auto-numbering, shared with Proposals) stays
// defined in server.ts and is passed in rather than duplicated, since
// Proposals itself is deliberately not extracted yet (deferred to last with
// invoices/auth/billing per the Phase 7 plan).
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  captureWithContext: (error: any, context: { route: string; tenantId?: string; userId?: string }) => void;
  getNextDocNumber: (tenantId: string, settingCol: string, countTable: string, defaultPrefix: string) => Promise<string>;
}

export function registerNotesHonorairesRoutes(app: Express, { supabaseAdmin, getTenantId, captureWithContext, getNextDocNumber }: RouteDeps) {
  app.get("/api/notes_honoraires", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const projectId = req.query.project_id as string | undefined;
      let query = tenantScopedFrom(supabaseAdmin, tenantId, 'notes_honoraires').select('*').order('created_at', { ascending: false });
      if (projectId) query = query.eq('project_id', projectId);
      const { data, error } = await query;
      if (error) throw error;
      res.json(data || []);
    } catch (e: any) { console.error(e); res.status(500).json({ error: 'Failed to fetch notes honoraires' }); }
  });

  app.post("/api/notes_honoraires", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const body = req.body;
      const id = body.id || crypto.randomUUID();
      const { id: _id, tenant_id: _tid, created_at: _ca, updated_at: _ua, ...insertData } = body;
      // Auto-generate numero if not provided
      if (!insertData.numero) {
        insertData.numero = await getNextDocNumber(tenantId, 'num_prefix_honoraires', 'notes_honoraires', 'NH');
      }
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'notes_honoraires').insert({ ...insertData, id, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
      if (error) throw error;
      const { data: created } = await tenantScopedFrom(supabaseAdmin, tenantId, 'notes_honoraires').select('*').eq('id', id).single();
      res.status(201).json(created);
    } catch (e: any) { console.error(e); res.status(500).json({ error: 'Failed to create note honoraires: ' + e.message }); }
  });

  app.put("/api/notes_honoraires/:id", async (req: any, res: any) => {
    let tenantId: string | undefined;
    try {
      tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { id: _id, tenant_id: _tid, created_at: _ca, ...updateData } = req.body;
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'notes_honoraires').update({ ...updateData, updated_at: new Date().toISOString() }).eq('id', id);
      if (error) throw error;
      const { data: updated } = await tenantScopedFrom(supabaseAdmin, tenantId, 'notes_honoraires').select('*').eq('id', id).single();
      res.json(updated);
    } catch (e: any) { captureWithContext(e, { route: 'PUT /api/notes_honoraires/:id', tenantId, userId: req.user?.id }); res.status(500).json({ error: 'Failed to update note honoraires: ' + e.message }); }
  });

  app.delete("/api/notes_honoraires/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'notes_honoraires').delete().eq('id', req.params.id);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(500).json({ error: 'Failed to delete note honoraires' }); }
  });
}
