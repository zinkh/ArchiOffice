// Croquis de réunion et de compte-rendu de chantier : liste, création, enregistrement,
// suppression, fond (plan ou photo) et aperçu PNG. Table `croquis`
// (supabase/migrate_croquis.sql), composant src/components/croquis/CroquisEditor.tsx.
//
// Règles à garder :
// - Un croquis dépend d'UNE réunion OU d'UN compte-rendu (contrainte `croquis_one_parent`).
//   Son `project_id` est TOUJOURS lu sur ce parent, jamais pris dans le corps : une requête ne
//   peut pas le rattacher à une autre affaire que celle de sa réunion.
// - Création idempotente : le client génère l'identifiant (file hors ligne) et un rejeu rend la
//   ligne déjà créée (200) au lieu d'un doublon.
// - La scène est revalidée à chaque écriture (`sanitizeScene`) : le serveur ne fait pas confiance
//   à la forme que le client prétend envoyer.
// - Le fond et l'aperçu sont des fichiers du cabinet (`storeBusinessFile`, dossier « Croquis » de
//   l'affaire) ; seules leurs références vivent en base. Un nouveau fichier remplace l'ancien, qui
//   n'est retiré qu'une fois la ligne à jour (un échec ne perd jamais le fichier encore référencé).
// - Les fichiers d'un croquis sont retirés avec lui, avec sa réunion et avec son affaire.
// - Instance non migrée : la lecture rend une liste vide, l'écriture un 503 explicite.
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';
import { firstForeignRelation } from '../assertTenantEntity';
import { handleSingleSitePhotoUpload, sniffImageMime, extensionForImageMime } from '../imageUpload';
import { isOwnStorageRef } from '../externalStorage/externalRef';
import { buildCroquisFolderPath } from '../externalStorage/businessFolderPath';
import type { RemoveBusinessFile, StoreBusinessFile } from '../externalStorage/storeBusinessFile';
import { isProjectArchived } from './projectArchive';
import { emptyScene, sanitizeScene, serializeScene } from '../../src/lib/croquis/scene';
import type { CroquisScene } from '../../src/types/croquis';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  storeBusinessFile: StoreBusinessFile;
  removeBusinessFile: RemoveBusinessFile;
}

const TABLE = 'croquis';
const ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const DEFAULT_TITLE = 'Croquis';
const MAX_TITLE = 200;
const MAX_SCENE_BYTES = 4_000_000;
const MAX_PER_PARENT = 50;
const MAX_IMAGE_SIDE = 10_000;
const MIN_OPACITY = 0.05;

const UNAVAILABLE = { error: 'Les croquis demandent une mise à jour de la base.', code: 'CROQUIS_UNAVAILABLE' };
const ARCHIVED = { error: 'Affaire archivée : rouvrez-la pour la modifier.', code: 'PROJECT_ARCHIVED' };

/** Table absente : instance dont la base n'a pas encore joué la migration. */
function isMissingTable(error: any): boolean {
  const message = String(error?.message || '');
  return error?.code === '42P01' || error?.code === 'PGRST205'
    || (/croquis/.test(message) && /does not exist|schema cache/i.test(message));
}

function cleanTitle(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);
}

/** `undefined` : absente. `null` : invalide. Sinon la valeur ramenée entre 0,05 et 1. */
function readOpacity(value: unknown): number | undefined | null {
  if (value === undefined) return undefined;
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
  if (!Number.isFinite(n)) return null;
  return Math.min(1, Math.max(MIN_OPACITY, Math.round(n * 100) / 100));
}

/** `undefined` : absente. `null` : invalide. Sinon un entier de 1 à 10 000. */
function readDimension(value: unknown): number | undefined | null {
  if (value === undefined || value === '') return undefined;
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isInteger(n) && n >= 1 && n <= MAX_IMAGE_SIDE ? n : null;
}

function normalizeScene(raw: unknown): { scene: CroquisScene } | { status: number; error: string } {
  const scene = sanitizeScene(raw);
  if (!scene) return { status: 400, error: 'Scène de croquis invalide.' };
  const json = serializeScene(scene);
  if (json.length > MAX_SCENE_BYTES) return { status: 413, error: 'Ce croquis est trop volumineux.' };
  // On enregistre la forme arrondie (2 décimales) : plus légère, et c'est celle que le client relira.
  return { scene: JSON.parse(json) as CroquisScene };
}

function fail(res: any, e: any, label: string) {
  if (isMissingTable(e)) return res.status(503).json(UNAVAILABLE);
  console.error(`[${label}]`, e);
  if (typeof e?.status === 'number') return res.status(e.status).json({ error: e.message || 'Opération impossible.' });
  return res.status(500).json({ error: 'Opération impossible sur le croquis.' });
}

export function registerCroquisRoutes(app: Express, { supabaseAdmin, getTenantId, storeBusinessFile, removeBusinessFile }: RouteDeps) {
  const scoped = (tenantId: string) => tenantScopedFrom(supabaseAdmin, tenantId, TABLE);

  async function loadRow(tenantId: string, id: string) {
    const { data, error } = await scoped(tenantId).select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return data;
  }

  /** Retire du stockage les fichiers d'un croquis. Au mieux : un échec ne bloque jamais l'écriture en cours. */
  function dropFiles(tenantId: string, refs: Array<string | null | undefined>) {
    for (const ref of refs) {
      if (ref && isOwnStorageRef(ref, 'documents')) removeBusinessFile(tenantId, 'documents', ref).catch(() => {});
    }
  }

  async function folderPathFor(tenantId: string, projectId: string | null) {
    const { data: project } = projectId
      ? await supabaseAdmin.from('projects').select('project_code, name').eq('id', projectId).eq('tenant_id', tenantId).maybeSingle()
      : { data: null };
    return buildCroquisFolderPath(project as any);
  }

  /** Dépose une image (fond ou aperçu) dans le dossier « Croquis » de l'affaire. */
  async function storeImage(tenantId: string, row: any, file: { buffer: Buffer }, kind: 'fond' | 'apercu') {
    const mime = sniffImageMime(file.buffer);
    if (!mime) throw Object.assign(new Error('Image illisible. Formats acceptés : PNG, JPEG, WebP.'), { status: 400 });
    const ext = extensionForImageMime(mime);
    // Nom unique à chaque dépôt : remplacer un fichier ne doit jamais dépendre de la gestion des doublons du drive.
    const stamp = Date.now().toString(36);
    return storeBusinessFile({
      tenantId,
      bucket: 'documents',
      folderPath: await folderPathFor(tenantId, row.project_id ?? null),
      fileName: `${cleanTitle(row.title) || DEFAULT_TITLE} - ${kind === 'fond' ? 'fond' : 'aperçu'} ${stamp}.${ext}`,
      // Chemin Supabase de repli : ASCII, préfixé du cabinet (condition de la lecture par URL signée).
      supabasePath: `${tenantId}/croquis/${row.id}/${kind}-${stamp}.${ext}`,
    }, file.buffer, mime);
  }

  async function handleImageUpload(req: any, res: any, kind: 'fond' | 'apercu') {
    try {
      const tenantId = await getTenantId(req.user.id);
      const row = await loadRow(tenantId, req.params.id);
      if (!row) return res.status(404).json({ error: 'Croquis introuvable.' });
      if (!req.file) return res.status(400).json({ error: 'Aucun fichier envoyé.' });

      let width: number | undefined | null;
      let height: number | undefined | null;
      if (kind === 'fond') {
        width = readDimension(req.body?.width);
        height = readDimension(req.body?.height);
        if (!width || !height) return res.status(400).json({ error: 'Dimensions du fond invalides.' });
      }

      const stored = await storeImage(tenantId, row, req.file, kind);
      const patch: Record<string, unknown> = kind === 'fond'
        ? { bg_path: stored.fileUrl, bg_width: width, bg_height: height, updated_at: new Date().toISOString() }
        : { preview_path: stored.fileUrl };
      const { data, error } = await scoped(tenantId).update(patch).eq('id', row.id).select().maybeSingle();
      if (error || !data) {
        // La ligne n'a pas bougé : le nouveau fichier ne serait référencé par personne.
        dropFiles(tenantId, [stored.fileUrl]);
        if (error) throw error;
        return res.status(404).json({ error: 'Croquis introuvable.' });
      }
      dropFiles(tenantId, [kind === 'fond' ? row.bg_path : row.preview_path]);
      res.json(data);
    } catch (e: any) {
      fail(res, e, `POST /api/croquis/:id/${kind}`);
    }
  }

  app.get('/api/croquis', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const meetingId = typeof req.query.meeting_id === 'string' ? req.query.meeting_id : '';
      const reportId = typeof req.query.site_report_id === 'string' ? req.query.site_report_id : '';
      if (Boolean(meetingId) === Boolean(reportId)) {
        return res.status(400).json({ error: 'Précisez une réunion ou un compte-rendu.' });
      }
      const relation = meetingId
        ? { table: 'meetings', id: meetingId, label: 'Réunion' }
        : { table: 'site_reports', id: reportId, label: 'Compte-rendu' };
      const foreign = await firstForeignRelation(supabaseAdmin, tenantId, [relation]);
      if (foreign) return res.status(404).json({ error: foreign });

      const { data, error } = await scoped(tenantId).select('*')
        .eq(meetingId ? 'meeting_id' : 'site_report_id', relation.id)
        .order('created_at', { ascending: true });
      if (error) {
        if (isMissingTable(error)) return res.json([]);
        throw error;
      }
      res.json(data || []);
    } catch (e: any) {
      fail(res, e, 'GET /api/croquis');
    }
  });

  app.get('/api/croquis/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const row = await loadRow(tenantId, req.params.id);
      if (!row) return res.status(404).json({ error: 'Croquis introuvable.' });
      res.json(row);
    } catch (e: any) {
      if (isMissingTable(e)) return res.status(404).json({ error: 'Croquis introuvable.' });
      fail(res, e, 'GET /api/croquis/:id');
    }
  });

  app.post('/api/croquis', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const body = req.body ?? {};
      if (body.id !== undefined && (typeof body.id !== 'string' || !ID_PATTERN.test(body.id))) {
        return res.status(400).json({ error: 'Identifiant de croquis invalide.' });
      }
      const present = (v: unknown) => v !== undefined && v !== null && v !== '';
      const hasMeeting = present(body.meeting_id);
      const hasReport = present(body.site_report_id);
      if (hasMeeting === hasReport) {
        return res.status(400).json({
          error: hasMeeting
            ? 'Un croquis dépend d’une réunion ou d’un compte-rendu, pas des deux.'
            : 'Précisez la réunion ou le compte-rendu du croquis.',
        });
      }
      const relation = hasMeeting
        ? { table: 'meetings', id: body.meeting_id, label: 'Réunion' }
        : { table: 'site_reports', id: body.site_report_id, label: 'Compte-rendu' };
      const foreign = await firstForeignRelation(supabaseAdmin, tenantId, [relation]);
      if (foreign) return res.status(400).json({ error: foreign });

      const id: string = body.id ?? crypto.randomUUID();
      // Rejeu d'une écriture mise en file : la ligne existe déjà, on la rend telle quelle.
      const existing = await loadRow(tenantId, id);
      if (existing) return res.status(200).json(existing);

      const { data: parent } = await tenantScopedFrom(supabaseAdmin, tenantId, relation.table)
        .select('project_id').eq('id', relation.id).maybeSingle();
      const projectId = typeof (parent as any)?.project_id === 'string' ? (parent as any).project_id : null;
      if (projectId && await isProjectArchived(supabaseAdmin, tenantId, projectId)) {
        return res.status(409).json(ARCHIVED);
      }

      const column = hasMeeting ? 'meeting_id' : 'site_report_id';
      const { data: siblings, error: countError } = await scoped(tenantId).select('id').eq(column, relation.id);
      if (countError) throw countError;
      if ((siblings?.length ?? 0) >= MAX_PER_PARENT) {
        return res.status(400).json({ error: `Nombre maximal de croquis atteint (${MAX_PER_PARENT}).` });
      }

      const normalized = body.scene === undefined ? { scene: emptyScene() } : normalizeScene(body.scene);
      if ('error' in normalized) return res.status(normalized.status).json({ error: normalized.error });
      const opacity = readOpacity(body.bg_opacity);
      if (opacity === null) return res.status(400).json({ error: 'Opacité du fond invalide.' });

      const now = new Date().toISOString();
      const { data, error } = await scoped(tenantId).insert({
        id,
        project_id: projectId,
        meeting_id: hasMeeting ? relation.id : null,
        site_report_id: hasReport ? relation.id : null,
        title: cleanTitle(body.title) || DEFAULT_TITLE,
        scene: normalized.scene,
        ...(opacity === undefined ? {} : { bg_opacity: opacity }),
        created_by: req.user.id,
        created_at: now,
        updated_at: now,
      }).select().single();
      if (error) {
        // Deux rejeux simultanés : le second tombe sur la clé primaire, la ligne existe.
        if (error.code === '23505') {
          const replay = await loadRow(tenantId, id);
          if (replay) return res.status(200).json(replay);
        }
        throw error;
      }
      res.status(201).json(data);
    } catch (e: any) {
      fail(res, e, 'POST /api/croquis');
    }
  });

  // Enregistrement partiel : seuls les champs présents dans le corps changent.
  app.put('/api/croquis/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const row = await loadRow(tenantId, req.params.id);
      if (!row) return res.status(404).json({ error: 'Croquis introuvable.' });

      const body = req.body ?? {};
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (body.title !== undefined) patch.title = cleanTitle(body.title) || DEFAULT_TITLE;
      if (body.scene !== undefined) {
        const normalized = normalizeScene(body.scene);
        if ('error' in normalized) return res.status(normalized.status).json({ error: normalized.error });
        patch.scene = normalized.scene;
      }
      if (body.bg_opacity !== undefined) {
        const opacity = readOpacity(body.bg_opacity);
        if (opacity === null || opacity === undefined) return res.status(400).json({ error: 'Opacité du fond invalide.' });
        patch.bg_opacity = opacity;
      }

      const { data, error } = await scoped(tenantId).update(patch).eq('id', row.id).select().maybeSingle();
      if (error) throw error;
      if (!data) return res.status(404).json({ error: 'Croquis introuvable.' });
      res.json(data);
    } catch (e: any) {
      fail(res, e, 'PUT /api/croquis/:id');
    }
  });

  app.delete('/api/croquis/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const row = await loadRow(tenantId, req.params.id);
      // Déjà supprimé (rejeu d'une écriture en file) : le résultat voulu est atteint.
      if (!row) return res.json({ success: true });
      const { error } = await scoped(tenantId).delete().eq('id', row.id);
      if (error) throw error;
      dropFiles(tenantId, [row.bg_path, row.preview_path]);
      res.json({ success: true });
    } catch (e: any) {
      fail(res, e, 'DELETE /api/croquis/:id');
    }
  });

  app.post('/api/croquis/:id/background', handleSingleSitePhotoUpload('file'), (req: any, res: any) => handleImageUpload(req, res, 'fond'));
  app.post('/api/croquis/:id/preview', handleSingleSitePhotoUpload('file'), (req: any, res: any) => handleImageUpload(req, res, 'apercu'));

  // Retour à la feuille blanche.
  app.delete('/api/croquis/:id/background', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const row = await loadRow(tenantId, req.params.id);
      if (!row) return res.status(404).json({ error: 'Croquis introuvable.' });
      const { data, error } = await scoped(tenantId)
        .update({ bg_path: null, bg_width: null, bg_height: null, updated_at: new Date().toISOString() })
        .eq('id', row.id).select().maybeSingle();
      if (error) throw error;
      dropFiles(tenantId, [row.bg_path]);
      res.json(data);
    } catch (e: any) {
      fail(res, e, 'DELETE /api/croquis/:id/background');
    }
  });

  // Les lignes partent en cascade avec leur réunion ou leur affaire (clés étrangères), pas leurs fichiers :
  // on relève les références AVANT la suppression et on ne les retire que si elle a réussi.
  function cleanupFilesOnDelete(path: string, column: 'meeting_id' | 'project_id') {
    app.delete(path, async (req: any, res: any, next: any) => {
      try {
        if (req.user?.id) {
          const tenantId = await getTenantId(req.user.id);
          const { data } = await scoped(tenantId).select('bg_path, preview_path').eq(column, req.params.id);
          const refs = (data || []).flatMap((r: any) => [r.bg_path, r.preview_path]);
          if (refs.length) {
            res.once('finish', () => {
              if (res.statusCode >= 200 && res.statusCode < 300) dropFiles(tenantId, refs);
            });
          }
        }
      } catch {
        /* au mieux : la suppression de la réunion ou de l'affaire n'en dépend pas */
      }
      next();
    });
  }
  cleanupFilesOnDelete('/api/meetings/:id', 'meeting_id');
  cleanupFilesOnDelete('/api/projects/:id', 'project_id');
}
