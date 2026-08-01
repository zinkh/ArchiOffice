// Phase 7 extraction — moved out of server.ts's "--- Observations routes ---"
// section. Also fixes a real tenant-isolation gap found during extraction:
// POST /api/observations/:id/link/:reportId performed zero ownership checks
// before linking an observation to a report. observation_reports has no
// tenant_id column at all (see supabase/migrate_add_observations.sql — it's
// protected only by an RLS subquery through `observations`, which
// supabaseAdmin bypasses entirely), so any authenticated caller could link
// an arbitrary observation to an arbitrary report across tenants just by
// guessing/enumerating ids. tenantScopedFrom can't be used directly on
// observation_reports (no tenant_id column to filter/stamp), so this now
// verifies both the observation and the report belong to the caller's
// tenant before inserting the link row.
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  getUserName: (tenantId: string, userId: string, email?: string) => Promise<string>;
  logActivity: (tenantId: string, userId: string, userName: string, action: string, target: string, targetId: string, targetType: string, category: string) => void;
}

export function registerObservationRoutes(app: Express, { supabaseAdmin, getTenantId, getUserName, logActivity }: RouteDeps) {
  app.get("/api/projects/:projectId/observations", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { projectId } = req.params;
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'observations')
        .select(`*, lot:project_lots(id,lot_number,lot_title), created_report:site_reports!created_report_id(report_number), resolved_report:site_reports!resolved_report_id(report_number), observation_reports(report_id)`)
        .eq('project_id', projectId)
        .order('number', { ascending: true });
      if (error) throw error;
      const mapped = (data || []).map((o: any) => ({
        ...o,
        created_report_number: o.created_report?.report_number,
        resolved_report_number: o.resolved_report?.report_number,
        report_ids: (o.observation_reports || []).map((r: any) => r.report_id),
      }));
      res.json(mapped);
    } catch (error) {
      console.error("[GET /api/projects/:projectId/observations]", error);
      res.status(500).json({ error: "Failed to fetch observations" });
    }
  });

  app.post("/api/projects/:projectId/observations", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { projectId } = req.params;
      const { lot_id, contact_id, texte, statut, due_date, created_report_id } = req.body;
      const { data: existing } = await tenantScopedFrom(supabaseAdmin, tenantId, 'observations').select('number').eq('project_id', projectId).order('number', { ascending: false }).limit(1);
      const number = existing && existing.length > 0 ? ((existing[0] as any).number || 0) + 1 : 1;
      const id = `obs_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'observations').insert({
        id, project_id: projectId, lot_id: lot_id || null, contact_id: contact_id || null,
        texte: texte || '', statut: statut || 'À faire', due_date: due_date || null,
        created_report_id: created_report_id || null, number
      }).select().single();
      if (error) throw error;
      if (created_report_id) {
        await supabaseAdmin.from('observation_reports').insert({ observation_id: id, report_id: created_report_id });
      }
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Création de l'observation N° ${number}`, texte || '', id, 'observation', 'Réserves/Observations');
      res.json(data);
    } catch (error) {
      console.error("[POST /api/projects/:projectId/observations]", error);
      res.status(500).json({ error: "Failed to create observation" });
    }
  });

  app.put("/api/observations/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { lot_id, contact_id, texte, statut, due_date, resolved_report_id } = req.body;
      const update: any = { lot_id: lot_id || null, contact_id: contact_id || null, texte, statut, due_date: due_date || null };
      if (statut === 'Levée' && resolved_report_id) update.resolved_report_id = resolved_report_id;
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'observations').update(update).eq('id', id);
      if (error) throw error;
      res.json({ success: true });
    } catch (error) {
      console.error("[PUT /api/observations/:id]", error);
      res.status(500).json({ error: "Failed to update observation" });
    }
  });

  app.delete("/api/observations/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { data: obs } = await tenantScopedFrom(supabaseAdmin, tenantId, 'observations').select('number, texte').eq('id', id).maybeSingle();
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'observations').delete().eq('id', id);
      if (error) throw error;
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Suppression de l'observation N° ${(obs as any)?.number}`, (obs as any)?.texte || '', id, 'observation', 'Réserves/Observations');
      res.json({ success: true });
    } catch (error) {
      console.error("[DELETE /api/observations/:id]", error);
      res.status(500).json({ error: "Failed to delete observation" });
    }
  });

  app.get("/api/reports/:reportId/observations", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { reportId } = req.params;
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'observations')
        .select(`*, lot:project_lots(id,lot_number,lot_title), created_report:site_reports!created_report_id(report_number), resolved_report:site_reports!resolved_report_id(report_number), observation_reports!inner(report_id)`)
        .eq('observation_reports.report_id', reportId)
        .order('number', { ascending: true });
      if (error) throw error;
      const mapped = (data || []).map((o: any) => ({
        ...o,
        created_report_number: o.created_report?.report_number,
        resolved_report_number: o.resolved_report?.report_number,
        report_ids: (o.observation_reports || []).map((r: any) => r.report_id),
      }));
      res.json(mapped);
    } catch (error) {
      console.error("[GET /api/reports/:reportId/observations]", error);
      res.status(500).json({ error: "Failed to fetch report observations" });
    }
  });

  app.post("/api/observations/:id/link/:reportId", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id, reportId } = req.params;
      const { data: obs } = await tenantScopedFrom(supabaseAdmin, tenantId, 'observations').select('id').eq('id', id).maybeSingle();
      if (!obs) return res.status(404).json({ error: "Observation not found" });
      const { data: report } = await tenantScopedFrom(supabaseAdmin, tenantId, 'site_reports').select('id').eq('id', reportId).maybeSingle();
      if (!report) return res.status(404).json({ error: "Report not found" });
      const { error } = await supabaseAdmin.from('observation_reports').insert({ observation_id: id, report_id: reportId });
      if (error) throw error;
      res.json({ success: true });
    } catch (error) {
      console.error("[POST /api/observations/:id/link/:reportId]", error);
      res.status(500).json({ error: "Failed to link observation to report" });
    }
  });
}
