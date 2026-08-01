// Phase 7 extraction — moved verbatim out of server.ts's "─── DPGF Items
// CRUD ───" and "─── DPGFs CRUD ───" sections (dpgf_items are children of a
// parent dpgfs row — kept together as one domain module).
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
}

export function registerDpgfRoutes(app: Express, { supabaseAdmin, getTenantId }: RouteDeps) {
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
