// Phase 7 extraction — moved out of server.ts's "── Contrats MOE ──" section.
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  captureWithContext: (error: any, context: { route: string; tenantId?: string; userId?: string }) => void;
}

export function registerContratsMoeRoutes(app: Express, { supabaseAdmin, getTenantId, captureWithContext }: RouteDeps) {
  app.get("/api/contrats_moe", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'contrats_moe')
        .select('*, contacts(first_name, last_name, company_name), projects(name)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      const result = (data || []).map((c: any) => {
        const contact = c.contacts;
        const client_name = contact
          ? (contact.company_name || `${contact.first_name || ''} ${contact.last_name || ''}`.trim())
          : '';
        const { contacts: _c, projects: _p, ...rest } = c;
        return { ...rest, client_name, project_name: c.projects?.name || '' };
      });
      res.json(result);
    } catch (e: any) { console.error(e); res.status(500).json({ error: 'Failed to fetch contrats MOE' }); }
  });

  app.post("/api/contrats_moe", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const body = req.body;
      const id = body.id || crypto.randomUUID();
      const { client_name: _cn, project_name: _pn, ...insertData } = body;
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'contrats_moe')
        .insert({ ...insertData, id, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
      if (error) throw error;
      const { data: created } = await tenantScopedFrom(supabaseAdmin, tenantId, 'contrats_moe')
        .select('*, contacts(first_name, last_name, company_name), projects(name)')
        .eq('id', id).single();
      const contact = (created as any)?.contacts;
      const client_name = contact
        ? (contact.company_name || `${contact.first_name || ''} ${contact.last_name || ''}`.trim())
        : '';
      const { contacts: _c, projects: _p, ...rest } = (created as any) || {};
      res.status(201).json({ ...rest, client_name, project_name: (created as any)?.projects?.name || '' });
    } catch (e: any) { console.error(e); res.status(500).json({ error: 'Failed to create contrat MOE: ' + e.message }); }
  });

  app.put("/api/contrats_moe/:id", async (req: any, res: any) => {
    let tenantId: string | undefined;
    try {
      tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { client_name: _cn, project_name: _pn, id: _id, tenant_id: _tid, created_at: _ca, ...updateData } = req.body;
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'contrats_moe')
        .update({ ...updateData, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
      const { data: updated } = await tenantScopedFrom(supabaseAdmin, tenantId, 'contrats_moe')
        .select('*, contacts(first_name, last_name, company_name), projects(name)')
        .eq('id', id).single();
      const contact = (updated as any)?.contacts;
      const client_name = contact
        ? (contact.company_name || `${contact.first_name || ''} ${contact.last_name || ''}`.trim())
        : '';
      const { contacts: _c, projects: _p, ...rest } = (updated as any) || {};
      res.json({ ...rest, client_name, project_name: (updated as any)?.projects?.name || '' });
    } catch (e: any) { captureWithContext(e, { route: 'PUT /api/contrats_moe/:id', tenantId, userId: req.user?.id }); res.status(500).json({ error: 'Failed to update contrat MOE: ' + e.message }); }
  });

  app.delete("/api/contrats_moe/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'contrats_moe')
        .delete().eq('id', req.params.id);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(500).json({ error: 'Failed to delete contrat MOE' }); }
  });
}
