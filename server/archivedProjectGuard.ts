// Lecture seule d'une affaire archivée, pour tout ce qui s'y rattache. Un seul
// garde monté avant les routes (server.ts), au lieu d'une vérification dans une
// centaine de gestionnaires : une écriture qui vise une affaire archivée répond
// 409 PROJECT_ARCHIVED. Voir CLAUDE.md, « Archivage des affaires ».
import { isProjectArchived } from './routes/projectArchive';

/** Segment d'URL -> table dont les lignes portent un `project_id`. */
export const TABLES_RATTACHEES: Record<string, string> = {
  tasks: 'tasks',
  documents: 'documents',
  invoices: 'invoices',
  reserves: 'reserves',
  receptions: 'receptions',
  'gpa-reserves': 'gpa_reserves',
  milestones: 'milestones',
  observations: 'observations',
  ordres_de_service: 'ordres_de_service',
  situations: 'situations',
  'marches-entreprises': 'marches_entreprises',
  notes_honoraires: 'notes_honoraires',
  rfis: 'rfis',
  meetings: 'meetings',
  permits: 'permits',
  plans: 'plans',
  avenants_moe: 'avenants_moe',
  'time-entries': 'time_entries',
  time_entries: 'time_entries',
};

export type CibleGarde =
  | { type: 'projet'; id: string }
  | { type: 'ligne'; table: string; id: string }
  | { type: 'corps' };

const METHODES_ECRITURE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Ce qu'une requête d'écriture vise, d'après son chemin (sans le préfixe /api).
 * Rend null pour ce que le garde laisse passer : lecture, archivage et
 * réouverture eux-mêmes, suppression de l'affaire (réservée aux administrateurs),
 * génération d'un PDF (POST qui ne modifie rien).
 */
export function cibleDeLaRequete(method: string, path: string): CibleGarde | null {
  if (!METHODES_ECRITURE.has(method.toUpperCase())) return null;
  const segments = path.split('?')[0].split('/').filter(Boolean);
  if (segments.length === 0) return null;

  if (segments[0] === 'projects') {
    const id = segments[1];
    if (!id) return null;
    if (segments.length === 2) return null; // POST /projects (création), DELETE /projects/:id
    const action = segments[2];
    if (action === 'archive' || action === 'unarchive') return null;
    if (segments[segments.length - 1] === 'pdf') return null;
    return { type: 'projet', id };
  }

  const table = TABLES_RATTACHEES[segments[0]];
  if (!table) return null;
  // Collection : le projet vient du corps ; ligne : on lit son project_id.
  if (segments.length === 1) return method.toUpperCase() === 'POST' ? { type: 'corps' } : null;
  if (segments[segments.length - 1] === 'pdf') return null;
  return { type: 'ligne', table, id: segments[1] };
}

const REPONSE = { error: 'Affaire archivée : rouvrez-la pour la modifier.', code: 'PROJECT_ARCHIVED' };

export function archivedProjectGuard({ supabaseAdmin, getTenantId }: {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
}) {
  return async (req: any, res: any, next: any) => {
    try {
      const cible = cibleDeLaRequete(req.method, req.path);
      if (!cible || !req.user?.id) return next();
      const tenantId = await getTenantId(req.user.id);

      let projectId: string | null = null;
      if (cible.type === 'projet') {
        projectId = cible.id;
      } else if (cible.type === 'corps') {
        // Un envoi multipart n'est pas encore lu ici : sa route vérifie elle-même.
        projectId = typeof req.body?.project_id === 'string' ? req.body.project_id : null;
      } else {
        const { data, error } = await supabaseAdmin.from(cible.table).select('project_id')
          .eq('id', cible.id).eq('tenant_id', tenantId).maybeSingle();
        projectId = !error && typeof data?.project_id === 'string' ? data.project_id : null;
      }

      if (projectId && await isProjectArchived(supabaseAdmin, tenantId, projectId)) {
        return res.status(409).json(REPONSE);
      }
      next();
    } catch (e) {
      // Un garde qui tombe ne doit pas fermer l'application : on laisse passer
      // et on le dit, la route fait ses propres contrôles.
      console.error('[archivedProjectGuard]', e);
      next();
    }
  };
}
