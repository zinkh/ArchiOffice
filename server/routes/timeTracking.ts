// Phase 7 extraction — moved out of server.ts's "─── Time Tracking ───"
// section. The RBAC helpers (requireManagerOf/resolveReportIds/isAdmin/
// requireTenantAdmin) stay defined in server.ts — like getUserName/
// logActivity before them, they're shared by many still-inline routes
// (including the 3 team join-request routes deliberately left in place
// right after this section, since approving a join request assigns
// tenant_id/system_role to a profile and belongs with the deferred auth
// domain) — so they're passed in as dependencies rather than duplicated.
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  getUserName: (tenantId: string, userId: string, email?: string) => Promise<string>;
  logActivity: (tenantId: string, userId: string, userName: string, action: string, target: string, targetId: string, targetType: string, category: string) => void;
  requireManagerOf: (tenantId: string, targetUserId: string, actingUserId: string) => Promise<void>;
  resolveReportIds: (tenantId: string, managerId: string, includeAllForAdmin: boolean) => Promise<string[]>;
  isAdmin: (tenantId: string, userId: string) => Promise<boolean>;
  requireTenantAdmin: (userId: string) => Promise<string>;
}

function sumHours(entries: any[]): number {
  return entries.reduce((sum, e) => {
    if (!e.end_time) return sum;
    return sum + (new Date(e.end_time).getTime() - new Date(e.start_time).getTime()) / 3_600_000;
  }, 0);
}

export function registerTimeTrackingRoutes(app: Express, { supabaseAdmin, getTenantId, getUserName, logActivity, requireManagerOf, resolveReportIds, isAdmin, requireTenantAdmin }: RouteDeps) {
  app.post("/api/time_entries/clock-in", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { project_id, description } = req.body;
      const { data: open } = await tenantScopedFrom(supabaseAdmin, tenantId, 'time_entries').select('id').eq('user_id', req.user.id).is('end_time', null).maybeSingle();
      if (open) return res.status(409).json({ error: 'Vous êtes déjà pointé(e)' });
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'time_entries').insert({
        id, user_id: req.user.id, project_id: project_id || null,
        entry_date: now.split('T')[0], start_time: now, description: description || null,
        source: 'clock', created_at: now, updated_at: now,
      });
      if (error) throw error;
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, 'Pointage entrée', userName, id, 'time_entry', 'Suivi du temps');
      res.status(201).json({ id });
    } catch (e: any) { console.error(e); res.status(e.status || 500).json({ error: e.message || "Failed to clock in" }); }
  });

  app.post("/api/time_entries/clock-out", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: open } = await tenantScopedFrom(supabaseAdmin, tenantId, 'time_entries').select('id').eq('user_id', req.user.id).is('end_time', null).maybeSingle();
      if (!open) return res.status(404).json({ error: "Aucun pointage en cours" });
      const now = new Date().toISOString();
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'time_entries').update({ end_time: now, updated_at: now }).eq('id', open.id);
      if (error) throw error;
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, 'Pointage sortie', userName, open.id, 'time_entry', 'Suivi du temps');
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(e.status || 500).json({ error: e.message || "Failed to clock out" }); }
  });

  app.get("/api/time_entries/current", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data } = await tenantScopedFrom(supabaseAdmin, tenantId, 'time_entries').select('*').eq('user_id', req.user.id).is('end_time', null).maybeSingle();
      res.json(data || null);
    } catch (e: any) { console.error(e); res.status(e.status || 500).json({ error: e.message }); }
  });

  app.get("/api/time_entries", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { start_date, end_date, project_id, user_id } = req.query;
      const targetUserId = (user_id as string) || req.user.id;
      if (targetUserId !== req.user.id) await requireManagerOf(tenantId, targetUserId, req.user.id);
      let query = tenantScopedFrom(supabaseAdmin, tenantId, 'time_entries').select('*').eq('user_id', targetUserId);
      if (start_date) query = query.gte('entry_date', start_date as string);
      if (end_date) query = query.lte('entry_date', end_date as string);
      if (project_id) query = query.eq('project_id', project_id as string);
      const { data, error } = await query.order('entry_date').order('start_time');
      if (error) throw error;
      res.json(data);
    } catch (e: any) { console.error(e); res.status(e.status || 500).json({ error: e.message || "Failed to fetch time entries" }); }
  });

  app.post("/api/time_entries", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { entry_date, start_time, end_time, project_id, description } = req.body;
      if (!entry_date || !start_time || !end_time) return res.status(400).json({ error: 'entry_date, start_time et end_time requis' });
      if (new Date(end_time) <= new Date(start_time)) return res.status(400).json({ error: "L'heure de fin doit être après l'heure de début" });
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'time_entries').insert({
        id, user_id: req.user.id, project_id: project_id || null,
        entry_date, start_time, end_time, description: description || null,
        source: 'manual', created_at: now, updated_at: now,
      });
      if (error) throw error;
      res.status(201).json({ id });
    } catch (e: any) { console.error(e); res.status(e.status || 500).json({ error: e.message || "Failed to create time entry" }); }
  });

  app.put("/api/time_entries/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { data: existing } = await tenantScopedFrom(supabaseAdmin, tenantId, 'time_entries').select('user_id').eq('id', id).maybeSingle();
      if (!existing) return res.status(404).json({ error: 'Entrée introuvable' });
      await requireManagerOf(tenantId, existing.user_id, req.user.id);
      const { entry_date, start_time, end_time, project_id, description } = req.body;
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'time_entries').update({
        entry_date, start_time, end_time: end_time || null, project_id: project_id || null,
        description: description || null, updated_at: new Date().toISOString(),
      }).eq('id', id);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(e.status || 500).json({ error: e.message || "Failed to update time entry" }); }
  });

  app.delete("/api/time_entries/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { data: existing } = await tenantScopedFrom(supabaseAdmin, tenantId, 'time_entries').select('user_id').eq('id', id).maybeSingle();
      if (!existing) return res.status(404).json({ error: 'Entrée introuvable' });
      await requireManagerOf(tenantId, existing.user_id, req.user.id);
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'time_entries').delete().eq('id', id);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(e.status || 500).json({ error: e.message || "Failed to delete time entry" }); }
  });

  app.get("/api/time_entries/weekly-summary", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { week_start, user_id } = req.query;
      const targetUserId = (user_id as string) || req.user.id;
      if (targetUserId !== req.user.id) await requireManagerOf(tenantId, targetUserId, req.user.id);
      if (!week_start) return res.status(400).json({ error: 'week_start requis' });
      const start = new Date(week_start as string + 'T00:00:00Z');
      const end = new Date(start); end.setUTCDate(end.getUTCDate() + 6);
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'time_entries').select('*').eq('user_id', targetUserId)
        .gte('entry_date', start.toISOString().split('T')[0]).lte('entry_date', end.toISOString().split('T')[0]);
      if (error) throw error;
      const entries = data || [];
      const byProjectMap: Record<string, number> = {};
      const byDayMap: Record<string, number> = {};
      for (const e of entries) {
        if (!e.end_time) continue;
        const hours = (new Date(e.end_time).getTime() - new Date(e.start_time).getTime()) / 3_600_000;
        const projKey = e.project_id || '__none__';
        byProjectMap[projKey] = (byProjectMap[projKey] || 0) + hours;
        byDayMap[e.entry_date] = (byDayMap[e.entry_date] || 0) + hours;
      }
      res.json({
        total_hours: sumHours(entries),
        by_project: Object.entries(byProjectMap).map(([project_id, hours]) => ({ project_id: project_id === '__none__' ? null : project_id, hours })),
        by_day: Object.entries(byDayMap).map(([date, hours]) => ({ date, hours })),
      });
    } catch (e: any) { console.error(e); res.status(e.status || 500).json({ error: e.message || "Failed to compute weekly summary" }); }
  });

  app.get("/api/time_entries/team-summary", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { week_start, scope } = req.query;
      if (!week_start) return res.status(400).json({ error: 'week_start requis' });
      const reportIds = await resolveReportIds(tenantId, req.user.id, scope === 'all');
      if (reportIds.length === 0) {
        if (!(await isAdmin(tenantId, req.user.id))) {
          const { data: anyReport } = await tenantScopedFrom(supabaseAdmin, tenantId, 'profiles').select('id').eq('manager_id', req.user.id).limit(1);
          if (!anyReport || anyReport.length === 0) return res.status(403).json({ error: "Réservé aux managers et administrateurs" });
        }
        return res.json([]);
      }
      const start = new Date(week_start as string + 'T00:00:00Z');
      const end = new Date(start); end.setUTCDate(end.getUTCDate() + 6);
      const { data: entries, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'time_entries').select('*').in('user_id', reportIds)
        .gte('entry_date', start.toISOString().split('T')[0]).lte('entry_date', end.toISOString().split('T')[0]);
      if (error) throw error;
      const { data: profiles } = await tenantScopedFrom(supabaseAdmin, tenantId, 'profiles').select('id, name').in('id', reportIds);
      const nameById: Record<string, string> = Object.fromEntries((profiles || []).map((p: any) => [p.id, p.name]));
      const result = reportIds.map(uid => ({
        user_id: uid, name: nameById[uid] || uid,
        total_hours: sumHours((entries || []).filter((e: any) => e.user_id === uid)),
      }));
      res.json(result);
    } catch (e: any) { console.error(e); res.status(e.status || 500).json({ error: e.message || "Failed to compute team summary" }); }
  });

  // Manager/admin: raw time entries + approved leave for the team over a week,
  // used to render the visual "agence" weekly occupancy grid (one row per
  // employee, one column per day) on the Calendar page's "Vue équipe" tab.
  app.get("/api/time_entries/team-schedule", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { week_start } = req.query;
      if (!week_start) return res.status(400).json({ error: 'week_start requis' });
      const reportIds = await resolveReportIds(tenantId, req.user.id, true);
      if (reportIds.length === 0) {
        if (!(await isAdmin(tenantId, req.user.id))) return res.status(403).json({ error: "Réservé aux managers et administrateurs" });
        return res.json({ employees: [], entries: [], leaves: [], projects: [] });
      }
      const start = new Date(week_start as string + 'T00:00:00Z');
      const end = new Date(start); end.setUTCDate(end.getUTCDate() + 6);
      const startStr = start.toISOString().split('T')[0];
      const endStr = end.toISOString().split('T')[0];

      const { data: profiles } = await tenantScopedFrom(supabaseAdmin, tenantId, 'profiles').select('id, name, job_title, department').in('id', reportIds);
      const { data: entries, error: entriesErr } = await tenantScopedFrom(supabaseAdmin, tenantId, 'time_entries').select('id, user_id, entry_date, start_time, end_time, project_id')
        .in('user_id', reportIds).gte('entry_date', startStr).lte('entry_date', endStr);
      if (entriesErr) throw entriesErr;
      const { data: leaves, error: leavesErr } = await tenantScopedFrom(supabaseAdmin, tenantId, 'leave_requests').select('id, user_id, leave_type, start_date, end_date')
        .in('user_id', reportIds).eq('status', 'approved').lte('start_date', endStr).gte('end_date', startStr);
      if (leavesErr) throw leavesErr;
      const { data: projects } = await tenantScopedFrom(supabaseAdmin, tenantId, 'projects').select('id, name');

      res.json({ employees: profiles || [], entries: entries || [], leaves: leaves || [], projects: projects || [] });
    } catch (e: any) { console.error(e); res.status(e.status || 500).json({ error: e.message || "Failed to compute team schedule" }); }
  });

  // Admin-only: hours per employee × per project for an arbitrary date range
  // (used by the "Par projet" tab and its Excel export — distinct from
  // team-summary, which is scoped to the caller's direct reports).
  app.get("/api/time_entries/admin-matrix", async (req: any, res: any) => {
    try {
      const tenantId = await requireTenantAdmin(req.user.id);
      const { start_date, end_date } = req.query;
      if (!start_date || !end_date) return res.status(400).json({ error: 'start_date et end_date requis' });
      const { data: entries, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'time_entries').select('user_id, project_id, start_time, end_time')
        .gte('entry_date', start_date as string).lte('entry_date', end_date as string);
      if (error) throw error;
      const { data: profiles } = await tenantScopedFrom(supabaseAdmin, tenantId, 'profiles').select('id, name');
      const { data: projects } = await tenantScopedFrom(supabaseAdmin, tenantId, 'projects').select('id, name');
      const cellMap: Record<string, number> = {};
      for (const e of entries || []) {
        if (!e.end_time) continue;
        const hours = (new Date(e.end_time).getTime() - new Date(e.start_time).getTime()) / 3_600_000;
        const key = `${e.user_id}::${e.project_id || '__none__'}`;
        cellMap[key] = (cellMap[key] || 0) + hours;
      }
      const cells = Object.entries(cellMap).map(([key, hours]) => {
        const [user_id, project_id] = key.split('::');
        return { user_id, project_id: project_id === '__none__' ? null : project_id, hours };
      });
      res.json({ employees: profiles || [], projects: projects || [], cells });
    } catch (e: any) { console.error(e); res.status(e.status || 500).json({ error: e.message || "Failed to compute admin matrix" }); }
  });

  // Admin-only: total hours per employee for a calendar month, across the whole
  // tenant — feeds the Excel export sent to the accountant.
  app.get("/api/time_entries/monthly-summary", async (req: any, res: any) => {
    try {
      const tenantId = await requireTenantAdmin(req.user.id);
      const { month } = req.query; // 'YYYY-MM'
      if (!month || !/^\d{4}-\d{2}$/.test(month as string)) return res.status(400).json({ error: 'month requis (format YYYY-MM)' });
      const [y, m] = (month as string).split('-').map(Number);
      const monthStart = `${month}-01`;
      const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const monthEnd = `${month}-${String(lastDay).padStart(2, '0')}`;
      const { data: entries, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'time_entries').select('user_id, start_time, end_time')
        .gte('entry_date', monthStart).lte('entry_date', monthEnd);
      if (error) throw error;
      const { data: profiles } = await tenantScopedFrom(supabaseAdmin, tenantId, 'profiles').select('id, name');
      const totalsByUser: Record<string, number> = {};
      for (const e of entries || []) {
        if (!e.end_time) continue;
        const hours = (new Date(e.end_time).getTime() - new Date(e.start_time).getTime()) / 3_600_000;
        totalsByUser[e.user_id] = (totalsByUser[e.user_id] || 0) + hours;
      }
      const result = (profiles || []).map((p: any) => ({ user_id: p.id, name: p.name, total_hours: totalsByUser[p.id] || 0 }));
      res.json(result);
    } catch (e: any) { console.error(e); res.status(e.status || 500).json({ error: e.message || "Failed to compute monthly summary" }); }
  });
}
