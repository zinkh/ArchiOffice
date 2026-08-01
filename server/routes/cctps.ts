// Phase 7 extraction — moved verbatim out of server.ts's "─── CCTPs CRUD
// (missing update/delete) ───" section. Note: CCTP creation lives elsewhere
// (POST /api/projects/:projectId/cctp, a different route shape) and wasn't
// part of this section — left in server.ts for a future slice rather than
// guessed at here.
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
}

export function registerCctpRoutes(app: Express, { supabaseAdmin, getTenantId }: RouteDeps) {
  app.put('/api/cctps/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { title, content, lot, is_template } = req.body;
      const last_updated = new Date().toISOString();
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'cctps')
        .update({ title, content, lot, is_template: !!is_template, last_updated })
        .eq('id', req.params.id).select().single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) {
      console.error('[PUT /api/cctps/:id]', e);
      res.status(500).json({ error: 'Failed to update CCTP: ' + e.message });
    }
  });

  app.delete('/api/cctps/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'cctps').delete().eq('id', req.params.id);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) {
      console.error('[DELETE /api/cctps/:id]', e);
      res.status(500).json({ error: 'Failed to delete CCTP' });
    }
  });
}
