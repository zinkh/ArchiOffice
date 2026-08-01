// Phase 7 extraction — moved out of server.ts's "─── Leave / Congés ───"
// section. Same dependency-injection approach as timeTracking.ts for the
// RBAC helpers shared with still-inline routes.
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
  businessDaysBetween: (startDateStr: string, endDateStr: string) => number;
}

const LEAVE_LABELS: Record<string, string> = { conges_payes: 'Congés payés', rtt: 'RTT', maladie: 'Maladie', sans_solde: 'Congé sans solde', exceptionnel: 'Congé exceptionnel' };

export function registerLeaveRoutes(app: Express, { supabaseAdmin, getTenantId, getUserName, logActivity, requireManagerOf, resolveReportIds, isAdmin, requireTenantAdmin, businessDaysBetween }: RouteDeps) {
  app.get("/api/leave_requests", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { scope, user_id } = req.query;
      if (scope === 'team') {
        const reportIds = await resolveReportIds(tenantId, req.user.id, true);
        if (reportIds.length === 0) {
          if (!(await isAdmin(tenantId, req.user.id))) return res.status(403).json({ error: "Réservé aux managers et administrateurs" });
          return res.json([]);
        }
        const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'leave_requests').select('*').in('user_id', reportIds).order('created_at', { ascending: false });
        if (error) throw error;
        return res.json(data);
      }
      const targetUserId = (user_id as string) || req.user.id;
      if (targetUserId !== req.user.id) await requireManagerOf(tenantId, targetUserId, req.user.id);
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'leave_requests').select('*').eq('user_id', targetUserId).order('created_at', { ascending: false });
      if (error) throw error;
      res.json(data);
    } catch (e: any) { console.error(e); res.status(e.status || 500).json({ error: e.message || "Failed to fetch leave requests" }); }
  });

  app.post("/api/leave_requests", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { leave_type, motif, start_date, end_date, reason } = req.body;
      const validTypes = ['conges_payes', 'rtt', 'maladie', 'sans_solde', 'exceptionnel'];
      if (!validTypes.includes(leave_type)) return res.status(400).json({ error: 'Type de congé invalide' });
      if (!start_date || !end_date) return res.status(400).json({ error: 'start_date et end_date requis' });
      if (new Date(end_date) < new Date(start_date)) return res.status(400).json({ error: 'end_date doit être après start_date' });
      const business_days = businessDaysBetween(start_date, end_date);
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'leave_requests').insert({
        id, user_id: req.user.id, leave_type, motif: motif || null,
        start_date, end_date, business_days, reason: reason || null,
        status: 'pending', created_at: now, updated_at: now,
      });
      if (error) throw error;
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Demande de congés (${LEAVE_LABELS[leave_type] || leave_type}) déposée`, userName, id, 'leave_request', 'Congés');
      res.status(201).json({ id, business_days });
    } catch (e: any) { console.error(e); res.status(e.status || 500).json({ error: e.message || "Failed to create leave request" }); }
  });

  app.patch("/api/leave_requests/:id/status", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { status, decision_note } = req.body;
      const validStatuses = ['approved', 'rejected'];
      if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });
      const { data: request } = await tenantScopedFrom(supabaseAdmin, tenantId, 'leave_requests').select('*').eq('id', id).maybeSingle();
      if (!request) return res.status(404).json({ error: 'Demande introuvable' });
      await requireManagerOf(tenantId, request.user_id, req.user.id);
      const { data: updated, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'leave_requests').update({
        status, decided_by: req.user.id, decided_at: new Date().toISOString(),
        decision_note: decision_note || null, updated_at: new Date().toISOString(),
      }).eq('id', id).eq('status', 'pending').select().maybeSingle();
      if (error) throw error;
      if (!updated) return res.status(404).json({ error: 'Cette demande a déjà été traitée' });
      const STATUS_LABELS: Record<string, string> = { approved: 'approuvés', rejected: 'refusés' };
      const requesterName = await getUserName(tenantId, request.user_id, undefined);
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Congés (${LEAVE_LABELS[request.leave_type] || request.leave_type}) ${STATUS_LABELS[status]} pour ${requesterName}`, requesterName, id, 'leave_request', 'Congés');
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(e.status || 500).json({ error: e.message || "Failed to update leave request status" }); }
  });

  app.delete("/api/leave_requests/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { data: request } = await tenantScopedFrom(supabaseAdmin, tenantId, 'leave_requests').select('user_id, status').eq('id', id).maybeSingle();
      if (!request) return res.status(404).json({ error: 'Demande introuvable' });
      if (request.user_id === req.user.id) {
        if (request.status !== 'pending') return res.status(400).json({ error: 'Seule une demande en attente peut être annulée' });
      } else {
        await requireManagerOf(tenantId, request.user_id, req.user.id);
      }
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'leave_requests').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', id);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(e.status || 500).json({ error: e.message || "Failed to cancel leave request" }); }
  });

  app.get("/api/leave_balances", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { user_id, year } = req.query;
      const targetUserId = (user_id as string) || req.user.id;
      if (targetUserId !== req.user.id) await requireManagerOf(tenantId, targetUserId, req.user.id);
      const targetYear = parseInt((year as string) || String(new Date().getFullYear()), 10);
      const { data: settings } = await tenantScopedFrom(supabaseAdmin, tenantId, 'settings').select('default_leave_days_conges_payes, default_leave_days_rtt').maybeSingle();
      const { data: overrides } = await tenantScopedFrom(supabaseAdmin, tenantId, 'leave_balances').select('*').eq('user_id', targetUserId).eq('year', targetYear);
      const { data: approvedRequests } = await tenantScopedFrom(supabaseAdmin, tenantId, 'leave_requests').select('leave_type, business_days, start_date').eq('user_id', targetUserId).eq('status', 'approved');
      const defaults: Record<string, number> = {
        conges_payes: settings?.default_leave_days_conges_payes ?? 25,
        rtt: settings?.default_leave_days_rtt ?? 0,
      };
      const overrideByType: Record<string, number> = Object.fromEntries((overrides || []).map((o: any) => [o.leave_type, o.allocated_days]));
      const balances = ['conges_payes', 'rtt'].map(leaveType => {
        const allocated = overrideByType[leaveType] ?? defaults[leaveType];
        const used = (approvedRequests || [])
          .filter((r: any) => r.leave_type === leaveType && new Date(r.start_date).getFullYear() === targetYear)
          .reduce((sum: number, r: any) => sum + Number(r.business_days), 0);
        return { user_id: targetUserId, year: targetYear, leave_type: leaveType, allocated_days: allocated, used_days: used, remaining_days: allocated - used };
      });
      res.json(balances);
    } catch (e: any) { console.error(e); res.status(e.status || 500).json({ error: e.message || "Failed to fetch leave balances" }); }
  });

  // Admin-only: congés payés / RTT balances for every employee at once, for
  // a given year — feeds the "Soldes" export (global table + per-employee fiche).
  app.get("/api/leave_balances/all", async (req: any, res: any) => {
    try {
      const tenantId = await requireTenantAdmin(req.user.id);
      const targetYear = parseInt((req.query.year as string) || String(new Date().getFullYear()), 10);
      const { data: profiles } = await tenantScopedFrom(supabaseAdmin, tenantId, 'profiles').select('id, name');
      const { data: settings } = await tenantScopedFrom(supabaseAdmin, tenantId, 'settings').select('default_leave_days_conges_payes, default_leave_days_rtt').maybeSingle();
      const { data: overrides } = await tenantScopedFrom(supabaseAdmin, tenantId, 'leave_balances').select('*').eq('year', targetYear);
      const { data: approvedRequests } = await tenantScopedFrom(supabaseAdmin, tenantId, 'leave_requests').select('user_id, leave_type, business_days, start_date').eq('status', 'approved');
      const defaults: Record<string, number> = {
        conges_payes: settings?.default_leave_days_conges_payes ?? 25,
        rtt: settings?.default_leave_days_rtt ?? 0,
      };
      const overrideByUserType: Record<string, number> = Object.fromEntries((overrides || []).map((o: any) => [`${o.user_id}::${o.leave_type}`, o.allocated_days]));
      const result = (profiles || []).map((p: any) => {
        const balances = ['conges_payes', 'rtt'].map(leaveType => {
          const allocated = overrideByUserType[`${p.id}::${leaveType}`] ?? defaults[leaveType];
          const used = (approvedRequests || [])
            .filter((r: any) => r.user_id === p.id && r.leave_type === leaveType && new Date(r.start_date).getFullYear() === targetYear)
            .reduce((sum: number, r: any) => sum + Number(r.business_days), 0);
          return { leave_type: leaveType, allocated_days: allocated, used_days: used, remaining_days: allocated - used };
        });
        return { user_id: p.id, name: p.name, year: targetYear, balances };
      });
      res.json(result);
    } catch (e: any) { console.error(e); res.status(e.status || 500).json({ error: e.message || "Failed to fetch leave balances" }); }
  });

  app.put("/api/leave_balances", async (req: any, res: any) => {
    try {
      const tenantId = await requireTenantAdmin(req.user.id);
      const { user_id, year, leave_type, allocated_days } = req.body;
      if (!user_id || !year || !['conges_payes', 'rtt'].includes(leave_type)) return res.status(400).json({ error: 'Paramètres invalides' });
      const now = new Date().toISOString();
      const { data: existing } = await tenantScopedFrom(supabaseAdmin, tenantId, 'leave_balances').select('id').eq('user_id', user_id).eq('year', year).eq('leave_type', leave_type).maybeSingle();
      if (existing) {
        const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'leave_balances').update({ allocated_days, updated_at: now }).eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'leave_balances').insert({
          id: crypto.randomUUID(), user_id, year, leave_type, allocated_days, created_at: now, updated_at: now,
        });
        if (error) throw error;
      }
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(e.status || 500).json({ error: e.message || "Failed to update leave balance" }); }
  });
}
