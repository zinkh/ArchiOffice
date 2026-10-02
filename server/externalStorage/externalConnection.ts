// Chargement de l'espace de stockage actif d'un cabinet, et report de son état
// quand un appel au fournisseur échoue.
//
// Le cache mémoire n'est pas une optimisation gratuite : `storeBusinessFile` est
// appelé à chaque dépôt de fichier, et une requête de plus par dépôt pour lire
// la même ligne de configuration serait du gaspillage pur. Le TTL est court
// (30 s) parce qu'une déconnexion depuis les Réglages doit prendre effet
// rapidement sans qu'on ait à invalider depuis toutes les routes ; la route de
// déconnexion invalide malgré tout explicitement, pour que l'effet soit immédiat
// sur l'instance qui a reçu le clic.
import { ExternalStorageError } from './provider';

export interface ExternalStorageConnection {
  id: string;
  tenant_id: string;
  provider: 'google_drive' | 'dropbox' | 'webdav';
  webdav_flavor?: string | null;
  display_name?: string | null;
  external_account_email?: string | null;
  refresh_token?: string | null;
  access_token?: string | null;
  expires_at?: string | null;
  scopes?: string | null;
  drive_id?: string | null;
  base_url?: string | null;
  username?: string | null;
  password_encrypted?: string | null;
  root_folder_path: string;
  root_folder_external_id?: string | null;
  is_active: boolean;
  status: string;
}

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { connection: ExternalStorageConnection | null; expiresAt: number }>();

export function invalidateConnectionCache(tenantId?: string): void {
  if (tenantId) cache.delete(tenantId);
  else cache.clear();
}

/** L'espace actif du cabinet, ou null s'il n'en a pas branché — auquel cas tout
 *  continue d'aller dans Supabase Storage, exactement comme avant. */
export async function getActiveConnection(
  supabaseAdmin: any,
  tenantId: string,
): Promise<ExternalStorageConnection | null> {
  const cached = cache.get(tenantId);
  if (cached && cached.expiresAt > Date.now()) return cached.connection;

  let connection: ExternalStorageConnection | null = null;
  try {
    const { data } = await supabaseAdmin
      .from('external_storage_connections')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .maybeSingle();
    connection = (data as ExternalStorageConnection) ?? null;
  } catch {
    // Table absente (migration pas encore jouée) : on se comporte comme un
    // cabinet sans espace externe plutôt que de faire échouer tous les dépôts.
    connection = null;
  }

  cache.set(tenantId, { connection, expiresAt: Date.now() + CACHE_TTL_MS });
  return connection;
}

/** Recharge une connexion par son identifiant, quel que soit son état actif —
 *  c'est ce dont la LECTURE a besoin : un fichier déposé hier doit rester
 *  consultable même si le cabinet a depuis déconnecté son espace. */
export async function getConnectionById(
  supabaseAdmin: any,
  tenantId: string,
  connectionId: string,
): Promise<ExternalStorageConnection | null> {
  const { data } = await supabaseAdmin
    .from('external_storage_connections')
    .select('*')
    .eq('id', connectionId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  return (data as ExternalStorageConnection) ?? null;
}

/** Écrit sur la connexion pourquoi le dernier appel a échoué, pour que l'écran
 *  Réglages puisse le dire au lieu de laisser l'utilisateur deviner. Meilleur
 *  effort : signaler une panne ne doit pas en provoquer une seconde. */
export async function recordConnectionError(
  supabaseAdmin: any,
  connection: ExternalStorageConnection,
  error: unknown,
): Promise<void> {
  const code = error instanceof ExternalStorageError ? error.code : 'unknown';
  const status = code === 'needs_reauth' ? 'needs_reauth' : 'error';
  const message = error instanceof Error ? error.message : String(error);
  try {
    await supabaseAdmin
      .from('external_storage_connections')
      .update({ status, last_error: message.slice(0, 500), last_error_at: new Date().toISOString() })
      .eq('id', connection.id);
    invalidateConnectionCache(connection.tenant_id);
  } catch {
    /* meilleur effort */
  }
}

/** Remet la connexion au vert après un appel réussi, et note l'usage. */
export async function recordConnectionSuccess(
  supabaseAdmin: any,
  connection: ExternalStorageConnection,
): Promise<void> {
  const patch: any = { last_used_at: new Date().toISOString() };
  if (connection.status !== 'ok') {
    patch.status = 'ok';
    patch.last_error = null;
    patch.last_error_at = null;
  }
  try {
    await supabaseAdmin.from('external_storage_connections').update(patch).eq('id', connection.id);
    if (patch.status) invalidateConnectionCache(connection.tenant_id);
  } catch {
    /* meilleur effort */
  }
}
