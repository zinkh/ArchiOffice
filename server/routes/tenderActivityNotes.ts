// Journal de suivi d'un appel d'offres — texte libre horodaté, ajout seul
// (pas d'édition a posteriori, sur le modèle d'un fil de suivi).
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';
import { assertTenantEntity } from '../assertTenantEntity';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  getUserName: (tenantId: string, userId: string, email?: string) => Promise<string>;
}

export function registerTenderActivityNoteRoutes(app: Express, { supabaseAdmin, getTenantId, getUserName }: RouteDeps) {
  app.get("/api/tender-activity-notes", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { tender_id } = req.query;
      if (!tender_id) return res.status(400).json({ error: "tender_id requis" });
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tender_activity_notes').select('*').eq('tender_id', tender_id as string).order('created_at', { ascending: false });
      if (error) throw error;
      res.json(data || []);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to fetch activity notes" }); }
  });

  app.post("/api/tender-activity-notes", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { tender_id, content } = req.body;
      if (!tender_id || !(await assertTenantEntity(supabaseAdmin, 'tenders', tender_id, tenantId))) {
        return res.status(400).json({ error: "Appel d'offres introuvable pour ce cabinet." });
      }
      if (!content?.trim()) return res.status(400).json({ error: "Le contenu de la note est requis." });
      const authorName = await getUserName(tenantId, req.user.id, req.user.email);
      const id = crypto.randomUUID();
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tender_activity_notes').insert({
        id, tender_id, author_name: authorName, content: content.trim(),
      }).select().single();
      if (error) throw error;
      res.status(201).json(data);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to create activity note: " + e.message }); }
  });

  app.delete("/api/tender-activity-notes/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tender_activity_notes').delete().eq('id', id);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to delete activity note: " + e.message }); }
  });
}
