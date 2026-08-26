// Phase 7 extraction — moved out of server.ts's inline Tenders CRUD section
// (just above "--- Veille RSS des appels d'offres ---", which now lives in
// server/routes/tenderRss.ts). Tenders (appels d'offres) is a standalone
// CRM-like domain, not part of the invoices/proposals/auth/billing group
// deliberately deferred to last.
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  getUserName: (tenantId: string, userId: string, email?: string) => Promise<string>;
  logActivity: (tenantId: string, userId: string, userName: string, action: string, target: string, targetId: string, targetType: string, category: string) => void;
  captureWithContext: (error: any, context: { route: string; tenantId?: string; userId?: string }) => void;
}

export function registerTenderRoutes(app: Express, { supabaseAdmin, getTenantId, getUserName, logActivity, captureWithContext }: RouteDeps) {
  app.get("/api/tenders", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tenders').select('*, tender_specialties(*)');
      if (error) throw error;
      res.json((data || []).map((t: any) => ({ ...t, specialties_list: t.tender_specialties || [] })));
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to fetch tenders" }); }
  });

  app.get("/api/tenders/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tenders').select('*, tender_specialties(*)').eq('id', id).single();
      if (error || !data) return res.status(404).json({ error: "Tender not found" });
      res.json({ ...data, specialties_list: (data as any).tender_specialties || [] });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to fetch tender" }); }
  });

  app.post("/api/tenders", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { title, client, submission_deadline, status, value, notes, mandataire_id, type, surface, construction_cost, honoraires_percent, complexity_rate, base_fee_percent, miqcp_assessment, mandatory_visit, visit_date, withdrawal_deadline, archived, specialties_list, milestones_list } = req.body;
      const id = crypto.randomUUID();
      const { error: te } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tenders').insert({ id, title, client, submission_deadline, status: status || 'Draft', value: value || 0, notes: notes || '', mandataire_id: mandataire_id || null, type, surface: surface || 0, construction_cost: construction_cost || 0, honoraires_percent: honoraires_percent || 0, complexity_rate: complexity_rate ?? null, base_fee_percent: base_fee_percent ?? null, miqcp_assessment: miqcp_assessment || null, mandatory_visit: !!mandatory_visit, visit_date: visit_date || null, withdrawal_deadline: withdrawal_deadline || null, archived: !!archived });
      if (te) throw te;
      if (specialties_list?.length) await tenantScopedFrom(supabaseAdmin, tenantId, 'tender_specialties').insert(specialties_list.map((s: any) => ({ id: crypto.randomUUID(), tender_id: id, specialty_name: s.specialty_name, contact_id: s.contact_id || null })));
      if (milestones_list?.length) await tenantScopedFrom(supabaseAdmin, tenantId, 'milestones').insert(milestones_list.map((m: any) => ({ id: crypto.randomUUID(), tender_id: id, title: m.title, due_date: m.due_date, completed: !!m.completed })));
      const { data } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tenders').select('*, tender_specialties(*)').eq('id', id).single();
      // Log activity
      const userNameTndr = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userNameTndr, `Nouvel appel d'offres "${title}"`, title, id, 'tender', 'Appels d\'offres');
      res.status(201).json({ ...(data || {}), specialties_list: (data as any)?.tender_specialties || [] });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to create tender: " + e.message }); }
  });

  app.delete("/api/tenders/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { data: tender } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tenders').select('title').eq('id', id).maybeSingle();
      await tenantScopedFrom(supabaseAdmin, tenantId, 'tender_specialties').delete().eq('tender_id', id);
      await tenantScopedFrom(supabaseAdmin, tenantId, 'milestones').delete().eq('tender_id', id);
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tenders').delete().eq('id', id);
      if (error) throw error;
      const title = (tender as any)?.title || '';
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Suppression de l'appel d'offres "${title}"`, title, id, 'tender', 'Appels d\'offres');
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to delete tender" }); }
  });

  app.put("/api/tenders/:id", async (req: any, res: any) => {
    let tenantId: string | undefined;
    try {
      tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { title, client, submission_deadline, status, value, notes, mandataire_id, type, surface, construction_cost, honoraires_percent, complexity_rate, base_fee_percent, miqcp_assessment, mandatory_visit, visit_date, withdrawal_deadline, archived, specialties_list, milestones_list } = req.body;
      const { error: ue } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tenders').update({ title, client, submission_deadline, status, value: value || 0, notes: notes || '', mandataire_id: mandataire_id || null, type, surface: surface || 0, construction_cost: construction_cost || 0, honoraires_percent: honoraires_percent || 0, complexity_rate: complexity_rate ?? null, base_fee_percent: base_fee_percent ?? null, miqcp_assessment: miqcp_assessment || null, mandatory_visit: !!mandatory_visit, visit_date: visit_date || null, withdrawal_deadline: withdrawal_deadline || null, archived: !!archived }).eq('id', id);
      if (ue) throw ue;
      await tenantScopedFrom(supabaseAdmin, tenantId, 'tender_specialties').delete().eq('tender_id', id);
      if (specialties_list?.length) await tenantScopedFrom(supabaseAdmin, tenantId, 'tender_specialties').insert(specialties_list.map((s: any) => ({ id: crypto.randomUUID(), tender_id: id, specialty_name: s.specialty_name, contact_id: s.contact_id || null })));
      await tenantScopedFrom(supabaseAdmin, tenantId, 'milestones').delete().eq('tender_id', id);
      if (milestones_list?.length) await tenantScopedFrom(supabaseAdmin, tenantId, 'milestones').insert(milestones_list.map((m: any) => ({ id: crypto.randomUUID(), tender_id: id, title: m.title, due_date: m.due_date, completed: !!m.completed })));
      const { data } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tenders').select('*, tender_specialties(*)').eq('id', id).single();
      res.json({ ...(data || {}), specialties_list: (data as any)?.tender_specialties || [] });
    } catch (e: any) { captureWithContext(e, { route: 'PUT /api/tenders/:id', tenantId, userId: req.user?.id }); res.status(500).json({ error: "Failed to update tender: " + e.message }); }
  });
}
