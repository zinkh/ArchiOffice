// Phase 7 extraction — moved out of server.ts's inline Tenders CRUD section
// (just above "--- Veille RSS des appels d'offres ---", which now lives in
// server/routes/tenderRss.ts). Tenders (appels d'offres) is a standalone
// CRM-like domain, not part of the invoices/proposals/auth/billing group
// deliberately deferred to last.
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';
import { assertTenantEntity } from '../assertTenantEntity';

async function assertSpecialtyContacts(supabaseAdmin: any, tenantId: string, specialties: any[] | undefined): Promise<boolean> {
  for (const s of specialties || []) {
    if (s?.contact_id && !(await assertTenantEntity(supabaseAdmin, 'contacts', s.contact_id, tenantId))) return false;
  }
  return true;
}

// Même contrôle que assertSpecialtyContacts, pour les membres du groupement
// retenu (server/routes/tenders.ts, tender_groupement_membres) — un
// contact_id fourni dans le corps de la requête doit appartenir au cabinet.
async function assertGroupementContacts(supabaseAdmin: any, tenantId: string, membres: any[] | undefined): Promise<boolean> {
  for (const m of membres || []) {
    if (m?.contact_id && !(await assertTenantEntity(supabaseAdmin, 'contacts', m.contact_id, tenantId))) return false;
  }
  return true;
}

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
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tenders').select('*, tender_specialties(*), tender_evaluation_criteria(*), tender_groupement_membres(*)').eq('id', id).single();
      if (error || !data) return res.status(404).json({ error: "Tender not found" });
      const criteria = ((data as any).tender_evaluation_criteria || []).slice().sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0));
      const groupement = ((data as any).tender_groupement_membres || []).slice().sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0));
      res.json({ ...data, specialties_list: (data as any).tender_specialties || [], evaluation_criteria_list: criteria, groupement_retenu_list: groupement });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to fetch tender" }); }
  });

  app.post("/api/tenders", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { title, client, submission_deadline, status, value, notes, description, mandataire_id, type, surface, construction_cost, honoraires_percent, complexity_rate, base_fee_percent, miqcp_assessment, mandatory_visit, visit_date, withdrawal_deadline, archived, specialties_list, milestones_list, evaluation_criteria_list, ville_execution, enveloppe_previsionnelle, groupement_retenu_list, honoraires_retenus_montant, fee_distribution, vat_rate, decimal_precision, exclusivite } = req.body;
      if (mandataire_id && !(await assertTenantEntity(supabaseAdmin, 'contacts', mandataire_id, tenantId))) {
        return res.status(400).json({ error: "Mandataire introuvable pour ce cabinet." });
      }
      if (!(await assertSpecialtyContacts(supabaseAdmin, tenantId, specialties_list))) {
        return res.status(400).json({ error: "Contact de spécialité introuvable pour ce cabinet." });
      }
      if (!(await assertGroupementContacts(supabaseAdmin, tenantId, groupement_retenu_list))) {
        return res.status(400).json({ error: "Contact du groupement retenu introuvable pour ce cabinet." });
      }
      const id = crypto.randomUUID();
      const { error: te } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tenders').insert({ id, title, client, submission_deadline, status: status || 'Draft', value: value || 0, notes: notes || '', description: description || null, mandataire_id: mandataire_id || null, type, surface: surface || 0, construction_cost: construction_cost || 0, honoraires_percent: honoraires_percent || 0, complexity_rate: complexity_rate ?? null, base_fee_percent: base_fee_percent ?? null, miqcp_assessment: miqcp_assessment || null, mandatory_visit: !!mandatory_visit, visit_date: visit_date || null, withdrawal_deadline: withdrawal_deadline || null, archived: !!archived, ville_execution: ville_execution || null, enveloppe_previsionnelle: enveloppe_previsionnelle ?? null, honoraires_retenus_montant: honoraires_retenus_montant ?? null, fee_distribution: fee_distribution || null, vat_rate: vat_rate ?? 20, decimal_precision: decimal_precision ?? 2, exclusivite: exclusivite || null });
      if (te) throw te;
      if (specialties_list?.length) await tenantScopedFrom(supabaseAdmin, tenantId, 'tender_specialties').insert(specialties_list.map((s: any) => ({ id: crypto.randomUUID(), tender_id: id, specialty_name: s.specialty_name, contact_id: s.contact_id || null })));
      if (milestones_list?.length) await tenantScopedFrom(supabaseAdmin, tenantId, 'milestones').insert(milestones_list.map((m: any) => ({ id: crypto.randomUUID(), tender_id: id, title: m.title, due_date: m.due_date, completed: !!m.completed })));
      if (evaluation_criteria_list?.length) await tenantScopedFrom(supabaseAdmin, tenantId, 'tender_evaluation_criteria').insert(evaluation_criteria_list.map((c: any, i: number) => ({ id: crypto.randomUUID(), tender_id: id, label: c.label, weight_pct: c.weight_pct || 0, sort_order: i })));
      if (groupement_retenu_list?.length) await tenantScopedFrom(supabaseAdmin, tenantId, 'tender_groupement_membres').insert(groupement_retenu_list.map((m: any, i: number) => ({ id: crypto.randomUUID(), tender_id: id, role: m.role, contact_id: m.contact_id || null, name: m.name || null, sort_order: i })));
      const { data } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tenders').select('*, tender_specialties(*), tender_evaluation_criteria(*), tender_groupement_membres(*)').eq('id', id).single();
      // Log activity
      const userNameTndr = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userNameTndr, `Nouvel appel d'offres "${title}"`, title, id, 'tender', 'Appels d\'offres');
      res.status(201).json({ ...(data || {}), specialties_list: (data as any)?.tender_specialties || [], evaluation_criteria_list: (data as any)?.tender_evaluation_criteria || [], groupement_retenu_list: (data as any)?.tender_groupement_membres || [] });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to create tender: " + e.message }); }
  });

  app.delete("/api/tenders/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { data: tender } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tenders').select('title').eq('id', id).maybeSingle();
      await tenantScopedFrom(supabaseAdmin, tenantId, 'tender_specialties').delete().eq('tender_id', id);
      await tenantScopedFrom(supabaseAdmin, tenantId, 'milestones').delete().eq('tender_id', id);
      await tenantScopedFrom(supabaseAdmin, tenantId, 'tender_evaluation_criteria').delete().eq('tender_id', id);
      await tenantScopedFrom(supabaseAdmin, tenantId, 'tender_groupement_membres').delete().eq('tender_id', id);
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
      const { title, client, submission_deadline, status, value, notes, description, mandataire_id, type, surface, construction_cost, honoraires_percent, complexity_rate, base_fee_percent, miqcp_assessment, mandatory_visit, visit_date, withdrawal_deadline, archived, specialties_list, milestones_list, evaluation_criteria_list, ville_execution, enveloppe_previsionnelle, groupement_retenu_list, honoraires_retenus_montant, fee_distribution, vat_rate, decimal_precision, exclusivite } = req.body;
      if (mandataire_id && !(await assertTenantEntity(supabaseAdmin, 'contacts', mandataire_id, tenantId))) {
        return res.status(400).json({ error: "Mandataire introuvable pour ce cabinet." });
      }
      if (!(await assertSpecialtyContacts(supabaseAdmin, tenantId, specialties_list))) {
        return res.status(400).json({ error: "Contact de spécialité introuvable pour ce cabinet." });
      }
      if (!(await assertGroupementContacts(supabaseAdmin, tenantId, groupement_retenu_list))) {
        return res.status(400).json({ error: "Contact du groupement retenu introuvable pour ce cabinet." });
      }
      const { error: ue } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tenders').update({ title, client, submission_deadline, status, value: value || 0, notes: notes || '', description: description ?? null, mandataire_id: mandataire_id || null, type, surface: surface || 0, construction_cost: construction_cost || 0, honoraires_percent: honoraires_percent || 0, complexity_rate: complexity_rate ?? null, base_fee_percent: base_fee_percent ?? null, miqcp_assessment: miqcp_assessment || null, mandatory_visit: !!mandatory_visit, visit_date: visit_date || null, withdrawal_deadline: withdrawal_deadline || null, archived: !!archived, ville_execution: ville_execution || null, enveloppe_previsionnelle: enveloppe_previsionnelle ?? null, honoraires_retenus_montant: honoraires_retenus_montant ?? null, fee_distribution: fee_distribution ?? null, vat_rate: vat_rate ?? 20, decimal_precision: decimal_precision ?? 2, exclusivite: exclusivite || null }).eq('id', id);
      if (ue) throw ue;
      await tenantScopedFrom(supabaseAdmin, tenantId, 'tender_specialties').delete().eq('tender_id', id);
      if (specialties_list?.length) await tenantScopedFrom(supabaseAdmin, tenantId, 'tender_specialties').insert(specialties_list.map((s: any) => ({ id: crypto.randomUUID(), tender_id: id, specialty_name: s.specialty_name, contact_id: s.contact_id || null })));
      await tenantScopedFrom(supabaseAdmin, tenantId, 'milestones').delete().eq('tender_id', id);
      if (milestones_list?.length) await tenantScopedFrom(supabaseAdmin, tenantId, 'milestones').insert(milestones_list.map((m: any) => ({ id: crypto.randomUUID(), tender_id: id, title: m.title, due_date: m.due_date, completed: !!m.completed })));
      if (evaluation_criteria_list !== undefined) {
        await tenantScopedFrom(supabaseAdmin, tenantId, 'tender_evaluation_criteria').delete().eq('tender_id', id);
        if (evaluation_criteria_list?.length) await tenantScopedFrom(supabaseAdmin, tenantId, 'tender_evaluation_criteria').insert(evaluation_criteria_list.map((c: any, i: number) => ({ id: crypto.randomUUID(), tender_id: id, label: c.label, weight_pct: c.weight_pct || 0, sort_order: i })));
      }
      if (groupement_retenu_list !== undefined) {
        await tenantScopedFrom(supabaseAdmin, tenantId, 'tender_groupement_membres').delete().eq('tender_id', id);
        if (groupement_retenu_list?.length) await tenantScopedFrom(supabaseAdmin, tenantId, 'tender_groupement_membres').insert(groupement_retenu_list.map((m: any, i: number) => ({ id: crypto.randomUUID(), tender_id: id, role: m.role, contact_id: m.contact_id || null, name: m.name || null, sort_order: i })));
      }
      const { data } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tenders').select('*, tender_specialties(*), tender_evaluation_criteria(*), tender_groupement_membres(*)').eq('id', id).single();
      const criteria = ((data as any)?.tender_evaluation_criteria || []).slice().sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0));
      const groupement = ((data as any)?.tender_groupement_membres || []).slice().sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0));
      res.json({ ...(data || {}), specialties_list: (data as any)?.tender_specialties || [], evaluation_criteria_list: criteria, groupement_retenu_list: groupement });
    } catch (e: any) { captureWithContext(e, { route: 'PUT /api/tenders/:id', tenantId, userId: req.user?.id }); res.status(500).json({ error: "Failed to update tender: " + e.message }); }
  });

  // Candidatures similaires : d'autres affaires du cabinet dont le résultat
  // (groupement retenu) est connu, retrouvées par type de procédure ou par
  // spécialité commune — affiché dans l'analyse concurrentielle de l'onglet
  // Aperçu (src/pages/TenderDetail.tsx). Le rapprochement se fait en mémoire
  // (specialties et membres du groupement joints séparément) plutôt que via
  // un embed PostgREST, pour rester simple sur un nombre d'affaires par
  // cabinet toujours modeste.
  app.get("/api/tenders/:id/candidatures-similaires", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { data: tender } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tenders').select('id, type').eq('id', id).maybeSingle();
      if (!tender) return res.status(404).json({ error: "Appel d'offres introuvable." });

      const { data: ownSpecialties } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tender_specialties').select('specialty_name').eq('tender_id', id);
      const ownSpecialtyNames = new Set((ownSpecialties || []).map((s: any) => (s.specialty_name || '').trim().toLowerCase()).filter(Boolean));

      // Une affaire n'a un résultat connu que si elle porte au moins un
      // membre de groupement retenu — le champ unique entreprise_retenue
      // (filtrable en un .not(...is.null)) a été remplacé par cette table.
      const { data: allGroupementRows } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tender_groupement_membres').select('tender_id, role, contact_id, name, sort_order');
      const groupementByTender = new Map<string, any[]>();
      for (const m of (allGroupementRows || []) as any[]) {
        if (m.tender_id === id) continue;
        if (!groupementByTender.has(m.tender_id)) groupementByTender.set(m.tender_id, []);
        groupementByTender.get(m.tender_id)!.push(m);
      }
      const resultTenderIds = [...groupementByTender.keys()];
      if (resultTenderIds.length === 0) return res.json([]);

      const { data: candidates } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tenders')
        .select('id, title, client, type, honoraires_retenus_montant, enveloppe_previsionnelle, submission_deadline')
        .in('id', resultTenderIds);
      const candidateList = (candidates || []) as any[];

      const { data: candidateSpecialties } = candidateList.length
        ? await tenantScopedFrom(supabaseAdmin, tenantId, 'tender_specialties').select('tender_id, specialty_name').in('tender_id', candidateList.map(c => c.id))
        : { data: [] as any[] };
      const specialtiesByTender = new Map<string, Set<string>>();
      for (const s of (candidateSpecialties || []) as any[]) {
        const key = (s.specialty_name || '').trim().toLowerCase();
        if (!key) continue;
        if (!specialtiesByTender.has(s.tender_id)) specialtiesByTender.set(s.tender_id, new Set());
        specialtiesByTender.get(s.tender_id)!.add(key);
      }

      const similar = candidateList
        .filter(c => {
          const sameType = !!tender.type && !!c.type && String(c.type).toLowerCase() === String(tender.type).toLowerCase();
          const sharedSpecialty = ownSpecialtyNames.size > 0 && [...(specialtiesByTender.get(c.id) || [])].some(name => ownSpecialtyNames.has(name));
          return sameType || sharedSpecialty;
        })
        .sort((a, b) => String(b.submission_deadline || '').localeCompare(String(a.submission_deadline || '')))
        .slice(0, 10)
        .map(c => ({
          id: c.id, title: c.title, client: c.client, type: c.type,
          honoraires_retenus_montant: c.honoraires_retenus_montant, enveloppe_previsionnelle: c.enveloppe_previsionnelle,
          submission_deadline: c.submission_deadline,
          groupement_retenu_list: (groupementByTender.get(c.id) || []).slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)),
        }));

      res.json(similar);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to fetch similar tenders" }); }
  });
}
