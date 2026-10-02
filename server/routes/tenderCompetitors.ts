// Concurrents pressentis sur un appel d'offres — alimente le stat
// "Candidats" de la fiche détaillée (COUNT) et le tableau "Analyse
// concurrentielle" de son onglet Aperçu. Voir supabase/migrate_tender_dossier.sql.
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';
import { assertTenantEntity } from '../assertTenantEntity';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
}

const RISK_LEVELS = ['faible', 'moyen', 'eleve'];

export function registerTenderCompetitorRoutes(app: Express, { supabaseAdmin, getTenantId }: RouteDeps) {
  app.get("/api/tender-competitors", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { tender_id } = req.query;
      if (!tender_id) return res.status(400).json({ error: "tender_id requis" });
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tender_competitors').select('*').eq('tender_id', tender_id as string).order('created_at', { ascending: true });
      if (error) throw error;
      res.json(data || []);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to fetch competitors" }); }
  });

  app.post("/api/tender-competitors", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { tender_id, name, info, risk_level } = req.body;
      if (!tender_id || !(await assertTenantEntity(supabaseAdmin, 'tenders', tender_id, tenantId))) {
        return res.status(400).json({ error: "Appel d'offres introuvable pour ce cabinet." });
      }
      if (!name) return res.status(400).json({ error: "Le nom du concurrent est requis." });
      const id = crypto.randomUUID();
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tender_competitors').insert({
        id, tender_id, name, info: info || null,
        risk_level: RISK_LEVELS.includes(risk_level) ? risk_level : 'moyen',
      }).select().single();
      if (error) throw error;
      res.status(201).json(data);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to create competitor: " + e.message }); }
  });

  app.put("/api/tender-competitors/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { name, info, risk_level } = req.body;
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tender_competitors').update({
        name, info: info || null,
        risk_level: RISK_LEVELS.includes(risk_level) ? risk_level : 'moyen',
      }).eq('id', id);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to update competitor: " + e.message }); }
  });

  app.delete("/api/tender-competitors/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tender_competitors').delete().eq('id', id);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to delete competitor: " + e.message }); }
  });
}
