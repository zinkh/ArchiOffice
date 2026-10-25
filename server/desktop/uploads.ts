// Dépôt par morceaux reprenable d'un client desktop. Voir docs/desktop-sync-contract.md,
// section 8.
//
//   open  -> POST /uploads            vérifie TOUT avant le premier octet (CAO, archivage, verrou, version)
//   chunk -> PUT  /uploads/:id        écrit un morceau sur le disque temporaire du serveur
//   done  -> POST /uploads/:id/complete  recompose, contrôle empreinte et contenu, stocke, crée la version
//
// Les morceaux vivent sur le DISQUE TEMPORAIRE du serveur, jamais dans Supabase Storage : un
// fichier CAO ne doit atteindre que l'espace du cabinet (règle de la section 8.4).
//
// Limite connue : `storeBusinessFile` reçoit un Buffer, donc le fichier est relu EN MÉMOIRE à la
// fin. D'où un plafond (DESKTOP_MAX_UPLOAD_MB, 200 Mo par défaut) tant que les fournisseurs de
// stockage n'acceptent pas un flux.
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileExtension, isCadFileName, isIgnoredFileName } from '../../src/lib/cadFiles';
import { DEFAULT_PHASE_CODE, parseNodeId } from '../../src/lib/desktopNodes';
import { assertTenantEntity } from '../assertTenantEntity';
import { DANGEROUS_EXTENSIONS, looksDangerous } from '../documentUpload';
import { buildDocumentFolderPath } from '../externalStorage/businessFolderPath';
import { getActiveConnection } from '../externalStorage/externalConnection';
import type { RemoveBusinessFile, StoreBusinessFile } from '../externalStorage/storeBusinessFile';
import { sanitizeFilename } from '../sanitizeFilename';
import { safeSegment } from '../storageKey';
import { isProjectArchived } from '../routes/projectArchive';
import { getLiveLock, toLockView } from './locks';
import {
  DesktopError, loadDocument, loadProject, nodesForDocuments,
  type DesktopNode, type DocRow, type NodeContext,
} from './nodes';

export const DEFAULT_CHUNK_BYTES = 8 * 1024 * 1024;
export const MAX_CHUNK_BYTES = 16 * 1024 * 1024;
export const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
const SHA256 = /^[0-9a-f]{64}$/i;
const UPLOAD_ID = /^up_[0-9a-f]{24}$/;
const CLEANUP_EVERY_MS = 10 * 60 * 1000;

export function maxUploadBytes(): number {
  const mb = Number(process.env.DESKTOP_MAX_UPLOAD_MB);
  return (Number.isFinite(mb) && mb > 0 ? mb : 200) * 1024 * 1024;
}

const offlineMode = () => process.env.OFFLINE_MODE === 'true';

export interface UploadDeps {
  getUserName: (tenantId: string, userId: string, email?: string) => Promise<string>;
  logActivity: (tenantId: string, userId: string, userName: string, action: string, target: string, targetId: string, targetType: string, category: string) => void;
  checkQuota: (tenantId: string, resource: 'projects' | 'users' | 'documents') => Promise<void>;
  storeBusinessFile: StoreBusinessFile;
  removeBusinessFile: RemoveBusinessFile;
}

function tempPath(uploadId: string): string {
  if (!UPLOAD_ID.test(uploadId)) throw new DesktopError(404, 'UPLOAD_NOT_FOUND', 'Session de dépôt introuvable.');
  const dir = process.env.DESKTOP_UPLOAD_DIR || path.join(os.tmpdir(), 'archioffice-desktop-uploads');
  return path.join(dir, `${uploadId}.part`);
}

interface UploadRow {
  id: string;
  tenant_id: string;
  user_id: string;
  device_id: string | null;
  target: { documentId?: string; create?: { parentId: string; conflictOf?: string | null } };
  base_version: number | null;
  bump_indice: boolean;
  name: string;
  mime_type: string | null;
  description: string | null;
  size_bytes: number;
  sha256: string;
  received: Array<[number, number]>;
  expires_at: string;
  completed_at: string | null;
  result: any;
}

export function nextIndice(current: string | null | undefined): string | null {
  const letter = (current || 'A').toUpperCase();
  if (!/^[A-Z]$/.test(letter) || letter === 'Z') return null;
  return String.fromCharCode(letter.charCodeAt(0) + 1);
}

/** Fusionne des intervalles d'octets (bornes comprises). */
export function mergeRanges(ranges: ReadonlyArray<readonly [number, number]>): Array<[number, number]> {
  const sorted = ranges.map(r => [r[0], r[1]] as [number, number]).sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const [start, end] of sorted) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

export function coversAll(ranges: ReadonlyArray<readonly [number, number]>, size: number): boolean {
  if (size === 0) return true;
  const merged = mergeRanges(ranges);
  return merged.length === 1 && merged[0][0] === 0 && merged[0][1] >= size - 1;
}

export function parseContentRange(header: string | undefined): { start: number; end: number; total: number } | null {
  const match = /^bytes (\d{1,15})-(\d{1,15})\/(\d{1,15})$/.exec(String(header ?? '').trim());
  if (!match) return null;
  return { start: Number(match[1]), end: Number(match[2]), total: Number(match[3]) };
}

// ── Contrôles communs à l'ouverture et à la fin ──────────────────────────────

/** La règle de la section 8.4 : un fichier CAO exige l'espace de stockage du cabinet. */
async function assertCadAllowed(ctx: NodeContext, name: string): Promise<void> {
  if (!isCadFileName(name) || offlineMode()) return;
  const connection = await getActiveConnection(ctx.db, ctx.tenantId);
  if (!connection) {
    throw new DesktopError(
      409, 'EXTERNAL_STORAGE_REQUIRED',
      "Les fichiers CAO se déposent sur l'espace de stockage de votre cabinet. Branchez-le dans Réglages.",
    );
  }
}

/**
 * Les mêmes refus pour un dépôt et pour une modification de métadonnées : affaire archivée,
 * document approuvé, verrou d'une autre personne (mode `enforced`), version de base périmée.
 * `allowApproved` ne sert qu'au changement de statut, seul geste permis sur un document approuvé.
 */
export async function assertWritableDocument(
  ctx: NodeContext,
  doc: DocRow,
  baseVersion: number | null,
  options: { allowApproved?: boolean } = {},
): Promise<void> {
  if (doc.project_id && await isProjectArchived(ctx.db, ctx.tenantId, doc.project_id)) {
    throw new DesktopError(409, 'PROJECT_ARCHIVED', 'Affaire archivée : rouvrez-la pour la modifier.');
  }
  if (doc.doc_statut === 'approuve' && !options.allowApproved) {
    throw new DesktopError(409, 'DOCUMENT_APPROVED', 'Ce document est approuvé : déposez une nouvelle version depuis ArchiOffice.');
  }
  if (ctx.lockMode === 'enforced') {
    const lock = await getLiveLock(ctx.db, ctx.tenantId, doc.id);
    if (lock && lock.user_id !== ctx.userId) {
      throw new DesktopError(423, 'LOCKED', 'Ce document est verrouillé par une autre personne.', { lock: toLockView(lock, ctx.userId) });
    }
  }
  if (baseVersion === null) {
    throw new DesktopError(400, 'BASE_VERSION_REQUIRED', 'La version de base (baseVersion) est requise.');
  }
  if ((doc.version ?? 1) !== baseVersion) {
    const [currentNode] = await nodesForDocuments(ctx, [doc]);
    throw new DesktopError(409, 'VERSION_CONFLICT', 'Le document a changé depuis votre dernière lecture.', {
      currentVersion: doc.version ?? 1, currentNode,
    });
  }
}

interface CreateTarget { projectId: string | null; phase: string | null; conflictOf: string | null }

async function resolveCreateTarget(ctx: NodeContext, create: { parentId?: string; conflictOf?: string | null }): Promise<CreateTarget> {
  const parent = parseNodeId(create?.parentId);
  let projectId: string | null = null;
  let phase: string | null = null;
  if (parent?.kind === 'phase') {
    projectId = parent.projectId;
    phase = parent.code === DEFAULT_PHASE_CODE ? null : parent.code;
  } else if (parent?.kind === 'prj') {
    projectId = parent.projectId;
  } else if (parent?.kind === 'inbox' && parent.tenantId === ctx.tenantId) {
    projectId = null;
  } else {
    throw new DesktopError(400, 'INVALID_PARENT', 'Dossier de destination invalide.');
  }
  if (projectId) {
    if (!(await assertTenantEntity(ctx.db, 'projects', projectId, ctx.tenantId))) {
      throw new DesktopError(404, 'NODE_NOT_FOUND', 'Affaire introuvable pour ce cabinet.');
    }
    if (await isProjectArchived(ctx.db, ctx.tenantId, projectId)) {
      throw new DesktopError(409, 'PROJECT_ARCHIVED', 'Affaire archivée : rouvrez-la pour la modifier.');
    }
  }
  let conflictOf: string | null = null;
  if (create.conflictOf) {
    if (!(await loadDocument(ctx, String(create.conflictOf), { includeDeleted: true }))) {
      throw new DesktopError(400, 'INVALID_CONFLICT_OF', 'Document d\'origine introuvable.');
    }
    conflictOf = String(create.conflictOf);
  }
  return { projectId, phase, conflictOf };
}

// ── Ouverture ────────────────────────────────────────────────────────────────

let lastCleanupAt = 0;

/** Purge les sessions expirées et leurs fichiers (au plus toutes les 10 minutes). */
export async function purgeExpiredUploads(db: any): Promise<void> {
  const now = Date.now();
  if (now - lastCleanupAt < CLEANUP_EVERY_MS) return;
  lastCleanupAt = now;
  try {
    const { data } = await db.from('desktop_uploads').select('id')
      .lt('expires_at', new Date(now).toISOString()).limit(50);
    for (const row of (data || []) as Array<{ id: string }>) {
      await fs.promises.rm(tempPath(row.id), { force: true }).catch(() => undefined);
      await db.from('desktop_uploads').delete().eq('id', row.id);
    }
  } catch {
    // Meilleur effort : un nettoyage raté ne doit jamais empêcher un dépôt.
  }
}

export async function openUpload(
  ctx: NodeContext,
  deps: UploadDeps,
  body: any,
  deviceId: string | null,
): Promise<{ uploadId: string; chunkSize: number; expiresAt: string }> {
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 255) throw new DesktopError(400, 'INVALID_UPLOAD', 'Nom de fichier invalide.');
  if (isIgnoredFileName(name)) {
    throw new DesktopError(400, 'NAME_IGNORED', 'Ce fichier temporaire ou système n\'est pas un document d\'affaire.');
  }
  const size = body?.size;
  if (!Number.isInteger(size) || size < 0) throw new DesktopError(400, 'INVALID_UPLOAD', 'Taille invalide.');
  if (size > maxUploadBytes()) {
    throw new DesktopError(413, 'FILE_TOO_LARGE', `Fichier trop volumineux (${Math.floor(maxUploadBytes() / 1024 / 1024)} Mo au plus).`);
  }
  const sha256 = typeof body?.sha256 === 'string' ? body.sha256.toLowerCase() : '';
  if (!SHA256.test(sha256)) throw new DesktopError(400, 'INVALID_UPLOAD', 'Empreinte SHA-256 invalide.');

  if (DANGEROUS_EXTENSIONS.has(fileExtension(name))) {
    throw new DesktopError(400, 'FILE_TYPE_REFUSED', 'Type de fichier non autorisé.');
  }
  // Avant toute lecture en base et avant le premier octet.
  await assertCadAllowed(ctx, name);

  const target = body?.target;
  const baseVersion = Number.isInteger(body?.baseVersion) ? body.baseVersion : null;
  const bumpIndice = body?.bumpIndice === true;
  let storedTarget: UploadRow['target'];
  if (target?.documentId) {
    const doc = await loadDocument(ctx, String(target.documentId));
    if (!doc) throw new DesktopError(404, 'NODE_NOT_FOUND', 'Document introuvable.');
    await assertWritableDocument(ctx, doc, baseVersion);
    if (bumpIndice && nextIndice(doc.indice) === null) {
      throw new DesktopError(409, 'INDICE_LIMIT', "L'indice de diffusion ne peut plus avancer.");
    }
    storedTarget = { documentId: doc.id };
  } else if (target?.create) {
    const resolved = await resolveCreateTarget(ctx, target.create);
    await deps.checkQuota(ctx.tenantId, 'documents');
    storedTarget = { create: { parentId: String(target.create.parentId), conflictOf: resolved.conflictOf } };
  } else {
    throw new DesktopError(400, 'INVALID_UPLOAD', 'Cible du dépôt manquante (documentId ou create).');
  }

  void purgeExpiredUploads(ctx.db);
  const uploadId = `up_${crypto.randomBytes(12).toString('hex')}`;
  const expiresAt = new Date(Date.now() + UPLOAD_TTL_MS).toISOString();
  const { error } = await ctx.db.from('desktop_uploads').insert({
    id: uploadId, tenant_id: ctx.tenantId, user_id: ctx.userId, device_id: deviceId,
    target: storedTarget, base_version: baseVersion, bump_indice: bumpIndice,
    name, mime_type: typeof body?.mimeType === 'string' ? body.mimeType.slice(0, 200) : null,
    description: typeof body?.description === 'string' ? body.description.slice(0, 2000) : null,
    size_bytes: size, sha256, received: [], expires_at: expiresAt,
  });
  if (error) throw error;

  const file = tempPath(uploadId);
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const handle = await fs.promises.open(file, 'w');
  try { await handle.truncate(size); } finally { await handle.close(); }
  return { uploadId, chunkSize: DEFAULT_CHUNK_BYTES, expiresAt };
}

async function loadUpload(ctx: NodeContext, uploadId: string): Promise<UploadRow> {
  if (!UPLOAD_ID.test(uploadId)) throw new DesktopError(404, 'UPLOAD_NOT_FOUND', 'Session de dépôt introuvable.');
  const { data, error } = await ctx.db.from('desktop_uploads').select('*')
    .eq('id', uploadId).eq('tenant_id', ctx.tenantId).eq('user_id', ctx.userId).maybeSingle();
  if (error) throw error;
  if (!data) throw new DesktopError(404, 'UPLOAD_NOT_FOUND', 'Session de dépôt introuvable.');
  return data as UploadRow;
}

export async function uploadStatus(ctx: NodeContext, uploadId: string) {
  const row = await loadUpload(ctx, uploadId);
  return {
    uploadId: row.id, size: Number(row.size_bytes), received: mergeRanges(row.received || []),
    completed: !!row.completed_at, expiresAt: row.expires_at,
  };
}

// ── Morceaux ─────────────────────────────────────────────────────────────────

export async function receiveChunk(
  ctx: NodeContext,
  uploadId: string,
  contentRange: string | undefined,
  data: Buffer,
): Promise<void> {
  const row = await loadUpload(ctx, uploadId);
  if (row.completed_at) throw new DesktopError(409, 'UPLOAD_COMPLETED', 'Ce dépôt est déjà terminé.');
  if (new Date(row.expires_at).getTime() < Date.now()) throw new DesktopError(410, 'UPLOAD_EXPIRED', 'Session de dépôt expirée.');

  const range = parseContentRange(contentRange);
  const size = Number(row.size_bytes);
  if (!range || range.total !== size || range.start > range.end || range.end >= size) {
    throw new DesktopError(400, 'INVALID_RANGE', 'En-tête Content-Range invalide.');
  }
  const length = range.end - range.start + 1;
  if (length > MAX_CHUNK_BYTES) throw new DesktopError(413, 'CHUNK_TOO_LARGE', 'Morceau trop volumineux.');
  if (!Buffer.isBuffer(data) || data.length !== length) {
    throw new DesktopError(400, 'INVALID_RANGE', "La taille du morceau ne correspond pas à Content-Range.");
  }

  const handle = await fs.promises.open(tempPath(uploadId), 'r+');
  try { await handle.write(data, 0, length, range.start); } finally { await handle.close(); }

  const received = mergeRanges([...(row.received || []), [range.start, range.end]]);
  const { error } = await ctx.db.from('desktop_uploads').update({ received }).eq('id', uploadId);
  if (error) throw error;
}

// ── Fin ──────────────────────────────────────────────────────────────────────

export interface CompletedUpload {
  node: DesktopNode;
  version: number;
  etag: string;
}

export async function completeUpload(
  ctx: NodeContext,
  deps: UploadDeps,
  uploadId: string,
  bodySha256: string | undefined,
): Promise<CompletedUpload> {
  const row = await loadUpload(ctx, uploadId);
  if (row.completed_at && row.result?.documentId) {
    // Idempotent : le client qui n'a pas reçu la réponse la redemande.
    const doc = await loadDocument(ctx, row.result.documentId);
    if (doc) {
      const [node] = await nodesForDocuments(ctx, [doc]);
      return { node, version: doc.version ?? 1, etag: `v${doc.version ?? 1}` };
    }
  }
  if (new Date(row.expires_at).getTime() < Date.now()) throw new DesktopError(410, 'UPLOAD_EXPIRED', 'Session de dépôt expirée.');

  const size = Number(row.size_bytes);
  if (!coversAll(row.received || [], size)) {
    throw new DesktopError(409, 'UPLOAD_INCOMPLETE', 'Des morceaux manquent : reprenez le dépôt.', { received: mergeRanges(row.received || []) });
  }
  if (bodySha256 && bodySha256.toLowerCase() !== row.sha256) {
    throw new DesktopError(422, 'CHECKSUM_MISMATCH', "L'empreinte annoncée ne correspond pas à celle de l'ouverture.");
  }

  const file = tempPath(uploadId);
  const buffer = await fs.promises.readFile(file);
  if (buffer.length !== size) throw new DesktopError(422, 'CHECKSUM_MISMATCH', 'Taille reçue inattendue.');
  const digest = crypto.createHash('sha256').update(buffer).digest('hex');
  if (digest !== row.sha256) throw new DesktopError(422, 'CHECKSUM_MISMATCH', "L'empreinte du fichier reçu ne correspond pas.");
  if (looksDangerous(buffer)) throw new DesktopError(400, 'FILE_TYPE_REFUSED', 'Type de fichier non autorisé.');

  // Les règles sont rejouées : le dépôt a pu durer des heures.
  await assertCadAllowed(ctx, row.name);

  const userName = await deps.getUserName(ctx.tenantId, ctx.userId);
  const uploadedAt = new Date().toISOString();
  const mime = row.mime_type || 'application/octet-stream';
  let documentId: string;
  let version: number;

  if (row.target.documentId) {
    const doc = await loadDocument(ctx, row.target.documentId);
    if (!doc) throw new DesktopError(404, 'NODE_NOT_FOUND', 'Document introuvable.');
    await assertWritableDocument(ctx, doc, row.base_version);
    const indice = row.bump_indice ? nextIndice(doc.indice) : (doc.indice ?? 'A');
    if (indice === null) throw new DesktopError(409, 'INDICE_LIMIT', "L'indice de diffusion ne peut plus avancer.");

    documentId = doc.id;
    version = (doc.version ?? 1) + 1;
    const project = doc.project_id ? await loadProject(ctx, doc.project_id) : null;
    const existingPhase = doc.phase ?? null;
    const phaseSegment = existingPhase ? `${safeSegment(existingPhase)}/` : '';
    const stored = await deps.storeBusinessFile({
      tenantId: ctx.tenantId, bucket: 'documents',
      folderPath: buildDocumentFolderPath(project, existingPhase),
      fileName: row.name,
      supabasePath: `${ctx.tenantId}/${doc.project_id || 'general'}/${phaseSegment}${doc.id}/v${version}-${sanitizeFilename(row.name)}`,
    }, buffer, mime);

    // Mise à jour CONDITIONNELLE sur la version lue : deux dépôts simultanés ne se marchent pas dessus.
    const { data: updated, error } = await ctx.db.from('documents').update({
      version, file_url: stored.fileUrl, storage_backend: stored.storageBackend, uploaded_at: uploadedAt,
      size_bytes: stored.sizeBytes, mime_type: mime, content_sha256: digest, indice, doc_statut: 'en_cours',
    }).eq('id', doc.id).eq('tenant_id', ctx.tenantId).eq('version', doc.version ?? 1).select();
    if (error) throw error;
    if (!updated || updated.length === 0) {
      await deps.removeBusinessFile(ctx.tenantId, 'documents', stored.fileUrl).catch(() => undefined);
      const current = await loadDocument(ctx, doc.id);
      const [currentNode] = current ? await nodesForDocuments(ctx, [current]) : [];
      throw new DesktopError(409, 'VERSION_CONFLICT', 'Le document a changé pendant le dépôt.', {
        currentVersion: current?.version ?? null, currentNode,
      });
    }
    await ctx.db.from('document_versions').insert({
      id: crypto.randomUUID(), tenant_id: ctx.tenantId, document_id: doc.id, version,
      file_url: stored.fileUrl, storage_backend: stored.storageBackend, uploaded_by: userName,
      uploaded_at: uploadedAt, description: row.description, size_bytes: stored.sizeBytes,
    });
    deps.logActivity(ctx.tenantId, ctx.userId, userName, `Nouvelle version du document "${row.name}" (poste de travail)`, row.name, doc.id, 'document', 'Documents');
  } else {
    const target = await resolveCreateTarget(ctx, row.target.create ?? { parentId: '' });
    await deps.checkQuota(ctx.tenantId, 'documents');
    documentId = crypto.randomUUID();
    version = 1;
    const project = target.projectId ? await loadProject(ctx, target.projectId) : null;
    const phaseSegment = target.phase ? `${safeSegment(target.phase)}/` : '';
    const stored = await deps.storeBusinessFile({
      tenantId: ctx.tenantId, bucket: 'documents',
      folderPath: buildDocumentFolderPath(project, target.phase),
      fileName: row.name,
      supabasePath: `${ctx.tenantId}/${target.projectId || 'general'}/${phaseSegment}${documentId}/${sanitizeFilename(row.name)}`,
    }, buffer, mime);
    const { error } = await ctx.db.from('documents').insert({
      id: documentId, tenant_id: ctx.tenantId, project_id: target.projectId,
      resource_type: 'projects', resource_id: target.projectId,
      name: row.name, category: 'Autre', phase: target.phase, version, file_url: stored.fileUrl,
      storage_backend: stored.storageBackend, mime_type: mime, size_bytes: stored.sizeBytes,
      uploaded_by: userName, uploaded_at: uploadedAt, description: row.description,
      indice: 'A', doc_statut: 'en_cours', validation_status: 'pending',
      content_sha256: digest, conflict_of: target.conflictOf,
    });
    if (error) {
      await deps.removeBusinessFile(ctx.tenantId, 'documents', stored.fileUrl).catch(() => undefined);
      throw error;
    }
    await ctx.db.from('document_versions').insert({
      id: crypto.randomUUID(), tenant_id: ctx.tenantId, document_id: documentId, version,
      file_url: stored.fileUrl, storage_backend: stored.storageBackend, uploaded_by: userName,
      uploaded_at: uploadedAt, description: row.description, size_bytes: stored.sizeBytes,
    });
    deps.logActivity(ctx.tenantId, ctx.userId, userName, `Ajout du document "${row.name}" (poste de travail)`, row.name, documentId, 'document', 'Documents');
  }

  await ctx.db.from('desktop_uploads').update({
    completed_at: uploadedAt, result: { documentId, version },
  }).eq('id', uploadId);
  await fs.promises.rm(file, { force: true }).catch(() => undefined);

  const doc = await loadDocument(ctx, documentId);
  if (!doc) throw new DesktopError(500, 'INTERNAL', 'Document introuvable après le dépôt.');
  const [node] = await nodesForDocuments(ctx, [doc]);
  return { node, version, etag: `v${version}` };
}
