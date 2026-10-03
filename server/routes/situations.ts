// Phase 7 extraction — moved verbatim out of server.ts's "─── Situations
// CRUD ───" and "─── Detail Situations CRUD ───" sections (detail_situations
// rows are line items of a parent situation — kept together as one domain
// module, same convention as dpgf.ts). GET /api/situations/:projectId and
// GET /api/situations/:situationId/details join from the Projects section
// (server/routes/projects.ts) this same lot — read counterparts of the
// mutations already here, just never extracted alongside them.
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';
import { assertTenantEntity } from '../assertTenantEntity';
import { montantDepuisLignes, validerAvancementLignes } from '../../src/lib/situationDetaillee';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  getUserName: (tenantId: string, userId: string, email?: string) => Promise<string>;
  logActivity: (tenantId: string, userId: string, userName: string, action: string, target: string, targetId: string, targetType: string, category: string) => Promise<void>;
}

export function registerSituationRoutes(app: Express, { supabaseAdmin, getTenantId, getUserName, logActivity }: RouteDeps) {
  app.get('/api/situations/:projectId', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'situations').select('*').eq('project_id', req.params.projectId);
      if (error) throw error;
      res.json(data);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to fetch situations" }); }
  });

  app.get('/api/situations/:situationId/details', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'detail_situations').select('*').eq('situation_id', req.params.situationId);
      if (error) throw error;
      res.json(data);
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to fetch situation details" }); }
  });

  // Champs d'une situation de travaux qu'un client peut écrire. Les colonnes
  // de liaison Chorus Pro / Super PDP restent réservées à leurs propres routes.
  const SITUATION_FIELDS = [
    'numero_situation', 'date_situation', 'etat', 'marche_id', 'date_reception_situation',
    'reference_entreprise', 'montant_presente_ht', 'montant_admis_ht', 'date_certificat',
    'revision_coeff', 'penalites_ht', 'penalites_notes', 'avance_remboursement', 'notes_moe',
    'mode_saisie',
  ] as const;
  const MODES_SAISIE = ['simple', 'detaille'];
  const SITUATION_ETATS = ['Brouillon', 'Validée', 'Payée'];
  const AMOUNT_FIELDS = new Set(['montant_presente_ht', 'montant_admis_ht', 'revision_coeff', 'penalites_ht', 'avance_remboursement']);
  const DATE_FIELDS = new Set(['date_reception_situation', 'date_certificat']);

  /** Garde les champs connus, vide en null, montants en nombres. Rend une erreur lisible sinon. */
  function pickSituation(body: any): { row: Record<string, any>; error?: string } {
    const row: Record<string, any> = {};
    for (const key of SITUATION_FIELDS) {
      if (!(key in (body ?? {}))) continue;
      let value = body[key];
      if (typeof value === 'string') value = value.trim();
      if (value === '' || value === undefined) value = null;
      if (value !== null && AMOUNT_FIELDS.has(key)) {
        const n = typeof value === 'number' ? value : parseFloat(String(value).replace(',', '.'));
        if (!Number.isFinite(n)) return { row, error: `Montant invalide : ${key}.` };
        value = n;
      }
      if (value !== null && DATE_FIELDS.has(key) && !/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
        return { row, error: `Date invalide : ${key}.` };
      }
      if (key === 'etat' && value !== null && !SITUATION_ETATS.includes(value)) {
        return { row, error: 'État de situation inconnu.' };
      }
      if (key === 'numero_situation' && value !== null) {
        const n = Number(value);
        if (!Number.isInteger(n) || n < 1) return { row, error: 'Numéro de situation invalide.' };
        value = n;
      }
      if (key === 'mode_saisie' && value !== null && !MODES_SAISIE.includes(value)) {
        return { row, error: 'Mode de saisie inconnu.' };
      }
      row[key] = value;
    }
    if (row.mode_saisie === null) delete row.mode_saisie;
    // Mode détaillé : l'avancement ligne par ligne du DPGF, figé dans la situation.
    if (body && 'avancement_lignes' in body) {
      const { lignes, error } = validerAvancementLignes(body.avancement_lignes);
      if (error) return { row, error };
      row.avancement_lignes = lignes ?? null;
    }
    return { row };
  }

  /**
   * En mode détaillé, le cumul présenté se DÉDUIT des lignes : c'est le serveur
   * qui fait la somme, jamais un montant envoyé à côté des lignes.
   */
  function deduireCumul(row: Record<string, any>, modeActuel: string | null) {
    const mode = row.mode_saisie ?? modeActuel ?? 'simple';
    if (mode === 'detaille' && Array.isArray(row.avancement_lignes)) {
      row.montant_presente_ht = montantDepuisLignes(row.avancement_lignes);
    }
  }

  app.post('/api/situations', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { project_id } = req.body ?? {};
      if (!project_id || !(await assertTenantEntity(supabaseAdmin, 'projects', project_id, tenantId))) {
        return res.status(400).json({ error: "Projet introuvable pour ce cabinet." });
      }
      const { row, error: invalid } = pickSituation(req.body);
      if (invalid) return res.status(400).json({ error: invalid });
      if (row.marche_id && !(await assertTenantEntity(supabaseAdmin, 'marches_entreprises', row.marche_id, tenantId))) {
        return res.status(400).json({ error: "Marché introuvable pour ce cabinet." });
      }
      deduireCumul(row, null);
      // Numérotée par marché : la première situation d'une entreprise est la n°1.
      if (!row.numero_situation) {
        let query = tenantScopedFrom(supabaseAdmin, tenantId, 'situations').select('numero_situation').eq('project_id', project_id);
        query = row.marche_id ? query.eq('marche_id', row.marche_id) : query.is('marche_id', null);
        const { data: existing } = await query;
        row.numero_situation = (existing ?? []).reduce((max: number, s: any) => Math.max(max, Number(s.numero_situation) || 0), 0) + 1;
      }
      const id = crypto.randomUUID();
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'situations')
        .insert({
          id, project_id, etat: 'Brouillon',
          date_situation: new Date().toISOString().slice(0, 10),
          ...row,
        })
        .select().single();
      if (error) throw error;
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Création de la situation N° ${row.numero_situation}`, String(row.numero_situation), id, 'situation', 'Situations/DPGF');
      res.status(201).json(data);
    } catch (e: any) {
      console.error('[POST /api/situations]', e);
      res.status(500).json({ error: 'Failed to create situation: ' + e.message });
    }
  });

  app.put('/api/situations/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { row, error: invalid } = pickSituation(req.body);
      if (invalid) return res.status(400).json({ error: invalid });
      if (row.marche_id && !(await assertTenantEntity(supabaseAdmin, 'marches_entreprises', row.marche_id, tenantId))) {
        return res.status(400).json({ error: "Marché introuvable pour ce cabinet." });
      }
      let modeActuel: string | null = null;
      if ('avancement_lignes' in row && !('mode_saisie' in row)) {
        const { data: actuelle } = await tenantScopedFrom(supabaseAdmin, tenantId, 'situations')
          .select('mode_saisie').eq('id', req.params.id).maybeSingle();
        modeActuel = (actuelle as any)?.mode_saisie ?? null;
      }
      deduireCumul(row, modeActuel);
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'situations')
        .update({ ...row, updated_at: new Date().toISOString() })
        .eq('id', req.params.id).select().maybeSingle();
      if (error) throw error;
      if (!data) return res.status(404).json({ error: 'Situation introuvable.' });
      res.json(data);
    } catch (e: any) {
      console.error('[PUT /api/situations/:id]', e);
      res.status(500).json({ error: 'Failed to update situation: ' + e.message });
    }
  });

  app.delete('/api/situations/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: situation } = await tenantScopedFrom(supabaseAdmin, tenantId, 'situations').select('numero_situation').eq('id', req.params.id).maybeSingle();
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'situations').delete().eq('id', req.params.id);
      if (error) throw error;
      const numero = (situation as any)?.numero_situation;
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Suppression de la situation N° ${numero}`, String(numero ?? ''), req.params.id, 'situation', 'Situations/DPGF');
      res.json({ success: true });
    } catch (e: any) {
      console.error('[DELETE /api/situations/:id]', e);
      res.status(500).json({ error: 'Failed to delete situation' });
    }
  });

  app.post('/api/detail-situations', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id: bodyId, situation_id, dpgf_item_id, quantite_realisee, montant_situation } = req.body;
      if (situation_id && !(await assertTenantEntity(supabaseAdmin, 'situations', situation_id, tenantId))) {
        return res.status(400).json({ error: "Situation introuvable pour ce cabinet." });
      }
      if (dpgf_item_id && !(await assertTenantEntity(supabaseAdmin, 'dpgf_items', dpgf_item_id, tenantId))) {
        return res.status(400).json({ error: "Ligne DPGF introuvable pour ce cabinet." });
      }
      const id = bodyId || crypto.randomUUID();
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'detail_situations')
        .insert({ id, situation_id, dpgf_item_id, quantite_realisee, montant_situation })
        .select().single();
      if (error) throw error;
      res.status(201).json(data);
    } catch (e: any) {
      console.error('[POST /api/detail-situations]', e);
      res.status(500).json({ error: 'Failed to create detail situation: ' + e.message });
    }
  });

  app.put('/api/detail-situations/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { quantite_realisee, montant_situation } = req.body;
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'detail_situations')
        .update({ quantite_realisee, montant_situation })
        .eq('id', req.params.id).select().single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) {
      console.error('[PUT /api/detail-situations/:id]', e);
      res.status(500).json({ error: 'Failed to update detail situation: ' + e.message });
    }
  });

  app.delete('/api/detail-situations/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'detail_situations').delete().eq('id', req.params.id);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) {
      console.error('[DELETE /api/detail-situations/:id]', e);
      res.status(500).json({ error: 'Failed to delete detail situation' });
    }
  });
}
