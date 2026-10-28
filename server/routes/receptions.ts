// Phase 7 extraction — moved out of server.ts's "Reception Routes" section,
// part of the "suivi de chantier" cluster (see ordresDeService.ts).
//
// Une ligne `receptions` est soit un PV générique de l'affaire (régime NULL, comportement
// d'origine), soit un PV d'OPR par lot (régime `prive` ou `public`, voir src/lib/oprPv.ts) :
// les champs d'OPR sont assainis (`sanitizeOprPayload`), le régime est déduit de l'affaire
// et jamais lu dans la requête, et le lot d'un PV ne change plus une fois créé.
import type { Express } from 'express';
import { assertTenantEntity } from '../assertTenantEntity';
import { regimeDepuisAffaire } from '../../src/lib/oprPv';
import { sanitizeOprPayload } from '../../src/lib/oprPvSanitize';

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

      const { data, error } = await supabaseAdmin.from('receptions').insert({
        id: crypto.randomUUID(), tenant_id: tenantId, project_id, date, type, has_reserves: !!has_reserves, reserves_count: reserves_count || 0, document_url,
        reference_pv: reference_pv || null, lieu: lieu || null, signataires: signataires || null,
        observations: observations || null, date_limite_levee: date_limite_levee || null, pv_valide: !!pv_valide,
        ...opr.colonnes, ...(regime ? { regime } : {}),
      }).select().single();
      if (error) {
        if (estOpr && MISSING_COLUMN_CODES.has(error.code)) return res.status(503).json(NON_MIGRE);
        throw error;
      }
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
}
