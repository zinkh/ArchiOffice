// Phase 7 extraction — moved out of server.ts's "Reception Routes" section,
// part of the "suivi de chantier" cluster (see ordresDeService.ts).
//
// Une ligne `receptions` est soit un PV générique de l'affaire (régime NULL, comportement
// d'origine), soit un PV d'OPR par lot (régime `prive` ou `public`, voir src/lib/oprPv.ts) :
// les champs d'OPR sont assainis (`sanitizeOprPayload`), le régime est déduit de l'affaire
// et jamais lu dans la requête, et le lot d'un PV ne change plus une fois créé.
import type { Express } from 'express';
import { assertTenantEntity } from '../assertTenantEntity';
import { controlerPv, estDateIso, regimeDepuisAffaire } from '../../src/lib/oprPv';
import { lirePv, sanitizeOprPayload } from '../../src/lib/oprPvSanitize';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
}

const MISSING_COLUMN_CODES = new Set(['42703', 'PGRST204']);
const NON_MIGRE = {
  error: "Les PV d'OPR par lot demandent la migration supabase/migrate_opr_pv.sql, pas encore appliquée.",
  code: 'OPR_PV_UNAVAILABLE',
};

/** Champs historiques que le PUT d'un PV d'OPR n'écrit que s'ils figurent dans le corps. */
const CHAMPS_TEXTE = ['date', 'type', 'document_url', 'reference_pv', 'lieu', 'signataires', 'observations', 'date_limite_levee'] as const;

/** Le marché et le lot visés existent, relèvent du cabinet et de CETTE affaire. */
async function verifierReferences(
  supabaseAdmin: any, tenantId: string, projectId: string, colonnes: Record<string, unknown>,
): Promise<string | null> {
  if (colonnes.marche_id) {
    const { data } = await supabaseAdmin.from('marches_entreprises')
      .select('id, project_id, type_marche').eq('id', colonnes.marche_id).eq('tenant_id', tenantId).maybeSingle();
    if (!data || data.project_id !== projectId) return 'Marché introuvable pour cette affaire.';
    if (data.type_marche === 'accord_cadre') {
      return "Un accord-cadre n'a pas de PV d'OPR : choisissez un marché subséquent ou un marché ordinaire.";
    }
  }
  if (colonnes.lot_id) {
    const { data } = await supabaseAdmin.from('project_lots')
      .select('id, project_id').eq('id', colonnes.lot_id).eq('tenant_id', tenantId).maybeSingle();
    if (!data || data.project_id !== projectId) return 'Lot introuvable pour cette affaire.';
  }
  return null;
}

/** Une réserve est encore à lever tant qu'elle n'est ni levée ni quittancée. */
const STATUTS_RESERVE_LEVEE = new Set(['Levée', 'Quitus Transmis']);

/**
 * Prochaine référence `OPR-AAAA-NNN` du cabinet : le plus grand suffixe de l'année + 1.
 * Deux créations simultanées peuvent proposer la même : l'index unique partiel
 * (`receptions_opr_reference`) en refuse une, et l'appelant recalcule.
 */
async function prochaineReference(supabaseAdmin: any, tenantId: string, annee: string): Promise<string> {
  const { data } = await supabaseAdmin.from('receptions').select('reference_pv').eq('tenant_id', tenantId);
  const prefixe = `OPR-${annee}-`;
  let max = 0;
  for (const r of data ?? []) {
    const ref = String(r.reference_pv ?? '');
    if (!ref.startsWith(prefixe)) continue;
    const suffixe = /^\d+$/.test(ref.slice(prefixe.length)) ? Number(ref.slice(prefixe.length)) : 0;
    if (suffixe > max) max = suffixe;
  }
  return `${prefixe}${String(max + 1).padStart(3, '0')}`;
}

const REPONSE_PV_SIGNE = { error: 'PV signé : rouvrez la signature pour le modifier.', code: 'PV_SIGNE' };

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
      if (project_id && !(await assertTenantEntity(supabaseAdmin, 'projects', project_id, tenantId))) {
        return res.status(400).json({ error: "Projet introuvable pour ce cabinet." });
      }

      const opr = sanitizeOprPayload(req.body);
      if (opr.erreurs.length) return res.status(400).json({ error: opr.erreurs.join(' ') });
      const estOpr = Object.keys(opr.colonnes).length > 0;
      let regime: string | undefined;
      if (estOpr) {
        if (!project_id) return res.status(400).json({ error: "Un PV d'OPR est rattaché à une affaire." });
        if (!opr.colonnes.marche_id && !opr.colonnes.lot_id) {
          return res.status(400).json({ error: "Le lot (ou le marché) du PV est obligatoire : un PV par lot." });
        }
        const refus = await verifierReferences(supabaseAdmin, tenantId, project_id, opr.colonnes);
        if (refus) return res.status(400).json({ error: refus });
        const { data: affaire } = await supabaseAdmin.from('projects').select('is_public_client').eq('id', project_id).eq('tenant_id', tenantId).maybeSingle();
        regime = regimeDepuisAffaire(affaire?.is_public_client);
      }

      // Un PV d'OPR reçoit sa référence du serveur quand le client n'en fournit pas.
      const referenceAuto = estOpr && !reference_pv;
      const annee = estDateIso(date) ? date.slice(0, 4) : String(new Date().getUTCFullYear());
      for (let tentative = 0; ; tentative++) {
        const { data, error } = await supabaseAdmin.from('receptions').insert({
          id: crypto.randomUUID(), tenant_id: tenantId, project_id, date, type, has_reserves: !!has_reserves, reserves_count: reserves_count || 0, document_url,
          reference_pv: referenceAuto ? await prochaineReference(supabaseAdmin, tenantId, annee) : (reference_pv || null),
          lieu: lieu || null, signataires: signataires || null,
          observations: observations || null, date_limite_levee: date_limite_levee || null, pv_valide: !!pv_valide,
          ...opr.colonnes, ...(regime ? { regime } : {}),
        }).select().single();
        if (error) {
          if (referenceAuto && error.code === '23505' && tentative < 4) continue;
          if (estOpr && MISSING_COLUMN_CODES.has(error.code)) return res.status(503).json(NON_MIGRE);
          throw error;
        }
        return res.json(data);
      }
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

      const opr = sanitizeOprPayload(req.body);
      if (opr.erreurs.length) return res.status(400).json({ error: opr.erreurs.join(' ') });
      const aDesChampsOpr = Object.keys(opr.colonnes).length > 0;

      const { data: existant, error: lectureErreur } = await supabaseAdmin.from('receptions').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).maybeSingle();
      if (lectureErreur) throw lectureErreur;
      if (!existant) return res.status(404).json({ error: "PV de réception introuvable." });

      // PV générique : comportement d'origine, tous les champs historiques sont réécrits.
      if (!existant.regime) {
        if (aDesChampsOpr) return res.status(400).json({ error: "Ce PV est un PV générique : créez un PV d'OPR pour le lot." });
        const { data, error } = await supabaseAdmin.from('receptions').update({
          date, type, has_reserves: !!has_reserves, reserves_count: reserves_count || 0, document_url,
          reference_pv: reference_pv || null, lieu: lieu || null, signataires: signataires || null,
          observations: observations || null, date_limite_levee: date_limite_levee || null, pv_valide: !!pv_valide
        }).eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
        if (error) throw error;
        return res.json(data);
      }

      // PV signé : le contenu est figé jusqu'à la réouverture de la signature.
      if (existant.signed_at) return res.status(409).json(REPONSE_PV_SIGNE);

      // PV d'OPR : mise à jour partielle (un client qui ne connaît pas un champ ne l'efface pas)
      // et lot figé.
      const { marche_id, lot_id, ...modifiables } = opr.colonnes;
      for (const [cle, valeur] of [['marche_id', marche_id], ['lot_id', lot_id]] as const) {
        if (valeur !== undefined && valeur !== existant[cle]) {
          return res.status(400).json({ error: "Le lot d'un PV ne change pas : créez un autre PV." });
        }
      }
      const maj: Record<string, unknown> = { ...modifiables };
      for (const cle of CHAMPS_TEXTE) {
        if (cle in req.body) maj[cle] = typeof req.body[cle] === 'string' && req.body[cle] !== '' ? req.body[cle] : (cle === 'date' || cle === 'type' ? existant[cle] : null);
      }
      if ('has_reserves' in req.body) maj.has_reserves = !!has_reserves;
      if ('reserves_count' in req.body) maj.reserves_count = Number(reserves_count) || 0;
      if ('pv_valide' in req.body) maj.pv_valide = !!pv_valide;
      if (Object.keys(maj).length === 0) return res.json(existant);

      const { data, error } = await supabaseAdmin.from('receptions').update(maj).eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
      if (error) {
        if (MISSING_COLUMN_CODES.has(error.code)) return res.status(503).json(NON_MIGRE);
        throw error;
      }
      res.json(data);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to update reception" }); }
  });

  // Signature d'un PV d'OPR (papier : scan déposé ; électronique : document signé déposé).
  // Refusée tant que le PV est incohérent ; une fois signé, son contenu est figé (PUT en 409).
  app.post("/api/receptions/:id/signature", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const mode = String(req.body?.mode ?? '');
      if (mode !== 'papier' && mode !== 'electronique') {
        return res.status(400).json({ error: "Mode de signature inconnu (papier ou électronique)." });
      }
      const date = req.body?.date;
      if (!estDateIso(date)) return res.status(400).json({ error: "Date de signature invalide (AAAA-MM-JJ)." });
      const documentId = typeof req.body?.document_id === 'string' ? req.body.document_id.slice(0, 100) : null;
      if (documentId && !(await assertTenantEntity(supabaseAdmin, 'documents', documentId, tenantId))) {
        return res.status(400).json({ error: "Document introuvable pour ce cabinet." });
      }

      const { data: existant } = await supabaseAdmin.from('receptions').select('*').eq('id', req.params.id).eq('tenant_id', tenantId).maybeSingle();
      if (!existant) return res.status(404).json({ error: "PV de réception introuvable." });
      const pv = lirePv(existant);
      if (!pv) return res.status(400).json({ error: "Seul un PV d'OPR par lot se signe." });
      if (existant.signed_at) return res.status(409).json(REPONSE_PV_SIGNE);

      const { data: reserves } = await supabaseAdmin.from('reserves').select('status').eq('tenant_id', tenantId).eq('reception_id', existant.id);
      const reservesOuvertes = (reserves ?? []).filter((r: any) => !STATUTS_RESERVE_LEVEE.has(r.status)).length;
      const controle = controlerPv(pv, { reservesOuvertes });
      if (controle.erreurs.length) {
        return res.status(409).json({ error: "Le PV est incohérent : corrigez-le avant de le signer.", code: 'PV_INCOHERENT', erreurs: controle.erreurs });
      }

      const { data, error } = await supabaseAdmin.from('receptions')
        .update({ signed_at: date, signed_mode: mode, signed_document_id: documentId })
        .eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
      if (error) {
        if (MISSING_COLUMN_CODES.has(error.code)) return res.status(503).json(NON_MIGRE);
        throw error;
      }
      res.json(data);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to sign reception" }); }
  });

  // Rouvre un PV signé par erreur : son contenu redevient modifiable.
  app.post("/api/receptions/:id/signature/rouvrir", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: existant } = await supabaseAdmin.from('receptions').select('id, regime').eq('id', req.params.id).eq('tenant_id', tenantId).maybeSingle();
      if (!existant) return res.status(404).json({ error: "PV de réception introuvable." });
      if (!existant.regime) return res.status(400).json({ error: "Seul un PV d'OPR par lot se signe." });
      const { data, error } = await supabaseAdmin.from('receptions')
        .update({ signed_at: null, signed_mode: null, signed_document_id: null })
        .eq('id', req.params.id).eq('tenant_id', tenantId).select().single();
      if (error) {
        if (MISSING_COLUMN_CODES.has(error.code)) return res.status(503).json(NON_MIGRE);
        throw error;
      }
      res.json(data);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to reopen reception" }); }
  });
}
