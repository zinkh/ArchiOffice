// Résolution de `<racine>/<affaire>/<phase>` chez le fournisseur, et son cache.
//
// Sans cache, chaque dépôt de fichier coûterait deux à six appels à l'API du
// fournisseur rien que pour retrouver un dossier qui existe déjà. Avec, un dépôt
// en régime établi ne coûte qu'un SELECT : `external_storage_folders` associe un
// chemin logique normalisé à l'identifiant du dossier chez le fournisseur.
//
// L'orchestration vit ici et non dans les adaptateurs : ceux-ci n'exposent que
// `findChildFolder` et `createChildFolder` (voir provider.ts), pour que les
// trois partagent ce cache au lieu d'en réimplémenter chacun un.
import type { ExternalStorageProvider } from './provider';
import type { ExternalStorageConnection } from './externalConnection';

/** Le chemin logique, racine comprise, tel qu'il est mémorisé en base. */
export function folderKeyFor(connection: ExternalStorageConnection, segments: string[]): string {
  return [connection.root_folder_path, ...segments].join('/');
}

/**
 * L'identifiant du dossier correspondant à `segments` sous la racine, en le
 * créant au besoin.
 *
 * Une seule requête de lecture pour tout le chemin (`in` sur les clés
 * cumulatives), puis on ne descend qu'à partir du préfixe le plus profond déjà
 * connu.
 */
export async function ensureFolderPath(
  supabaseAdmin: any,
  tenantId: string,
  connection: ExternalStorageConnection,
  provider: ExternalStorageProvider,
  segments: string[],
): Promise<string> {
  const keys: string[] = [];
  for (let i = 0; i < segments.length; i += 1) {
    keys.push(folderKeyFor(connection, segments.slice(0, i + 1)));
  }
  const rootKey = connection.root_folder_path;

  const known = new Map<string, string>();
  const { data: rows } = await supabaseAdmin
    .from('external_storage_folders')
    .select('folder_key, external_id')
    .eq('connection_id', connection.id)
    .in('folder_key', [rootKey, ...keys]);
  for (const row of (rows as any[]) || []) known.set(row.folder_key, row.external_id);

  // La racine d'abord : elle est portée par la connexion elle-même, pour qu'une
  // reconnexion ne reparte pas d'un dossier neuf.
  let parentId = known.get(rootKey) || connection.root_folder_external_id || null;
  const toCache: Array<{ folder_key: string; external_id: string }> = [];
  if (!parentId) {
    parentId = await provider.resolveRoot();
    toCache.push({ folder_key: rootKey, external_id: parentId });
  }

  for (let i = 0; i < segments.length; i += 1) {
    const key = keys[i];
    const cached = known.get(key);
    if (cached) {
      parentId = cached;
      continue;
    }
    // On cherche avant de créer : c'est ce qui rend la reprise idempotente quand
    // le dossier existe déjà côté drive (reconnexion, cache vidé, dossier créé à
    // la main par le cabinet).
    const found = await provider.findChildFolder(parentId as string, segments[i]);
    parentId = found ?? (await provider.createChildFolder(parentId as string, segments[i]));
    toCache.push({ folder_key: key, external_id: parentId });
  }

  if (toCache.length) {
    const now = new Date().toISOString();
    // L'index unique (connection_id, folder_key) rend cet upsert idempotent :
    // deux dépôts simultanés sur la même affaire ne créent pas deux lignes.
    await supabaseAdmin
      .from('external_storage_folders')
      .upsert(
        toCache.map((row) => ({
          tenant_id: tenantId,
          connection_id: connection.id,
          folder_key: row.folder_key,
          external_id: row.external_id,
          last_verified_at: now,
        })),
        { onConflict: 'connection_id,folder_key' },
      );
  }

  return parentId as string;
}

/**
 * Oublie un chemin et tout ce qui vit dessous.
 *
 * Appelé quand le fournisseur répond que le dossier n'existe plus : quelqu'un
 * l'a renommé ou mis à la corbeille depuis son drive. On efface le sous-arbre
 * plutôt que la seule clé, parce que les identifiants des dossiers enfants
 * mémorisés sont alors tout aussi périmés.
 *
 * Conséquence assumée : un dossier renommé à la main fait réapparaître, au
 * dépôt suivant, un dossier au nom d'origine à côté du sien. On ne poursuit pas
 * les renommages — ce serait deviner. Les fichiers déjà déposés, eux, ne sont
 * pas concernés : ils sont référencés par leur propre identifiant, jamais par le
 * chemin de leur dossier.
 */
export async function invalidateFolderSubtree(
  supabaseAdmin: any,
  connectionId: string,
  folderKey: string,
): Promise<void> {
  try {
    await supabaseAdmin
      .from('external_storage_folders')
      .delete()
      .eq('connection_id', connectionId)
      .like('folder_key', `${folderKey}%`);
  } catch {
    /* meilleur effort : la reprise recréera ce qu'il faut */
  }
}
