// Références à joindre à un appel d'offres, sélectionnées parmi la
// bibliothèque du cabinet (affaires réelles ou références saisies à la main,
// voir src/pages/References.tsx / src/lib/referenceItems.ts). `required`
// repère une référence exigée par le règlement de consultation, indépendamment
// de la sélection elle-même (une candidature peut joindre plus de références
// que le minimum demandé).
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';
import { assertTenantEntity } from '../assertTenantEntity';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
}

export function registerTenderReferenceRoutes(app: Express, { supabaseAdmin, getTenantId }: RouteDeps) {
  app.get("/api/tender-references", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { tender_id } = req.query;
      if (!tender_id) return res.status(400).json({ error: "tender_id requis" });
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tender_references').select('*').eq('tender_id', tender_id as string).order('created_at', { ascending: true });
      if (error) throw error;
      const rows = data || [];
      const projectIds = rows.filter((r: any) => r.project_id).map((r: any) => r.project_id);
      const customIds = rows.filter((r: any) => r.custom_reference_id).map((r: any) => r.custom_reference_id);
      const [projectsRes, customRes] = await Promise.all([
        projectIds.length
          ? tenantScopedFrom(supabaseAdmin, tenantId, 'projects').select('id, name, client, category, end_date').in('id', projectIds)
          : Promise.resolve({ data: [] }),
        customIds.length
          ? tenantScopedFrom(supabaseAdmin, tenantId, 'custom_references').select('id, name, client, category, end_date').in('id', customIds)
          : Promise.resolve({ data: [] }),
      ]);
      const projectsById = new Map<string, any>((projectsRes.data || []).map((p: any) => [p.id, p]));
      const customById = new Map<string, any>((customRes.data || []).map((c: any) => [c.id, c]));
      const enriched = rows.map((r: any) => {
        const source = r.project_id ? projectsById.get(r.project_id) : customById.get(r.custom_reference_id);
        return {
          ...r,
          name: source?.name || '',
          client: source?.client || '',
          category: source?.category || '',
          end_date: source?.end_date || null,
          source: r.project_id ? 'project' : 'manual',
        };
      });
      res.json(enriched);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to fetch references" }); }
  });

  app.post("/api/tender-references", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { tender_id, project_id, custom_reference_id, required } = req.body;
      if (!tender_id || !(await assertTenantEntity(supabaseAdmin, 'tenders', tender_id, tenantId))) {
        return res.status(400).json({ error: "Appel d'offres introuvable pour ce cabinet." });
      }
      if (!project_id && !custom_reference_id) {
        return res.status(400).json({ error: "Une référence (projet ou saisie manuelle) est requise." });
      }
      if (project_id && !(await assertTenantEntity(supabaseAdmin, 'projects', project_id, tenantId))) {
        return res.status(400).json({ error: "Affaire introuvable pour ce cabinet." });
      }
      if (custom_reference_id && !(await assertTenantEntity(supabaseAdmin, 'custom_references', custom_reference_id, tenantId))) {
        return res.status(400).json({ error: "Référence introuvable pour ce cabinet." });
      }
      const id = crypto.randomUUID();
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tender_references').insert({
        id, tender_id, project_id: project_id || null, custom_reference_id: custom_reference_id || null, required: !!required,
      }).select().single();
      if (error) throw error;
      res.status(201).json(data);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to create reference: " + e.message }); }
  });

  app.put("/api/tender-references/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { required } = req.body;
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tender_references').update({ required: !!required }).eq('id', id);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to update reference: " + e.message }); }
  });

  app.delete("/api/tender-references/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tender_references').delete().eq('id', id);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to delete reference: " + e.message }); }
  });
}
