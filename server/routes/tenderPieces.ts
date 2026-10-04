// Pièces demandées par le règlement de consultation d'un appel d'offres
// (candidature / offre technique / offre financière). Alimente le stat
// "Pièces à fournir X/Y" de la fiche détaillée. Une pièce peut être détectée
// automatiquement par l'analyse IA du DCE (statut 'detectee_ia', voir
// server/routes/tenderAi.ts) avant d'être confirmée "fournie" à la main.
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';
import { assertTenantEntity } from '../assertTenantEntity';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
}

const SECTIONS = ['candidature', 'offre_technique', 'offre_financiere'];
const STATUSES = ['a_fournir', 'fournie', 'detectee_ia'];

export function registerTenderPieceRoutes(app: Express, { supabaseAdmin, getTenantId }: RouteDeps) {
  app.get("/api/tender-pieces", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { tender_id } = req.query;
      if (!tender_id) return res.status(400).json({ error: "tender_id requis" });
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tender_pieces').select('*').eq('tender_id', tender_id as string).order('created_at', { ascending: true });
      if (error) throw error;
      res.json(data || []);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to fetch pieces" }); }
  });

  app.post("/api/tender-pieces", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { tender_id, section, label, obligatoire, quantity_required, status, source_hint, document_id } = req.body;
      if (!tender_id || !(await assertTenantEntity(supabaseAdmin, 'tenders', tender_id, tenantId))) {
        return res.status(400).json({ error: "Appel d'offres introuvable pour ce cabinet." });
      }
      if (!label) return res.status(400).json({ error: "Le libellé de la pièce est requis." });
      if (document_id && !(await assertTenantEntity(supabaseAdmin, 'documents', document_id, tenantId))) {
        return res.status(400).json({ error: "Document introuvable pour ce cabinet." });
      }
      const id = crypto.randomUUID();
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tender_pieces').insert({
        id, tender_id,
        section: SECTIONS.includes(section) ? section : 'candidature',
        label, obligatoire: obligatoire !== false,
        quantity_required: quantity_required ?? null,
        status: STATUSES.includes(status) ? status : 'a_fournir',
        source_hint: source_hint || null,
        document_id: document_id || null,
      }).select().single();
      if (error) throw error;
      res.status(201).json(data);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to create piece: " + e.message }); }
  });

  app.put("/api/tender-pieces/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { section, label, obligatoire, quantity_required, status, source_hint, document_id } = req.body;
      if (document_id && !(await assertTenantEntity(supabaseAdmin, 'documents', document_id, tenantId))) {
        return res.status(400).json({ error: "Document introuvable pour ce cabinet." });
      }
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tender_pieces').update({
        section: SECTIONS.includes(section) ? section : 'candidature',
        label, obligatoire: obligatoire !== false,
        quantity_required: quantity_required ?? null,
        status: STATUSES.includes(status) ? status : 'a_fournir',
        source_hint: source_hint || null,
        document_id: document_id || null,
      }).eq('id', id);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to update piece: " + e.message }); }
  });

  app.delete("/api/tender-pieces/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tender_pieces').delete().eq('id', id);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to delete piece: " + e.message }); }
  });
}
