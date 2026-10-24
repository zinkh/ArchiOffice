// Affaires archivées : ce qu'une lecture « de suivi » (alertes métier, suggestions
// IA) doit ignorer. Une affaire rangée n'a plus de retard ni de tâche à relancer.
// Voir CLAUDE.md, « Archivage des affaires ».

/**
 * Identifiants des affaires archivées du cabinet. Vide (jamais une erreur) quand
 * la colonne n'existe pas encore : une instance non migrée garde son
 * comportement d'avant.
 */
export async function archivedProjectIds(supabaseAdmin: any, tenantId: string): Promise<Set<string>> {
  try {
    const { data, error } = await supabaseAdmin.from('projects').select('id')
      .eq('tenant_id', tenantId).not('archived_at', 'is', null);
    if (error) return new Set();
    return new Set((data || []).map((p: any) => String(p.id)));
  } catch {
    return new Set();
  }
}

/**
 * Les affaires archivées du cabinet avec leur date de fin de conservation,
 * pour l'alerte d'échéance. Vide quand la colonne n'existe pas encore.
 */
export async function archivedProjectsWithRetention(
  supabaseAdmin: any, tenantId: string,
): Promise<Array<{ id: string; name: string | null; project_code: string | null; retention_until: string | null }>> {
  try {
    const { data, error } = await supabaseAdmin.from('projects').select('id, name, project_code, retention_until')
      .eq('tenant_id', tenantId).not('archived_at', 'is', null);
    return error ? [] : (data || []);
  } catch {
    return [];
  }
}

/**
 * Retire les lignes d'une affaire archivée. `cle` vaut `project_id` pour les
 * lignes rattachées à une affaire, `id` pour la liste des affaires elle-même ;
 * une ligne sans affaire (réunion libre, appel d'offres) est conservée.
 * `undefined` reste `undefined` : une lecture facultative qui a échoué ne doit
 * pas devenir « rien à signaler ».
 */
export function sansAffairesArchivees<T extends Record<string, any>>(
  lignes: T[] | undefined, archivees: Set<string>, cle: 'project_id' | 'id' = 'project_id',
): T[] | undefined {
  if (!lignes || archivees.size === 0) return lignes;
  return lignes.filter(l => l[cle] == null || !archivees.has(String(l[cle])));
}
