// Phase 7 extraction — moved out of server.ts's "Reports/Notes de chantier"
// section (site_reports = comptes-rendus de chantier, site_report_notes =
// their line items). POST creating a report auto-copies still-open notes
// from the project's previous report, so a recurring issue doesn't need to
// be re-entered every week.
import type { Express } from 'express';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  getUserName: (tenantId: string, userId: string, email?: string) => Promise<string>;
  logActivity: (tenantId: string, userId: string, userName: string, action: string, target: string, targetId: string, targetType: string, category: string) => void;
  captureWithContext: (error: any, context: Record<string, any>) => void;
}

export function registerSiteReportRoutes(app: Express, { supabaseAdmin, getTenantId, getUserName, logActivity, captureWithContext }: RouteDeps) {
  app.get("/api/projects/:projectId/reports", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { projectId } = req.params;
      const { data: reports, error } = await supabaseAdmin.from('site_reports').select('*').eq('project_id', projectId).eq('tenant_id', tenantId).order('date', { ascending: false });
      if (error) throw error;
      const parsedReports = (reports || []).map((report: any) => ({
        ...report,
        stakeholders: Array.isArray(report.stakeholders) ? report.stakeholders : (() => { try { return report.stakeholders ? JSON.parse(report.stakeholders) : []; } catch (e) {
          console.error("[GET /api/projects/:projectId/reports]", e); return []; } })(),
        companies: Array.isArray(report.companies) ? report.companies : (() => { try { return report.companies ? JSON.parse(report.companies) : []; } catch (e) {
          console.error("[GET /api/projects/:projectId/reports]", e); return []; } })()
      }));
      res.json(parsedReports);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to fetch reports" });
    }
  });

  app.post("/api/projects/:projectId/reports", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { projectId } = req.params;
      const { date, report_number } = req.body;
      const id = crypto.randomUUID();
      const { error: insErr } = await supabaseAdmin.from('site_reports').insert({ id, tenant_id: tenantId, project_id: projectId, date, report_number });
      if (insErr) throw insErr;
      const { data: project } = await supabaseAdmin.from('projects').select('name').eq('id', projectId).eq('tenant_id', tenantId).maybeSingle();
      const projectName = (project as any)?.name || '';
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Création du compte-rendu de chantier N° ${report_number} (${projectName})`, projectName, id, 'site_report', 'Notes de site');
      // Copy open notes from previous report
      const { data: previousReports } = await supabaseAdmin.from('site_reports').select('id').eq('project_id', projectId).eq('tenant_id', tenantId).neq('id', id).order('date', { ascending: false }).limit(1);
      if (previousReports && previousReports.length > 0) {
        const prevId = previousReports[0].id;
        const { data: openNotes } = await supabaseAdmin.from('site_report_notes').select('*').eq('report_id', prevId).eq('status', 'open');
        if (openNotes && openNotes.length > 0) {
          const newNotes = openNotes.map((note: any) => ({ id: crypto.randomUUID(), tenant_id: tenantId, report_id: id, category: note.category, note_number: note.note_number, responsible_company: note.responsible_company, issue_date: note.issue_date, due_date: note.due_date, status: 'open' }));
          await supabaseAdmin.from('site_report_notes').insert(newNotes);
        }
      }
      res.status(201).json({ id });
    } catch (error) {
      console.error("[POST /api/projects/:projectId/reports]", error);
      res.status(500).json({ error: "Failed to create report" });
    }
  });

  app.get("/api/reports/:reportId/notes", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { reportId } = req.params;
      const { data: notes, error } = await supabaseAdmin.from('site_report_notes').select('*').eq('report_id', reportId).eq('tenant_id', tenantId);
      if (error) throw error;
      res.json(notes);
    } catch (error) {
      console.error("[GET /api/reports/:reportId/notes]", error);
      res.status(500).json({ error: "Failed to fetch notes" });
    }
  });

  app.post("/api/reports/:reportId/notes", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { reportId } = req.params;
      const { category, note_number, responsible_company, issue_date, due_date } = req.body;
      const id = crypto.randomUUID();
      const { error } = await supabaseAdmin.from('site_report_notes').insert({ id, tenant_id: tenantId, report_id: reportId, category, note_number, responsible_company, issue_date, due_date });
      if (error) throw error;
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Ajout de la note de chantier N° ${note_number}`, category || '', id, 'site_report_note', 'Notes de site');
      res.status(201).json({ id });
    } catch (error) {
      console.error("[POST /api/reports/:reportId/notes]", error);
      res.status(500).json({ error: "Failed to create note" });
    }
  });

  app.put("/api/reports/:reportId", async (req: any, res: any) => {
    let tenantId: string | undefined;
    try {
      tenantId = await getTenantId(req.user.id);
      const { reportId } = req.params;
      const { pageFormat, stakeholders, companies, meetingNotes, nextMeeting } = req.body;
      const { error } = await supabaseAdmin.from('site_reports').update({
        pageFormat: pageFormat || null,
        stakeholders: stakeholders || [],
        companies: companies || [],
        meetingNotes: meetingNotes || null,
        nextMeeting: nextMeeting || null
      }).eq('id', reportId).eq('tenant_id', tenantId);
      if (error) throw error;
      const { data: updatedReport } = await supabaseAdmin.from('site_reports').select('*').eq('id', reportId).eq('tenant_id', tenantId).single();
      res.json({ ...(updatedReport as any), stakeholders: (updatedReport as any)?.stakeholders || [], companies: (updatedReport as any)?.companies || [] });
    } catch (error) {
      captureWithContext(error, { route: 'PUT /api/reports/:reportId', tenantId, userId: req.user?.id });
      res.status(500).json({ error: "Failed to update report" });
    }
  });

  app.put("/api/notes/:noteId", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { noteId } = req.params;
      const { category, responsible_company, text, status, due_date, realization_date } = req.body;
      const { error } = await supabaseAdmin.from('site_report_notes').update({ category, responsible_company, text, status, due_date, realization_date }).eq('id', noteId).eq('tenant_id', tenantId);
      if (error) throw error;
      res.json({ success: true });
    } catch (error) {
      console.error("[PUT /api/notes/:noteId]", error);
      res.status(500).json({ error: "Failed to update note" });
    }
  });

  app.delete("/api/notes/:noteId", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { noteId } = req.params;
      const { data: note } = await supabaseAdmin.from('site_report_notes').select('note_number, category').eq('id', noteId).eq('tenant_id', tenantId).maybeSingle();
      const { error } = await supabaseAdmin.from('site_report_notes').delete().eq('id', noteId).eq('tenant_id', tenantId);
      if (error) throw error;
      const noteNumber = (note as any)?.note_number;
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Suppression de la note de chantier N° ${noteNumber}`, (note as any)?.category || '', noteId, 'site_report_note', 'Notes de site');
      res.json({ success: true });
    } catch (error) {
      console.error("[DELETE /api/notes/:noteId]", error);
      res.status(500).json({ error: "Failed to delete note" });
    }
  });
}
