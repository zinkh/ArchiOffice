// Écritures et lectures réelles des croquis : file hors ligne, cache Dexie, brouillon local, images gardées
// sur l'appareil. La logique pure est dans src/lib/croquisOffline.ts et src/lib/croquis/autosave.ts (testées) ;
// ce module en est la colle avec IndexedDB, localStorage, la file d'écritures et les URL signées.
// Routes serveur : server/routes/croquis.ts.
import { db, type CroquisFile, type PendingWrite } from '../db';
import type { Croquis } from '../types';
import type { CroquisScene } from '../types/croquis';
import type { LoadedBackground } from './croquis/background';
import { emptyScene } from './croquis/scene';
import {
  CROQUIS_WRITE_KINDS,
  croquisWriteEntity,
  croquisWriteId,
  parseCroquisWriteId,
  parseDraft,
  sceneEquals,
  serializeDraft,
  type CroquisDraft,
  type CroquisParent,
  type CroquisWriteKind,
} from './croquisOffline';
import {
  OFFLINE_WRITE_SYNCED_EVENT,
  discardPendingWrite,
  enqueueJsonRequest,
  enqueueMultipartRequest,
  queuedJsonRequest,
} from './offlineQueue';
import { resolveSignedUrl } from './signedStorageUrl';

export const croquisListUrl = (parent: CroquisParent): string =>
  `/api/croquis?${parent.kind === 'meeting' ? 'meeting_id' : 'site_report_id'}=${encodeURIComponent(parent.id)}`;

export async function readPendingCroquisWrites(): Promise<PendingWrite[]> {
  try {
    return (await db.pendingWrites.toArray()).filter((w) => w.entity === 'croquis' || w.entity === 'croquisFile');
  } catch {
    return [];
  }
}

// ── Brouillon local (synchrone) ─────────────────────────────────────────────

const draftKey = (id: string): string => `croquis-draft:${id}`;

/** `false` si le navigateur refuse (quota, navigation privée) : la file reste alors la seule protection. */
export function saveCroquisDraft(id: string, scene: CroquisScene, bgOpacity: number): boolean {
  try {
    localStorage.setItem(draftKey(id), serializeDraft(scene, bgOpacity));
    return true;
  } catch {
    return false;
  }
}

export function loadCroquisDraft(id: string): CroquisDraft | null {
  try {
    return parseDraft(localStorage.getItem(draftKey(id)));
  } catch {
    return null;
  }
}

/**
 * Retire le brouillon. Avec `sent`, seulement s'il est identique à ce qui vient de partir : on a pu
 * continuer à dessiner pendant l'envoi, et ce nouveau brouillon-là ne doit pas disparaître.
 */
export function clearCroquisDraft(id: string, sent?: { scene: CroquisScene; bgOpacity: number }): void {
  try {
    if (sent) {
      const draft = parseDraft(localStorage.getItem(draftKey(id)));
      if (draft && (!sceneEquals(draft.scene, sent.scene) || Math.abs(draft.bgOpacity - sent.bgOpacity) > 0.001)) return;
    }
    localStorage.removeItem(draftKey(id));
  } catch {
    /* rien à retirer */
  }
}

// ── Écritures JSON ──────────────────────────────────────────────────────────

interface JsonRequest {
  entity: PendingWrite['entity'];
  id: string;
  method: PendingWrite['method'];
  url: string;
  body?: unknown;
}

async function isPending(kind: CroquisWriteKind, croquisId: string): Promise<boolean> {
  try {
    return Boolean(await db.pendingWrites.get(croquisWriteId(kind, croquisId)));
  } catch {
    return false;
  }
}

/**
 * Envoie tout de suite, sauf si une écriture qui doit passer AVANT est encore en file : la création (le
 * serveur répondrait 404) ou un enregistrement plus ancien du même champ (il écraserait celui-ci en
 * repartant après lui). L'écriture entre alors dans la file, qui rejoue dans l'ordre de création.
 */
async function writeOrdered<T>(request: JsonRequest, behind: CroquisWriteKind[], croquisId: string): Promise<{ queued: boolean; data?: T }> {
  for (const kind of behind) {
    if (await isPending(kind, croquisId)) {
      await enqueueJsonRequest(request);
      return { queued: true };
    }
  }
  return queuedJsonRequest<T>(request);
}

const cachePut = (row: Croquis | undefined) => {
  if (row?.id) db.croquisCache.put(row).catch(() => undefined);
};

export async function createCroquis(parent: CroquisParent, input: { title: string; scene?: CroquisScene }): Promise<{ row: Croquis; queued: boolean }> {
  const id = crypto.randomUUID();
  const scene = input.scene ?? emptyScene();
  const body = {
    id,
    ...(parent.kind === 'meeting' ? { meeting_id: parent.id } : { site_report_id: parent.id }),
    title: input.title,
    scene,
  };
  const result = await queuedJsonRequest<Croquis>({ entity: 'croquis', id: croquisWriteId('create', id), method: 'POST', url: '/api/croquis', body });
  if (!result.queued && result.data) {
    cachePut(result.data);
    return { row: result.data, queued: false };
  }
  const now = new Date().toISOString();
  const row: Croquis = {
    id,
    project_id: parent.projectId ?? null,
    meeting_id: parent.kind === 'meeting' ? parent.id : null,
    site_report_id: parent.kind === 'siteReport' ? parent.id : null,
    title: input.title,
    scene,
    bg_path: null,
    bg_opacity: 0.35,
    created_at: now,
    updated_at: now,
    pendingSync: true,
  };
  return { row, queued: true };
}

/** Enregistre la scène et l'opacité du fond. Toujours l'état COMPLET : une écriture en file remplace la précédente. */
export async function persistCroquisScene(id: string, scene: CroquisScene, bgOpacity: number): Promise<{ queued: boolean }> {
  const result = await writeOrdered<Croquis>({
    entity: 'croquis',
    id: croquisWriteId('scene', id),
    method: 'PUT',
    url: `/api/croquis/${id}`,
    body: { scene, bg_opacity: bgOpacity },
  }, ['create', 'scene'], id);
  cachePut(result.data);
  return { queued: result.queued };
}

export async function renameCroquis(id: string, title: string): Promise<{ queued: boolean }> {
  const result = await writeOrdered<Croquis>({
    entity: 'croquis',
    id: croquisWriteId('title', id),
    method: 'PUT',
    url: `/api/croquis/${id}`,
    body: { title },
  }, ['create', 'title'], id);
  cachePut(result.data);
  return { queued: result.queued };
}

/** Supprime un croquis, avec tout ce qui attendait encore d'être envoyé à son sujet. */
export async function deleteCroquis(id: string): Promise<{ queued: boolean }> {
  for (const kind of CROQUIS_WRITE_KINDS) {
    if (kind !== 'remove') await discardPendingWrite(croquisWriteId(kind, id), croquisWriteEntity(kind));
  }
  clearCroquisDraft(id);
  // Même un croquis jamais parti reçoit sa suppression : le serveur répond « fait » pour un croquis absent.
  const result = await queuedJsonRequest({ entity: 'croquis', id: croquisWriteId('remove', id), method: 'DELETE', url: `/api/croquis/${id}` });
  await db.croquisCache.delete(id).catch(() => undefined);
  await db.croquisFiles.where('croquisId').equals(id).delete().catch(() => undefined);
  return { queued: result.queued };
}

// ── Images : fond et aperçu ─────────────────────────────────────────────────

const fileKey = (id: string, kind: 'bg' | 'preview') => `${id}:${kind}`;

async function keepLocalImage(id: string, kind: 'bg' | 'preview', blob: Blob, size?: { width: number; height: number }) {
  const entry: CroquisFile = { id: fileKey(id, kind), croquisId: id, path: null, blob, width: size?.width, height: size?.height, savedAt: Date.now() };
  await db.croquisFiles.put(entry).catch(() => undefined);
}

/** Pose le fond : gardé sur l'appareil tout de suite (affichage et export hors ligne), envoyé en arrière-plan. */
export async function importCroquisBackground(id: string, loaded: LoadedBackground): Promise<void> {
  const { background, blob } = loaded;
  await keepLocalImage(id, 'bg', blob, { width: background.width, height: background.height });
  await discardPendingWrite(croquisWriteId('backgroundClear', id), 'croquis');
  await enqueueMultipartRequest({
    entity: 'croquisFile',
    id: croquisWriteId('background', id),
    method: 'POST',
    url: `/api/croquis/${id}/background`,
    blob,
    blobFieldName: 'file',
    blobFilename: 'fond.jpg',
    extraFields: { width: String(background.width), height: String(background.height) },
  });
}

/** Retour à la feuille blanche. Un fond encore en attente d'envoi est simplement abandonné. */
export async function clearCroquisBackground(id: string): Promise<void> {
  await discardPendingWrite(croquisWriteId('background', id), 'croquisFile');
  await db.croquisFiles.delete(fileKey(id, 'bg')).catch(() => undefined);
  await enqueueJsonRequest({ entity: 'croquis', id: croquisWriteId('backgroundClear', id), method: 'DELETE', url: `/api/croquis/${id}/background` });
}

/** Aperçu PNG du croquis, inséré dans les exports du compte-rendu. Un nouvel aperçu remplace l'ancien en file. */
export async function saveCroquisPreview(id: string, blob: Blob): Promise<void> {
  await keepLocalImage(id, 'preview', blob);
  await enqueueMultipartRequest({
    entity: 'croquisFile',
    id: croquisWriteId('preview', id),
    method: 'POST',
    url: `/api/croquis/${id}/preview`,
    blob,
    blobFieldName: 'file',
    blobFilename: 'apercu.png',
  });
}

/**
 * L'image d'un croquis (fond ou aperçu) : d'abord celle gardée sur l'appareil, sinon celle du serveur (puis
 * gardée). Hors ligne, une ancienne image vaut mieux qu'aucune. `null` : pas d'image, ou illisible.
 */
export async function loadCroquisImage(row: Croquis, kind: 'bg' | 'preview'): Promise<Blob | null> {
  const key = fileKey(row.id, kind);
  const serverPath = kind === 'bg' ? row.bg_path : row.preview_path;
  const pendingKind: CroquisWriteKind = kind === 'bg' ? 'background' : 'preview';
  let cached: CroquisFile | undefined;
  try { cached = await db.croquisFiles.get(key); } catch { cached = undefined; }

  if (cached) {
    if (cached.path === null) {
      // Image posée depuis cet appareil. Une fois partie, la ligne porte sa référence : on la retient.
      if (serverPath && !(await isPending(pendingKind, row.id))) await db.croquisFiles.update(key, { path: serverPath }).catch(() => undefined);
      return cached.blob;
    }
    if (cached.path === serverPath) return cached.blob;
  }
  if (!serverPath) return null;
  if (!navigator.onLine) return cached?.blob ?? null;
  try {
    const response = await fetch(await resolveSignedUrl(serverPath));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    await db.croquisFiles.put({
      id: key, croquisId: row.id, path: serverPath, blob,
      width: kind === 'bg' ? row.bg_width ?? undefined : undefined,
      height: kind === 'bg' ? row.bg_height ?? undefined : undefined,
      savedAt: Date.now(),
    }).catch(() => undefined);
    return blob;
  } catch {
    return cached?.blob ?? null;
  }
}

// ── Cache à l'arrivée d'une écriture rejouée ────────────────────────────────

let listening = false;

/**
 * Quand une écriture en file atteint enfin le serveur, sa réponse (la ligne à jour) rafraîchit le cache, et
 * l'image déposée est marquée « envoyée ». Posé une fois pour toute la session, par les hooks de croquis.
 */
export function installCroquisSyncListener(): void {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener(OFFLINE_WRITE_SYNCED_EVENT, (event) => {
    const detail = (event as CustomEvent).detail as { id?: string; entity?: string; data?: any } | undefined;
    if (!detail?.id || (detail.entity !== 'croquis' && detail.entity !== 'croquisFile')) return;
    const parsed = parseCroquisWriteId(detail.id);
    const data = detail.data;
    if (!parsed || !data || typeof data !== 'object') return;
    if (typeof data.id === 'string' && data.scene) cachePut(data as Croquis);
    if (parsed.kind === 'background' && data.bg_path) db.croquisFiles.update(fileKey(parsed.croquisId, 'bg'), { path: data.bg_path }).catch(() => undefined);
    if (parsed.kind === 'preview' && data.preview_path) db.croquisFiles.update(fileKey(parsed.croquisId, 'preview'), { path: data.preview_path }).catch(() => undefined);
  });
}
