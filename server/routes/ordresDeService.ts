// Phase 7 extraction — moved out of server.ts's "OS Routes" section (ordres
// de service / work orders). First domain of the newly-scoped "suivi de
// chantier" cluster (site tracking: OS, Visas, Receptions, Reserves, GPA
// reserves, Permits, RFIs) — small, similar-shaped CRUD tables, previously
// left off every prior bilan's "remaining" list by oversight rather than
// deliberate deferral.
import type { Express } from 'express';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  getUserName: (tenantId: string, userId: string, email?: string) => Promise<string>;
  logActivity: (tenantId: string, userId: string, userName: string, action: string, target: string, targetId: string, targetType: string, category: string) => void;
}

export function registerOrdresDeServiceRoutes(app: Express, { supabaseAdmin, getTenantId, getUserName, logActivity }: RouteDeps) {
  app.get("/api/ordres_de_service", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { project_id } = req.query;
      const query = supabaseAdmin.from('ordres_de_service').select('*').eq('tenant_id', tenantId);
      if (project_id) query.eq('project_id', project_id as string);
      const { data, error } = await query;
      if (error) throw error;
      res.json(data);
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: "Failed to fetch OS" });
    }
  });

  app.post("/api/ordres_de_service", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const {
        project_id, os_number, march_number, title, date, description, lot, status, type,
        maitrise_oeuvre_adresse, entreprise, origine_demande, montant_marche_ht, objet,
        date_fourniture, article_ccap, incidences_delais_type, incidences_delais_details,
        incidences_couts_type, montant_devis_presente, montant_devis_accepte, date_signature
      } = req.body || {};
      const id = crypto.randomUUID();
      const { data, error } = await supabaseAdmin.from('ordres_de_service').insert({
        id, tenant_id: tenantId, project_id, os_number, march_number, title, date, description, lot,
        status: status || 'draft', type: type || 'travaux',
        maitrise_oeuvre_adresse, entreprise, origine_demande, montant_marche_ht, objet,
        date_fourniture, article_ccap, incidences_delais_type, incidences_delais_details,
        incidences_couts_type, montant_devis_presente, montant_devis_accepte, date_signature
      }).select().single();
      if (error) throw error;
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Création de l'ordre de service "${title || os_number}"`, title || os_number || '', id, 'ordre_de_service', 'Ordres de service');
      res.status(201).json(data);
    } catch (e: any) {
      console.error("Error creating OS:", e);
      res.status(500).json({ error: "Failed to create OS", details: e.message });
    }
  });

  app.put("/api/ordres_de_service/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const {
        os_number, march_number, title, date, description, lot, status, type,
        maitrise_oeuvre_adresse, entreprise, origine_demande, montant_marche_ht, objet,
        date_fourniture, article_ccap, incidences_delais_type, incidences_delais_details,
        incidences_couts_type, montant_devis_presente, montant_devis_accepte, date_signature,
        date_emission, date_ar, date_execution, emetteur_os, destinataire_os, notes_ar,
        delai_execution, delai_unit
      } = req.body;
      const { error } = await supabaseAdmin.from('ordres_de_service').update({
        os_number, march_number, title, date, description, lot, status, type: type || 'travaux',
        maitrise_oeuvre_adresse, entreprise, origine_demande, montant_marche_ht, objet,
        date_fourniture, article_ccap, incidences_delais_type, incidences_delais_details,
        incidences_couts_type, montant_devis_presente, montant_devis_accepte, date_signature,
        date_emission, date_ar, date_execution, emetteur_os, destinataire_os, notes_ar,
        delai_execution, delai_unit
      }).eq('id', id).eq('tenant_id', tenantId);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: "Failed to update OS" });
    }
  });

  app.delete("/api/ordres_de_service/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { data: os } = await supabaseAdmin.from('ordres_de_service').select('title, os_number').eq('id', id).eq('tenant_id', tenantId).maybeSingle();
      const { error } = await supabaseAdmin.from('ordres_de_service').delete().eq('id', id).eq('tenant_id', tenantId);
      if (error) throw error;
      const label = (os as any)?.title || (os as any)?.os_number || '';
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Suppression de l'ordre de service "${label}"`, label, id, 'ordre_de_service', 'Ordres de service');
      res.json({ success: true });
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: "Failed to delete OS" });
    }
  });

  // PATCH status transition for OS
  app.patch("/api/ordres_de_service/:id/status", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { status, date_ar, date_execution, notes_ar } = req.body;
      const validStatuses = ['draft', 'submitted', 'approved', 'rejected'];
      if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });
      const updateData: any = { status };
      if (status === 'submitted') updateData.date_emission = new Date().toISOString().split('T')[0];
      if (date_ar) updateData.date_ar = date_ar;
      if (date_execution) updateData.date_execution = date_execution;
      if (notes_ar) updateData.notes_ar = notes_ar;
      const { data: os } = await supabaseAdmin.from('ordres_de_service').select('title, os_number').eq('id', id).eq('tenant_id', tenantId).maybeSingle();
      const { error } = await supabaseAdmin.from('ordres_de_service').update(updateData).eq('id', id).eq('tenant_id', tenantId);
      if (error) throw error;
      const label = (os as any)?.title || (os as any)?.os_number || '';
      const STATUS_LABELS: Record<string, string> = { draft: 'brouillon', submitted: 'soumis', approved: 'approuvé', rejected: 'rejeté' };
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Ordre de service "${label}" marqué ${STATUS_LABELS[status] || status}`, label, id, 'ordre_de_service', 'Ordres de service');
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(500).json({ error: e.message }); }
  });

  // GET next OS number for a project
  app.get("/api/ordres_de_service/next-number", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { project_id } = req.query;
      const query = supabaseAdmin.from('ordres_de_service').select('os_number').eq('tenant_id', tenantId);
      if (project_id) (query as any).eq('project_id', project_id as string);
      const { data } = await query;
      const nums = (data || []).map((r: any) => parseInt(r.os_number) || 0);
      const next = nums.length > 0 ? Math.max(...nums) + 1 : 1;
      res.json({ next: String(next).padStart(3, '0') });
    } catch (e: any) {
      console.error("[GET /api/ordres_de_service/next-number]", e); res.status(500).json({ error: e.message }); }
  });
}
