// Lien de téléchargement d'un fichier d'un cabinet, pour le compte d'un invité.
//
// Même mécanisme que GET /api/storage/signed-url (server/routes/storageAccess.ts),
// avec une différence qui change tout : le cabinet n'est PAS celui de l'appelant,
// c'est celui du partage. L'appelant n'est membre de rien dans ce cabinet, donc
// l'appartenance du fichier se vérifie contre `tenantId` fourni par le partage,
// jamais contre un cabinet désigné par la requête. Le droit sur le document et son
// rattachement à l'affaire partagée se vérifient AVANT l'appel, dans la route.
import { PRIVATE_STORAGE_BUCKETS, parseStorageRef } from '../storagePaths';
import { isExternalRef, parseExternalRef } from '../externalStorage/externalRef';
import { getConnectionById } from '../externalStorage/externalConnection';
import { EXTERNAL_TICKET_TTL_SECONDS, signExternalTicket } from '../externalStorage/externalTicket';

const SIGNED_URL_TTL_SECONDS = 60 * 60;

export type FileLink =
  | { ok: true; url: string; expiresIn: number }
  | { ok: false; status: number; error: string };

export async function linkForTenantFile(supabaseAdmin: any, tenantId: string, fileUrl: string): Promise<FileLink> {
  if (isExternalRef(fileUrl)) {
    const ref = parseExternalRef(fileUrl);
    if (!ref) return { ok: false, status: 400, error: 'Référence de stockage invalide' };
    if (process.env.OFFLINE_MODE === 'true') {
      return { ok: false, status: 503, error: "Ce fichier est hébergé sur l'espace de stockage du cabinet et n'est pas disponible hors ligne." };
    }
    // Faute de préfixe `${tenantId}/` dans le chemin, c'est l'appartenance de la
    // CONNEXION au cabinet du partage qui fait frontière.
    const connection = await getConnectionById(supabaseAdmin, tenantId, ref.connectionId);
    if (!connection) return { ok: false, status: 403, error: 'Accès refusé' };
    const ticket = signExternalTicket({ t: tenantId, c: ref.connectionId, e: ref.externalId, n: ref.fileName });
    return { ok: true, url: `/api/storage/external/${encodeURIComponent(ticket)}`, expiresIn: EXTERNAL_TICKET_TTL_SECONDS };
  }

  const ref = parseStorageRef(fileUrl);
  if (!ref || !PRIVATE_STORAGE_BUCKETS.has(ref.bucket)) {
    return { ok: false, status: 400, error: 'Référence de stockage invalide' };
  }
  if (!ref.path.startsWith(`${tenantId}/`)) return { ok: false, status: 403, error: 'Accès refusé' };
  const { data, error } = await supabaseAdmin.storage.from(ref.bucket).createSignedUrl(ref.path, SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) return { ok: false, status: 404, error: 'Fichier introuvable' };
  return { ok: true, url: data.signedUrl, expiresIn: SIGNED_URL_TTL_SECONDS };
}
