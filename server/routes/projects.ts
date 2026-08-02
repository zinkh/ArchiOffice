// Phase 7 extraction — moved out of server.ts's core Projects CRUD section
// (the most central table in the schema — nearly every other domain
// references a project_id). GET /api/dpgf/:projectId and the two
// GET /api/situations* lookup routes that used to sit in the middle of this
// section moved to dpgf.ts/situations.ts instead (their natural home —
// those modules already own the POST/PUT/DELETE side of the same tables;
// only the read lookups had never been extracted).
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  getUserName: (tenantId: string, userId: string, email?: string) => Promise<string>;
  logActivity: (tenantId: string, userId: string, userName: string, action: string, target: string, targetId: string, targetType: string, category: string) => void;
  checkQuota: (tenantId: string, resource: 'projects' | 'users' | 'documents') => Promise<void>;
  captureWithContext: (error: any, context: Record<string, any>) => void;
  requireRole: (...roles: string[]) => (req: any, res: any, next: any) => Promise<void>;
}

export function registerProjectRoutes(app: Express, { supabaseAdmin, getTenantId, getUserName, logActivity, checkQuota, captureWithContext, requireRole }: RouteDeps) {
  app.get("/api/projects", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await supabaseAdmin
        .from('projects')
        .select('*, project_cotraitants(*), project_lots(*), project_stakeholders(*), project_categories_junction(category_id)')
        .eq('tenant_id', tenantId);
      if (error) throw error;
      const projectsWithDetails = (data || []).map((p: any) => ({
        ...p,
        cotraitants_list: p.project_cotraitants || [],
        lots_list: p.project_lots || [],
        stakeholders_list: p.project_stakeholders || [],
        categories_list: (p.project_categories_junction || []).map((j: any) => j.category_id),
      }));
      res.json(projectsWithDetails);
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: "Failed to fetch projects" });
    }
  });

  app.get("/api/projects/:id/full", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { data: project, error: pe } = await supabaseAdmin.from('projects').select('*').eq('id', id).eq('tenant_id', tenantId).single();
      if (pe || !project) return res.status(404).json({ error: "Project not found" });
      const [milestones, invoices, specifications, ordres_de_service, visas, receptions, reserves, plans] = await Promise.all([
        supabaseAdmin.from('milestones').select('*').eq('project_id', id).eq('tenant_id', tenantId).then((r: any) => r.data || []),
        supabaseAdmin.from('invoices').select('*').eq('project_id', id).eq('tenant_id', tenantId).then((r: any) => r.data || []),
        supabaseAdmin.from('specifications').select('*').eq('project_id', id).eq('tenant_id', tenantId).then((r: any) => r.data || []),
        supabaseAdmin.from('ordres_de_service').select('*').eq('project_id', id).eq('tenant_id', tenantId).then((r: any) => r.data || []),
        supabaseAdmin.from('visas').select('*').eq('project_id', id).eq('tenant_id', tenantId).then((r: any) => r.data || []),
        supabaseAdmin.from('receptions').select('*').eq('project_id', id).eq('tenant_id', tenantId).then((r: any) => r.data || []),
        supabaseAdmin.from('reserves').select('*').eq('project_id', id).eq('tenant_id', tenantId).then((r: any) => r.data || []),
        supabaseAdmin.from('plans').select('*').eq('project_id', id).eq('tenant_id', tenantId).then((r: any) => r.data || []),
      ]);
      res.json({ project, milestones, invoices, specifications, ordres_de_service, visas, receptions, reserves, plans });
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: "Failed to fetch project details" });
    }
  });

  // Project-scoped activity log — powers the "Historique du projet" timeline
  // in the redesigned ProjectDetail overview. Reads the same `activities`
  // rows logActivity(...) already writes for project creation/deletion
  // (below) and phase transitions (projectPhaseHistory.ts).
  app.get("/api/projects/:id/activity", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'activities')
        .select('*')
        .eq('target_id', req.params.id)
        .eq('target_type', 'project')
        .order('created_at', { ascending: false });
      if (error) { res.json([]); return; }
      res.json(data || []);
    } catch (e: any) {
      console.error('[GET /api/projects/:id/activity]', e);
      res.json([]);
    }
  });

  app.post("/api/projects", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      await checkQuota(tenantId, 'projects');
      const {
        id: bodyId, name, client, status, budget, category, start_date, end_date, description, image_url, address,
        is_complete_mission, etudes_notes, chantier_notes, is_public_client, client_siret, client_vat_number,
        surface, construction_cost, remuneration, progression, project_manager, cotraitants, external_intervenants, entreprises,
        cotraitants_list, lots_list, stakeholders_list, categories_list,
        reference, projet_detail, is_entreprise, nom_societe, rcs, representant, qualite,
        adresse_client, cp_client, ville_client, telephone, portable, email_client,
        adresse_terrain, cp_ville_terrain, ban_id_terrain, city_code_terrain, ref_cadastrale, zone_plu, surface_parcelle,
        nom_etablissement, avant_trav, apres_trav, type_et_cat, type_projet,
        categorie_projet, surface_plancher, surface_plancher_ext, surface_erp,
        surface_ert, effectif_public, effectif_personnel, ind, date_modification,
        maf_intercalaire, taux_mission, part_interet, secteur_abf, programme
      } = req.body;
      if (!name || !client) return res.status(400).json({ error: "Name and client are required" });
      // Generate project code — prefixed PREFIX-YEAR-NNN when the tenant configured
      // a num_prefix_affaire (Onboarding wizard / Settings), else the legacy bare YYNNN.
      const { data: affaireSettings } = await supabaseAdmin.from('settings').select('num_prefix_affaire').eq('tenant_id', tenantId).maybeSingle();
      const affairePrefix = (affaireSettings as any)?.num_prefix_affaire?.trim();
      const year = new Date().getFullYear().toString().slice(-2);
      let project_code: string;
      if (affairePrefix) {
        const likePattern = `${affairePrefix}-${year}-%`;
        const { count: countVal } = await supabaseAdmin.from('projects').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId).like('project_code', likePattern).then((r: any) => ({ count: r.count || 0 }));
        project_code = `${affairePrefix}-${year}-${((countVal as number) + 1).toString().padStart(3, '0')}`;
      } else {
        const { count: countVal } = await supabaseAdmin.from('projects').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId).like('project_code', `${year}%`).then((r: any) => ({ count: r.count || 0 }));
        project_code = `${year}${((countVal as number) + 1).toString().padStart(3, '0')}`;
      }
      const id = bodyId || crypto.randomUUID();
      const { error: pe } = await supabaseAdmin.from('projects').insert({
        id, tenant_id: tenantId, name, client, status: status || 'Planning', budget: budget || 0,
        category: category || null, start_date: start_date || new Date().toISOString().split('T')[0],
        end_date: end_date || new Date().toISOString().split('T')[0], description: description || null,
        image_url: image_url || null, project_code, address: address || null,
        is_complete_mission: !!is_complete_mission, etudes_notes, chantier_notes, is_public_client: !!is_public_client,
        client_siret: client_siret || null, client_vat_number: client_vat_number || null,
        surface, construction_cost, remuneration, progression, project_manager, cotraitants, external_intervenants, entreprises,
        reference, projet_detail, is_entreprise: !!is_entreprise, nom_societe, rcs, representant, qualite,
        adresse_client, cp_client, ville_client, telephone, portable, email_client,
        adresse_terrain, cp_ville_terrain, ban_id_terrain, city_code_terrain, ref_cadastrale, zone_plu, surface_parcelle,
        nom_etablissement, avant_trav, apres_trav, type_et_cat, type_projet,
        categorie_projet, surface_plancher, surface_plancher_ext, surface_erp,
        surface_ert, effectif_public, effectif_personnel, ind, date_modification,
        maf_intercalaire, taux_mission, part_interet, secteur_abf, programme
      });
      if (pe) throw pe;
      if (cotraitants_list?.length) {
        await supabaseAdmin.from('project_cotraitants').insert(cotraitants_list.map((c: any) => ({ id: crypto.randomUUID(), tenant_id: tenantId, project_id: id, specialty: c.specialty, contact_id: c.contact_id || null })));
      }
      if (lots_list?.length) {
        await supabaseAdmin.from('project_lots').insert(lots_list.map((l: any) => ({ id: crypto.randomUUID(), tenant_id: tenantId, project_id: id, lot_number: l.lot_number, lot_title: l.lot_title, contact_id: l.contact_id || null })));
      }
      if (stakeholders_list?.length) {
        await supabaseAdmin.from('project_stakeholders').insert(stakeholders_list.map((s: any) => ({ id: crypto.randomUUID(), tenant_id: tenantId, project_id: id, name: s.name, role: s.role, contact_id: s.contact_id || null })));
      }
      if (categories_list?.length) {
        await supabaseAdmin.from('project_categories_junction').insert(categories_list.map((catId: string) => ({ project_id: id, category_id: catId, tenant_id: tenantId })));
      }
      // Log activity
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Création du projet "${name}"`, name, id, 'project', 'Projets');

      res.status(201).json({ id, project_code });
    } catch (error: any) {
      console.error("Error creating project:", error);
      res.status(error.status || 500).json({ error: error.message || "Failed to create project" });
    }
  });

  app.put("/api/projects/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const {
        name, client, status, budget, category, start_date, end_date, description, image_url, address,
        is_complete_mission, is_chantier, etudes_notes, chantier_notes, is_public_client, client_siret, client_vat_number,
        surface, construction_cost, remuneration, progression, project_manager, cotraitants, external_intervenants, entreprises,
        cotraitants_list, lots_list, stakeholders_list, categories_list,
        reference, projet_detail, is_entreprise, nom_societe, rcs, representant, qualite,
        adresse_client, cp_client, ville_client, telephone, portable, email_client,
        adresse_terrain, cp_ville_terrain, ban_id_terrain, city_code_terrain, ref_cadastrale, zone_plu, surface_parcelle,
        nom_etablissement, avant_trav, apres_trav, type_et_cat, type_projet,
        categorie_projet, surface_plancher, surface_plancher_ext, surface_erp,
        surface_ert, effectif_public, effectif_personnel, ind, date_modification,
        maf_intercalaire, taux_mission, part_interet, secteur_abf, programme
      } = req.body;
      if (!name || !client) return res.status(400).json({ error: "Name and client are required" });
      const { error: ue } = await supabaseAdmin.from('projects').update({
        name, client, status, budget, category, start_date, end_date, description, image_url, address,
        is_complete_mission: !!is_complete_mission, is_chantier: !!is_chantier, etudes_notes, chantier_notes, is_public_client: !!is_public_client,
        client_siret: client_siret || null, client_vat_number: client_vat_number || null,
        surface, construction_cost, remuneration, progression, project_manager, cotraitants, external_intervenants, entreprises,
        reference, projet_detail, is_entreprise: !!is_entreprise, nom_societe, rcs, representant, qualite,
        adresse_client, cp_client, ville_client, telephone, portable, email_client,
        adresse_terrain, cp_ville_terrain, ban_id_terrain, city_code_terrain, ref_cadastrale, zone_plu, surface_parcelle,
        nom_etablissement, avant_trav, apres_trav, type_et_cat, type_projet,
        categorie_projet, surface_plancher, surface_plancher_ext, surface_erp,
        surface_ert, effectif_public, effectif_personnel, ind, date_modification,
        maf_intercalaire, taux_mission, part_interet, secteur_abf, programme
      }).eq('id', id).eq('tenant_id', tenantId);
      if (ue) throw ue;
      // Update related lists (delete + reinsert)
      await supabaseAdmin.from('project_cotraitants').delete().eq('project_id', id).eq('tenant_id', tenantId);
      if (cotraitants_list?.length) {
        await supabaseAdmin.from('project_cotraitants').insert(cotraitants_list.map((c: any) => ({ id: crypto.randomUUID(), tenant_id: tenantId, project_id: id, specialty: c.specialty, contact_id: c.contact_id || null })));
      }
      await supabaseAdmin.from('project_lots').delete().eq('project_id', id).eq('tenant_id', tenantId);
      if (lots_list?.length) {
        await supabaseAdmin.from('project_lots').insert(lots_list.map((l: any) => ({ id: crypto.randomUUID(), tenant_id: tenantId, project_id: id, lot_number: l.lot_number, lot_title: l.lot_title, contact_id: l.contact_id || null })));
      }
      await supabaseAdmin.from('project_stakeholders').delete().eq('project_id', id).eq('tenant_id', tenantId);
      if (stakeholders_list?.length) {
        await supabaseAdmin.from('project_stakeholders').insert(stakeholders_list.map((s: any) => ({ id: crypto.randomUUID(), tenant_id: tenantId, project_id: id, name: s.name, role: s.role, contact_id: s.contact_id || null })));
      }
      await supabaseAdmin.from('project_categories_junction').delete().eq('project_id', id).eq('tenant_id', tenantId);
      if (categories_list?.length) {
        await supabaseAdmin.from('project_categories_junction').insert(categories_list.map((catId: string) => ({ project_id: id, category_id: catId, tenant_id: tenantId })));
      }
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error updating project:", error);
      res.status(500).json({ error: "Failed to update project: " + error.message });
    }
  });

  app.delete("/api/projects/:id", requireRole('admin'), async (req: any, res: any) => {
    try {
      const tenantId = req.tenantId as string;
      const { id } = req.params;
      const { data: project } = await supabaseAdmin.from('projects').select('name').eq('id', id).eq('tenant_id', tenantId).maybeSingle();
      await Promise.all([
        supabaseAdmin.from('project_team').delete().eq('project_id', id).eq('tenant_id', tenantId),
        supabaseAdmin.from('milestones').delete().eq('project_id', id).eq('tenant_id', tenantId),
        supabaseAdmin.from('specifications').delete().eq('project_id', id).eq('tenant_id', tenantId),
        supabaseAdmin.from('project_cotraitants').delete().eq('project_id', id).eq('tenant_id', tenantId),
      ]);
      const { error } = await supabaseAdmin.from('projects').delete().eq('id', id).eq('tenant_id', tenantId);
      if (error) throw error;
      const name = (project as any)?.name || '';
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Suppression du projet "${name}"`, name, id, 'project', 'Projets');
      res.json({ success: true });
    } catch (error: any) {
      captureWithContext(error, { route: 'DELETE /api/projects/:id', tenantId: req.tenantId, userId: req.user?.id });
      res.status(500).json({ error: "Failed to delete project: " + error.message });
    }
  });

  app.get("/api/project_categories", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await supabaseAdmin.from('project_categories').select('*').eq('tenant_id', tenantId).order('name');
      if (error) throw error;
      res.json(data);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to fetch project categories" }); }
  });

  app.post("/api/project_categories", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id: bodyId, name } = req.body;
      const id = bodyId || crypto.randomUUID();
      const { error } = await supabaseAdmin.from('project_categories').insert({ id, tenant_id: tenantId, name });
      if (error) throw error;
      res.status(201).json({ id });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to create project category" }); }
  });

  app.delete("/api/project_categories/:id", async (req: any, res: any) => {
    try {
      const tenantId2 = await getTenantId(req.user.id);
      const { id } = req.params;
      const { error } = await supabaseAdmin.from('project_categories').delete().eq('id', id).eq('tenant_id', tenantId2);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to delete project category" }); }
  });
}
