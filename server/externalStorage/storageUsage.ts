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

export async function tenantSupabaseStorageBytes(
  supabaseAdmin: any,
  tenantId: string,
): Promise<number> {
  const { data } = await supabaseAdmin
    .from('document_versions')
    .select('size_bytes')
    .eq('tenant_id', tenantId)
    .eq('storage_backend', 'supabase');
  return ((data as any[]) || []).reduce((sum: number, row: any) => sum + (row.size_bytes || 0), 0);
}
