// Rafraîchissement des jetons d'accès des espaces de stockage OAuth
// (Google Drive, Dropbox).
//
// Même mécanique que server/mailOAuthTokens.ts, dont ce fichier est le
// pendant : cache en mémoire keyé par `connection.id`, marge de sécurité de
// 60 s avant l'expiration, et `decryptSecretMaybe` pour lire un jeton
// éventuellement écrit en clair avant le passage au chiffrement.
//
// Volontairement séparé plutôt qu'ajouté à mailOAuthTokens.ts : ce dernier lit
// et écrit `email_connections`/`calendar_connections`, et sa rotation de jeton
// Microsoft n'a rien à voir avec du stockage. Le peu de code commun (un POST
// de formulaire vers un point de terminaison de jeton) ne justifie pas de
// coupler deux domaines.
import { decryptSecretMaybe, encryptSecret } from '../secretsCrypto';
import { ExternalStorageError } from './provider';
import type { ExternalStorageConnection } from './externalConnection';

const cache = new Map<string, { token: string; expiresAt: number }>();

export function clearStorageTokenCache(connectionId?: string): void {
  if (connectionId) cache.delete(connectionId);
  else cache.clear();
}

interface RefreshConfig {
  tokenUrl: string;
  clientId: string | undefined;
  clientSecret: string | undefined;
  /** Nom du fournisseur, pour les messages d'erreur lisibles par l'architecte. */
  label: string;
  /** Certains fournisseurs font tourner le refresh token à chaque usage ; il
   *  faut alors le repersister ou la connexion meurt à l'expiration du premier. */
  persistRotatedRefreshToken?: boolean;
  supabaseAdmin?: any;
}

export async function getStorageAccessToken(
  connection: ExternalStorageConnection,
  config: RefreshConfig,
): Promise<string> {
  const now = Date.now();
  const cached = cache.get(connection.id);
  if (cached && cached.expiresAt > now + 60_000) return cached.token;

  if (!config.clientId || !config.clientSecret) {
    throw new ExternalStorageError(
      `Le connecteur ${config.label} n'est pas configuré sur cette instance.`,
      'unknown',
      503,
    );
  }
  const refreshToken = decryptSecretMaybe(connection.refresh_token);
  if (!refreshToken) {
    throw new ExternalStorageError(
      `L'accès à ${config.label} a été révoqué. Reconnectez cet espace de stockage.`,
      'needs_reauth',
      502,
    );
  }

  const resp = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }).toString(),
  });
  const data: any = await resp.json().catch(() => ({}));

  if (!resp.ok || !data.access_token) {
    // invalid_grant = le cabinet a retiré l'accès depuis son compte, ou le
    // jeton a expiré faute d'usage. Se reconnecter est la seule issue ; le
    // distinguer d'une panne réseau évite de faire attendre pour rien.
    const revoked = data?.error === 'invalid_grant' || resp.status === 400 || resp.status === 401;
    throw new ExternalStorageError(
      data?.error_description || data?.error || `Échec du rafraîchissement du jeton ${config.label}`,
      revoked ? 'needs_reauth' : 'unreachable',
      502,
    );
  }

  if (config.persistRotatedRefreshToken && data.refresh_token && data.refresh_token !== refreshToken && config.supabaseAdmin) {
    connection.refresh_token = data.refresh_token;
    config.supabaseAdmin.from('external_storage_connections')
      .update({ refresh_token: encryptSecret(data.refresh_token) }).eq('id', connection.id)
      .then(() => {}, (err: any) => console.error('[externalStorage refresh_token persist]', err?.message));
  }

  cache.set(connection.id, {
    token: data.access_token,
    expiresAt: now + (data.expires_in || 3600) * 1000,
  });
  return data.access_token;
}
