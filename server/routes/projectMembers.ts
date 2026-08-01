// Phase 7 extraction — moved verbatim out of server.ts's "─── Project
// Members (per-project access control) ───" section, including its
// "table might not exist yet" (Postgres error 42P01) fallbacks for
// environments where the project_members migration hasn't been applied.
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
}

export function registerProjectMemberRoutes(app: Express, { supabaseAdmin, getTenantId }: RouteDeps) {
  // Tenant-wide project membership lookup (optionally filtered by user_id) —
  // lets the dashboard resolve "my projects" / "my team's projects" without
  // looping the per-project endpoint below.
  app.get('/api/project-members', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { user_id } = req.query;
      let query = tenantScopedFrom(supabaseAdmin, tenantId, 'project_members').select('*');
      if (user_id) query = query.eq('user_id', user_id as string);
      const { data, error } = await query;
      if (error) {
        if ((error as any).code === '42P01') { res.json([]); return; }
        throw error;
      }
      res.json(data || []);
    } catch (e: any) { console.error('[GET /api/project-members]', e); res.json([]); }
  });

  app.get('/api/projects/:id/members', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'project_members').select('*').eq('project_id', req.params.id);
      if (error) { res.json([]); return; }
      res.json(data || []);
    } catch (e: any) { console.error('[GET /api/projects/:id/members]', e); res.json([]); }
  });

  app.post('/api/projects/:id/members', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { user_id, role } = req.body;
      if (!user_id) return res.status(400).json({ error: 'user_id is required' });
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'project_members')
        .insert({ id: crypto.randomUUID(), project_id: req.params.id, user_id, role: role || 'member' })
        .select().single();
      if (error) {
        if ((error as any).code === '42P01') return res.status(503).json({ error: 'Migration project_members non appliquée' });
        throw error;
      }
      res.status(201).json(data);
    } catch (e: any) { console.error('[POST /api/projects/:id/members]', e); res.status(500).json({ error: 'Failed to add project member' }); }
  });

  app.delete('/api/projects/:id/members/:userId', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'project_members')
        .delete()
        .eq('project_id', req.params.id)
        .eq('user_id', req.params.userId);
      if (error) {
        if ((error as any).code === '42P01') { res.json({ success: true }); return; }
        throw error;
      }
      res.json({ success: true });
    } catch (e: any) { console.error('[DELETE /api/projects/:id/members/:userId]', e); res.status(500).json({ error: 'Failed to remove project member' }); }
  });
}
