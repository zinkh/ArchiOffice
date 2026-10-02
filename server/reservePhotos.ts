// ── Photos de réserves (OPR et GPA) ──────────────────────────────────────────
// Sur le modèle des photos de réunion (server/routes/meetings.ts) : une table
// `reserve_photos` et un bucket privé `reserve-photos`, lus via l'URL signée
// de server/routes/storageAccess.ts. Une seule table sert les deux jeux de
// réserves (`reserves` et `gpa_reserves`), distingués par `reserve_kind` —
// c'est donc ici, et pas par une clé étrangère, que la suppression d'une
// réserve emporte ses photos.
import type { Express } from 'express';
import { tenantScopedFrom } from './tenantScopedFrom';
import { sanitizeFilename } from './sanitizeFilename';
import { handleSingleSitePhotoUpload, sniffImageMime, resizeImage, MEETING_PHOTO_MAX_DIMENSION } from './imageUpload';

export const RESERVE_PHOTO_BUCKET = 'reserve-photos';

export type ReserveKind = 'opr' | 'gpa';

export interface ReserveKindConfig {
  kind: ReserveKind;
  table: 'reserves' | 'gpa_reserves';
  apiBase: '/api/reserves' | '/api/gpa-reserves';
}

export const RESERVE_KINDS: readonly ReserveKindConfig[] = [
  { kind: 'opr', table: 'reserves', apiBase: '/api/reserves' },
  { kind: 'gpa', table: 'gpa_reserves', apiBase: '/api/gpa-reserves' },
];

/**
 * Attache à chaque réserve son tableau `photos` (vide si aucune). Une seule
 * requête pour toute la liste, jamais une par réserve. Une instance dont la
 * base n'a pas encore joué la migration rend des tableaux vides plutôt
 * qu'une erreur : la liste des réserves ne doit pas dépendre des photos.
 */
export async function attachReservePhotos<T extends { id: string }>(
  supabaseAdmin: any, tenantId: string, kind: ReserveKind, reserves: T[],
): Promise<(T & { photos: any[] })[]> {
  if (reserves.length === 0) return [];
  const ids = reserves.map(r => r.id);
  const byReserve = new Map<string, any[]>();
  try {
    const { data } = await tenantScopedFrom(supabaseAdmin, tenantId, 'reserve_photos')
      .select('*').eq('reserve_kind', kind).in('reserve_id', ids).order('uploaded_at', { ascending: true });
    for (const photo of (data || []) as any[]) {
      const list = byReserve.get(photo.reserve_id) || [];
      list.push(photo);
      byReserve.set(photo.reserve_id, list);
    }
  } catch { /* table absente (instance non migrée) : pas de photos */ }
  return reserves.map(r => ({ ...r, photos: byReserve.get(r.id) || [] }));
}

/** Supprime les photos d'une réserve (lignes puis objets, en meilleur effort). */
export async function deleteReservePhotos(
  supabaseAdmin: any, tenantId: string, kind: ReserveKind, reserveId: string,
  deleteFromStorage?: (bucket: string, fileUrl: string) => Promise<void>,
): Promise<void> {
  try {
    const { data: photos } = await tenantScopedFrom(supabaseAdmin, tenantId, 'reserve_photos')
      .select('file_url').eq('reserve_kind', kind).eq('reserve_id', reserveId);
    await tenantScopedFrom(supabaseAdmin, tenantId, 'reserve_photos').delete().eq('reserve_kind', kind).eq('reserve_id', reserveId);
    if (deleteFromStorage) {
      for (const p of (photos || []) as any[]) deleteFromStorage(RESERVE_PHOTO_BUCKET, p.file_url).catch(() => {});
    }
  } catch { /* table absente : rien à supprimer */ }
}

export interface ReservePhotoRouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  uploadToStorage: (bucket: string, storagePath: string, buffer: Buffer, mimetype: string) => Promise<string>;
  deleteFromStorage: (bucket: string, fileUrl: string) => Promise<void>;
}

/**
 * `GET/POST /api/reserves/:id/photos`, `DELETE /api/reserves/:id/photos/:photoId`
 * et `PATCH /api/reserves/:id/photos/:photoId` (légende), et les mêmes sous
 * `/api/gpa-reserves`. La réserve visée doit appartenir au cabinet : l'id
 * d'une réserve d'un autre cabinet rend 404, jamais une écriture.
 */
export function registerReservePhotoRoutes(app: Express, { supabaseAdmin, getTenantId, uploadToStorage, deleteFromStorage }: ReservePhotoRouteDeps) {
  for (const { kind, table, apiBase } of RESERVE_KINDS) {
    const ownReserve = async (tenantId: string, id: string) => {
      const { data } = await supabaseAdmin.from(table).select('id').eq('id', id).eq('tenant_id', tenantId).maybeSingle();
      return !!data;
    };

    app.get(`${apiBase}/:id/photos`, async (req: any, res: any) => {
      try {
        const tenantId = await getTenantId(req.user.id);
        if (!(await ownReserve(tenantId, req.params.id))) return res.status(404).json({ error: 'Réserve introuvable.' });
        const [withPhotos] = await attachReservePhotos(supabaseAdmin, tenantId, kind, [{ id: req.params.id }]);
        res.json(withPhotos?.photos || []);
      } catch (e: any) { console.error(`[GET ${apiBase}/:id/photos]`, e); res.status(500).json({ error: e.message }); }
    });

    // Même liste blanche d'images que les photos de réunion : la photo est
    // rendue en <img> et reprise dans l'export PDF, tout ce qui n'est pas une
    // vraie image n'y servirait à rien.
    app.post(`${apiBase}/:id/photos`, handleSingleSitePhotoUpload('file'), async (req: any, res: any) => {
      try {
        const tenantId = await getTenantId(req.user.id);
        const { id } = req.params;
        if (!(await ownReserve(tenantId, id))) return res.status(404).json({ error: 'Réserve introuvable.' });
        const file = req.file;
        if (!file) return res.status(400).json({ error: 'Aucun fichier envoyé.' });
        // Id fourni par le client (file de synchro hors-ligne) : un envoi
        // rejoué après coupure réseau retrouve la photo déjà déposée au lieu
        // de la reposer une seconde fois sur le stockage.
        const clientPhotoId = typeof req.body?.id === 'string' && req.body.id ? req.body.id : null;
        if (clientPhotoId) {
          const { data: existing } = await tenantScopedFrom(supabaseAdmin, tenantId, 'reserve_photos').select('*').eq('id', clientPhotoId).maybeSingle();
          if (existing) return res.status(200).json(existing);
        }
        const sniffedMime = sniffImageMime(file.buffer);
        if (!sniffedMime) {
          return res.status(400).json({ error: 'Type de fichier non autorisé. Formats acceptés : PNG, JPEG, WebP.' });
        }
        const { buffer, mimetype } = await resizeImage(file.buffer, sniffedMime, MEETING_PHOTO_MAX_DIMENSION);
        const photoId = clientPhotoId || crypto.randomUUID();
        const storagePath = `${tenantId}/${id}/${photoId}-${sanitizeFilename(file.originalname || 'photo.jpg')}`;
        const file_url = await uploadToStorage(RESERVE_PHOTO_BUCKET, storagePath, buffer, mimetype);
        const uploaded_at = new Date().toISOString();
        const caption = typeof req.body?.caption === 'string' && req.body.caption.trim() ? req.body.caption.trim() : null;
        const row = { id: photoId, reserve_id: id, reserve_kind: kind, file_url, caption, uploaded_at };
        const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'reserve_photos').insert(row);
        if (error) throw error;
        res.status(201).json(row);
      } catch (e: any) { console.error(`[POST ${apiBase}/:id/photos]`, e); res.status(500).json({ error: e.message }); }
    });

    app.patch(`${apiBase}/:id/photos/:photoId`, async (req: any, res: any) => {
      try {
        const tenantId = await getTenantId(req.user.id);
        const { id, photoId } = req.params;
        const caption = typeof req.body?.caption === 'string' ? req.body.caption : null;
        const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'reserve_photos')
          .update({ caption }).eq('id', photoId).eq('reserve_id', id).eq('reserve_kind', kind);
        if (error) throw error;
        res.json({ success: true });
      } catch (e: any) { console.error(`[PATCH ${apiBase}/:id/photos/:photoId]`, e); res.status(500).json({ error: e.message }); }
    });

    app.delete(`${apiBase}/:id/photos/:photoId`, async (req: any, res: any) => {
      try {
        const tenantId = await getTenantId(req.user.id);
        const { id, photoId } = req.params;
        const { data: photo } = await tenantScopedFrom(supabaseAdmin, tenantId, 'reserve_photos')
          .select('file_url').eq('id', photoId).eq('reserve_id', id).eq('reserve_kind', kind).maybeSingle();
        if (!photo) return res.status(404).json({ error: 'Photo introuvable.' });
        await tenantScopedFrom(supabaseAdmin, tenantId, 'reserve_photos').delete().eq('id', photoId);
        deleteFromStorage(RESERVE_PHOTO_BUCKET, (photo as any).file_url).catch(() => {});
        res.json({ success: true });
      } catch (e: any) { console.error(`[DELETE ${apiBase}/:id/photos/:photoId]`, e); res.status(500).json({ error: e.message }); }
    });
  }
}
