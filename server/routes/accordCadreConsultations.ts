// Remise en concurrence entre titulaires d'un accord-cadre (voir
// supabase/migrate_marches_subsequents_multi_titulaires.sql et src/lib/accordCadre.ts).
//
// Une consultation décrit ce qu'on veut commander (lignes du bordereau, quantités),
// recueille le prix de chaque titulaire, puis l'attribution émet le marché subséquent
// sous le titulaire retenu, aux prix de SON offre. L'émission passe par la même
// fonction SQL que l'émission directe : le plafond partagé du groupe s'applique.
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';
import { executerEmission } from './marchesSubsequents';
import {
  classerOffres, lignesCommandeDepuisOffre, totalOffre, verifierOffre,
  type LigneConsultation, type OffreConcurrence,
} from '../../src/lib/accordCadre';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
}

const MAX_LIGNES = 300;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const texte = (v: unknown, max = 300): string => String(v ?? '').trim().slice(0, max);
const dateValide = (v: unknown): v is string => typeof v === 'string' && DATE_RE.test(v) && !Number.isNaN(Date.parse(v));

function lireLignes(brut: unknown): LigneConsultation[] | null {
  if (!Array.isArray(brut) || brut.length === 0 || brut.length > MAX_LIGNES) return null;
  const vues = new Set<string>();
  const lignes: LigneConsultation[] = [];
  for (const l of brut as any[]) {
    const articleId = texte(l?.articleId, 100);
    const quantite = Number(l?.quantite);
    if (!articleId || vues.has(articleId) || !Number.isFinite(quantite) || quantite < 0) return null;
    vues.add(articleId);
    lignes.push({
      articleId, refBpu: texte(l?.refBpu, 40) || undefined, designation: texte(l?.designation, 500),
      unite: texte(l?.unite, 20), quantite,
    });
  }
  return lignes.every(l => l.designation) ? lignes : null;
}

/** Offres assainies : un titulaire du groupe, une seule offre, des prix numériques. */
function lireOffres(brut: unknown, membres: Set<string>, lignes: LigneConsultation[]): OffreConcurrence[] | null {
  if (!Array.isArray(brut)) return null;
  const articles = new Set(lignes.map(l => l.articleId));
  const vus = new Set<string>();
  const offres: OffreConcurrence[] = [];
  for (const o of brut as any[]) {
    const marcheId = texte(o?.marche_id, 64);
    if (!membres.has(marcheId) || vus.has(marcheId)) return null;
    vus.add(marcheId);
    const prix: Record<string, number | null> = {};
    for (const [k, v] of Object.entries(o?.prix ?? {})) {
      if (!articles.has(k)) continue;
      if (v === null || v === '' || v === undefined) { prix[k] = null; continue; }
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) return null;
      prix[k] = Math.round(n * 100) / 100;
    }
    const delai = o?.delai_jours === null || o?.delai_jours === undefined || o?.delai_jours === '' ? null : Number(o.delai_jours);
    if (delai !== null && (!Number.isFinite(delai) || delai < 0)) return null;
    const recue = o?.recue_le ? o.recue_le : null;
    if (recue !== null && !dateValide(recue)) return null;
    offres.push({
      marche_id: marcheId, prix, delai_jours: delai === null ? null : Math.round(delai),
      remarques: texte(o?.remarques, 1000), recue_le: recue, declinee: !!o?.declinee,
    });
  }
  return offres;
}

/** Réponse capturée : l'émission répond directement sur `res`, l'attribution veut le résultat. */
function captureReponse() {
  const r: { code: number; body: any; status(c: number): any; json(b: any): any } = {
    code: 200, body: null,
    status(c: number) { r.code = c; return r; },
    json(b: any) { r.body = b; return r; },
  };
  return r;
}

export function registerAccordCadreConsultationsRoutes(app: Express, { supabaseAdmin, getTenantId }: RouteDeps) {
  const table = (tenantId: string) => tenantScopedFrom(supabaseAdmin, tenantId, 'accord_cadre_consultations');
  const marches = (tenantId: string) => tenantScopedFrom(supabaseAdmin, tenantId, 'marches_entreprises');

  /** Instance sans la migration : lecture vide, écriture refusée (503). */
  const tableAbsente = (error: any) => error && (error.code === '42P01' || error.code === 'PGRST205');

  async function contexte(tenantId: string, marcheId: string) {
    const { data: m } = await marches(tenantId).select('*').eq('id', marcheId).maybeSingle();
    if (!m || m.type_marche !== 'accord_cadre') return null;
    const teteId = m.accord_cadre_groupe_id ?? m.id;
    const { data } = await marches(tenantId).select('*').eq('project_id', m.project_id).eq('type_marche', 'accord_cadre');
    const membres = (data ?? []).filter((r: any) => r.id === teteId || r.accord_cadre_groupe_id === teteId);
    const tete = membres.find((r: any) => r.id === teteId);
    return tete ? { tete, membres } : null;
  }

  app.get("/api/marches-entreprises/:id/consultations", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const ctx = await contexte(tenantId, req.params.id);
      if (!ctx) return res.status(404).json({ error: "Accord-cadre introuvable." });
      const { data, error } = await table(tenantId).select('*').eq('accord_cadre_id', ctx.tete.id).order('numero', { ascending: true });
      if (tableAbsente(error)) return res.json([]);
      if (error) throw error;
      res.json(data ?? []);
    } catch (e: any) {
      console.error("[GET /api/marches-entreprises/:id/consultations]", e); res.status(500).json({ error: e.message }); }
  });

  app.post("/api/marches-entreprises/:id/consultations", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const ctx = await contexte(tenantId, req.params.id);
      if (!ctx) return res.status(404).json({ error: "Accord-cadre introuvable." });
      if (ctx.membres.length < 2) return res.status(409).json({ error: "Une remise en concurrence suppose au moins deux titulaires." });
      const lignes = lireLignes(req.body?.lignes);
      if (!lignes) return res.status(400).json({ error: "Lignes de consultation invalides (article, désignation et quantité requis, sans doublon)." });
      const dateLimite = req.body?.date_limite ? req.body.date_limite : null;
      if (dateLimite !== null && !dateValide(dateLimite)) return res.status(400).json({ error: "Date limite invalide." });

      const { data: existantes, error: errLecture } = await table(tenantId).select('numero').eq('accord_cadre_id', ctx.tete.id);
      if (tableAbsente(errLecture)) return res.status(503).json({ error: "Les remises en concurrence ne sont pas disponibles : migration SQL à appliquer." });
      if (errLecture) throw errLecture;
      const numero = Math.max(0, ...(existantes ?? []).map((r: any) => Number(r.numero) || 0)) + 1;
      const { data, error } = await table(tenantId).insert({
        project_id: ctx.tete.project_id, accord_cadre_id: ctx.tete.id, numero,
        objet: texte(req.body?.objet, 500), date_limite: dateLimite, lignes, offres: [], statut: 'en_cours',
      }).select().single();
      if (error) throw error;
      res.status(201).json(data);
    } catch (e: any) {
      console.error("[POST /api/marches-entreprises/:id/consultations]", e); res.status(500).json({ error: e.message }); }
  });

  async function lireConsultation(tenantId: string, id: string) {
    const { data, error } = await table(tenantId).select('*').eq('id', id).maybeSingle();
    if (tableAbsente(error)) return null;
    if (error) throw error;
    return data ?? null;
  }

  app.put("/api/accord-cadre-consultations/:cid", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const c = await lireConsultation(tenantId, req.params.cid);
      if (!c) return res.status(404).json({ error: "Remise en concurrence introuvable." });
      if (c.statut !== 'en_cours') return res.status(409).json({ error: "Cette remise en concurrence est close." });
      const ctx = await contexte(tenantId, c.accord_cadre_id);
      if (!ctx) return res.status(404).json({ error: "Accord-cadre introuvable." });

      const maj: Record<string, unknown> = { updated_at: new Date().toISOString() };
      let lignes: LigneConsultation[] = c.lignes ?? [];
      if (req.body?.lignes !== undefined) {
        const l = lireLignes(req.body.lignes);
        if (!l) return res.status(400).json({ error: "Lignes de consultation invalides." });
        lignes = l; maj.lignes = l;
      }
      if (req.body?.objet !== undefined) maj.objet = texte(req.body.objet, 500);
      if (req.body?.date_limite !== undefined) {
        if (req.body.date_limite && !dateValide(req.body.date_limite)) return res.status(400).json({ error: "Date limite invalide." });
        maj.date_limite = req.body.date_limite || null;
      }
      if (req.body?.offres !== undefined || req.body?.lignes !== undefined) {
        const offres = lireOffres(req.body?.offres ?? c.offres ?? [], new Set(ctx.membres.map((m: any) => m.id)), lignes);
        if (!offres) return res.status(400).json({ error: "Offres invalides (titulaire hors du groupe, prix ou date illisible)." });
        for (const o of offres) {
          const titulaire = ctx.membres.find((m: any) => m.id === o.marche_id);
          const controle = verifierOffre(lignes, o.prix, titulaire?.offre_snapshot?.prix);
          if (!controle.ok) return res.status(400).json({ error: `${titulaire?.entreprise_nom ?? 'Titulaire'} : ${controle.erreurs[0]}`, erreurs: controle.erreurs });
        }
        maj.offres = offres;
      }
      const { data, error } = await table(tenantId).update(maj).eq('id', c.id).eq('statut', 'en_cours').select();
      if (error) throw error;
      if (!data?.length) return res.status(409).json({ error: "Cette remise en concurrence est close." });
      res.json(data[0]);
    } catch (e: any) {
      console.error("[PUT /api/accord-cadre-consultations/:cid]", e); res.status(500).json({ error: e.message }); }
  });

  // Attribution : émet le subséquent sous le titulaire retenu, aux prix de son offre.
  app.post("/api/accord-cadre-consultations/:cid/attribuer", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const c = await lireConsultation(tenantId, req.params.cid);
      if (!c) return res.status(404).json({ error: "Remise en concurrence introuvable." });
      if (c.statut !== 'en_cours') return res.status(409).json({ error: "Cette remise en concurrence est close." });
      const ctx = await contexte(tenantId, c.accord_cadre_id);
      if (!ctx) return res.status(404).json({ error: "Accord-cadre introuvable." });

      const gagnantId = texte(req.body?.marche_id, 64);
      const titulaire = ctx.membres.find((m: any) => m.id === gagnantId);
      const offre = (c.offres ?? []).find((o: OffreConcurrence) => o.marche_id === gagnantId);
      if (!titulaire || !offre) return res.status(400).json({ error: "Titulaire retenu absent de la remise en concurrence." });
      if (totalOffre(c.lignes ?? [], offre) === null) return res.status(400).json({ error: "L'offre du titulaire retenu est incomplète ou déclinée." });
      const classement = classerOffres(c.lignes ?? [], c.offres ?? []);
      const moinsDisant = classement[0]?.offre.marche_id === gagnantId;
      const motif = texte(req.body?.motif_choix, 1000);
      // Retenir une offre qui n'est pas la moins-disante exige de le justifier.
      if (!moinsDisant && !motif) return res.status(400).json({ error: "Motivez le choix d'une offre qui n'est pas la moins-disante." });

      // Réservation : un seul appelant fait passer la consultation en « attribuée ».
      const { data: reservee, error: errReserve } = await table(tenantId)
        .update({ statut: 'attribuee', retenue_marche_id: gagnantId, motif_choix: motif || null, updated_at: new Date().toISOString() })
        .eq('id', c.id).eq('statut', 'en_cours').select();
      if (errReserve) throw errReserve;
      if (!reservee?.length) return res.status(409).json({ error: "Cette remise en concurrence est déjà attribuée." });

      const rendre = async () => {
        await table(tenantId)
          .update({ statut: 'en_cours', retenue_marche_id: null, motif_choix: null, updated_at: new Date().toISOString() })
          .eq('id', c.id);
      };
      try {
        const capture = captureReponse();
        await executerEmission(supabaseAdmin, tenantId, titulaire, null, {
          objet: c.objet || `Remise en concurrence n° ${c.numero}`,
          lignes: lignesCommandeDepuisOffre(c.lignes ?? [], offre),
          date_notification: req.body?.date_notification, tva_rate: req.body?.tva_rate, duree_mois: req.body?.duree_mois,
          notes: `Remise en concurrence n° ${c.numero}${motif ? ` · ${motif}` : ''}`,
        }, capture);
        if (capture.code >= 400) { await rendre(); return res.status(capture.code).json(capture.body); }
        const subsequent = capture.body;
        await table(tenantId).update({ subsequent_id: subsequent.id }).eq('id', c.id);
        res.status(201).json({ subsequent, consultation: { ...reservee[0], subsequent_id: subsequent.id } });
      } catch (e) {
        await rendre();
        throw e;
      }
    } catch (e: any) {
      console.error("[POST /api/accord-cadre-consultations/:cid/attribuer]", e); res.status(500).json({ error: e.message }); }
  });

  app.post("/api/accord-cadre-consultations/:cid/abandonner", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const c = await lireConsultation(tenantId, req.params.cid);
      if (!c) return res.status(404).json({ error: "Remise en concurrence introuvable." });
      const { data, error } = await table(tenantId)
        .update({ statut: 'abandonnee', motif_choix: texte(req.body?.motif, 1000) || null, updated_at: new Date().toISOString() })
        .eq('id', c.id).eq('statut', 'en_cours').select();
      if (error) throw error;
      if (!data?.length) return res.status(409).json({ error: "Cette remise en concurrence est close." });
      res.json(data[0]);
    } catch (e: any) {
      console.error("[POST /api/accord-cadre-consultations/:cid/abandonner]", e); res.status(500).json({ error: e.message }); }
  });

  // Suppression : une remise en concurrence attribuée reste, elle motive un marché émis.
  app.delete("/api/accord-cadre-consultations/:cid", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const c = await lireConsultation(tenantId, req.params.cid);
      if (!c) return res.status(404).json({ error: "Remise en concurrence introuvable." });
      if (c.statut === 'attribuee') return res.status(409).json({ error: "Une remise en concurrence attribuée ne peut pas être supprimée." });
      const { error } = await table(tenantId).delete().eq('id', c.id);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) {
      console.error("[DELETE /api/accord-cadre-consultations/:cid]", e); res.status(500).json({ error: e.message }); }
  });
}
