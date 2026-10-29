// Photos de réserves en attente d'envoi, superposées à la liste lue sur le serveur.
//
// Une photo prise sur le chantier est rangée dans la file d'écritures (IndexedDB) et part en
// arrière-plan : la saisie ne l'attend jamais. Tant qu'elle n'est pas sur le serveur, la liste
// lue (`GET /api/reserves`) ne la connaît pas ; sans cette superposition, elle disparaîtrait de
// l'écran à chaque rechargement alors qu'elle est bien gardée sur l'appareil.
import type { PendingWrite } from '../db';
import type { ReservePhoto } from '../types';

/**
 * Fichier à afficher pour une photo : la miniature du serveur quand elle existe (une case de liste
 * n'a pas à télécharger la photo de 1600 px), sinon la photo elle-même. `thumbFailed` : la miniature
 * n'a pas pu être lue, on retombe sur la photo plutôt que d'afficher une case vide.
 */
export function photoDisplaySrc(photo: Pick<ReservePhoto, 'file_url' | 'thumb_url'>, thumbFailed = false): string {
  return photo.thumb_url && !thumbFailed ? photo.thumb_url : photo.file_url;
}

/** Entité de file des photos, selon le jeu de réserves (OPR ou GPA). */
export function photoEntityFor(apiBase: '/api/reserves' | '/api/gpa-reserves'): 'reservePhoto' | 'gpaReservePhoto' {
  return apiBase === '/api/gpa-reserves' ? 'gpaReservePhoto' : 'reservePhoto';
}

/** Identifiant de la réserve visée par une écriture de photo (`/api/reserves/<id>/photos`). */
export function reserveIdFromPhotoUrl(url: string): string | null {
  const match = /^\/api\/(?:reserves|gpa-reserves)\/([^/?#]+)\/photos$/.exec(url);
  if (!match) return null;
  try { return decodeURIComponent(match[1]); } catch { return null; }
}

type PhotoWrite = Pick<PendingWrite, 'id' | 'entity' | 'method' | 'url' | 'kind' | 'status' | 'createdAt' | 'lastError'>;

/** Photos en attente d'une entité, regroupées par réserve, dans l'ordre où elles ont été prises. */
export function pendingPhotosByReserve(
  writes: PhotoWrite[],
  entity: 'reservePhoto' | 'gpaReservePhoto',
  previewFor: (writeId: string) => string,
): Map<string, ReservePhoto[]> {
  const kind = entity === 'gpaReservePhoto' ? 'gpa' : 'opr';
  const byReserve = new Map<string, ReservePhoto[]>();
  const ordered = writes
    .filter(w => w.entity === entity && w.method === 'POST' && w.kind === 'multipart')
    .sort((a, b) => a.createdAt - b.createdAt);
  for (const w of ordered) {
    const reserveId = reserveIdFromPhotoUrl(w.url);
    if (!reserveId) continue;
    const list = byReserve.get(reserveId) || [];
    list.push({
      id: w.id,
      reserve_id: reserveId,
      reserve_kind: kind,
      file_url: '',
      uploaded_at: new Date(w.createdAt).toISOString(),
      pendingSync: true,
      localPreviewUrl: previewFor(w.id),
      syncError: w.status === 'error' ? (w.lastError || 'Envoi refusé') : undefined,
    });
    byReserve.set(reserveId, list);
  }
  return byReserve;
}

/**
 * Ajoute à chaque réserve ses photos en attente. Rend la MÊME liste (même référence) quand il
 * n'y a rien à superposer, pour ne pas relancer les calculs de l'écran à chaque lecture de la file.
 */
export function overlayPendingPhotos<T extends { id: string; photos?: ReservePhoto[] }>(
  reserves: T[],
  pending: Map<string, ReservePhoto[]>,
): T[] {
  if (pending.size === 0) return reserves;
  let changed = false;
  const result = reserves.map(reserve => {
    const extra = pending.get(reserve.id);
    if (!extra || extra.length === 0) return reserve;
    const known = new Set((reserve.photos || []).map(p => p.id));
    // Une photo déjà revenue du serveur (écran relu juste après l'envoi) ne s'affiche pas deux fois.
    const toAdd = extra.filter(p => !known.has(p.id));
    if (toAdd.length === 0) return reserve;
    changed = true;
    return { ...reserve, photos: [...(reserve.photos || []), ...toAdd] };
  });
  return changed ? result : reserves;
}

// Un aperçu local par photo en attente, créé une fois et libéré à l'envoi : en créer un à chaque
// rendu fuirait la mémoire, ce qui compte sur un iPad qui garde la liste ouverte toute la journée.
const previewUrls = new Map<string, string>();

export function previewUrlFor(writeId: string, blob: Blob | undefined): string {
  const existing = previewUrls.get(writeId);
  if (existing) return existing;
  if (!blob || typeof URL === 'undefined' || !URL.createObjectURL) return '';
  const url = URL.createObjectURL(blob);
  previewUrls.set(writeId, url);
  return url;
}

export function releasePreviewUrl(writeId: string): void {
  const url = previewUrls.get(writeId);
  if (!url) return;
  previewUrls.delete(writeId);
  try { URL.revokeObjectURL(url); } catch { /* déjà libéré */ }
}
