// Avenants au contrat de maîtrise d'œuvre — distincts des ordres de service
// (server/routes/ordresDeService.ts), qui eux s'adressent à une entreprise
// sur un marché de travaux. Un avenant MOE modifie le contrat de l'agence
// elle-même (contrats_moe) : montant des honoraires, délais, mission. Voir
// supabase/migrate_avenants_moe.sql pour l'historique de la séparation.
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  getUserName: (tenantId: string, userId: string, email?: string) => Promise<string>;
  logActivity: (tenantId: string, userId: string, userName: string, action: string, target: string, targetId: string, targetType: string, category: string) => void;
}

export function registerAvenantsMoeRoutes(app: Express, { supabaseAdmin, getTenantId, getUserName, logActivity }: RouteDeps) {
  app.get("/api/avenants_moe", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { project_id, contrat_moe_id } = req.query;
      let query = tenantScopedFrom(supabaseAdmin, tenantId, 'avenants_moe').select('*').order('date', { ascending: true });
      if (project_id) query = query.eq('project_id', project_id as string);
      if (contrat_moe_id) query = query.eq('contrat_moe_id', contrat_moe_id as string);
      const { data, error } = await query;
      if (error) throw error;
      res.json(data || []);
    } catch (e: any) {
      console.error(e); res.status(500).json({ error: "Failed to fetch avenants MOE" });
    }
  });

  app.post("/api/avenants_moe", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const {
        project_id, contrat_moe_id, os_number, title, date, description, status,
        origine_demande, objet, date_signature, incidences_delais_type, incidences_delais_details,
        delai_execution, montant_devis_presente, montant_devis_accepte,
      } = req.body || {};
      if (!contrat_moe_id) return res.status(400).json({ error: "Un avenant doit être rattaché à un contrat MOE (contrat_moe_id)." });
      const id = crypto.randomUUID();
      const { data, error } = await supabaseAdmin.from('avenants_moe').insert({
        id, tenant_id: tenantId, project_id, contrat_moe_id, os_number, title,
        date: date || new Date().toISOString().split('T')[0], description,
        status: status || 'draft', origine_demande, objet, date_signature,
        incidences_delais_type, incidences_delais_details,
        delai_execution: delai_execution ? Number(delai_execution) : null,
        montant_devis_presente: montant_devis_presente != null ? Number(montant_devis_presente) : null,
        montant_devis_accepte: montant_devis_accepte != null ? Number(montant_devis_accepte) : null,
      }).select().single();
      if (error) throw error;
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Création de l'avenant "${title || os_number}"`, title || os_number || '', id, 'avenant_moe', 'Avenants MOE');
      res.status(201).json(data);
    } catch (e: any) {
      console.error("Error creating avenant MOE:", e); res.status(500).json({ error: "Failed to create avenant MOE: " + e.message });
    }
  });

  app.put("/api/avenants_moe/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const {
        os_number, title, date, description, status, origine_demande, objet, date_signature,
        incidences_delais_type, incidences_delais_details, delai_execution,
        montant_devis_presente, montant_devis_accepte,
      } = req.body || {};
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'avenants_moe').update({
        os_number, title, date, description, status, origine_demande, objet, date_signature,
        incidences_delais_type, incidences_delais_details,
        delai_execution: delai_execution ? Number(delai_execution) : null,
        montant_devis_presente: montant_devis_presente != null ? Number(montant_devis_presente) : null,
        montant_devis_accepte: montant_devis_accepte != null ? Number(montant_devis_accepte) : null,
      }).eq('id', id);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) {
      console.error(e); res.status(500).json({ error: "Failed to update avenant MOE" });
    }
  });

  app.patch("/api/avenants_moe/:id/status", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { status, montant_devis_accepte } = req.body || {};
      const validStatuses = ['draft', 'submitted', 'approved', 'rejected'];
      if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status' });
      const updateData: any = { status };
      if (montant_devis_accepte != null) updateData.montant_devis_accepte = Number(montant_devis_accepte);
      const { data: avenant } = await tenantScopedFrom(supabaseAdmin, tenantId, 'avenants_moe').select('title, os_number').eq('id', id).maybeSingle();
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'avenants_moe').update(updateData).eq('id', id);
      if (error) throw error;
      const label = (avenant as any)?.title || (avenant as any)?.os_number || '';
      const STATUS_LABELS: Record<string, string> = { draft: 'brouillon', submitted: 'soumis', approved: 'approuvé', rejected: 'rejeté' };
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Avenant "${label}" marqué ${STATUS_LABELS[status] || status}`, label, id, 'avenant_moe', 'Avenants MOE');
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/avenants_moe/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: avenant } = await tenantScopedFrom(supabaseAdmin, tenantId, 'avenants_moe').select('title, os_number').eq('id', req.params.id).maybeSingle();
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'avenants_moe').delete().eq('id', req.params.id);
      if (error) throw error;
      const label = (avenant as any)?.title || (avenant as any)?.os_number || '';
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Suppression de l'avenant "${label}"`, label, req.params.id, 'avenant_moe', 'Avenants MOE');
      res.json({ success: true });
    } catch (e: any) {
      console.error(e); res.status(500).json({ error: "Failed to delete avenant MOE" });
    }
  });
}
