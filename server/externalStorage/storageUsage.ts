// Les octets qu'un cabinet occupe RÉELLEMENT chez nous.
//
// Deux endroits mesuraient jusqu'ici la même chose chacun de leur côté :
// server.ts::checkStorageQuota (le plafond qui refuse un dépôt) et
// server/routes/billing.ts (la jauge « Stockage » de l'écran Abonnement). Ils
// sommaient tous deux `document_versions.size_bytes` sans distinction.
//
// Depuis que les documents peuvent vivre sur l'espace du cabinet, compter ces
// octets-là contre son quota n'a plus de sens : ils ne nous coûtent rien, et lui
// refuser le bénéfice de l'économie qu'il vient de faire serait exactement
// l'inverse du but. D'où le filtre sur `storage_backend`, et d'où le fait de
// n'avoir plus qu'un seul endroit pour le poser — un filtre appliqué au plafond
// mais oublié sur la jauge donnerait un écran qui monte sans jamais bloquer,
// c'est-à-dire incompréhensible.
//
// C'est la seule raison d'être de la colonne `storage_backend` : une requête
// PostgREST ne sait pas analyser une URI, alors que c'est bien `file_url` qui
// fait foi partout ailleurs.

// Mesure exacte, tous buckets métier : la fonction SQL tenant_storage_bytes
// (supabase/migrate_tenant_storage_bytes.sql) additionne les objets rangés sous
// `<cabinet>/...` dans storage.objects. Les photos, plans, messages et CV n'entrent
// pas dans document_versions : sans elle, un plafond se contournait par les photos
// (en production, 51 Mo comptés pour 93 Mo réellement hébergés).
//
// Repli sur l'ancien calcul (versions de documents seulement) quand la fonction
// n'existe pas (instance non migrée), rend NULL (Postgres local d'Electron, sans
// schéma `storage`) ou échoue : mieux vaut sous-compter que refuser un dépôt à
// cause d'une mesure indisponible.
async function measuredStorageBytes(supabaseAdmin: any, tenantId: string): Promise<number | null> {
  try {
    const { data, error } = await supabaseAdmin.rpc('tenant_storage_bytes', { p_tenant_id: tenantId });
    if (error) {
      const missing = error.code === 'PGRST202' || error.code === '42883';
      if (!missing) console.warn('[storageUsage] tenant_storage_bytes indisponible :', error.message);
      return null;
    }
    // bigint : renvoyé en nombre par PostgREST, en texte au-delà de 2^53.
    const bytes = data === null || data === undefined ? NaN : Number(data);
    return Number.isFinite(bytes) && bytes >= 0 ? bytes : null;
  } catch {
    return null;
  }
}

export async function tenantSupabaseStorageBytes(
  supabaseAdmin: any,
  tenantId: string,
): Promise<number> {
  const measured = await measuredStorageBytes(supabaseAdmin, tenantId);
  if (measured !== null) return measured;

  const { data } = await supabaseAdmin
    .from('document_versions')
    .select('size_bytes')
    .eq('tenant_id', tenantId)
    .eq('storage_backend', 'supabase');
  return ((data as any[]) || []).reduce((sum: number, row: any) => sum + (row.size_bytes || 0), 0);
}
