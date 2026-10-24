// API de synchronisation desktop : /api/desktop/v1. Voir docs/desktop-sync-contract.md.
//
// Consommée par les composants natifs (Cloud Files API sous Windows, File Provider sous
// macOS), authentifiés par un jeton d'appareil `ds_at_…` (server/desktop/deviceTokens.ts)
// ou, pour l'enregistrement d'un appareil, par la session de l'application Electron.
//
// Le jeton d'appareil ne donne accès QU'À ce préfixe : server.ts refuse tout autre chemin.
// Le cabinet se désigne par X-Tenant-Id, revérifié contre les adhésions par le même
// middleware que le reste de l'API.
//
// Instance non migrée (supabase/migrate_desktop_sync.sql) : 503 DESKTOP_SYNC_UNAVAILABLE sur ce
// préfixe, sans toucher au reste de l'API.
//
// Pas encore fait (voir le contrat) : flux SSE /events (le sondage de /changes suffit),
// notification de la personne dont on rompt le verrou, création de dossier.
import express from 'express';
import type { Express } from 'express';
import { isCadFileName, isIgnoredFileName, fileExtension } from '../../src/lib/cadFiles';
import { DEFAULT_PHASE_CODE, documentNodeId, parseNodeId } from '../../src/lib/desktopNodes';
import { assertTenantEntity } from '../assertTenantEntity';
import { DANGEROUS_EXTENSIONS } from '../documentUpload';
import { getConnectionById } from '../externalStorage/externalConnection';
import { isExternalRef, parseExternalRef } from '../externalStorage/externalRef';
import { signExternalTicket } from '../externalStorage/externalTicket';
import type { RemoveBusinessFile, StoreBusinessFile } from '../externalStorage/storeBusinessFile';
import { parseStorageRef } from '../storagePaths';
import { listMembershipsWithTenants } from '../tenantMemberships';
import { buildEvents, currentCursor, getFloor, maybePrune, parseCursor, parseLimit, readChangeRows } from '../desktop/changes';
import { issueDevice, listDevices, parseDeviceInput, revokeDevice, TooManyDevicesError } from '../desktop/deviceTokens';
import { acquireLock, getLockMode, releaseLock, renewLock, toLockView } from '../desktop/locks';
import {
  canDeleteRole, DesktopError, getNode, listChildren, listVersions, loadDocument, nodesForDocuments,
  type NodeContext,
} from '../desktop/nodes';
import {
  assertWritableDocument, completeUpload, nextIndice, openUpload, receiveChunk, uploadStatus, MAX_CHUNK_BYTES,
} from '../desktop/uploads';
import { isProjectArchived } from './projectArchive';

export interface DesktopRouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  getUserName: (tenantId: string, userId: string, email?: string) => Promise<string>;
  logActivity: (tenantId: string, userId: string, userName: string, action: string, target: string, targetId: string, targetType: string, category: string) => void;
  checkQuota: (tenantId: string, resource: 'projects' | 'users' | 'documents') => Promise<void>;
  storeBusinessFile: StoreBusinessFile;
  removeBusinessFile: RemoveBusinessFile;
  getSystemRole: (tenantId: string, userId: string) => Promise<string | null>;
}

const MISSING_SCHEMA_CODES = new Set(['42P01', '42703', 'PGRST204', 'PGRST205']);
const SIGNED_URL_TTL_SECONDS = 60 * 60;
const DOC_STATUSES = new Set(['en_cours', 'approuve', 'perime']);

function isMissingSchema(e: any): boolean {
  if (MISSING_SCHEMA_CODES.has(e?.code)) return true;
  const message = String(e?.message ?? '');
  return /desktop_|document_locks|deleted_at|content_sha256|desktop_lock_mode/.test(message)
    && /does not exist|schema cache/i.test(message);
}

/** Version attendue par un `If-Match: "v7"` ou un champ `baseVersion`. */
function expectedVersion(req: any): number | null {
  const header = String(req.headers['if-match'] ?? '').match(/(\d{1,9})/);
  if (header) return Number(header[1]);
  return Number.isInteger(req.body?.baseVersion) ? req.body.baseVersion : null;
}

export function registerDesktopSyncRoutes(app: Express, deps: DesktopRouteDeps) {
  const { supabaseAdmin: db } = deps;
  const BASE = '/api/desktop/v1';

  async function contextFor(req: any): Promise<NodeContext> {
    const tenantId = await deps.getTenantId(req.user.id);
    const [role, lockMode] = await Promise.all([
      deps.getSystemRole(tenantId, req.user.id),
      getLockMode(db, tenantId),
    ]);
    return { db, tenantId, userId: req.user.id, role, lockMode };
  }

  function handle(fn: (req: any, res: any) => Promise<void>) {
    return async (req: any, res: any) => {
      try {
        await fn(req, res);
      } catch (e: any) {
        if (e instanceof DesktopError) {
          return res.status(e.status).json({ error: e.message, code: e.code, ...e.extra });
        }
        if (isMissingSchema(e)) {
          return res.status(503).json({
            error: "La synchronisation desktop n'est pas activée sur cette instance (migration manquante).",
            code: 'DESKTOP_SYNC_UNAVAILABLE',
          });
        }
        if (e?.status && e?.status < 500) {
          return res.status(e.status).json({ error: e.message, code: e.code });
        }
        console.error('[desktop-sync]', req.method, req.originalUrl, e);
        res.status(e?.status || 500).json({ error: 'Échec de la synchronisation desktop.', code: 'INTERNAL' });
      }
    };
  }

  const documentIdOf = (rawId: string): string => {
    const parsed = parseNodeId(rawId);
    if (parsed?.kind !== 'doc') throw new DesktopError(400, 'NOT_A_FILE', "Ce nœud n'est pas un fichier.");
    return parsed.documentId;
  };

  const requireDocument = async (ctx: NodeContext, rawId: string, includeDeleted = false) => {
    const doc = await loadDocument(ctx, documentIdOf(rawId), { includeDeleted });
    if (!doc) throw new DesktopError(404, 'NODE_NOT_FOUND', 'Document introuvable.');
    return doc;
  };

  const respondNode = async (ctx: NodeContext, documentId: string) => {
    const doc = await loadDocument(ctx, documentId);
    if (!doc) throw new DesktopError(404, 'NODE_NOT_FOUND', 'Document introuvable.');
    return (await nodesForDocuments(ctx, [doc]))[0];
  };

  // ── Appareils ──────────────────────────────────────────────────────────────

  app.post(`${BASE}/devices`, handle(async (req, res) => {
    // Un appareil ne s'enregistre pas lui-même : il faut la session de l'application.
    if (req.deviceId) throw new DesktopError(403, 'DEVICE_TOKEN_NOT_ALLOWED', "Un appareil ne peut pas en enregistrer un autre.");
    const parsed = parseDeviceInput(req.body);
    if ('error' in parsed) throw new DesktopError(400, 'INVALID_DEVICE', parsed.error);
    try {
      const { device, token } = await issueDevice(db, req.user.id, parsed.input);
      res.status(201).json({ deviceId: device.id, token, expiresAt: device.expiresAt });
    } catch (e) {
      if (e instanceof TooManyDevicesError) throw new DesktopError(409, 'TOO_MANY_DEVICES', e.message);
      throw e;
    }
  }));

  app.get(`${BASE}/devices`, handle(async (req, res) => {
    const devices = await listDevices(db, req.user.id);
    res.json(devices.map(d => ({ ...d, current: d.id === req.deviceId })));
  }));

  app.delete(`${BASE}/devices/:id`, handle(async (req, res) => {
    const revoked = await revokeDevice(db, req.user.id, String(req.params.id));
    if (!revoked) throw new DesktopError(404, 'DEVICE_NOT_FOUND', 'Appareil introuvable.');
    res.json({ success: true });
  }));

  // ── Lecture de l'arborescence ──────────────────────────────────────────────

  app.get(`${BASE}/roots`, handle(async (req, res) => {
    const memberships = await listMembershipsWithTenants(db, req.user.id);
    res.json(memberships.map(m => ({
      tenantId: m.tenantId, name: m.tenantName, role: m.systemRole, isDefault: m.isDefault,
      nodeId: `tenant:${m.tenantId}`,
    })));
  }));

  app.get(`${BASE}/nodes/:id`, handle(async (req, res) => {
    const ctx = await contextFor(req);
    const node = await getNode(ctx, String(req.params.id));
    if (!node) throw new DesktopError(404, 'NODE_NOT_FOUND', 'Nœud introuvable.');
    if (node.etag) res.set('ETag', `"${node.etag}"`);
    res.json(node);
  }));

  app.get(`${BASE}/nodes/:id/children`, handle(async (req, res) => {
    const ctx = await contextFor(req);
    res.json(await listChildren(ctx, String(req.params.id), {
      cursor: req.query.cursor ? String(req.query.cursor) : null,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    }));
  }));

  app.get(`${BASE}/nodes/:id/versions`, handle(async (req, res) => {
    const ctx = await contextFor(req);
    const doc = await requireDocument(ctx, String(req.params.id));
    res.json(await listVersions(ctx, doc.id));
  }));

  // Lecture des octets : jamais de lien public chez le fournisseur. Supabase rend une URL
  // signée d'une heure, l'espace du cabinet passe par un jeton HMAC propre à notre origine
  // (qui retransmet `Range`, voir storageAccess.ts).
  app.get(`${BASE}/nodes/:id/content`, handle(async (req, res) => {
    const ctx = await contextFor(req);
    const doc = await requireDocument(ctx, String(req.params.id));
    let fileUrl: string = doc.file_url;
    if (req.query.version !== undefined) {
      const version = Number(req.query.version);
      if (!Number.isInteger(version) || version < 1) throw new DesktopError(400, 'INVALID_VERSION', 'Version invalide.');
      const { data } = await db.from('document_versions').select('file_url')
        .eq('tenant_id', ctx.tenantId).eq('document_id', doc.id).eq('version', version).maybeSingle();
      if (!data) throw new DesktopError(404, 'VERSION_NOT_FOUND', 'Version introuvable.');
      fileUrl = data.file_url;
    } else {
      res.set('ETag', `"v${doc.version ?? 1}"`);
      if (doc.content_sha256) res.set('X-Content-SHA256', doc.content_sha256);
    }

    if (isExternalRef(fileUrl)) {
      if (process.env.OFFLINE_MODE === 'true') {
        throw new DesktopError(503, 'NOT_AVAILABLE_OFFLINE', "Ce fichier est hébergé sur l'espace de stockage du cabinet et n'est pas disponible hors ligne.");
      }
      const ref = parseExternalRef(fileUrl);
      if (!ref) throw new DesktopError(400, 'INVALID_REF', 'Référence de stockage invalide.');
      // L'appartenance de la CONNEXION au cabinet fait ici frontière d'autorisation.
      if (!(await getConnectionById(db, ctx.tenantId, ref.connectionId))) {
        throw new DesktopError(403, 'ACCESS_DENIED', 'Accès refusé.');
      }
      const ticket = signExternalTicket({ t: ctx.tenantId, c: ref.connectionId, e: ref.externalId, n: ref.fileName });
      return void res.redirect(302, `/api/storage/external/${encodeURIComponent(ticket)}`);
    }
    const ref = parseStorageRef(fileUrl);
    if (!ref || !ref.path.startsWith(`${ctx.tenantId}/`)) {
      // Le préfixe du cabinet est la frontière d'autorisation des fichiers Supabase.
      throw new DesktopError(403, 'ACCESS_DENIED', 'Accès refusé.');
    }
    const { data, error } = await db.storage.from(ref.bucket).createSignedUrl(ref.path, SIGNED_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) throw new DesktopError(404, 'FILE_NOT_FOUND', 'Fichier introuvable.');
    res.redirect(302, data.signedUrl);
  }));

  // ── Journal de changements ─────────────────────────────────────────────────

  app.get(`${BASE}/changes`, handle(async (req, res) => {
    const ctx = await contextFor(req);
    void maybePrune(db);
    if (req.query.cursor === undefined || req.query.cursor === '') {
      // Premier appel : le client parcourt l'arborescence, puis lit à partir de ce curseur.
      return void res.json({ cursor: await currentCursor(db), resync: true, events: [], hasMore: false });
    }
    const cursor = parseCursor(req.query.cursor);
    if (cursor < await getFloor(db)) {
      throw new DesktopError(410, 'CURSOR_EXPIRED', 'Curseur périmé : refaites une synchronisation complète.');
    }
    const limit = parseLimit(req.query.limit);
    const { rows, hasMore } = await readChangeRows(db, ctx.tenantId, cursor, limit);
    const events = await buildEvents(ctx, rows);
    const nextCursor = rows.length > 0 ? rows[rows.length - 1].seq : cursor;
    res.json({ events, nextCursor: String(nextCursor), hasMore });
  }));

  // ── Verrous ────────────────────────────────────────────────────────────────

  app.post(`${BASE}/nodes/:id/lock`, handle(async (req, res) => {
    const ctx = await contextFor(req);
    if (ctx.lockMode === 'off') throw new DesktopError(409, 'LOCKS_DISABLED', 'Les verrous sont désactivés pour ce cabinet.');
    const doc = await requireDocument(ctx, String(req.params.id));
    if (doc.project_id && await isProjectArchived(db, ctx.tenantId, doc.project_id)) {
      throw new DesktopError(409, 'PROJECT_ARCHIVED', 'Affaire archivée : rouvrez-la pour la modifier.');
    }
    const userName = await deps.getUserName(ctx.tenantId, ctx.userId);
    const result = await acquireLock(db, {
      tenantId: ctx.tenantId, documentId: doc.id, userId: ctx.userId, userName,
      deviceId: req.deviceId ?? (typeof req.body?.deviceId === 'string' ? req.body.deviceId : null),
    });
    if (!result.ok) {
      throw new DesktopError(409, 'ALREADY_LOCKED', 'Ce document est déjà verrouillé.', { holder: toLockView(result.holder, ctx.userId) });
    }
    res.json({ lock: toLockView(result.lock, ctx.userId) });
  }));

  app.post(`${BASE}/nodes/:id/lock/renew`, handle(async (req, res) => {
    const ctx = await contextFor(req);
    const doc = await requireDocument(ctx, String(req.params.id));
    const lock = await renewLock(db, { tenantId: ctx.tenantId, documentId: doc.id, userId: ctx.userId });
    if (!lock) throw new DesktopError(404, 'LOCK_NOT_FOUND', "Vous ne détenez pas de verrou sur ce document.");
    res.json({ lock: toLockView(lock, ctx.userId) });
  }));

  app.delete(`${BASE}/nodes/:id/lock`, handle(async (req, res) => {
    const ctx = await contextFor(req);
    const doc = await requireDocument(ctx, String(req.params.id));
    const force = String(req.query.force) === 'true';
    if (force && ctx.role !== 'admin' && ctx.role !== 'manager') {
      throw new DesktopError(403, 'FORBIDDEN', 'Seul un administrateur ou un manager peut rompre le verrou d\'une autre personne.');
    }
    const { result, previous } = await releaseLock(db, { tenantId: ctx.tenantId, documentId: doc.id, userId: ctx.userId, force });
    if (result === 'not_owner') {
      throw new DesktopError(403, 'NOT_LOCK_OWNER', 'Ce verrou appartient à une autre personne.', { holder: previous ? toLockView(previous, ctx.userId) : null });
    }
    if (result === 'released' && force && previous && previous.user_id !== ctx.userId) {
      const userName = await deps.getUserName(ctx.tenantId, ctx.userId);
      deps.logActivity(ctx.tenantId, ctx.userId, userName, `Rupture du verrou de ${previous.user_name || 'un collaborateur'} sur "${doc.name}"`, doc.name, doc.id, 'document', 'Documents');
    }
    res.json({ success: true });
  }));

  // ── Dépôts par morceaux ────────────────────────────────────────────────────

  const uploadDeps = {
    getUserName: deps.getUserName, logActivity: deps.logActivity, checkQuota: deps.checkQuota,
    storeBusinessFile: deps.storeBusinessFile, removeBusinessFile: deps.removeBusinessFile,
  };

  app.post(`${BASE}/uploads`, handle(async (req, res) => {
    const ctx = await contextFor(req);
    res.status(201).json(await openUpload(ctx, uploadDeps, req.body, req.deviceId ?? null));
  }));

  app.get(`${BASE}/uploads/:id`, handle(async (req, res) => {
    res.json(await uploadStatus(await contextFor(req), String(req.params.id)));
  }));

  app.put(
    `${BASE}/uploads/:id`,
    express.raw({ type: () => true, limit: MAX_CHUNK_BYTES + 1024 }),
    handle(async (req, res) => {
      const ctx = await contextFor(req);
      await receiveChunk(ctx, String(req.params.id), req.headers['content-range'] as string | undefined, req.body);
      res.status(204).end();
    }),
  );

  app.post(`${BASE}/uploads/:id/complete`, handle(async (req, res) => {
    const ctx = await contextFor(req);
    const result = await completeUpload(ctx, uploadDeps, String(req.params.id), typeof req.body?.sha256 === 'string' ? req.body.sha256 : undefined);
    res.set('ETag', `"${result.etag}"`).json(result);
  }));

  // ── Métadonnées, suppression logique, indice, lien ─────────────────────────

  app.patch(`${BASE}/nodes/:id`, handle(async (req, res) => {
    const ctx = await contextFor(req);
    const doc = await requireDocument(ctx, String(req.params.id));
    const body = req.body ?? {};
    const update: Record<string, any> = {};
    const onlyStatus = Object.keys(body).every(k => k === 'status' || k === 'baseVersion');

    await assertWritableDocument(ctx, doc, expectedVersion(req) ?? (doc.version ?? 1), { allowApproved: onlyStatus });

    if (body.name !== undefined) {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name || name.length > 255) throw new DesktopError(400, 'INVALID_NAME', 'Nom invalide.');
      if (isIgnoredFileName(name)) throw new DesktopError(400, 'NAME_IGNORED', "Ce nom de fichier temporaire ou système n'est pas permis.");
      if (DANGEROUS_EXTENSIONS.has(fileExtension(name))) throw new DesktopError(400, 'FILE_TYPE_REFUSED', 'Type de fichier non autorisé.');
      // Renommer un fichier déjà dans Supabase en .dwg le ferait devenir un fichier CAO hébergé chez nous.
      if (isCadFileName(name) && !isCadFileName(doc.name) && doc.storage_backend !== 'external' && process.env.OFFLINE_MODE !== 'true') {
        throw new DesktopError(409, 'EXTERNAL_STORAGE_REQUIRED', "Un fichier CAO doit être hébergé sur l'espace de stockage du cabinet.");
      }
      update.name = name;
    }

    if (body.parentId !== undefined || body.phase !== undefined) {
      let projectId = doc.project_id;
      let phase: string | null;
      if (body.parentId !== undefined) {
        const parent = parseNodeId(body.parentId);
        if (parent?.kind === 'phase' || parent?.kind === 'prj') {
          projectId = parent.projectId;
          phase = parent.kind === 'phase' && parent.code !== DEFAULT_PHASE_CODE ? parent.code : null;
        } else if (parent?.kind === 'inbox' && parent.tenantId === ctx.tenantId) {
          projectId = null;
          phase = null;
        } else {
          throw new DesktopError(400, 'INVALID_PARENT', 'Dossier de destination invalide.');
        }
      } else {
        phase = typeof body.phase === 'string' && body.phase.trim() && body.phase.trim() !== DEFAULT_PHASE_CODE ? body.phase.trim() : null;
      }
      if (doc.project_id && projectId !== doc.project_id) {
        throw new DesktopError(400, 'MOVE_ACROSS_PROJECTS', "Déplacer un document vers une autre affaire n'est pas permis.");
      }
      if (projectId && projectId !== doc.project_id) {
        // Classement depuis « À classer » vers une affaire.
        if (!(await assertTenantEntity(db, 'projects', projectId, ctx.tenantId))) {
          throw new DesktopError(404, 'NODE_NOT_FOUND', 'Affaire introuvable pour ce cabinet.');
        }
        if (await isProjectArchived(db, ctx.tenantId, projectId)) {
          throw new DesktopError(409, 'PROJECT_ARCHIVED', 'Affaire archivée : rouvrez-la pour la modifier.');
        }
        update.project_id = projectId;
        update.resource_id = projectId;
      }
      update.phase = phase;
    }

    if (body.docType !== undefined) {
      update.doc_type = body.docType ? String(body.docType).slice(0, 60) : null;
    }
    if (body.description !== undefined) {
      update.description = body.description ? String(body.description).slice(0, 2000) : null;
    }
    if (body.status !== undefined) {
      if (!DOC_STATUSES.has(body.status)) throw new DesktopError(400, 'INVALID_STATUS', 'Statut invalide.');
      update.doc_statut = body.status;
      if (body.status === 'approuve') {
        update.approbateur = await deps.getUserName(ctx.tenantId, ctx.userId);
        update.date_approbation = new Date().toISOString();
      }
    }
    if (Object.keys(update).length === 0) throw new DesktopError(400, 'NOTHING_TO_UPDATE', 'Aucune modification demandée.');

    const { error } = await db.from('documents').update(update).eq('id', doc.id).eq('tenant_id', ctx.tenantId);
    if (error) throw error;
    const node = await respondNode(ctx, doc.id);
    res.set('ETag', `"${node.etag}"`).json(node);
  }));

  app.delete(`${BASE}/nodes/:id`, handle(async (req, res) => {
    const ctx = await contextFor(req);
    if (parseNodeId(String(req.params.id))?.kind !== 'doc') {
      throw new DesktopError(409, 'FOLDER_NOT_SUPPORTED', 'Les dossiers ne se suppriment pas depuis le poste de travail.');
    }
    if (!canDeleteRole(ctx.role)) throw new DesktopError(403, 'FORBIDDEN', "Votre rôle ne permet pas de supprimer un document.");
    const doc = await requireDocument(ctx, String(req.params.id));
    await assertWritableDocument(ctx, doc, doc.version ?? 1);
    // Suppression LOGIQUE : jamais de suppression définitive depuis un appareil.
    const { error } = await db.from('documents').update({ deleted_at: new Date().toISOString() })
      .eq('id', doc.id).eq('tenant_id', ctx.tenantId);
    if (error) throw error;
    const userName = await deps.getUserName(ctx.tenantId, ctx.userId);
    deps.logActivity(ctx.tenantId, ctx.userId, userName, `Mise à la corbeille du document "${doc.name}" (poste de travail)`, doc.name, doc.id, 'document', 'Documents');
    res.json({ success: true });
  }));

  app.post(`${BASE}/nodes/:id/restore`, handle(async (req, res) => {
    const ctx = await contextFor(req);
    if (!canDeleteRole(ctx.role)) throw new DesktopError(403, 'FORBIDDEN', 'Votre rôle ne permet pas de restaurer un document.');
    const doc = await requireDocument(ctx, String(req.params.id), true);
    if (!doc.deleted_at) throw new DesktopError(409, 'NOT_DELETED', "Ce document n'est pas dans la corbeille.");
    if (doc.project_id && await isProjectArchived(db, ctx.tenantId, doc.project_id)) {
      throw new DesktopError(409, 'PROJECT_ARCHIVED', 'Affaire archivée : rouvrez-la pour la modifier.');
    }
    const { error } = await db.from('documents').update({ deleted_at: null }).eq('id', doc.id).eq('tenant_id', ctx.tenantId);
    if (error) throw error;
    res.json(await respondNode(ctx, doc.id));
  }));

  app.post(`${BASE}/nodes/:id/bump-indice`, handle(async (req, res) => {
    const ctx = await contextFor(req);
    const doc = await requireDocument(ctx, String(req.params.id));
    await assertWritableDocument(ctx, doc, expectedVersion(req) ?? (doc.version ?? 1));
    const indice = nextIndice(doc.indice);
    if (indice === null) throw new DesktopError(409, 'INDICE_LIMIT', "L'indice de diffusion ne peut plus avancer.");
    const { error } = await db.from('documents').update({ indice }).eq('id', doc.id).eq('tenant_id', ctx.tenantId);
    if (error) throw error;
    res.json(await respondNode(ctx, doc.id));
  }));

  // Un lien profond ne donne aucun accès par lui-même : il exige une session et le droit de lecture.
  app.post(`${BASE}/nodes/:id/link`, handle(async (req, res) => {
    const ctx = await contextFor(req);
    const doc = await requireDocument(ctx, String(req.params.id));
    res.json({ deepLink: `archioffice://document/${encodeURIComponent(doc.id)}`, nodeId: documentNodeId(doc.id) });
  }));

}
