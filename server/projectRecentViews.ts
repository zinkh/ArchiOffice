// ── Projets ouverts récemment ────────────────────────────────────────────────
// `project_recent_views` garde, par personne, la dernière ouverture de chaque
// affaire (voir supabase/migrate_reserves_photos_recent_views.sql). C'est la
// donnée qui classe la liste des projets par défaut : ce sur quoi on a
// travaillé en dernier remonte en tête, sur tous ses postes puisque c'est
// stocké côté serveur et non dans le navigateur.
//
// Les deux fonctions sont en meilleur effort : une base qui n'a pas encore
// joué la migration rend la liste sans `last_opened_at` plutôt qu'une erreur.
import { tenantScopedFrom } from './tenantScopedFrom';

export async function recordProjectOpened(supabaseAdmin: any, tenantId: string, userId: string, projectId: string): Promise<void> {
  const { error } = await supabaseAdmin.from('project_recent_views').upsert(
    { id: `${userId}:${projectId}`, tenant_id: tenantId, user_id: userId, project_id: projectId, opened_at: new Date().toISOString() },
    { onConflict: 'user_id,project_id' },
  );
  if (error) throw error;
}

export async function attachLastOpenedAt<T extends { id: string }>(
  supabaseAdmin: any, tenantId: string, userId: string, projects: T[],
): Promise<(T & { last_opened_at: string | null })[]> {
  const opened = new Map<string, string>();
  if (projects.length > 0) {
    try {
      const { data } = await tenantScopedFrom(supabaseAdmin, tenantId, 'project_recent_views')
        .select('project_id, opened_at').eq('user_id', userId);
      for (const row of (data || []) as any[]) opened.set(row.project_id, row.opened_at);
    } catch { /* table absente : pas d'historique d'ouverture */ }
  }
  return projects.map(p => ({ ...p, last_opened_at: opened.get(p.id) || null }));
}
