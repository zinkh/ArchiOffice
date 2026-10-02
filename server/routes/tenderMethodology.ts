// Sections de la note méthodologique (mémoire technique) d'un appel
// d'offres — rédigeables à la main ou, sur le plan Enterprise, avec l'aide
// de l'IA (voir server/routes/tenderAi.ts, POST .../methodology/:noteId/draft-ai).
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';
import { assertTenantEntity } from '../assertTenantEntity';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
}

export function registerTenderMethodologyRoutes(app: Express, { supabaseAdmin, getTenantId }: RouteDeps) {
  app.get("/api/tender-methodology-notes", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { tender_id } = req.query;
      if (!tender_id) return res.status(400).json({ error: "tender_id requis" });
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tender_methodology_notes').select('*').eq('tender_id', tender_id as string).order('sort_order', { ascending: true });
      if (error) throw error;
      res.json(data || []);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to fetch methodology notes" }); }
  });

  app.post("/api/tender-methodology-notes", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { tender_id, title, content, sort_order } = req.body;
      if (!tender_id || !(await assertTenantEntity(supabaseAdmin, 'tenders', tender_id, tenantId))) {
        return res.status(400).json({ error: "Appel d'offres introuvable pour ce cabinet." });
      }
      if (!title) return res.status(400).json({ error: "Le titre de la section est requis." });
      const id = crypto.randomUUID();
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tender_methodology_notes').insert({
        id, tender_id, title, content: content || '',
        status: content?.trim() ? 'redige' : 'a_rediger',
        sort_order: sort_order ?? 0,
      }).select().single();
      if (error) throw error;
      res.status(201).json(data);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to create methodology note: " + e.message }); }
  });

  app.put("/api/tender-methodology-notes/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { title, content, sort_order } = req.body;
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tender_methodology_notes').update({
        title, content: content || '',
        status: content?.trim() ? 'redige' : 'a_rediger',
        sort_order: sort_order ?? 0,
        updated_at: new Date().toISOString(),
      }).eq('id', id);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to update methodology note: " + e.message }); }
  });

  app.delete("/api/tender-methodology-notes/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tender_methodology_notes').delete().eq('id', id);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to delete methodology note: " + e.message }); }
  });
}
