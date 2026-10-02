// Phase 7 extraction — moved out of server.ts's "GPA reserves" section,
// part of the "suivi de chantier" cluster (see ordresDeService.ts). Same
// mechanism as OPR `reserves` (server/routes/reserves.ts), kept in a
// separate table since OPR and GPA reserves are distinct tracking sets.
import type { Express } from 'express';
import { assertTenantEntity } from '../assertTenantEntity';
import { attachReservePhotos, deleteReservePhotos } from '../reservePhotos';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  getUserName: (tenantId: string, userId: string, email?: string) => Promise<string>;
  logActivity: (tenantId: string, userId: string, userName: string, action: string, target: string, targetId: string, targetType: string, category: string) => void;
  /** Retire les objets des photos d'une réserve supprimée (meilleur effort). */
  deleteFromStorage?: (bucket: string, fileUrl: string) => Promise<void>;
}

export function registerGpaReserveRoutes(app: Express, { supabaseAdmin, getTenantId, getUserName, logActivity, deleteFromStorage }: RouteDeps) {
  app.get("/api/gpa-reserves", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { project_id } = req.query;
      let query = supabaseAdmin.from('gpa_reserves').select('*').eq('tenant_id', tenantId);
      if (project_id) query = query.eq('project_id', project_id as string);
      const { data, error } = await query;
      if (error) {
        if ((error as any).code === '42P01') { res.json([]); return; }
        throw error;
      }
      // Chaque réserve porte ses photos (`photos: []` à défaut) : la liste, la
      // fiche et l'export PDF les lisent sans un appel par réserve.
      res.json(await attachReservePhotos(supabaseAdmin, tenantId, 'gpa', data || []));
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to fetch GPA reserves" }); }
  });

  app.post("/api/gpa-reserves", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id: bodyId, project_id, reception_id, title, batiment, local, status, lots, entreprises, created_at, due_date, plan_id, x, y, description } = req.body;
      // Rejouer la même création après une coupure réseau (file de synchro
      // hors-ligne) ne doit ni créer une seconde réserve, ni consommer un
      // second numéro dans la séquence du projet.
      if (bodyId) {
        const { data: existing } = await supabaseAdmin.from('gpa_reserves').select('*').eq('id', bodyId).eq('tenant_id', tenantId).maybeSingle();
        if (existing) return res.status(200).json({ ...(existing as any), photos: (await attachReservePhotos(supabaseAdmin, tenantId, 'gpa', [existing as any]))[0]?.photos || [] });
      }
      if (project_id && !(await assertTenantEntity(supabaseAdmin, 'projects', project_id, tenantId))) {
        return res.status(400).json({ error: "Projet introuvable pour ce cabinet." });
      }
      if (reception_id && !(await assertTenantEntity(supabaseAdmin, 'receptions', reception_id, tenantId))) {
        return res.status(400).json({ error: "Réception introuvable pour ce cabinet." });
      }
      if (plan_id && !(await assertTenantEntity(supabaseAdmin, 'plans', plan_id, tenantId))) {
        return res.status(400).json({ error: "Plan introuvable pour ce cabinet." });
      }
      const { data: lastRow } = await supabaseAdmin.from('gpa_reserves').select('number').eq('tenant_id', tenantId).eq('project_id', project_id).order('number', { ascending: false }).limit(1).single();
      const nextNumber = ((lastRow as any)?.number || 0) + 1;
      const id = bodyId || crypto.randomUUID();
      const { data, error } = await supabaseAdmin.from('gpa_reserves').insert({
        id, tenant_id: tenantId, project_id, reception_id, title, batiment, local,
        status: status || 'A faire', lots, entreprises, created_at, due_date, plan_id, x, y, number: nextNumber,
        description: description || null,
      }).select().single();
      if (error) throw error;
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Création de la réserve GPA N° ${nextNumber} "${title}"`, title || '', id, 'gpa_reserve', 'Réserves GPA');
      res.json({ ...(data as any), photos: [] });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to create GPA reserve" }); }
  });

  app.delete("/api/gpa-reserves/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: reserve } = await supabaseAdmin.from('gpa_reserves').select('title, number').eq('id', req.params.id).eq('tenant_id', tenantId).maybeSingle();
      const { error } = await supabaseAdmin.from('gpa_reserves').delete().eq('id', req.params.id).eq('tenant_id', tenantId);
      if (error) throw error;
      await deleteReservePhotos(supabaseAdmin, tenantId, 'gpa', req.params.id, deleteFromStorage);
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Suppression de la réserve GPA N° ${(reserve as any)?.number} "${(reserve as any)?.title || ''}"`, (reserve as any)?.title || '', req.params.id, 'gpa_reserve', 'Réserves GPA');
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to delete GPA reserve" }); }
  });

  app.put("/api/gpa-reserves/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { title, batiment, local, status, lots, entreprises, created_at, due_date, plan_id, x, y, description } = req.body;
      if (plan_id && !(await assertTenantEntity(supabaseAdmin, 'plans', plan_id, tenantId))) {
        return res.status(400).json({ error: "Plan introuvable pour ce cabinet." });
      }
      const { error } = await supabaseAdmin.from('gpa_reserves').update({ title, batiment, local, status, lots, entreprises, created_at, due_date, plan_id, x, y, description: description ?? null }).eq('id', req.params.id).eq('tenant_id', tenantId);
      if (error) throw error;
      res.json({ id: req.params.id, title, batiment, local, status, lots, entreprises, created_at, due_date, plan_id, x, y, description: description ?? null });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to update GPA reserve" }); }
  });
}
