// Phase 7 extraction — moved out of server.ts's "─── Marchés Entreprises
// CRUD ───" section (marchés privés / private-market construction
// contracts and their "état d'acompte" interim payment statements).
// computeEtatAcompte/buildEtatAcomptePdfBuffer move to server/etatAcompte.ts
// since the still-inline SuperPDP and Chorus Pro integrations also call
// them — a shared module avoids either duplicating the calculation or
// extracting those two integrations as a side effect of this batch.
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';
import { assertTenantEntity } from '../assertTenantEntity';
import { buildCertificatPdfBuffer } from '../etatAcompte';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
}

/**
 * Colonnes écrites seulement par les routes de l'ACT (constitution et
 * signature). Le POST/PUT générique, qui reprend le corps tel quel, ne doit pas
 * pouvoir rouvrir ou falsifier un marché signé.
 */
const COLONNES_ACT = [
  'act_lot_id', 'act_entreprise_id', 'offre_snapshot',
  'statut_signature', 'mode_signature', 'date_signature', 'acte_signe_document_id',
] as const;

function sansColonnesAct(body: any): Record<string, unknown> {
  const copie = { ...(body ?? {}) };
  for (const c of COLONNES_ACT) delete copie[c];
  return copie;
}

const MAX_SNAPSHOT_CHARS = 500_000;
const texte = (v: unknown, max = 300): string => String(v ?? '').trim().slice(0, max);
const montant = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
};

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
      if (req.body?.project_id && !(await assertTenantEntity(supabaseAdmin, 'projects', req.body.project_id, tenantId))) {
        return res.status(400).json({ error: "Projet introuvable pour ce cabinet." });
      }
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'marches_entreprises')
        .insert(sansColonnesAct(req.body))
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
      if (req.body?.project_id && !(await assertTenantEntity(supabaseAdmin, 'projects', req.body.project_id, tenantId))) {
        return res.status(400).json({ error: "Projet introuvable pour ce cabinet." });
      }
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'marches_entreprises')
        .update({ ...sansColonnesAct(req.body), updated_at: new Date().toISOString() })
        .eq('id', req.params.id)
        .select()
        .single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) {
      console.error("[PUT /api/marches-entreprises/:id]", e); res.status(500).json({ error: e.message }); }
  });

  // POST /api/projects/:projectId/marches-act : constitue (ou met à jour) les
  // marchés des lots attribués dans l'ACT. Idempotent par (affaire, lot) : un
  // second appel ne duplique rien, et un marché déjà signé n'est jamais touché.
  app.post("/api/projects/:projectId/marches-act", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const projectId = String(req.params.projectId);
      if (!(await assertTenantEntity(supabaseAdmin, 'projects', projectId, tenantId))) {
        return res.status(400).json({ error: "Projet introuvable pour ce cabinet." });
      }
      const entrees = Array.isArray(req.body?.marches) ? req.body.marches : null;
      if (!entrees || entrees.length === 0 || entrees.length > 100) {
        return res.status(400).json({ error: "Liste de marchés absente ou trop longue." });
      }

      const lignes: Record<string, unknown>[] = [];
      for (const e of entrees) {
        const actLotId = texte(e?.act_lot_id, 100);
        const nom = texte(e?.entreprise_nom);
        const ht = montant(e?.montant_ht);
        if (!actLotId || !nom || ht === null) {
          return res.status(400).json({ error: "Chaque marché exige un lot, une entreprise et un montant HT valide." });
        }
        const tva = e?.tva_rate === undefined ? 20 : montant(e.tva_rate);
        if (tva === null || tva > 100) return res.status(400).json({ error: "Taux de TVA invalide." });
        const contactId = texte(e?.contact_id, 100) || null;
        if (contactId && !(await assertTenantEntity(supabaseAdmin, 'contacts', contactId, tenantId))) {
          return res.status(400).json({ error: "Contact introuvable pour ce cabinet." });
        }
        let snapshot: unknown = null;
        if (e?.offre_snapshot && typeof e.offre_snapshot === 'object') {
          if (JSON.stringify(e.offre_snapshot).length > MAX_SNAPSHOT_CHARS) {
            return res.status(400).json({ error: "L'offre à figer est trop volumineuse." });
          }
          snapshot = e.offre_snapshot;
        }
        lignes.push({
          act_lot_id: actLotId,
          act_entreprise_id: texte(e?.act_entreprise_id, 100) || null,
          contact_id: contactId,
          entreprise_nom: nom,
          lot_numero: texte(e?.lot_numero, 30),
          lot_titre: texte(e?.lot_titre),
          montant_ht: ht,
          tva_rate: tva,
          offre_snapshot: snapshot,
        });
      }

      const { data: existants, error: errLecture } = await tenantScopedFrom(supabaseAdmin, tenantId, 'marches_entreprises')
        .select('id, act_lot_id, statut_signature')
        .eq('project_id', projectId);
      if (errLecture) throw errLecture;
      const parLot = new Map<string, any>((existants ?? []).filter((m: any) => m.act_lot_id).map((m: any) => [m.act_lot_id, m]));

      let crees = 0, misAJour = 0, ignores = 0;
      const maintenant = new Date().toISOString();
      for (const ligne of lignes) {
        const deja = parLot.get(ligne.act_lot_id as string);
        if (deja?.statut_signature === 'signe') { ignores++; continue; }
        if (deja) {
          const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'marches_entreprises')
            .update({ ...ligne, updated_at: maintenant })
            .eq('id', deja.id);
          if (error) throw error;
          misAJour++;
        } else {
          const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'marches_entreprises')
            .insert({ ...ligne, project_id: projectId, statut_signature: 'a_signer' });
          if (error) throw error;
          crees++;
        }
      }

      const { data: marches, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'marches_entreprises')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      res.json({ marches: marches ?? [], crees, misAJour, ignores });
    } catch (e: any) {
      console.error("[POST /api/projects/:projectId/marches-act]", e); res.status(500).json({ error: e.message }); }
  });

  // POST /api/marches-entreprises/:id/signature : enregistre la signature
  // (papier : scan déposé ; électronique : document signé déposé). Le marché
  // passe « signé » et ses pièces se verrouillent.
  app.post("/api/marches-entreprises/:id/signature", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const mode = String(req.body?.mode ?? '');
      if (mode !== 'papier' && mode !== 'electronique') {
        return res.status(400).json({ error: "Mode de signature inconnu (papier ou électronique)." });
      }
      const date = String(req.body?.date_signature ?? '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
        return res.status(400).json({ error: "Date de signature invalide." });
      }
      const documentId = texte(req.body?.document_id, 100) || null;
      if (documentId && !(await assertTenantEntity(supabaseAdmin, 'documents', documentId, tenantId))) {
        return res.status(400).json({ error: "Document introuvable pour ce cabinet." });
      }
      const { data: marche } = await tenantScopedFrom(supabaseAdmin, tenantId, 'marches_entreprises')
        .select('id').eq('id', req.params.id).maybeSingle();
      if (!marche) return res.status(404).json({ error: "Marché introuvable." });
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'marches_entreprises')
        .update({
          statut_signature: 'signe', mode_signature: mode, date_signature: date,
          acte_signe_document_id: documentId, updated_at: new Date().toISOString(),
        })
        .eq('id', req.params.id)
        .select().single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) {
      console.error("[POST /api/marches-entreprises/:id/signature]", e); res.status(500).json({ error: e.message }); }
  });

  // POST /api/marches-entreprises/:id/signature/rouvrir : annule la signature
  // enregistrée par erreur ; le marché repasse « à signer ».
  app.post("/api/marches-entreprises/:id/signature/rouvrir", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: marche } = await tenantScopedFrom(supabaseAdmin, tenantId, 'marches_entreprises')
        .select('id').eq('id', req.params.id).maybeSingle();
      if (!marche) return res.status(404).json({ error: "Marché introuvable." });
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'marches_entreprises')
        .update({
          statut_signature: 'a_signer', mode_signature: null, date_signature: null,
          acte_signe_document_id: null, updated_at: new Date().toISOString(),
        })
        .eq('id', req.params.id)
        .select().single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) {
      console.error("[POST /api/marches-entreprises/:id/signature/rouvrir]", e); res.status(500).json({ error: e.message }); }
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
      if (!(await assertTenantEntity(supabaseAdmin, 'situations', req.params.situationId, tenantId))) {
        return res.status(404).json({ error: 'Situation introuvable pour ce cabinet.' });
      }
      const { items } = req.body as { items: Array<{ dpgf_item_id: string; pourcentage_avancement: number; montant_periode: number }> };
      for (const item of items || []) {
        if (item?.dpgf_item_id && !(await assertTenantEntity(supabaseAdmin, 'dpgf_items', item.dpgf_item_id, tenantId))) {
          return res.status(400).json({ error: "Ligne DPGF introuvable pour ce cabinet." });
        }
      }

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
      if (marche_id && !(await assertTenantEntity(supabaseAdmin, 'marches_entreprises', marche_id, tenantId))) {
        return res.status(400).json({ error: "Marché introuvable pour ce cabinet." });
      }
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

  // GET /api/situations/:situationId/etat-acompte-pdf — PDF du certificat de paiement
  app.get("/api/situations/:situationId/etat-acompte-pdf", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);

      const { data: sit } = await tenantScopedFrom(supabaseAdmin, tenantId, 'situations')
        .select('*, marche:marches_entreprises(*)')
        .eq('id', req.params.situationId)
        .single();

      if (!sit) return res.status(404).json({ error: 'not found' });

      const buf = await buildCertificatPdfBuffer(supabaseAdmin, tenantId, sit, (sit as any).marche);
      res.set('Content-Type', 'application/pdf');
      res.set('Content-Disposition', `attachment; filename="certificat-paiement-${sit.numero_situation}.pdf"`);
      res.send(buf);
    } catch (e: any) {
      console.error("[GET /api/situations/:situationId/etat-acompte-pdf]", e); res.status(500).json({ error: e.message }); }
  });
}
