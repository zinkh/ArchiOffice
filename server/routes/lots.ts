// Phase 7 extraction — moved out of server.ts's Lots section (project_lots
// table — market trade packages like Gros œuvre, Charpente, Électricité).
import type { Express } from 'express';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
}

export function registerLotRoutes(app: Express, { supabaseAdmin, getTenantId }: RouteDeps) {
  app.get("/api/projects/:projectId/lots", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { projectId } = req.params;
      const { data: lots, error } = await supabaseAdmin.from('project_lots').select('*').eq('project_id', projectId).eq('tenant_id', tenantId);
      if (error) throw error;
      // Ordre naturel par numéro : la réorganisation renumérote « 01 », « 02 »... donc l'ordre est le numéro.
      res.json([...(lots ?? [])].sort((a: any, b: any) => String(a.lot_number ?? '').localeCompare(String(b.lot_number ?? ''), 'fr', { numeric: true })));
    } catch (error) {
      console.error("[GET /api/projects/:projectId/lots]", error);
      res.status(500).json({ error: "Failed to fetch lots" });
    }
  });

  app.post("/api/projects/:projectId/lots", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { projectId } = req.params;
      const { id: bodyId, lot_number, lot_title } = req.body;
      const lotId = bodyId || crypto.randomUUID();
      const { error } = await supabaseAdmin.from('project_lots').insert({ id: lotId, tenant_id: tenantId, project_id: projectId, lot_number, lot_title });
      if (error) throw error;
      res.status(201).json({ id: lotId });
    } catch (error) {
      console.error("[POST /api/projects/:projectId/lots]", error);
      res.status(500).json({ error: "Failed to create lot" });
    }
  });

  // Renomme / renumérote un lot (utilisé quand la liste se remplit depuis le CCTP).
  app.put("/api/lots/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const patch: Record<string, string> = {};
      if (typeof req.body?.lot_number === 'string') patch.lot_number = req.body.lot_number.trim();
      if (typeof req.body?.lot_title === 'string') patch.lot_title = req.body.lot_title.trim();
      if (!Object.keys(patch).length) return res.status(400).json({ error: "Rien à modifier" });
      const { error } = await supabaseAdmin.from('project_lots').update(patch).eq('id', req.params.id).eq('tenant_id', tenantId);
      if (error) throw error;
      res.json({ success: true });
    } catch (error) {
      console.error("[PUT /api/lots/:id]", error);
      res.status(500).json({ error: "Failed to update lot" });
    }
  });

  // Réorganise les lots d'un projet : `ids` donne le nouvel ordre, les numéros
  // sont réattribués automatiquement (01, 02, ...). Aucune colonne de rang :
  // le numéro est l'ordre.
  app.put("/api/projects/:projectId/lots/order", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { projectId } = req.params;
      const ids = req.body?.ids;
      if (!Array.isArray(ids) || ids.some((i: unknown) => typeof i !== 'string') || new Set(ids).size !== ids.length) {
        return res.status(400).json({ error: "ids doit être une liste d'identifiants distincts" });
      }
      const { data: existing, error } = await supabaseAdmin.from('project_lots').select('id').eq('project_id', projectId).eq('tenant_id', tenantId);
      if (error) throw error;
      const known = new Set((existing ?? []).map((l: any) => l.id));
      if (ids.length !== known.size || ids.some((i: string) => !known.has(i))) {
        return res.status(400).json({ error: "La liste doit contenir exactement les lots du projet" });
      }
      for (const [index, id] of ids.entries()) {
        const { error: upErr } = await supabaseAdmin.from('project_lots')
          .update({ lot_number: String(index + 1).padStart(2, '0') })
          .eq('id', id).eq('tenant_id', tenantId).eq('project_id', projectId);
        if (upErr) throw upErr;
      }
      const { data: lots, error: readErr } = await supabaseAdmin.from('project_lots').select('*').eq('project_id', projectId).eq('tenant_id', tenantId);
      if (readErr) throw readErr;
      res.json([...(lots ?? [])].sort((a: any, b: any) => String(a.lot_number).localeCompare(String(b.lot_number), 'fr', { numeric: true })));
    } catch (error) {
      console.error("[PUT /api/projects/:projectId/lots/order]", error);
      res.status(500).json({ error: "Failed to reorder lots" });
    }
  });

  app.delete("/api/lots/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { error } = await supabaseAdmin.from('project_lots').delete().eq('id', id).eq('tenant_id', tenantId);
      if (error) throw error;
      res.json({ success: true });
    } catch (error) {
      console.error("[DELETE /api/lots/:id]", error);
      res.status(500).json({ error: "Failed to delete lot" });
    }
  });
}
