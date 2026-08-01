// Phase 7 extraction — moved out of server.ts's "─── Marchés Entreprises
// CRUD ───" section (marchés privés / private-market construction
// contracts and their "état d'acompte" interim payment statements).
// computeEtatAcompte/buildEtatAcomptePdfBuffer move to server/etatAcompte.ts
// since the still-inline SuperPDP and Chorus Pro integrations also call
// them — a shared module avoids either duplicating the calculation or
// extracting those two integrations as a side effect of this batch.
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';
import { buildEtatAcomptePdfBuffer } from '../etatAcompte';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
}

export function registerMarchesEntreprisesRoutes(app: Express, { supabaseAdmin, getTenantId }: RouteDeps) {
  app.get("/api/marches-entreprises/:projectId", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'marches_entreprises')
        .select('*')
        .eq('project_id', req.params.projectId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      res.json(data ?? []);
    } catch (e: any) {
      console.error("[GET /api/marches-entreprises/:projectId]", e); res.status(500).json({ error: e.message }); }
  });

  app.post("/api/marches-entreprises", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'marches_entreprises')
        .insert({ ...req.body })
        .select()
        .single();
      if (error) throw error;
      res.status(201).json(data);
    } catch (e: any) {
      console.error("[POST /api/marches-entreprises]", e); res.status(500).json({ error: e.message }); }
  });

  app.put("/api/marches-entreprises/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'marches_entreprises')
        .update({ ...req.body, updated_at: new Date().toISOString() })
        .eq('id', req.params.id)
        .select()
        .single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) {
      console.error("[PUT /api/marches-entreprises/:id]", e); res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/marches-entreprises/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'marches_entreprises')
        .delete()
        .eq('id', req.params.id);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) {
      console.error("[DELETE /api/marches-entreprises/:id]", e); res.status(500).json({ error: e.message }); }
  });

  // GET /api/situations/:projectId/avec-marche — situations avec marché joint
  app.get("/api/situations/:projectId/avec-marche", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'situations')
        .select('*, marche:marches_entreprises(id,entreprise_nom,lot_numero,lot_titre,montant_ht,tva_rate,avance_pct,avance_montant_ttc,avance_remboursee_cumul,retenue_garantie_pct,retenue_garantie_bancaire,retenue_garantie_bancaire_montant,revision_active,revision_formule)')
        .eq('project_id', req.params.projectId)
        .order('numero_situation', { ascending: true });
      if (error) throw error;
      res.json(data ?? []);
    } catch (e: any) {
      console.error("[GET /api/situations/:projectId/avec-marche]", e); res.status(500).json({ error: e.message }); }
  });

  // GET /api/situations/:situationId/details-enhanced — details avec avancement N-1 auto-calculé
  app.get("/api/situations/:situationId/details-enhanced", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);

      // Récupérer la situation courante
      const { data: sit } = await tenantScopedFrom(supabaseAdmin, tenantId, 'situations')
        .select('id, project_id, numero_situation, marche_id')
        .eq('id', req.params.situationId)
        .single();

      if (!sit) return res.status(404).json({ error: 'situation not found' });

      // Récupérer les postes DPGF du projet
      const { data: dpgfItems } = await tenantScopedFrom(supabaseAdmin, tenantId, 'dpgf_items')
        .select('*')
        .eq('project_id', sit.project_id);

      // Récupérer les details de la situation courante
      const { data: details } = await tenantScopedFrom(supabaseAdmin, tenantId, 'detail_situations')
        .select('*')
        .eq('situation_id', sit.id);

      // Récupérer la situation précédente pour N-1
      const { data: prevSit } = await tenantScopedFrom(supabaseAdmin, tenantId, 'situations')
        .select('id')
        .eq('project_id', sit.project_id)
        .lt('numero_situation', sit.numero_situation)
        .order('numero_situation', { ascending: false })
        .limit(1)
        .maybeSingle();

      let prevDetails: any[] = [];
      if (prevSit) {
        const { data: pd } = await tenantScopedFrom(supabaseAdmin, tenantId, 'detail_situations')
          .select('*')
          .eq('situation_id', prevSit.id);
        prevDetails = pd ?? [];
      }

      // Enrichir chaque poste DPGF avec l'avancement N et N-1
      const enriched = (dpgfItems ?? []).map((item: any) => {
        const detail = details?.find((d: any) => d.dpgf_item_id === item.id);
        const prevDetail = prevDetails.find((d: any) => d.dpgf_item_id === item.id);
        const montantTotal = Number(item.prix_unitaire_ht) * Number(item.quantite_prevue);
        const avancement_n = detail ? Number(detail.pourcentage_avancement || 0) : 0;
        const avancement_n_moins_1 = prevDetail ? Number(prevDetail.pourcentage_avancement || 0) : 0;
        const montant_cumul_n = montantTotal * avancement_n / 100;
        const montant_cumul_n_moins_1 = montantTotal * avancement_n_moins_1 / 100;
        const montant_periode = montant_cumul_n - montant_cumul_n_moins_1;
        return {
          ...item,
          montant_total: montantTotal,
          detail_id: detail?.id ?? null,
          avancement_n,
          avancement_n_moins_1,
          montant_cumul_n,
          montant_cumul_n_moins_1,
          montant_periode,
        };
      });

      res.json({ situation: sit, items: enriched });
    } catch (e: any) {
      console.error("[GET /api/situations/:situationId/details-enhanced]", e); res.status(500).json({ error: e.message }); }
  });

  // POST /api/situations/:situationId/detail-bulk — upsert tous les détails d'un coup
  app.post("/api/situations/:situationId/detail-bulk", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { items } = req.body as { items: Array<{ dpgf_item_id: string; pourcentage_avancement: number; montant_periode: number }> };

      // Supprimer les anciens détails
      await tenantScopedFrom(supabaseAdmin, tenantId, 'detail_situations')
        .delete()
        .eq('situation_id', req.params.situationId);

      if (!items?.length) return res.json({ success: true });

      const rows = items.map(i => ({
        id: crypto.randomUUID(),
        situation_id: req.params.situationId,
        dpgf_item_id: i.dpgf_item_id,
        pourcentage_avancement: i.pourcentage_avancement,
        montant_situation: i.montant_periode,
        montant_periode: i.montant_periode,
      }));

      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'detail_situations').insert(rows);
      if (error) throw error;
      res.json({ success: true, count: rows.length });
    } catch (e: any) {
      console.error("[POST /api/situations/:situationId/detail-bulk]", e); res.status(500).json({ error: e.message }); }
  });

  // PUT /api/situations/:id/etat-acompte — màj des champs état d'acompte
  app.put("/api/situations/:id/etat-acompte", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const {
        marche_id, date_reception_situation, penalites_ht, penalites_notes,
        avance_remboursement, revision_coeff, revision_indices, notes_moe, etat,
      } = req.body;
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'situations')
        .update({
          marche_id, date_reception_situation, penalites_ht, penalites_notes,
          avance_remboursement, revision_coeff, revision_indices, notes_moe, etat,
        })
        .eq('id', req.params.id)
        .select()
        .single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) {
      console.error("[PUT /api/situations/:id/etat-acompte]", e); res.status(500).json({ error: e.message }); }
  });

  // GET /api/situations/:situationId/etat-acompte-pdf — PDF état d'acompte
  app.get("/api/situations/:situationId/etat-acompte-pdf", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);

      const { data: sit } = await tenantScopedFrom(supabaseAdmin, tenantId, 'situations')
        .select('*, marche:marches_entreprises(*)')
        .eq('id', req.params.situationId)
        .single();

      if (!sit) return res.status(404).json({ error: 'not found' });

      const marche = (sit as any).marche as any;
      const { data: detailsRaw } = await tenantScopedFrom(supabaseAdmin, tenantId, 'detail_situations')
        .select('*, dpgf_item:dpgf_items(designation, prix_unitaire_ht, quantite_prevue, unite)')
        .eq('situation_id', sit.id);

      const details = detailsRaw ?? [];
      const { data: cfg } = await tenantScopedFrom(supabaseAdmin, tenantId, 'settings').select('agency_name').single();
      const agencyName = (cfg as any)?.agency_name ?? '';

      const buf = await buildEtatAcomptePdfBuffer(sit, marche, details, agencyName);
      res.set('Content-Type', 'application/pdf');
      res.set('Content-Disposition', `attachment; filename="etat-acompte-${sit.numero_situation}.pdf"`);
      res.send(buf);
    } catch (e: any) {
      console.error("[GET /api/situations/:situationId/etat-acompte-pdf]", e); res.status(500).json({ error: e.message }); }
  });
}
