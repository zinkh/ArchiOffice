// Phase 7 extraction — moved out of server.ts's "Reception Routes" section,
// part of the "suivi de chantier" cluster (see ordresDeService.ts).
import type { Express } from 'express';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
}

export function registerReceptionRoutes(app: Express, { supabaseAdmin, getTenantId }: RouteDeps) {
  app.get("/api/receptions", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { project_id } = req.query;
      const { data, error } = await supabaseAdmin.from('receptions').select('*').eq('tenant_id', tenantId).eq('project_id', project_id as string);
      if (error) throw error;
      res.json(data);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to fetch receptions" }); }
  });

  app.post("/api/receptions", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { project_id, date, type, has_reserves, reserves_count, document_url, reference_pv, lieu, signataires, observations, date_limite_levee, pv_valide } = req.body;
      const { data, error } = await supabaseAdmin.from('receptions').insert({
        id: crypto.randomUUID(), tenant_id: tenantId, project_id, date, type, has_reserves: !!has_reserves, reserves_count: reserves_count || 0, document_url,
        reference_pv: reference_pv || null, lieu: lieu || null, signataires: signataires || null,
        observations: observations || null, date_limite_levee: date_limite_levee || null, pv_valide: !!pv_valide
      }).select().single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to create reception" }); }
  });

  app.delete("/api/receptions/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { error } = await supabaseAdmin.from('receptions').delete().eq('id', req.params.id).eq('tenant_id', tenantId);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to delete reception" }); }
  });

  app.put("/api/receptions/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { date, type, has_reserves, reserves_count, document_url, reference_pv, lieu, signataires, observations, date_limite_levee, pv_valide } = req.body;
      const { data, error } = await supabaseAdmin.from('receptions').update({
        date, type, has_reserves: !!has_reserves, reserves_count: reserves_count || 0, document_url,
        reference_pv: reference_pv || null, lieu: lieu || null, signataires: signataires || null,
        observations: observations || null, date_limite_levee: date_limite_levee || null, pv_valide: !!pv_valide
      }).eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to update reception" }); }
  });
}
