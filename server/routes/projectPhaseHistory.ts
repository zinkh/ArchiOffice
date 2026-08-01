// Phase 7 extraction — moved verbatim out of server.ts's "─── Project phase
// history (ESQ/APS/APD/PC/PRO/DCE/ACT/VISA/DET/AOR) ───" section.
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  getUserName: (tenantId: string, userId: string, email?: string) => Promise<string>;
  logActivity: (tenantId: string, userId: string, userName: string, action: string, target: string, targetId: string, targetType: string, category: string) => Promise<void>;
}

export function registerProjectPhaseHistoryRoutes(app: Express, { supabaseAdmin, getTenantId, getUserName, logActivity }: RouteDeps) {
  app.get('/api/projects/:id/phase-history', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'project_phase_history')
        .select('*')
        .eq('project_id', req.params.id)
        .order('entered_at', { ascending: true });
      if (error) { res.json([]); return; }
      res.json(data || []);
    } catch (e: any) { console.error('[GET /api/projects/:id/phase-history]', e); res.json([]); }
  });

  app.post('/api/projects/:id/phase', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id: projectId } = req.params;
      const { phase } = req.body;
      if (!phase) return res.status(400).json({ error: 'phase is required' });

      const { data: project } = await tenantScopedFrom(supabaseAdmin, tenantId, 'projects').select('name').eq('id', projectId).single();
      if (!project) return res.status(404).json({ error: 'Project not found' });

      const { data: current } = await tenantScopedFrom(supabaseAdmin, tenantId, 'project_phase_history')
        .select('*')
        .eq('project_id', projectId)
        .is('exited_at', null)
        .maybeSingle();

      if (current && (current as any).phase === phase) {
        res.json(current);
        return;
      }

      const now = new Date().toISOString();
      if (current) {
        const { error: exitErr } = await tenantScopedFrom(supabaseAdmin, tenantId, 'project_phase_history')
          .update({ exited_at: now }).eq('id', (current as any).id);
        if (exitErr) throw exitErr;
      }

      const id = crypto.randomUUID();
      const { data: created, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'project_phase_history')
        .insert({ id, project_id: projectId, phase, entered_at: now, exited_at: null })
        .select().single();
      if (error) throw error;

      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Passage du projet "${(project as any).name}" en phase ${phase}`, (project as any).name, projectId, 'project', 'Projets');

      res.status(201).json(created);
    } catch (e: any) {
      console.error('[POST /api/projects/:id/phase]', e);
      res.status(500).json({ error: 'Failed to update project phase' });
    }
  });
}
