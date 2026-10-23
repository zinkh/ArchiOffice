// Phase 7 extraction — moved out of server.ts's "--- Observations routes ---"
// section. Also fixes a real tenant-isolation gap found during extraction:
// POST /api/observations/:id/link/:reportId performed zero ownership checks
// before linking an observation to a report. observation_reports has no
// tenant_id column at all (see supabase/migrate_add_observations.sql — it's
// protected only by an RLS subquery through `observations`, which
// supabaseAdmin bypasses entirely), so any authenticated caller could link
// an arbitrary observation to an arbitrary report across tenants just by
// guessing/enumerating ids. tenantScopedFrom can't be used directly on
// observation_reports (no tenant_id column to filter/stamp), so this now
// verifies both the observation and the report belong to the caller's
// tenant before inserting the link row.
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';
import { assertTenantEntity } from '../assertTenantEntity';
import { convertObservationsToReserves, CLOSED_OBSERVATION_STATUSES } from '../observationToReserve';
import { sanitizeFilename } from '../sanitizeFilename';
import { handleSingleSitePhotoUpload, sniffImageMime, resizeImage, MEETING_PHOTO_MAX_DIMENSION } from '../imageUpload';
import { MAX_OBSERVATION_LOTS } from '../../src/lib/observationLots';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  getUserName: (tenantId: string, userId: string, email?: string) => Promise<string>;
  logActivity: (tenantId: string, userId: string, userName: string, action: string, target: string, targetId: string, targetType: string, category: string) => void;
  uploadToStorage: (bucket: string, storagePath: string, buffer: Buffer, mimetype: string) => Promise<string>;
}

/** Identifiant de bâtiment/phase du registre du chantier : texte court, sinon ignoré. */
const cleanRef = (v: unknown): string => (typeof v === 'string' && v.length <= 64 ? v : '');

/**
 * Lots visés par une observation (voir src/lib/observationLots.ts) : un lot (`lot_id`), plusieurs
 * (`lot_ids`, `lot_id` = le premier) ou tous (`tce`, `lot_id` nul). Rend les colonnes à écrire, ou
 * `{}` quand le corps n'en parle pas (la modification ne touche alors pas aux lots).
 */
async function readLotTargets(supabaseAdmin: any, tenantId: string, body: any): Promise<{ fields?: Record<string, unknown>; error?: string }> {
  if (body.tce === undefined && body.lot_ids === undefined) return {};
  if (body.tce === true) return { fields: { tce: true, lot_ids: [], lot_id: null } };
  const rawIds: unknown[] = Array.isArray(body.lot_ids) ? body.lot_ids : [];
  const ids = [...new Set(rawIds.filter((v): v is string => typeof v === 'string' && v.length > 0 && v.length <= 64))].slice(0, MAX_OBSERVATION_LOTS);
  if (ids.length > 0) {
    const { data } = await supabaseAdmin.from('project_lots').select('id').eq('tenant_id', tenantId).in('id', ids);
    if (((data || []) as any[]).length !== ids.length) return { error: 'Lot introuvable pour ce cabinet.' };
  }
  if (ids.length > 1) return { fields: { tce: false, lot_ids: ids, lot_id: ids[0] } };
  // Un seul lot (ou aucun) : retour au cas historique, lot_id porté par la liste ou par le corps.
  return { fields: { tce: false, lot_ids: [], ...(ids.length === 1 ? { lot_id: ids[0] } : {}) } };
}

/** Instance dont la migration des lots multiples n'est pas jouée : l'écriture se rejoue sans ces colonnes. */
const MULTI_LOT_COLUMNS = /\b(lot_ids|tce)\b/i;
const withoutMultiLotColumns = <T extends Record<string, unknown>>(row: T): Omit<T, 'lot_ids' | 'tce'> => {
  const { lot_ids: _ids, tce: _tce, ...rest } = row;
  return rest;
};

// Verrou par opération (un seul processus) : sérialise l'attribution du numéro d'observation.
const numberLocks = new Map<string, Promise<unknown>>();
async function withProjectNumberLock<T>(projectId: string, task: () => Promise<T>): Promise<T> {
  const previous = numberLocks.get(projectId) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(task);
  const tail = run.catch(() => undefined);
  numberLocks.set(projectId, tail);
  try { return await run; } finally { if (numberLocks.get(projectId) === tail) numberLocks.delete(projectId); }
}

export function registerObservationRoutes(app: Express, { supabaseAdmin, getTenantId, getUserName, logActivity, uploadToStorage }: RouteDeps) {
  app.get("/api/projects/:projectId/observations", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { projectId } = req.params;
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'observations')
        .select(`*, lot:project_lots(id,lot_number,lot_title), created_report:site_reports!created_report_id(report_number), resolved_report:site_reports!resolved_report_id(report_number), observation_reports(report_id)`)
        .eq('project_id', projectId)
        .order('number', { ascending: true });
      if (error) throw error;
      // Numéro de la réserve de l'AOR qui reprend l'observation : une seule
      // lecture groupée, jamais une par ligne (absente tant que la migration
      // n'est pas jouée : `reserve_id` n'existe alors pas sur les lignes).
      const reserveIds = [...new Set((data || []).map((o: any) => o.reserve_id).filter(Boolean))] as string[];
      const { data: reserveRows } = reserveIds.length
        ? await supabaseAdmin.from('reserves').select('id, number').eq('tenant_id', tenantId).in('id', reserveIds)
        : { data: [] };
      const reserveNumberById = new Map<string, number>(((reserveRows || []) as any[]).map(r => [r.id, r.number]));
      const mapped = (data || []).map((o: any) => ({
        ...o,
        created_report_number: o.created_report?.report_number,
        resolved_report_number: o.resolved_report?.report_number,
        report_ids: (o.observation_reports || []).map((r: any) => r.report_id),
        // Une réserve supprimée depuis laisse un lien orphelin côté client : on ne le rend pas.
        reserve_id: o.reserve_id && reserveNumberById.has(o.reserve_id) ? o.reserve_id : null,
        reserve_number: o.reserve_id ? reserveNumberById.get(o.reserve_id) ?? null : null,
      }));
      res.json(mapped);
    } catch (error) {
      console.error("[GET /api/projects/:projectId/observations]", error);
      res.status(500).json({ error: "Failed to fetch observations" });
    }
  });

  app.post("/api/projects/:projectId/observations", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { projectId } = req.params;
      const { id: bodyId, lot_id, contact_id, texte, statut, due_date, created_report_id, type, urgence } = req.body;
      const batimentId = cleanRef(req.body.batiment_id);
      const phaseId = cleanRef(req.body.phase_id);
      // Id fourni par le client (file de synchro hors-ligne) : rejouer la
      // même création après une coupure réseau ne doit ni créer une seconde
      // observation, ni consommer un second numéro dans la séquence du projet.
      if (bodyId) {
        const { data: existing } = await tenantScopedFrom(supabaseAdmin, tenantId, 'observations').select('*').eq('id', bodyId).maybeSingle();
        if (existing) return res.status(200).json(existing);
      }
      if (lot_id && !(await assertTenantEntity(supabaseAdmin, 'project_lots', lot_id, tenantId))) {
        return res.status(400).json({ error: "Lot introuvable pour ce cabinet." });
      }
      if (contact_id && !(await assertTenantEntity(supabaseAdmin, 'contacts', contact_id, tenantId))) {
        return res.status(400).json({ error: "Contact introuvable pour ce cabinet." });
      }
      if (created_report_id) {
        const { data: report } = await tenantScopedFrom(supabaseAdmin, tenantId, 'site_reports').select('project_id').eq('id', created_report_id).maybeSingle();
        if (!report || (report as any).project_id !== projectId) return res.status(400).json({ error: "Compte rendu introuvable pour cette opération." });
      }
      const targets = await readLotTargets(supabaseAdmin, tenantId, req.body);
      if (targets.error) return res.status(400).json({ error: targets.error });
      const id = bodyId || `obs_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      // Le numéro (max + 1) est attribué sous verrou par opération : deux créations
      // simultanées ne lisent plus le même maximum et ne prennent plus le même numéro.
      const created = await withProjectNumberLock(projectId, async () => {
        const { data: existing } = await tenantScopedFrom(supabaseAdmin, tenantId, 'observations').select('number').eq('project_id', projectId).order('number', { ascending: false }).limit(1);
        const number = existing && existing.length > 0 ? ((existing[0] as any).number || 0) + 1 : 1;
        const row = {
          id, project_id: projectId, lot_id: lot_id || null, contact_id: contact_id || null,
          texte: texte || '', statut: statut || 'À faire', due_date: due_date || null,
          created_report_id: created_report_id || null, number,
          type: type || 'observation', urgence: urgence || 'normal',
          batiment_id: batimentId || null, phase_id: phaseId || null,
          ...targets.fields,
        };
        let { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'observations').insert(row).select().single();
        if (error && MULTI_LOT_COLUMNS.test(String(error.message))) {
          ({ data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'observations').insert(withoutMultiLotColumns(row)).select().single());
        }
        if (error) throw error;
        return { data, number };
      });
      const { data, number } = created;
      if (created_report_id) {
        await supabaseAdmin.from('observation_reports').insert({ observation_id: id, report_id: created_report_id });
      }
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Création de l'observation N° ${number}`, texte || '', id, 'observation', 'Réserves/Observations');
      res.json(data);
    } catch (error) {
      console.error("[POST /api/projects/:projectId/observations]", error);
      res.status(500).json({ error: "Failed to create observation" });
    }
  });

  app.put("/api/observations/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { lot_id, contact_id, texte, statut, due_date, resolved_report_id, type, urgence, photos, reponse } = req.body;
      if (lot_id && !(await assertTenantEntity(supabaseAdmin, 'project_lots', lot_id, tenantId))) {
        return res.status(400).json({ error: "Lot introuvable pour ce cabinet." });
      }
      if (contact_id && !(await assertTenantEntity(supabaseAdmin, 'contacts', contact_id, tenantId))) {
        return res.status(400).json({ error: "Contact introuvable pour ce cabinet." });
      }
      if (statut === 'Levée' && resolved_report_id && !(await assertTenantEntity(supabaseAdmin, 'site_reports', resolved_report_id, tenantId))) {
        return res.status(400).json({ error: "Compte rendu introuvable pour ce cabinet." });
      }
      const update: any = {};
      if (lot_id !== undefined) update.lot_id = lot_id || null;
      if (contact_id !== undefined) update.contact_id = contact_id || null;
      if (texte !== undefined) update.texte = texte;
      if (statut !== undefined) update.statut = statut;
      if (due_date !== undefined) update.due_date = due_date || null;
      if (type !== undefined) update.type = type;
      if (urgence !== undefined) update.urgence = urgence;
      if (photos !== undefined) update.photos = photos;
      if (reponse !== undefined) update.reponse = typeof reponse === 'string' ? reponse.slice(0, 5000) : null;
      if (req.body.batiment_id !== undefined) update.batiment_id = cleanRef(req.body.batiment_id) || null;
      if (req.body.phase_id !== undefined) update.phase_id = cleanRef(req.body.phase_id) || null;
      if (statut === 'Levée' && resolved_report_id) update.resolved_report_id = resolved_report_id;
      const targets = await readLotTargets(supabaseAdmin, tenantId, req.body);
      if (targets.error) return res.status(400).json({ error: targets.error });
      Object.assign(update, targets.fields);
      let { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'observations').update(update).eq('id', id);
      if (error && MULTI_LOT_COLUMNS.test(String(error.message))) {
        // Migration des lots multiples non jouée : on n'écrit que le reste, sans mentir sur l'attribution TCE / multi-lots.
        if (targets.fields && (targets.fields.tce === true || (targets.fields.lot_ids as unknown[])?.length > 1)) {
          return res.status(503).json({ error: "L'attribution à plusieurs lots n'est pas encore disponible sur cette instance (migration en attente)." });
        }
        ({ error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'observations').update(withoutMultiLotColumns(update)).eq('id', id));
      }
      if (error) throw error;
      res.json({ success: true });
    } catch (error) {
      console.error("[PUT /api/observations/:id]", error);
      res.status(500).json({ error: "Failed to update observation" });
    }
  });

  // Reprise en réserve de l'AOR (OPR) : une observation, ou toutes celles qui
  // restent à lever. Voir server/observationToReserve.ts.
  const respondConversionError = (res: any, route: string, error: any) => {
    console.error(`[${route}]`, error);
    // Colonne `reserve_id` absente : migration supabase/migrate_observation_reserve_link.sql non jouée.
    const missingColumn = /reserve_id/i.test(String(error?.message || ''));
    res.status(missingColumn ? 503 : 500).json({ error: missingColumn
      ? "La reprise en réserve n'est pas encore disponible sur cette instance (migration en attente)."
      : "Échec de la reprise en réserve" });
  };

  app.post("/api/observations/:id/to-reserve", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { data: obs } = await tenantScopedFrom(supabaseAdmin, tenantId, 'observations').select('project_id').eq('id', id).maybeSingle();
      if (!obs) return res.status(404).json({ error: "Observation introuvable." });
      const result = await convertObservationsToReserves(supabaseAdmin, tenantId, (obs as any).project_id, [id]);
      const skipped = result.skipped[0];
      if (skipped?.reason === 'deja_reprise') return res.status(409).json({ error: "Cette observation est déjà reprise en réserve." });
      if (skipped?.reason === 'cloturee') return res.status(400).json({ error: "Une observation levée ou refusée ne se reprend pas en réserve." });
      if (!result.created[0]) return res.status(404).json({ error: "Observation introuvable." });
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Reprise de l'observation en réserve N° ${result.created[0].number}`, '', result.created[0].reserve_id, 'reserve', 'Réserves/Observations');
      res.json(result.created[0]);
    } catch (error) {
      respondConversionError(res, 'POST /api/observations/:id/to-reserve', error);
    }
  });

  app.post("/api/projects/:projectId/observations/to-reserves", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { projectId } = req.params;
      if (!(await assertTenantEntity(supabaseAdmin, 'projects', projectId, tenantId))) {
        return res.status(404).json({ error: "Projet introuvable pour ce cabinet." });
      }
      const { data: rows } = await tenantScopedFrom(supabaseAdmin, tenantId, 'observations')
        .select('id, statut, type, reserve_id, number').eq('project_id', projectId).eq('type', 'reserve').order('number', { ascending: true });
      const candidates = ((rows || []) as any[]).filter(o => !o.reserve_id && !CLOSED_OBSERVATION_STATUSES.includes(o.statut)).map(o => o.id);
      const result = await convertObservationsToReserves(supabaseAdmin, tenantId, projectId, candidates);
      if (result.created.length > 0) {
        const userName = await getUserName(tenantId, req.user.id, req.user.email);
        logActivity(tenantId, req.user.id, userName, `Reprise de ${result.created.length} observation(s) de la DET en réserves`, '', projectId, 'project', 'Réserves/Observations');
      }
      res.json(result);
    } catch (error) {
      respondConversionError(res, 'POST /api/projects/:projectId/observations/to-reserves', error);
    }
  });

  // Image-only whitelist (same magic-byte sniffing as meeting photos): these
  // render inline in the reportage photo grid, so anything that isn't a real
  // image wouldn't display there anyway.
  app.post("/api/observations/:id/photos", handleSingleSitePhotoUpload('file'), async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const file = req.file;
      if (!file) return res.status(400).json({ error: "No file uploaded" });
      const sniffedMime = sniffImageMime(file.buffer);
      if (!sniffedMime) {
        return res.status(400).json({ error: "Type de fichier non autorisé. Formats acceptés : PNG, JPEG, WebP." });
      }
      const { data: obs } = await tenantScopedFrom(supabaseAdmin, tenantId, 'observations').select('photos').eq('id', id).maybeSingle();
      if (!obs) return res.status(404).json({ error: "Observation not found" });
      // Id fourni par le client (file de synchro hors-ligne). Les photos
      // d'observation vivent dans un simple tableau d'URL (`photos:
      // text[]`), pas une table dédiée avec sa propre clé — l'idempotence
      // se fait donc en reconnaissant l'id dans le chemin de stockage déjà
      // posé plus bas (`${photoId}-${nomFichier}`) : un envoi rejoué après
      // coupure réseau retrouve la photo déjà déposée au lieu de la reposer
      // une seconde fois.
      const clientPhotoId = typeof req.body?.id === 'string' && req.body.id ? req.body.id : null;
      const existingPhotos: string[] = (obs as any).photos || [];
      if (clientPhotoId && existingPhotos.some(url => url.includes(`/${clientPhotoId}-`))) {
        return res.status(200).json({ photos: existingPhotos });
      }
      const { buffer, mimetype } = await resizeImage(file.buffer, sniffedMime, MEETING_PHOTO_MAX_DIMENSION);
      const photoId = clientPhotoId || crypto.randomUUID();
      const storagePath = `${tenantId}/${id}/${photoId}-${sanitizeFilename(file.originalname)}`;
      const file_url = await uploadToStorage('meeting-photos', storagePath, buffer, mimetype);
      const photos = [...existingPhotos, file_url];
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'observations').update({ photos }).eq('id', id);
      if (error) throw error;
      res.status(201).json({ photos });
    } catch (error: any) {
      console.error("[POST /api/observations/:id/photos]", error);
      res.status(500).json({ error: error.message || "Failed to upload photo" });
    }
  });

  app.delete("/api/observations/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { data: obs } = await tenantScopedFrom(supabaseAdmin, tenantId, 'observations').select('number, texte').eq('id', id).maybeSingle();
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'observations').delete().eq('id', id);
      if (error) throw error;
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Suppression de l'observation N° ${(obs as any)?.number}`, (obs as any)?.texte || '', id, 'observation', 'Réserves/Observations');
      res.json({ success: true });
    } catch (error) {
      console.error("[DELETE /api/observations/:id]", error);
      res.status(500).json({ error: "Failed to delete observation" });
    }
  });

  app.get("/api/reports/:reportId/observations", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { reportId } = req.params;
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'observations')
        .select(`*, lot:project_lots(id,lot_number,lot_title), created_report:site_reports!created_report_id(report_number), resolved_report:site_reports!resolved_report_id(report_number), observation_reports!inner(report_id)`)
        .eq('observation_reports.report_id', reportId)
        .order('number', { ascending: true });
      if (error) throw error;
      const mapped = (data || []).map((o: any) => ({
        ...o,
        created_report_number: o.created_report?.report_number,
        resolved_report_number: o.resolved_report?.report_number,
        report_ids: (o.observation_reports || []).map((r: any) => r.report_id),
      }));
      res.json(mapped);
    } catch (error) {
      console.error("[GET /api/reports/:reportId/observations]", error);
      res.status(500).json({ error: "Failed to fetch report observations" });
    }
  });

  app.post("/api/observations/:id/link/:reportId", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id, reportId } = req.params;
      const { data: obs } = await tenantScopedFrom(supabaseAdmin, tenantId, 'observations').select('id').eq('id', id).maybeSingle();
      if (!obs) return res.status(404).json({ error: "Observation not found" });
      const { data: report } = await tenantScopedFrom(supabaseAdmin, tenantId, 'site_reports').select('id').eq('id', reportId).maybeSingle();
      if (!report) return res.status(404).json({ error: "Report not found" });
      const { error } = await supabaseAdmin.from('observation_reports').insert({ observation_id: id, report_id: reportId });
      if (error) throw error;
      res.json({ success: true });
    } catch (error) {
      console.error("[POST /api/observations/:id/link/:reportId]", error);
      res.status(500).json({ error: "Failed to link observation to report" });
    }
  });
}
