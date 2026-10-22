// Onglet « Travaux modificatifs » du chantier (DET) : les devis reçus des entreprises
// pour des travaux supplémentaires, et les fiches de travaux modificatifs (FTM).
// Une instance sans les tables (supabase/migrate_os_multi_entreprises_ftm.sql) lit
// des listes vides et refuse l'écriture en 503, sans casser le reste du chantier.
import type { Express } from 'express';
import { assertTenantEntity } from '../assertTenantEntity';
import { tenantScopedFrom } from '../tenantScopedFrom';
import { creerOrdreDeService } from './ordresDeService';
import {
  attribuerNumeros, CLE_SANS_ENTREPRISE, cleEntrepriseLot, entreprisesDistinctes, formatNumeroFtm, numeroHeriteFtm, resumeNumeros,
  type NumeroEntreprise,
} from '../../src/lib/numerotationEntreprise';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  getUserName?: (tenantId: string, userId: string, email?: string) => Promise<string>;
  logActivity?: (tenantId: string, userId: string, userName: string, action: string, target: string, targetId: string, targetType: string, category: string) => void;
}

const FTM = 'ftm';
const DEVIS = 'devis_travaux_modificatifs';

export const FTM_STATUTS = ['brouillon', 'emise', 'validee', 'refusee'] as const;
export const DEVIS_STATUTS = ['recu', 'en_analyse', 'accepte', 'refuse'] as const;
const ORIGINES = ['maitrise_ouvrage', 'maitrise_oeuvre', 'entreprise', 'aleas', 'autres'];

const manquante = (e: any): boolean => !!e && (e.code === '42P01' || e.code === 'PGRST205');
const MSG_503 = 'Les tables des travaux modificatifs ne sont pas encore créées sur cette instance (migration migrate_os_multi_entreprises_ftm.sql).';
const texte = (v: unknown, max: number): string | null => {
  const s = typeof v === 'string' ? v.trim().slice(0, max) : '';
  return s || null;
};
const montant = (v: unknown): number | null | undefined => {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};
const dateIso = (v: unknown): string | null | undefined => {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : undefined;
};
const entier = (v: unknown): number | null | undefined => {
  const n = montant(v);
  return n === undefined || n === null ? n : Math.round(n);
};

// Verrou par opération (un seul processus) : sérialise l'attribution du numéro de FTM.
const locks = new Map<string, Promise<unknown>>();
async function withLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(task);
  const tail = run.catch(() => undefined);
  locks.set(key, tail);
  try { return await run; } finally { if (locks.get(key) === tail) locks.delete(key); }
}

/** Colonne numeros_entreprises absente (migration non jouée) : la fiche est créée avec son seul numéro texte. */
const colonneManquante = (e: any): boolean => !!e && (e.code === '42703' || e.code === 'PGRST204' || /numeros_entreprises/.test(String(e.message || '')));

const ORIGINE_OS: Record<string, string> = { maitrise_ouvrage: 'maitrise_ouvrage', maitrise_oeuvre: 'maitrise_oeuvre', aleas: 'aleas' };

export function registerTravauxModificatifsRoutes(app: Express, { supabaseAdmin, getTenantId, getUserName, logActivity }: RouteDeps) {
  /** Marchés d'une liste, vérifiés dans le cabinet et l'affaire ; null si l'un d'eux est étranger. */
  async function marchesDe(tenantId: string, projectId: string, ids: string[]): Promise<any[] | null> {
    if (ids.length === 0) return [];
    const { data } = await supabaseAdmin.from('marches_entreprises')
      .select('id, project_id, type_marche, contact_id, entreprise_nom, lot_numero').in('id', ids).eq('tenant_id', tenantId);
    const rows = (data || []) as any[];
    if (rows.length !== ids.length || rows.some(m => m.project_id !== projectId)) return null;
    return rows;
  }
  /** Numéros d'une nouvelle FTM : un par entreprise et lot visés, dans la suite de chacun (« FTM-01-03 », « FTM-01-03 / FTM-02-01 »). */
  async function numerosFtm(tenantId: string, projectId: string, marches: any[]): Promise<NumeroEntreprise[]> {
    const [{ data: ftmRows }, { data: marchesProjet }] = await Promise.all([
      tenantScopedFrom(supabaseAdmin, tenantId, FTM).select('*').eq('project_id', projectId),
      supabaseAdmin.from('marches_entreprises').select('id, contact_id, entreprise_nom, lot_numero').eq('tenant_id', tenantId).eq('project_id', projectId),
    ]);
    // Une suite par entreprise ET par lot : FTM-01-01 pour le lot 01, FTM-02-01 pour le lot 02.
    const cles = new Map<string, string>(((marchesProjet || []) as any[]).map(m => [m.id, cleEntrepriseLot(m)]));
    for (const m of marches) cles.set(m.id, cleEntrepriseLot(m));
    // Une fiche sans entreprise a sa propre suite.
    const entreprises = marches.length
      ? entreprisesDistinctes(marches, cleEntrepriseLot)
      : [{ marche_id: '', lot: '', cle: CLE_SANS_ENTREPRISE, entreprise: '' }];
    const lignes = ((ftmRows || []) as any[]).map(f => (Array.isArray(f.marche_ids) && f.marche_ids.length === 0 && !f.numeros_entreprises?.length
      ? { ...f, numeros_entreprises: [{ marche_id: '', cle: CLE_SANS_ENTREPRISE, entreprise: '', numero: numeroHeriteFtm(f) }] }
      : f));
    return attribuerNumeros(lignes, entreprises, id => cles.get(id), numeroHeriteFtm);
  }
  const idsMarches = (v: unknown): string[] =>
    [...new Set((Array.isArray(v) ? v : []).filter((x): x is string => typeof x === 'string' && !!x))].slice(0, 20);

  // ── FTM ─────────────────────────────────────────────────────────────────
  app.get('/api/projects/:projectId/ftm', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, FTM)
        .select('*').eq('project_id', req.params.projectId).order('created_at', { ascending: true });
      if (error) return manquante(error) ? res.json([]) : res.status(500).json({ error: 'Lecture impossible.' });
      res.json(data ?? []);
    } catch (e: any) {
      console.error('[GET /api/projects/:id/ftm]', e);
      res.status(500).json({ error: 'Lecture impossible.' });
    }
  });

  app.post('/api/projects/:projectId/ftm', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const projectId = req.params.projectId;
      if (!(await assertTenantEntity(supabaseAdmin, 'projects', projectId, tenantId))) return res.status(404).json({ error: 'Affaire introuvable.' });
      const title = texte(req.body?.title, 200);
      if (!title) return res.status(400).json({ error: "L'intitulé de la fiche est obligatoire." });
      const marcheIds = idsMarches(req.body?.marche_ids);
      const marches = await marchesDe(tenantId, projectId, marcheIds);
      if (marches === null) return res.status(400).json({ error: 'Marché de travaux introuvable pour cette affaire.' });
      const osId = texte(req.body?.ordre_service_id, 64);
      if (osId && !(await assertTenantEntity(supabaseAdmin, 'ordres_de_service', osId, tenantId))) return res.status(400).json({ error: 'Ordre de service introuvable pour ce cabinet.' });
      const origine = ORIGINES.includes(req.body?.origine) ? req.body.origine : null;
      const status = (FTM_STATUTS as readonly string[]).includes(req.body?.status) ? req.body.status : 'brouillon';
      const lu = await tenantScopedFrom(supabaseAdmin, tenantId, FTM).select('id').eq('project_id', projectId);
      if (lu.error) return manquante(lu.error) ? res.status(503).json({ error: MSG_503 }) : res.status(500).json({ error: 'Enregistrement impossible.' });
      // Numéro attribué par le serveur dans la suite de CHAQUE entreprise visée, sous verrou : jamais saisi, jamais en double.
      const resultat = await withLock(`ftm:${tenantId}:${projectId}`, async () => {
        const numeros = await numerosFtm(tenantId, projectId, marches);
        const ligne = {
          id: crypto.randomUUID(), project_id: projectId, numero: resumeNumeros(numeros, (n, e) => formatNumeroFtm(n, e)),
          title, objet: texte(req.body?.objet, 300), origine, motif: texte(req.body?.motif, 2000), description: texte(req.body?.description, 5000),
          marche_ids: marcheIds, incidence_delai_jours: entier(req.body?.incidence_delai_jours) ?? null,
          incidences_delais_details: texte(req.body?.incidences_delais_details, 1000),
          montant_estime_ht: montant(req.body?.montant_estime_ht) ?? null, montant_accepte_ht: montant(req.body?.montant_accepte_ht) ?? null,
          status, date_emission: dateIso(req.body?.date_emission) ?? null, date_decision: dateIso(req.body?.date_decision) ?? null,
          ordre_service_id: osId,
        };
        let r = await tenantScopedFrom(supabaseAdmin, tenantId, FTM).insert({ ...ligne, numeros_entreprises: numeros }).select().single();
        if (r.error && colonneManquante(r.error)) r = await tenantScopedFrom(supabaseAdmin, tenantId, FTM).insert(ligne).select().single();
        return r;
      });
      // Index unique (affaire, numero) : le numéro porte le lot, seuls deux marchés sous un même numéro de lot s'y heurtent.
      if (resultat.error?.code === '23505') return res.status(409).json({ error: "Ce numéro de fiche existe déjà dans l'affaire : deux marchés portent le même numéro de lot. Corrigez la numérotation des lots." });
      if (resultat.error) return manquante(resultat.error) ? res.status(503).json({ error: MSG_503 }) : res.status(500).json({ error: 'Enregistrement impossible.' });
      res.status(201).json(resultat.data);
    } catch (e: any) {
      console.error('[POST /api/projects/:id/ftm]', e);
      res.status(500).json({ error: 'Enregistrement impossible.' });
    }
  });

  app.put('/api/ftm/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: actuelle } = await tenantScopedFrom(supabaseAdmin, tenantId, FTM).select('id, project_id').eq('id', req.params.id).maybeSingle();
      if (!actuelle) return res.status(404).json({ error: 'Fiche introuvable.' });
      const patch: Record<string, unknown> = {};
      const b = req.body || {};
      if (b.title !== undefined) {
        const title = texte(b.title, 200);
        if (!title) return res.status(400).json({ error: "L'intitulé de la fiche est obligatoire." });
        patch.title = title;
      }
      for (const [champ, max] of [['objet', 300], ['motif', 2000], ['description', 5000], ['incidences_delais_details', 1000]] as const) {
        if (b[champ] !== undefined) patch[champ] = texte(b[champ], max);
      }
      if (b.origine !== undefined) patch.origine = ORIGINES.includes(b.origine) ? b.origine : null;
      if (b.status !== undefined) {
        if (!(FTM_STATUTS as readonly string[]).includes(b.status)) return res.status(400).json({ error: 'Statut invalide.' });
        patch.status = b.status;
      }
      for (const champ of ['montant_estime_ht', 'montant_accepte_ht'] as const) {
        if (b[champ] !== undefined) { const v = montant(b[champ]); if (v === undefined) return res.status(400).json({ error: 'Montant invalide.' }); patch[champ] = v; }
      }
      if (b.incidence_delai_jours !== undefined) { const v = entier(b.incidence_delai_jours); if (v === undefined) return res.status(400).json({ error: 'Délai invalide.' }); patch.incidence_delai_jours = v; }
      for (const champ of ['date_emission', 'date_decision'] as const) {
        if (b[champ] !== undefined) { const v = dateIso(b[champ]); if (v === undefined) return res.status(400).json({ error: 'Date invalide.' }); patch[champ] = v; }
      }
      if (b.marche_ids !== undefined) {
        const ids = idsMarches(b.marche_ids);
        if ((await marchesDe(tenantId, (actuelle as any).project_id, ids)) === null) return res.status(400).json({ error: 'Marché de travaux introuvable pour cette affaire.' });
        patch.marche_ids = ids;
      }
      if (b.ordre_service_id !== undefined) {
        const osId = texte(b.ordre_service_id, 64);
        if (osId && !(await assertTenantEntity(supabaseAdmin, 'ordres_de_service', osId, tenantId))) return res.status(400).json({ error: 'Ordre de service introuvable pour ce cabinet.' });
        patch.ordre_service_id = osId;
      }
      if (Object.keys(patch).length === 0) return res.json(actuelle);
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, FTM).update(patch).eq('id', req.params.id).select().maybeSingle();
      if (error) return manquante(error) ? res.status(503).json({ error: MSG_503 }) : res.status(500).json({ error: 'Enregistrement impossible.' });
      res.json(data);
    } catch (e: any) {
      console.error('[PUT /api/ftm/:id]', e);
      res.status(500).json({ error: 'Enregistrement impossible.' });
    }
  });

  // Émet l'ordre de service d'une FTM VALIDÉE : brouillon prérempli (objet, description, entreprises,
  // montant, incidences), numéroté dans la suite de chaque entreprise ; la fiche garde le lien.
  app.post('/api/ftm/:id/ordre-service', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: f } = await tenantScopedFrom(supabaseAdmin, tenantId, FTM).select('*').eq('id', req.params.id).maybeSingle();
      if (!f) return res.status(404).json({ error: 'Fiche introuvable.' });
      const fiche = f as any;
      if (fiche.status !== 'validee') return res.status(409).json({ error: "Seule une fiche validée par le maître d'ouvrage donne lieu à un ordre de service." });
      if (fiche.ordre_service_id) return res.status(409).json({ error: 'Un ordre de service est déjà rattaché à cette fiche.' });
      const marcheIds = idsMarches(fiche.marche_ids);
      if (marcheIds.length === 0) return res.status(400).json({ error: "Rattachez d'abord la fiche à au moins une entreprise." });
      const { data: devisRows } = await tenantScopedFrom(supabaseAdmin, tenantId, DEVIS).select('montant_ht, statut').eq('ftm_id', fiche.id);
      const acceptes = ((devisRows || []) as any[]).filter(d => d.statut === 'accepte').reduce((s, d) => s + (Number(d.montant_ht) || 0), 0);
      // Montant : celui décidé sur la fiche, à défaut la somme des devis acceptés, à défaut l'estimation.
      const montantOs = fiche.montant_accepte_ht != null ? Number(fiche.montant_accepte_ht) : acceptes > 0 ? acceptes : fiche.montant_estime_ht != null ? Number(fiche.montant_estime_ht) : null;
      const jours = Number(fiche.incidence_delai_jours) || 0;
      const aujourdhui = new Date().toISOString().slice(0, 10);
      const r = await creerOrdreDeService(supabaseAdmin, tenantId, {
        project_id: fiche.project_id, marche_ids: marcheIds, type: 'travaux', status: 'draft',
        title: fiche.title, objet: fiche.objet || fiche.title,
        description: [fiche.motif, fiche.description].filter(Boolean).join('\n\n') || null,
        origine_demande: ORIGINE_OS[fiche.origine] || (fiche.origine ? 'autres' : undefined),
        incidences_delais_type: jours > 0 ? 'oui' : 'non', incidences_delais_details: jours > 0 ? [`${jours} jour(s)`, fiche.incidences_delais_details].filter(Boolean).join(' : ') : undefined,
        incidences_couts_type: montantOs ? 'oui' : 'non', montant_devis_presente: montantOs, montant_devis_accepte: montantOs,
        date: aujourdhui, date_emission: aujourdhui,
      });
      if (!r.ok) return res.status(r.status).json({ error: r.error });
      const { data: ftmMaj, error } = await tenantScopedFrom(supabaseAdmin, tenantId, FTM).update({ ordre_service_id: r.data.id }).eq('id', fiche.id).select().maybeSingle();
      if (error) console.error('[POST /api/ftm/:id/ordre-service] lien non posé', error);
      if (getUserName && logActivity) {
        const userName = await getUserName(tenantId, req.user.id, req.user.email);
        logActivity(tenantId, req.user.id, userName, `Ordre de service "${r.data.title}" émis depuis la fiche ${fiche.numero}`, r.data.title || '', r.data.id, 'ordre_de_service', 'Ordres de service');
      }
      res.status(201).json({ ordre: r.data, ftm: ftmMaj ?? { ...fiche, ordre_service_id: r.data.id } });
    } catch (e: any) {
      console.error('[POST /api/ftm/:id/ordre-service]', e);
      res.status(500).json({ error: "L'ordre de service n'a pas pu être créé." });
    }
  });

  app.delete('/api/ftm/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      // Les devis rattachés à la fiche lui sont détachés, jamais supprimés avec elle.
      await tenantScopedFrom(supabaseAdmin, tenantId, DEVIS).update({ ftm_id: null }).eq('ftm_id', req.params.id);
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, FTM).delete().eq('id', req.params.id);
      if (error) return manquante(error) ? res.status(503).json({ error: MSG_503 }) : res.status(500).json({ error: 'Suppression impossible.' });
      res.json({ success: true });
    } catch (e: any) {
      console.error('[DELETE /api/ftm/:id]', e);
      res.status(500).json({ error: 'Suppression impossible.' });
    }
  });

  // ── Devis de travaux modificatifs ───────────────────────────────────────
  app.get('/api/projects/:projectId/devis-travaux-modificatifs', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, DEVIS)
        .select('*').eq('project_id', req.params.projectId).order('created_at', { ascending: true });
      if (error) return manquante(error) ? res.json([]) : res.status(500).json({ error: 'Lecture impossible.' });
      res.json(data ?? []);
    } catch (e: any) {
      console.error('[GET /api/projects/:id/devis-travaux-modificatifs]', e);
      res.status(500).json({ error: 'Lecture impossible.' });
    }
  });

  /** Champs d'un devis, vérifiés ; rend { erreur } ou { patch } (seuls les champs présents). */
  async function lireDevis(tenantId: string, projectId: string, b: any): Promise<{ erreur: string } | { patch: Record<string, unknown> }> {
    const patch: Record<string, unknown> = {};
    if (b.objet !== undefined) {
      const objet = texte(b.objet, 300);
      if (!objet) return { erreur: "L'objet du devis est obligatoire." };
      patch.objet = objet;
    }
    if (b.reference !== undefined) patch.reference = texte(b.reference, 100);
    if (b.observations !== undefined) patch.observations = texte(b.observations, 2000);
    if (b.statut !== undefined) {
      if (!(DEVIS_STATUTS as readonly string[]).includes(b.statut)) return { erreur: 'Statut invalide.' };
      patch.statut = b.statut;
    }
    if (b.montant_ht !== undefined) { const v = montant(b.montant_ht); if (v === undefined) return { erreur: 'Montant invalide.' }; patch.montant_ht = v; }
    if (b.date_reception !== undefined) { const v = dateIso(b.date_reception); if (v === undefined) return { erreur: 'Date invalide.' }; patch.date_reception = v; }
    if (b.marche_id !== undefined) {
      const marcheId = texte(b.marche_id, 64);
      if (marcheId) {
        const marches = await marchesDe(tenantId, projectId, [marcheId]);
        if (marches === null) return { erreur: 'Marché de travaux introuvable pour cette affaire.' };
        patch.marche_id = marcheId;
        patch.entreprise = marches[0].entreprise_nom || null;
      } else {
        patch.marche_id = null;
        if (b.entreprise === undefined) patch.entreprise = null;
      }
    }
    if (b.entreprise !== undefined && !patch.marche_id) patch.entreprise = texte(b.entreprise, 200);
    if (b.ftm_id !== undefined) {
      const ftmId = texte(b.ftm_id, 64);
      if (ftmId) {
        const { data: f } = await tenantScopedFrom(supabaseAdmin, tenantId, FTM).select('id, project_id').eq('id', ftmId).maybeSingle();
        if (!f || (f as any).project_id !== projectId) return { erreur: 'Fiche de travaux modificatifs introuvable pour cette affaire.' };
      }
      patch.ftm_id = ftmId;
    }
    return { patch };
  }

  app.post('/api/projects/:projectId/devis-travaux-modificatifs', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const projectId = req.params.projectId;
      if (!(await assertTenantEntity(supabaseAdmin, 'projects', projectId, tenantId))) return res.status(404).json({ error: 'Affaire introuvable.' });
      if (!texte(req.body?.objet, 300)) return res.status(400).json({ error: "L'objet du devis est obligatoire." });
      const lu = await lireDevis(tenantId, projectId, req.body || {});
      if ('erreur' in lu) return res.status(400).json({ error: lu.erreur });
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, DEVIS).insert({
        statut: 'recu', ...lu.patch, id: crypto.randomUUID(), project_id: projectId,
      }).select().single();
      if (error) return manquante(error) ? res.status(503).json({ error: MSG_503 }) : res.status(500).json({ error: 'Enregistrement impossible.' });
      res.status(201).json(data);
    } catch (e: any) {
      console.error('[POST /api/projects/:id/devis-travaux-modificatifs]', e);
      res.status(500).json({ error: 'Enregistrement impossible.' });
    }
  });

  app.put('/api/devis-travaux-modificatifs/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: actuel } = await tenantScopedFrom(supabaseAdmin, tenantId, DEVIS).select('id, project_id').eq('id', req.params.id).maybeSingle();
      if (!actuel) return res.status(404).json({ error: 'Devis introuvable.' });
      const lu = await lireDevis(tenantId, (actuel as any).project_id, req.body || {});
      if ('erreur' in lu) return res.status(400).json({ error: lu.erreur });
      if (Object.keys(lu.patch).length === 0) return res.json(actuel);
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, DEVIS).update(lu.patch).eq('id', req.params.id).select().maybeSingle();
      if (error) return manquante(error) ? res.status(503).json({ error: MSG_503 }) : res.status(500).json({ error: 'Enregistrement impossible.' });
      res.json(data);
    } catch (e: any) {
      console.error('[PUT /api/devis-travaux-modificatifs/:id]', e);
      res.status(500).json({ error: 'Enregistrement impossible.' });
    }
  });

  app.delete('/api/devis-travaux-modificatifs/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, DEVIS).delete().eq('id', req.params.id);
      if (error) return manquante(error) ? res.status(503).json({ error: MSG_503 }) : res.status(500).json({ error: 'Suppression impossible.' });
      res.json({ success: true });
    } catch (e: any) {
      console.error('[DELETE /api/devis-travaux-modificatifs/:id]', e);
      res.status(500).json({ error: 'Suppression impossible.' });
    }
  });
}
