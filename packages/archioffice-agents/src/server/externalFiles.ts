// Le pont par lequel ce package lit un fichier hébergé sur l'espace de stockage
// du cabinet (Google Drive, Dropbox, Nextcloud, kDrive).
//
// Ce package est un module propriétaire autonome : il n'importe rien depuis le
// `server/` de l'application hôte (voir le commentaire de context.ts sur sa
// copie de parseStorageRef). Il ne peut donc pas construire lui-même un
// adaptateur de stockage. L'application lui en dépose un au démarrage, exactement
// comme `initOAuthStateStore(supabaseAdmin)` le fait pour les nonces OAuth :
// une variable de module posée une fois, plutôt qu'un paramètre de plus à
// propager dans tous les points d'appel.
//
// Sans ce pont, les agents cesseraient de lire les pièces jointes déposées
// depuis qu'un cabinet a branché son espace — silencieusement, en rapportant
// simplement que le document est vide.

export type ExternalFileReader = (
  tenantId: string,
  fileUrl: string,
) => Promise<{ buffer: Buffer; contentType: string } | null>;

let reader: ExternalFileReader | null = null;

export function setExternalFileReader(fn: ExternalFileReader | null): void {
  reader = fn;
}

/** Null si l'hôte n'a rien branché, ou si la référence n'est pas externe : le
 *  lecteur retombe alors sur ses chemins habituels. */
export async function readExternalFile(
  tenantId: string,
  fileUrl: string,
): Promise<{ buffer: Buffer; contentType: string } | null> {
  if (!reader || !fileUrl) return null;
  try {
    return await reader(tenantId, fileUrl);
  } catch {
    return null;
  }
}
