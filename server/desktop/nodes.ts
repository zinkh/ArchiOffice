// Arborescence des documents d'affaire vue par un client desktop : cabinet > affaire > phase
// > fichier, plus le dossier virtuel « À classer ». Voir docs/desktop-sync-contract.md,
// sections 4 et 4.1.
//
// Le serveur est la SEULE source des chemins et des noms : le client ne les calcule pas.
// Les chemins reprennent ceux du stockage externe (`buildDocumentFolderPath`), pour que ce
// que l'architecte voit dans l'Explorateur soit ce qu'il voit dans l'écran Documents.
//
// Une phase n'existe pas en base : c'est la valeur de `documents.phase` d'une affaire.
// Un dossier de phase n'apparaît donc que s'il contient au moins un document.
import { projectFolderName } from '../externalStorage/businessFolderPath';
import { sanitizeFolderSegment } from '../externalStorage/folderNaming';
import {
  comparePhaseCodes, DEFAULT_PHASE_CODE, documentNodeId, inboxNodeId, parseNodeId, phaseCode,
  phaseNodeId, projectNodeId, tenantNodeId, uniqueSiblingNames,
} from '../../src/lib/desktopNodes';
import { getLiveLocks, toLockView, type LockMode, type LockRow, type LockView } from './locks';

/** Erreur métier du module : porte son code HTTP et un code stable pour le client natif. */
export class DesktopError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'DesktopError';
  }
}

export interface NodeContext {
  db: any;
  tenantId: string;
  userId: string;
  /** Rôle de la personne dans CE cabinet (admin, manager, pm, user), ou null. */
  role: string | null;
  lockMode: LockMode;
}

export interface DesktopNode {
  id: string;
  kind: 'file' | 'folder';
  parentId: string | null;
  name: string;
  path: string;
  size: number | null;
  mimeType: string | null;
  sha256: string | null;
  modifiedAt: string | null;
  version: number | null;
  indice: string | null;
  etag: string | null;
  lock: LockView | null;
  permissions: { read: boolean; write: boolean; delete: boolean };
  readOnlyReason: 'archived' | 'approved' | 'locked' | 'role' | null;
  status: string | null;
  conflictOf: string | null;
}

export const INBOX_NAME = 'À classer';
const DELETE_ROLES = new Set(['admin', 'manager', 'pm']);
export const canDeleteRole = (role: string | null): boolean => !!role && DELETE_ROLES.has(role);

export interface ProjectRow {
  id: string;
  name: string | null;
  project_code: string | null;
  archived_at?: string | null;
}

const PAGE = 1000;

/** Lit toutes les lignes d'une requête : PostgREST plafonne une réponse à 1 000 lignes. */
async function fetchAll(build: () => any): Promise<any[]> {
  const rows: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE) return rows;
  }
}

export async function loadProject(ctx: NodeContext, projectId: string): Promise<ProjectRow | null> {
  const { data, error } = await ctx.db.from('projects').select('*')
    .eq('tenant_id', ctx.tenantId).eq('id', projectId).maybeSingle();
  if (error) throw error;
  return (data as ProjectRow) || null;
}

async function loadProjects(ctx: NodeContext, ids?: readonly string[]): Promise<Map<string, ProjectRow>> {
  const map = new Map<string, ProjectRow>();
  if (ids && ids.length === 0) return map;
  const rows = await fetchAll(() => {
    const q = ctx.db.from('projects').select('*').eq('tenant_id', ctx.tenantId).order('id');
    return ids ? q.in('id', [...ids]) : q;
  });
  for (const row of rows) map.set(row.id, row as ProjectRow);
  return map;
}

export interface DocRow {
  id: string;
  name: string;
  project_id: string | null;
  phase: string | null;
  version: number | null;
  indice: string | null;
  size_bytes: number | null;
  mime_type: string | null;
  uploaded_at: string | null;
  updated_at?: string | null;
  content_sha256?: string | null;
  doc_statut: string | null;
  deleted_at?: string | null;
  conflict_of?: string | null;
  file_url: string;
  [key: string]: any;
}

const documentsOf = (ctx: NodeContext) =>
  ctx.db.from('documents').select('*').eq('tenant_id', ctx.tenantId).eq('resource_type', 'projects');

export async function loadDocument(
  ctx: NodeContext,
  documentId: string,
  options: { includeDeleted?: boolean } = {},
): Promise<DocRow | null> {
  let q = documentsOf(ctx).eq('id', documentId);
  if (!options.includeDeleted) q = q.is('deleted_at', null);
  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  return (data as DocRow) || null;
}

/** Les documents vivants portant ces identifiants (ceux d'un autre cabinet ou supprimés sont absents). */
export async function loadDocuments(ctx: NodeContext, ids: readonly string[]): Promise<DocRow[]> {
  const rows: DocRow[] = [];
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 200) {
    const { data, error } = await documentsOf(ctx).is('deleted_at', null).in('id', unique.slice(i, i + 200));
    if (error) throw error;
    rows.push(...((data || []) as DocRow[]));
  }
  return rows;
}

/** Les documents vivants d'un dossier (une phase d'une affaire, ou « À classer »). */
async function folderSiblings(ctx: NodeContext, projectId: string | null, code: string | null): Promise<DocRow[]> {
  return fetchAll(() => {
    let q = documentsOf(ctx).is('deleted_at', null).order('id');
    if (!projectId) return q.is('project_id', null);
    q = q.eq('project_id', projectId);
    if (code === DEFAULT_PHASE_CODE) return q.or(`phase.is.null,phase.eq.${DEFAULT_PHASE_CODE},phase.eq.`);
    return q.eq('phase', code);
  }) as Promise<DocRow[]>;
}

const projectFolder = (project: ProjectRow): string => projectFolderName(project);
const phaseFolder = (code: string): string => sanitizeFolderSegment(code);

function emptyPermissions() {
  return { read: true, write: false, delete: false };
}

function folderNode(
  ctx: NodeContext,
  fields: { id: string; parentId: string | null; name: string; path: string; archived?: boolean },
): DesktopNode {
  const archived = !!fields.archived;
  return {
    id: fields.id, kind: 'folder', parentId: fields.parentId, name: fields.name, path: fields.path,
    size: null, mimeType: null, sha256: null, modifiedAt: null, version: null, indice: null, etag: null, lock: null,
    permissions: { ...emptyPermissions(), write: !archived },
    readOnlyReason: archived ? 'archived' : null,
    status: null, conflictOf: null,
  };
}

const tenantFolder = (ctx: NodeContext, name: string) =>
  folderNode(ctx, { id: tenantNodeId(ctx.tenantId), parentId: null, name, path: '' });
const inboxFolder = (ctx: NodeContext) =>
  folderNode(ctx, { id: inboxNodeId(ctx.tenantId), parentId: tenantNodeId(ctx.tenantId), name: INBOX_NAME, path: INBOX_NAME });
const projectFolderNode = (ctx: NodeContext, project: ProjectRow) =>
  folderNode(ctx, {
    id: projectNodeId(project.id), parentId: tenantNodeId(ctx.tenantId),
    name: projectFolder(project), path: projectFolder(project), archived: !!project.archived_at,
  });
const phaseFolderNode = (ctx: NodeContext, project: ProjectRow, code: string) =>
  folderNode(ctx, {
    id: phaseNodeId(project.id, code), parentId: projectNodeId(project.id),
    name: phaseFolder(code), path: `${projectFolder(project)}/${phaseFolder(code)}`, archived: !!project.archived_at,
  });

function documentNode(
  ctx: NodeContext,
  doc: DocRow,
  name: string,
  project: ProjectRow | null,
  lock: LockRow | undefined,
): DesktopNode {
  const archived = !!project?.archived_at;
  const approved = doc.doc_statut === 'approuve';
  const lockedByOther = !!lock && lock.user_id !== ctx.userId;
  const readOnlyReason: DesktopNode['readOnlyReason'] =
    archived ? 'archived' : approved ? 'approved' : lockedByOther && ctx.lockMode === 'enforced' ? 'locked' : null;
  const parentId = project ? phaseNodeId(project.id, phaseCode(doc.phase)) : inboxNodeId(ctx.tenantId);
  const folderPath = project ? `${projectFolder(project)}/${phaseFolder(phaseCode(doc.phase))}` : INBOX_NAME;
  const version = doc.version ?? 1;
  return {
    id: documentNodeId(doc.id), kind: 'file', parentId, name, path: `${folderPath}/${name}`,
    size: doc.size_bytes ?? null, mimeType: doc.mime_type ?? null, sha256: doc.content_sha256 ?? null,
    modifiedAt: doc.updated_at ?? doc.uploaded_at ?? null,
    version, indice: doc.indice ?? null, etag: `v${version}`,
    lock: lock && ctx.lockMode !== 'off' ? toLockView(lock, ctx.userId) : null,
    permissions: { read: true, write: readOnlyReason === null, delete: canDeleteRole(ctx.role) && !archived },
    readOnlyReason,
    status: doc.doc_statut ?? 'en_cours',
    conflictOf: doc.conflict_of ?? null,
  };
}

/**
 * Les nœuds de ces documents. Le nom d'un fichier dépend de ses voisins (deux homonymes
 * sont suffixés) : le dossier entier est donc relu pour chaque dossier concerné.
 */
export async function nodesForDocuments(ctx: NodeContext, docs: readonly DocRow[]): Promise<DesktopNode[]> {
  if (docs.length === 0) return [];
  const projectIds = [...new Set(docs.map(d => d.project_id).filter((id): id is string => !!id))];
  const [projects, locks] = await Promise.all([
    loadProjects(ctx, projectIds),
    getLiveLocks(ctx.db, ctx.tenantId, docs.map(d => d.id)),
  ]);

  const folders = new Map<string, DocRow[]>();
  for (const doc of docs) {
    const key = doc.project_id ? `${doc.project_id}|${phaseCode(doc.phase)}` : 'inbox';
    const list = folders.get(key) ?? [];
    list.push(doc);
    folders.set(key, list);
  }
  const names = new Map<string, string>();
  for (const [key, members] of folders) {
    const projectId = key === 'inbox' ? null : members[0].project_id;
    const siblings = await folderSiblings(ctx, projectId, key === 'inbox' ? null : phaseCode(members[0].phase));
    const unique = uniqueSiblingNames(siblings.map(s => ({ id: s.id, name: s.name })));
    // Un document absent du dossier (supprimé entre-temps) garde son nom propre.
    for (const m of members) names.set(m.id, unique.get(m.id) ?? uniqueSiblingNames([{ id: m.id, name: m.name }]).get(m.id)!);
  }
  return docs.map(doc => documentNode(
    ctx, doc, names.get(doc.id)!, doc.project_id ? projects.get(doc.project_id) ?? null : null, locks.get(doc.id),
  ));
}

export async function getNode(ctx: NodeContext, rawId: string): Promise<DesktopNode | null> {
  const parsed = parseNodeId(rawId);
  if (!parsed) return null;
  switch (parsed.kind) {
    case 'tenant': {
      if (parsed.tenantId !== ctx.tenantId) return null;
      const { data } = await ctx.db.from('tenants').select('name').eq('id', ctx.tenantId).maybeSingle();
      return tenantFolder(ctx, data?.name || 'ArchiOffice');
    }
    case 'inbox':
      return parsed.tenantId === ctx.tenantId ? inboxFolder(ctx) : null;
    case 'prj': {
      const project = await loadProject(ctx, parsed.projectId);
      return project ? projectFolderNode(ctx, project) : null;
    }
    case 'phase': {
      const project = await loadProject(ctx, parsed.projectId);
      return project ? phaseFolderNode(ctx, project, parsed.code) : null;
    }
    case 'doc': {
      const doc = await loadDocument(ctx, parsed.documentId);
      return doc ? (await nodesForDocuments(ctx, [doc]))[0] : null;
    }
  }
}

export function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset }), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string | undefined | null): number {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (Number.isInteger(parsed?.o) && parsed.o >= 0) return parsed.o;
  } catch { /* curseur illisible : refusé ci-dessous */ }
  throw new DesktopError(400, 'INVALID_CURSOR', 'Curseur invalide.');
}

const byName = (a: DesktopNode, b: DesktopNode) =>
  a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }) || (a.id < b.id ? -1 : 1);

/** Les enfants d'un dossier, par tranches. Jamais l'arbre entier. */
export async function listChildren(
  ctx: NodeContext,
  rawId: string,
  options: { cursor?: string | null; limit?: number } = {},
): Promise<{ nodes: DesktopNode[]; nextCursor: string | null }> {
  const parsed = parseNodeId(rawId);
  if (!parsed) throw new DesktopError(404, 'NODE_NOT_FOUND', 'Nœud introuvable.');
  const offset = decodeCursor(options.cursor);
  const limit = Math.min(Math.max(Math.floor(options.limit ?? 500) || 500, 1), 1000);

  let all: DesktopNode[];
  switch (parsed.kind) {
    case 'tenant': {
      if (parsed.tenantId !== ctx.tenantId) throw new DesktopError(404, 'NODE_NOT_FOUND', 'Nœud introuvable.');
      const projects = [...(await loadProjects(ctx)).values()].map(p => projectFolderNode(ctx, p)).sort(byName);
      all = [inboxFolder(ctx), ...projects];
      break;
    }
    case 'inbox': {
      if (parsed.tenantId !== ctx.tenantId) throw new DesktopError(404, 'NODE_NOT_FOUND', 'Nœud introuvable.');
      const siblings = await folderSiblings(ctx, null, null);
      all = (await nodesForDocuments(ctx, siblings)).sort(byName);
      break;
    }
    case 'prj': {
      const project = await loadProject(ctx, parsed.projectId);
      if (!project) throw new DesktopError(404, 'NODE_NOT_FOUND', 'Nœud introuvable.');
      const rows = await fetchAll(() => documentsOf(ctx).is('deleted_at', null).eq('project_id', project.id).order('id'));
      const codes = [...new Set(rows.map((r: any) => phaseCode(r.phase)))].sort(comparePhaseCodes);
      all = codes.map(code => phaseFolderNode(ctx, project, code));
      break;
    }
    case 'phase': {
      const project = await loadProject(ctx, parsed.projectId);
      if (!project) throw new DesktopError(404, 'NODE_NOT_FOUND', 'Nœud introuvable.');
      const siblings = await folderSiblings(ctx, project.id, parsed.code);
      all = (await nodesForDocuments(ctx, siblings)).sort(byName);
      break;
    }
    case 'doc':
      throw new DesktopError(400, 'NOT_A_FOLDER', "Ce nœud est un fichier : il n'a pas d'enfants.");
  }
  const page = all.slice(offset, offset + limit);
  return { nodes: page, nextCursor: offset + limit < all.length ? encodeCursor(offset + limit) : null };
}

export interface VersionRow {
  version: number;
  uploadedAt: string | null;
  uploadedBy: string | null;
  size: number | null;
  description: string | null;
}

export async function listVersions(ctx: NodeContext, documentId: string): Promise<VersionRow[]> {
  const { data, error } = await ctx.db.from('document_versions').select('*')
    .eq('tenant_id', ctx.tenantId).eq('document_id', documentId).order('version', { ascending: false });
  if (error) throw error;
  return (data || []).map((v: any) => ({
    version: v.version, uploadedAt: v.uploaded_at ?? null, uploadedBy: v.uploaded_by ?? null,
    size: v.size_bytes ?? null, description: v.description ?? null,
  }));
}
