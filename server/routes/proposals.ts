// Phase 7 extraction — moved out of server.ts's inline Proposals section
// (the last domain of the deliberately-deferred core, alongside Invoices).
// getNextDocNumber (auto-numbering, shared with notesHonoraires.ts and the
// new invoices.ts) is injected the same way notesHonoraires.ts already
// receives it — see server/getNextDocNumber.ts.
import type { Express } from 'express';
import { proposalToXml, xmlToProposal } from '../../src/lib/xmlHelper';
import { validateBody } from '../../src/lib/validateRequest';
import { proposalSchema } from '../../src/schemas/proposal.schema';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  getUserName: (tenantId: string, userId: string, email?: string) => Promise<string>;
  logActivity: (tenantId: string, userId: string, userName: string, action: string, target: string, targetId: string, targetType: string, category: string) => void;
  captureWithContext: (error: any, context: Record<string, any>) => void;
  getNextDocNumber: (tenantId: string, settingCol: string, countTable: string, defaultPrefix: string) => Promise<string>;
  upload: any;
}

export function registerProposalRoutes(app: Express, { supabaseAdmin, getTenantId, getUserName, logActivity, captureWithContext, getNextDocNumber, upload }: RouteDeps) {
  app.get("/api/proposals", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: proposals, error } = await supabaseAdmin.from('proposals').select('*, proposal_specialties(*), contacts(first_name, last_name)').eq('tenant_id', tenantId).order('created_at', { ascending: false });
      if (error) throw error;
      const result = (proposals || []).map((p: any) => {
        const contact = p.contacts;
        const client_name = contact ? `${contact.first_name || ''} ${contact.last_name || ''}`.trim() : '';
        const { contacts: _c, ...rest } = p;
        return { ...rest, client_name, specialties_list: p.proposal_specialties || [] };
      });
      res.json(result);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to fetch proposals" }); }
  });

  app.post("/api/proposals", validateBody(proposalSchema), async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const p = req.body;
      const id = p.id || crypto.randomUUID();
      const created_at = new Date().toISOString();
      const { specialties_list, client_name: _cn, construction_cost_num: _ccn, ...proposalData } = p;
      // Auto-generate readable reference if not provided
      if (!proposalData.reference) {
        proposalData.reference = await getNextDocNumber(tenantId, 'num_prefix_devis', 'proposals', 'DEVIS');
      }
      const { error: insErr } = await supabaseAdmin.from('proposals').insert({ ...proposalData, id, tenant_id: tenantId, created_at, amount: p.amount || 0, status: p.status || 'Draft' });
      if (insErr) throw insErr;
      if (specialties_list && Array.isArray(specialties_list)) {
        const specs = specialties_list.map((spec: any) => ({ id: crypto.randomUUID(), proposal_id: id, tenant_id: tenantId, specialty_name: spec.specialty_name, contact_id: spec.contact_id || null }));
        if (specs.length > 0) { const { error: specErr } = await supabaseAdmin.from('proposal_specialties').insert(specs); if (specErr) throw specErr; }
      }
      const { data: proposal } = await supabaseAdmin.from('proposals').select('*, proposal_specialties(*), contacts(first_name, last_name)').eq('id', id).single();
      const contact = (proposal as any)?.contacts;
      const client_name = contact ? `${contact.first_name || ''} ${contact.last_name || ''}`.trim() : '';
      const { contacts: _c, ...rest } = (proposal as any) || {};
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Création du devis "${proposalData.reference}"`, client_name, id, 'proposal', 'Devis');
      res.status(201).json({ ...rest, client_name, specialties_list: (proposal as any)?.proposal_specialties || [] });
    } catch (error: any) {
      console.error("Error creating proposal:", error);
      res.status(500).json({ error: "Failed to create proposal: " + error.message });
    }
  });

  app.put("/api/proposals/:id", validateBody(proposalSchema), async (req: any, res: any) => {
    let tenantId: string | undefined;
    try {
      tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const p = req.body;

      // Fetch old proposal to check status transition
      const { data: oldProposal } = await supabaseAdmin.from('proposals').select('status').eq('id', id).eq('tenant_id', tenantId).single();

      const { specialties_list, proposal_specialties: _ps, id: _pid, tenant_id: _tid, created_at: _ca, client_name: _cn, construction_cost_num: _ccn2, ...updateData } = p;
      const { error: updErr } = await supabaseAdmin.from('proposals').update(updateData).eq('id', id).eq('tenant_id', tenantId);
      if (updErr) throw updErr;

      // Update specialties: delete + reinsert
      await supabaseAdmin.from('proposal_specialties').delete().eq('proposal_id', id).eq('tenant_id', tenantId);
      if (specialties_list && Array.isArray(specialties_list) && specialties_list.length > 0) {
        const specs = specialties_list.map((spec: any) => ({ id: spec.id || crypto.randomUUID(), proposal_id: id, tenant_id: tenantId, specialty_name: spec.specialty_name, contact_id: spec.contact_id || null }));
        const { error: specErr } = await supabaseAdmin.from('proposal_specialties').insert(specs);
        if (specErr) throw specErr;
      }

      // If status changed to Accepted, create a project
      if (p.status === 'Accepted' && oldProposal?.status !== 'Accepted') {
        const projectId = crypto.randomUUID();
        let clientName = 'Unknown Client';
        if (p.client_id) {
          const { data: clientData } = await supabaseAdmin.from('contacts').select('first_name, last_name').eq('id', p.client_id).eq('tenant_id', tenantId).single();
          if (clientData) clientName = `${clientData.first_name || ''} ${clientData.last_name || ''}`.trim();
        }
        const { error: projErr } = await supabaseAdmin.from('projects').insert({
          id: projectId, tenant_id: tenantId,
          name: p.title, client: clientName, status: 'Planning', budget: p.amount, description: p.description,
          start_date: new Date().toISOString().split('T')[0],
          end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          address: p.adresse_terrain ? `${p.adresse_terrain}, ${p.cp_ville_terrain || ''}` : '',
          reference: p.reference, projet_detail: p.projet_detail, is_entreprise: p.is_entreprise,
          nom_societe: p.nom_societe, rcs: p.rcs, representant: p.representant, qualite: p.qualite,
          adresse_client: p.adresse_client, cp_client: p.cp_client, ville_client: p.ville_client,
          telephone: p.telephone, portable: p.portable, email_client: p.email_client,
          adresse_terrain: p.adresse_terrain, cp_ville_terrain: p.cp_ville_terrain,
          ban_id_terrain: p.ban_id_terrain, city_code_terrain: p.city_code_terrain,
          ref_cadastrale: p.ref_cadastrale, zone_plu: p.zone_plu, surface_parcelle: p.surface_parcelle,
          nom_etablissement: p.nom_etablissement, avant_trav: p.avant_trav, apres_trav: p.apres_trav,
          type_et_cat: p.type_et_cat, type_projet: p.type_projet, categorie_projet: p.categorie_projet,
          surface_plancher: p.surface_plancher, surface_plancher_ext: p.surface_plancher_ext,
          surface_erp: p.surface_erp, surface_ert: p.surface_ert,
          effectif_public: p.effectif_public, effectif_personnel: p.effectif_personnel,
          ind: p.ind, date_modification: p.date_modification,
          maf_intercalaire: p.maf_intercalaire, taux_mission: p.taux_mission, part_interet: p.part_interet
        });
        if (projErr) throw projErr;
        // Copy specialties to cotraitants
        if (specialties_list && Array.isArray(specialties_list) && specialties_list.length > 0) {
          const cots = specialties_list.map((spec: any) => ({ id: crypto.randomUUID(), project_id: projectId, tenant_id: tenantId, specialty: spec.specialty_name, contact_id: spec.contact_id || null }));
          await supabaseAdmin.from('project_cotraitants').insert(cots);
        }

        // Copy the fee-distribution mission breakdown into a new draft ContratMOE,
        // so the project's HONOS tab has real mission %/cotraitant data instead of
        // starting empty (fee_distribution otherwise stays orphaned on the proposal).
        try {
          const feeData = p.fee_distribution ? JSON.parse(p.fee_distribution) : null;
          const missions: any[] = feeData?.missions || [];
          if (missions.length > 0) {
            const totalBaseAmount = missions
              .filter((m: any) => m.category === 'Mission base')
              .reduce((acc: number, m: any) => acc + (m.amount || 0), 0);
            const missions_list = missions.map((m: any) => ({
              id: m.id, name: m.name, incluse: true,
              pct: totalBaseAmount > 0 ? (m.amount || 0) / totalBaseAmount * 100 : 0,
            }));
            const totalHonoraires = p.amount || totalBaseAmount || 1;
            const cotraitants = (specialties_list || []).map((spec: any) => {
              const montant_honoraires = missions.reduce((acc: number, m: any) =>
                acc + (m.amount || 0) * ((m.percentages?.[spec.contact_id] || 0) / 100), 0);
              return {
                id: crypto.randomUUID(), contact_id: spec.contact_id || null, contact_name: spec.contact_name || null,
                specialty: spec.specialty_name, montant_honoraires, fee_pct: montant_honoraires / totalHonoraires * 100,
              };
            });
            await supabaseAdmin.from('contrats_moe').insert({
              id: crypto.randomUUID(), tenant_id: tenantId, project_id: projectId,
              client_id: p.client_id || null, intitule_projet: p.title,
              type_contrat: 'construction_neuve', type_moa: 'prive', status: 'Brouillon',
              mode_honoraires: 'forfait', montant_honoraires: p.amount || null,
              missions_list, cotraitants,
            });
          }
        } catch (err) {
          console.error('Failed to auto-create ContratMOE from accepted proposal:', err);
        }
      }

      const { data: proposal } = await supabaseAdmin.from('proposals').select('*, proposal_specialties(*), contacts(first_name, last_name)').eq('id', id).eq('tenant_id', tenantId).single();
      const contact = (proposal as any)?.contacts;
      const client_name = contact ? `${contact.first_name || ''} ${contact.last_name || ''}`.trim() : '';
      const { contacts: _c, ...rest } = (proposal as any) || {};
      res.json({ ...rest, client_name, specialties_list: (proposal as any)?.proposal_specialties || [] });
    } catch (error: any) {
      captureWithContext(error, { route: 'PUT /api/proposals/:id', tenantId, userId: req.user?.id });
      res.status(500).json({ error: "Failed to update proposal: " + error.message });
    }
  });

  app.delete("/api/proposals/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { data: proposal } = await supabaseAdmin.from('proposals').select('title, status').eq('id', id).eq('tenant_id', tenantId).maybeSingle();
      if ((proposal as any)?.status !== 'Draft') {
        return res.status(400).json({ error: "Seuls les devis en brouillon peuvent être supprimés. Rejetez ce devis à la place." });
      }
      await supabaseAdmin.from('proposal_specialties').delete().eq('proposal_id', id).eq('tenant_id', tenantId);
      const { error } = await supabaseAdmin.from('proposals').delete().eq('id', id).eq('tenant_id', tenantId);
      if (error) throw error;
      const title = (proposal as any)?.title || '';
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Suppression du devis "${title}"`, title, id, 'proposal', 'Devis');
      res.json({ success: true });
    } catch (e: any) {
      console.error("Error deleting proposal:", e);
      res.status(500).json({ error: "Failed to delete proposal: " + e.message });
    }
  });

  app.get("/api/proposals/:id/export", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: proposal, error } = await supabaseAdmin.from('proposals').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).single();
      if (error || !proposal) return res.status(404).json({ error: "Proposal not found" });
      const xml = proposalToXml(proposal);
      res.setHeader("Content-Type", "application/xml");
      res.setHeader("Content-Disposition", `attachment; filename=proposal_${(proposal as any).id}.xml`);
      res.send(xml);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to export proposal" }); }
  });

  app.post("/api/proposals/import", upload.single("file"), async (req: any, res: any) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      const tenantId = await getTenantId(req.user.id);
      const xml = req.file.buffer.toString('utf-8');
      const proposalData = xmlToProposal(xml);
      const id = crypto.randomUUID();
      const created_at = new Date().toISOString();
      const { error } = await supabaseAdmin.from('proposals').insert({ id, tenant_id: tenantId, title: proposalData.title || 'Imported Proposal', description: proposalData.description || '', created_at, status: 'Draft' });
      if (error) throw error;
      res.json({ success: true, id });
    } catch (error: any) {
      console.error("Error importing proposal:", error);
      res.status(500).json({ error: "Failed to import proposal: " + error.message });
    }
  });
}
