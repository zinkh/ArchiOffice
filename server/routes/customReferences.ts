// Phase 7 extraction — moved verbatim out of server.ts's "─── Custom
// References (références hors projets) ───" section.
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
}

export function registerCustomReferenceRoutes(app: Express, { supabaseAdmin, getTenantId }: RouteDeps) {
  app.get('/api/references/custom', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'custom_references').select('*').order('end_date', { ascending: false });
      if (error) {
        if ((error as any).code === '42P01') { res.json([]); return; }
        throw error;
      }
      res.json(data || []);
    } catch (e: any) {
      console.error('[GET /api/references/custom]', e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/references/custom', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { name, client, category, end_date, surface, budget, status, description, image_url, location, start_date, project_manager, construction_cost, remuneration, fee_rate, progression, custom_data, cotraitants, images } = req.body;
      if (!name) return res.status(400).json({ error: 'name requis' });
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'custom_references')
        .insert({ name, client, category, end_date: end_date || null, surface: surface || null, budget: budget || null, status: status || 'Completed', description, image_url, location, start_date: start_date || null, project_manager, construction_cost: construction_cost || null, remuneration: remuneration || null, fee_rate: fee_rate || null, progression: progression || null, custom_data: custom_data || {}, cotraitants: cotraitants || [], images: images || [] })
        .select().single();
      if (error) throw error;
      res.status(201).json(data);
    } catch (e: any) {
      console.error('[POST /api/references/custom]', e);
      res.status(500).json({ error: e.message });
    }
  });

  app.put('/api/references/custom/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { name, client, category, end_date, surface, budget, status, description, image_url, location, start_date, project_manager, construction_cost, remuneration, fee_rate, progression, custom_data, cotraitants, images } = req.body;
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'custom_references')
        .update({ name, client, category, end_date: end_date || null, surface: surface || null, budget: budget || null, status, description, image_url, location, start_date: start_date || null, project_manager, construction_cost: construction_cost || null, remuneration: remuneration || null, fee_rate: fee_rate || null, progression: progression || null, custom_data: custom_data || {}, cotraitants: cotraitants || [], images: images || [] })
        .eq('id', req.params.id).select().single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) {
      console.error('[PUT /api/references/custom/:id]', e);
      res.status(500).json({ error: e.message });
    }
  });

  app.delete('/api/references/custom/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'custom_references').delete().eq('id', req.params.id);
      if (error) throw error;
      res.json({ ok: true });
    } catch (e: any) {
      console.error('[DELETE /api/references/custom/:id]', e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/references/custom/bulk', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { items } = req.body as { items: any[] };
      if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'No items provided' });
      const rows = items.map(({ name, client, category, end_date, surface, budget, status, description, image_url, location }) => ({
        id: crypto.randomUUID(),
        name: name || 'Sans titre',
        client: client || '',
        category: category || '',
        end_date: end_date || null,
        surface: surface != null ? Number(surface) : null,
        budget: budget != null ? Number(budget) : null,
        status: status || 'Completed',
        description: description || '',
        image_url: image_url || null,
        location: location || '',
      }));
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'custom_references').insert(rows).select();
      if (error) {
        if (error.code === '42P01') return res.json([]);
        throw error;
      }
      res.json(data);
    } catch (e: any) {
      console.error('[POST /api/references/custom/bulk]', e);
      res.status(500).json({ error: e.message });
    }
  });
}
