// Accords-cadres et marchés subséquents (voir supabase/migrate_marches_subsequents.sql
// et src/lib/accordCadre.ts). Un accord-cadre est une ligne de marches_entreprises ;
// chaque marché subséquent en est une ligne enfant, donc les OS, situations et
// certificats de paiement s'y accrochent sans changement.
//
// Le client n'envoie jamais le montant d'un subséquent : il est recalculé ici depuis
// les lignes (quantité x prix), et le plafond est contrôlé en base sous verrou.
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';
import { isMissingSequenceFunction } from '../documentSequence';
import {
  consommation, totalLignes, validerLignesCommande, MESSAGE_REFUS,
  type LigneCommande, type ModeExecution, type CodeRefus,
} from '../../src/lib/accordCadre';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
}

const MODES: ModeExecution[] = ['bons_de_commande', 'marches_subsequents', 'mixte'];
const MAX_LIGNES = 300;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const texte = (v: unknown, max = 300): string => String(v ?? '').trim().slice(0, max);
/** `null` si absent, `NaN` si invalide, sinon le montant arrondi au centime. */
const nombre = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN;
};
const dateValide = (v: unknown): v is string => typeof v === 'string' && DATE_RE.test(v) && !Number.isNaN(Date.parse(v));

function lireLignes(brut: unknown): LigneCommande[] | null {
  if (!Array.isArray(brut) || brut.length > MAX_LIGNES) return null;
  return brut.map((l: any) => ({
    articleId: texte(l?.articleId, 100) || undefined,
    refBpu: texte(l?.refBpu, 40) || undefined,
    designation: texte(l?.designation, 500),
    unite: texte(l?.unite, 20),
    quantite: Number(l?.quantite),
    prixUnitaire: Number(l?.prixUnitaire),
  }));
}

/** Traduit une exception de enregistrer_marche_subsequent en réponse HTTP, ou null si ce n'en est pas une. */
function refusMetier(error: any): { status: number; code: string; message: string } | null {
  const m = /^(ACCORD_CADRE_[A-Z_]+|PLAFOND_DEPASSE|SUBSEQUENT_[A-Z]+|MONTANT_INVALIDE)(?::(\S+))?/.exec(String(error?.message ?? ''));
  if (!m) return null;
  const code = m[1];
  if (code.endsWith('INTROUVABLE')) return { status: 404, code, message: code.startsWith('SUBSEQUENT') ? 'Marché subséquent introuvable.' : 'Accord-cadre introuvable.' };
  if (code === 'ACCORD_CADRE_INVALIDE') return { status: 409, code, message: "Ce marché n'est pas un accord-cadre." };
  if (code === 'SUBSEQUENT_SIGNE') return { status: 409, code, message: 'Un marché subséquent signé ne peut plus être modifié.' };
  const message = MESSAGE_REFUS[code as CodeRefus] ?? 'Émission refusée.';
  return { status: 409, code, message: code === 'PLAFOND_DEPASSE' && m[2] ? `${message} Reste disponible : ${m[2]} € HT.` : message };
}

export function registerMarchesSubsequentsRoutes(app: Express, { supabaseAdmin, getTenantId }: RouteDeps) {
  async function lireMarche(tenantId: string, id: string) {
    const { data } = await tenantScopedFrom(supabaseAdmin, tenantId, 'marches_entreprises')
      .select('*').eq('id', id).maybeSingle();
    return data ?? null;
  }
  async function lireSubsequents(tenantId: string, parentId: string) {
    const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'marches_entreprises')
      .select('*').eq('parent_marche_id', parentId).order('numero_subsequent', { ascending: true });
    if (error) throw error;
    return data ?? [];
  }
  const conditions = (ac: any) => ({
    montantMiniHT: ac.montant_mini_ht == null ? null : Number(ac.montant_mini_ht),
    montantMaxiHT: ac.montant_maxi_ht == null ? null : Number(ac.montant_maxi_ht),
    dateFin: ac.date_fin_accord_cadre ?? null,
  });

  // POST /api/marches-entreprises/:id/accord-cadre : érige un marché en accord-cadre
  // (ou ajuste ses conditions). Réservé aux marchés publics.
  app.post("/api/marches-entreprises/:id/accord-cadre", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const marche = await lireMarche(tenantId, req.params.id);
      if (!marche) return res.status(404).json({ error: "Marché introuvable." });
      if (marche.type_marche === 'subsequent') return res.status(409).json({ error: "Un marché subséquent ne peut pas devenir un accord-cadre." });

      const { data: projet } = await tenantScopedFrom(supabaseAdmin, tenantId, 'projects')
        .select('id, is_public_client').eq('id', marche.project_id).maybeSingle();
      if (!projet?.is_public_client) {
        return res.status(400).json({ error: "Les accords-cadres sont réservés aux marchés publics (maître d'ouvrage public)." });
      }

      const mode = String(req.body?.mode_execution ?? '') as ModeExecution;
      if (!MODES.includes(mode)) return res.status(400).json({ error: "Mode d'exécution inconnu (bons de commande, marchés subséquents ou mixte)." });
      const mini = nombre(req.body?.montant_mini_ht);
      const maxi = nombre(req.body?.montant_maxi_ht);
      if (Number.isNaN(mini) || Number.isNaN(maxi)) return res.status(400).json({ error: "Montant minimum ou maximum invalide." });
      if (mini !== null && maxi !== null && mini > maxi) return res.status(400).json({ error: "Le montant minimum dépasse le maximum." });
      const dateFin = req.body?.date_fin_accord_cadre ? req.body.date_fin_accord_cadre : null;
      if (dateFin !== null && !dateValide(dateFin)) return res.status(400).json({ error: "Date de fin de l'accord-cadre invalide." });

      if (marche.type_marche === 'marche') {
        const { data: situations } = await tenantScopedFrom(supabaseAdmin, tenantId, 'situations')
          .select('id').eq('marche_id', marche.id).limit(1);
        if ((situations ?? []).length > 0) {
          return res.status(409).json({ error: "Ce marché porte déjà des situations de travaux : il ne peut plus devenir un accord-cadre." });
        }
      } else {
        // Ajustement d'un accord-cadre existant : le plafond ne descend pas sous l'émis.
        const emis = consommation({ montantMiniHT: null, montantMaxiHT: null, dateFin: null }, await lireSubsequents(tenantId, marche.id)).cumulHT;
        if (maxi !== null && maxi < emis) {
          return res.status(409).json({ error: `Le maximum ne peut pas être inférieur au montant déjà émis (${emis} € HT).` });
        }
      }

      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'marches_entreprises')
        .update({
          type_marche: 'accord_cadre', mode_execution: mode,
          montant_mini_ht: mini, montant_maxi_ht: maxi, date_fin_accord_cadre: dateFin,
          updated_at: new Date().toISOString(),
        })
        .eq('id', marche.id).select().single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) {
      console.error("[POST /api/marches-entreprises/:id/accord-cadre]", e); res.status(500).json({ error: e.message }); }
  });

  // DELETE /api/marches-entreprises/:id/accord-cadre : redevient un marché ordinaire,
  // tant qu'aucun subséquent n'en dépend.
  app.delete("/api/marches-entreprises/:id/accord-cadre", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const marche = await lireMarche(tenantId, req.params.id);
      if (!marche) return res.status(404).json({ error: "Marché introuvable." });
      if (marche.type_marche !== 'accord_cadre') return res.status(409).json({ error: "Ce marché n'est pas un accord-cadre." });
      if ((await lireSubsequents(tenantId, marche.id)).length > 0) {
        return res.status(409).json({ error: "Des marchés subséquents dépendent de cet accord-cadre." });
      }
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'marches_entreprises')
        .update({
          type_marche: 'marche', mode_execution: null, montant_mini_ht: null, montant_maxi_ht: null,
          date_fin_accord_cadre: null, updated_at: new Date().toISOString(),
        })
        .eq('id', marche.id).select().single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) {
      console.error("[DELETE /api/marches-entreprises/:id/accord-cadre]", e); res.status(500).json({ error: e.message }); }
  });

  // GET /api/marches-entreprises/:id/subsequents : subséquents et consommation du plafond.
  app.get("/api/marches-entreprises/:id/subsequents", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const ac = await lireMarche(tenantId, req.params.id);
      if (!ac) return res.status(404).json({ error: "Accord-cadre introuvable." });
      if (ac.type_marche !== 'accord_cadre') return res.status(409).json({ error: "Ce marché n'est pas un accord-cadre." });
      const subsequents = await lireSubsequents(tenantId, ac.id);
      res.json({ accordCadre: ac, subsequents, consommation: consommation(conditions(ac), subsequents) });
    } catch (e: any) {
      console.error("[GET /api/marches-entreprises/:id/subsequents]", e); res.status(500).json({ error: e.message }); }
  });

  async function enregistrer(req: any, res: any, subId: string | null) {
    const tenantId = await getTenantId(req.user.id);
    const ac = await lireMarche(tenantId, req.params.id);
    if (!ac) return res.status(404).json({ error: "Accord-cadre introuvable." });
    if (ac.type_marche !== 'accord_cadre') return res.status(409).json({ error: "Ce marché n'est pas un accord-cadre." });

    const lignes = lireLignes(req.body?.lignes);
    if (!lignes) return res.status(400).json({ error: `Lignes absentes ou trop nombreuses (${MAX_LIGNES} au plus).` });
    const controle = validerLignesCommande(lignes, ac.offre_snapshot?.prix);
    if (!controle.ok) return res.status(400).json({ error: controle.erreurs[0], erreurs: controle.erreurs });

    const tva = req.body?.tva_rate === undefined ? undefined : nombre(req.body.tva_rate);
    if (tva !== undefined && (tva === null || Number.isNaN(tva) || tva > 100)) return res.status(400).json({ error: "Taux de TVA invalide." });
    const dateNotification = req.body?.date_notification ? req.body.date_notification : null;
    if (dateNotification !== null && !dateValide(dateNotification)) return res.status(400).json({ error: "Date de notification invalide." });
    const duree = nombre(req.body?.duree_mois);
    if (Number.isNaN(duree)) return res.status(400).json({ error: "Durée invalide." });

    const { data, error } = await supabaseAdmin.rpc('enregistrer_marche_subsequent', {
      p_tenant_id: tenantId,
      p_parent_id: ac.id,
      p_row: {
        objet: texte(req.body?.objet, 500),
        lignes_commande: lignes,
        montant_ht: totalLignes(lignes),
        tva_rate: tva,
        date_notification: dateNotification,
        duree_mois: duree === null ? null : Math.round(duree),
        notes: texte(req.body?.notes, 2000),
      },
      p_id: subId,
    });
    if (error) {
      if (isMissingSequenceFunction(error)) return res.status(503).json({ error: "Les marchés subséquents ne sont pas disponibles : migration SQL à appliquer." });
      const refus = refusMetier(error);
      if (refus) return res.status(refus.status).json({ error: refus.message, code: refus.code });
      throw error;
    }
    res.status(subId ? 200 : 201).json(data);
  }

  app.post("/api/marches-entreprises/:id/subsequents", async (req: any, res: any) => {
    try { await enregistrer(req, res, null); }
    catch (e: any) { console.error("[POST /api/marches-entreprises/:id/subsequents]", e); res.status(500).json({ error: e.message }); }
  });

  app.put("/api/marches-entreprises/:id/subsequents/:subId", async (req: any, res: any) => {
    try { await enregistrer(req, res, String(req.params.subId)); }
    catch (e: any) { console.error("[PUT /api/marches-entreprises/:id/subsequents/:subId]", e); res.status(500).json({ error: e.message }); }
  });

  // DELETE d'un subséquent : brouillon seulement (non signé, sans situation).
  app.delete("/api/marches-entreprises/:id/subsequents/:subId", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const sub = await lireMarche(tenantId, String(req.params.subId));
      if (!sub || sub.parent_marche_id !== req.params.id) return res.status(404).json({ error: "Marché subséquent introuvable." });
      if (sub.statut_signature === 'signe') return res.status(409).json({ error: "Un marché subséquent signé ne peut pas être supprimé." });
      const { data: situations } = await tenantScopedFrom(supabaseAdmin, tenantId, 'situations')
        .select('id').eq('marche_id', sub.id).limit(1);
      if ((situations ?? []).length > 0) return res.status(409).json({ error: "Des situations de travaux dépendent de ce marché subséquent." });
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'marches_entreprises').delete().eq('id', sub.id);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) {
      console.error("[DELETE /api/marches-entreprises/:id/subsequents/:subId]", e); res.status(500).json({ error: e.message }); }
  });
}
