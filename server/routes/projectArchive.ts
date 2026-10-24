// Archivage des affaires : contrôle de clôture (indicatif), archivage,
// réouverture, journal. Colonnes projects.archived_at / archived_by /
// archive_reason / retention_until, table project_archive_log,
// supabase/migrate_project_archive.sql. Voir CLAUDE.md, « Archivage des affaires ».
import type { Express } from 'express';
import {
  ARCHIVE_REASON_MAX_CHARS, buildArchiveChecklist, checklistWarnings, normalizeRetentionYears, retentionUntil,
  type ArchiveCheckItem,
} from '../../src/lib/projectArchive';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  getUserName: (tenantId: string, userId: string, email?: string) => Promise<string>;
  requireRole: (...roles: string[]) => (req: any, res: any, next: any) => Promise<void>;
}

const MIGRATION_MISSING = 'L’archivage des affaires n’est pas encore disponible sur cette instance (migration project_archive à appliquer).';

/** Colonne ou table absente : instance dont la base n'a pas encore joué la migration. */
function isMissingSchema(error: any): boolean {
  const message = String(error?.message || '');
  return ['42703', '42P01', 'PGRST204', 'PGRST205'].includes(error?.code)
    || (/archiv|retention_until/.test(message) && /does not exist|schema cache/i.test(message));
}

/** Meilleur effort : une lecture qui échoue (colonne absente) vaut « non archivée ». */
export async function isProjectArchived(supabaseAdmin: any, tenantId: string, projectId: string): Promise<boolean> {
  try {
    const { data, error } = await supabaseAdmin.from('projects').select('archived_at')
      .eq('id', projectId).eq('tenant_id', tenantId).maybeSingle();
    return !error && !!data?.archived_at;
  } catch {
    return false;
  }
}

async function loadChecklist(supabaseAdmin: any, tenantId: string, project: any): Promise<ArchiveCheckItem[]> {
  const rows = async (table: string, columns: string): Promise<any[]> => {
    const { data, error } = await supabaseAdmin.from(table).select(columns)
      .eq('tenant_id', tenantId).eq('project_id', project.id);
    if (error) throw error;
    return data || [];
  };
  const [invoices, reserves, tasks] = await Promise.all([
    rows('invoices', 'status'), rows('reserves', 'status'), rows('tasks', 'status'),
  ]);
  let doeVisaCount: number | null = null;
  try {
    doeVisaCount = (await rows('documents', 'id, doc_type')).filter(d => d.doc_type === 'DOE_VISA').length;
  } catch {
    doeVisaCount = null;
  }
  return buildArchiveChecklist({ projectStatus: project.status, invoices, reserves, tasks, doeVisaCount });
}

async function retentionYears(supabaseAdmin: any, tenantId: string): Promise<number> {
  const { data, error } = await supabaseAdmin.from('settings').select('archive_retention_years')
    .eq('tenant_id', tenantId).maybeSingle();
  return normalizeRetentionYears(error ? null : data?.archive_retention_years);
}

function cleanReason(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, ARCHIVE_REASON_MAX_CHARS) : '';
}

export function registerProjectArchiveRoutes(app: Express, { supabaseAdmin, getTenantId, getUserName, requireRole }: RouteDeps) {
  const loadProject = async (tenantId: string, id: string) => {
    const { data, error } = await supabaseAdmin.from('projects').select('*')
      .eq('id', id).eq('tenant_id', tenantId).maybeSingle();
    if (error) throw error;
    return data;
  };

  const writeLog = async (tenantId: string, projectId: string, action: 'archive' | 'unarchive', reason: string, overridden: ArchiveCheckItem[], req: any) => {
    try {
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      await supabaseAdmin.from('project_archive_log').insert({
        id: `pa_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        tenant_id: tenantId, project_id: projectId, action, reason: reason || null,
        overridden_checks: overridden.map(({ id, label, detail }) => ({ id, label, detail })),
        user_id: req.user.id, user_name: userName,
      });
    } catch (e) {
      // Le journal est un complément : son échec ne défait pas l'archivage.
      console.error('[project_archive_log]', e);
    }
  };

  app.get('/api/projects/:id/archive-check', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const project = await loadProject(tenantId, req.params.id);
      if (!project) return res.status(404).json({ error: 'Affaire introuvable.' });
      const checklist = await loadChecklist(supabaseAdmin, tenantId, project);
      res.json({
        archived: !!project.archived_at, archived_at: project.archived_at ?? null,
        retention_until: project.retention_until ?? null, archive_reason: project.archive_reason ?? null,
        checklist,
      });
    } catch (e: any) {
      console.error('[GET /api/projects/:id/archive-check]', e);
      res.status(500).json({ error: 'Impossible de contrôler la clôture de l’affaire.' });
    }
  });

  app.post('/api/projects/:id/archive', requireRole('admin', 'manager'), async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const project = await loadProject(tenantId, req.params.id);
      if (!project) return res.status(404).json({ error: 'Affaire introuvable.' });
      if (project.archived_at) return res.status(409).json({ error: 'Affaire déjà archivée.', code: 'PROJECT_ARCHIVED' });

      const checklist = await loadChecklist(supabaseAdmin, tenantId, project);
      const warnings = checklistWarnings(checklist);
      const overrideReason = cleanReason(req.body?.override_reason);
      // Clôture indicative : des contrôles en alerte n'interdisent rien, ils
      // demandent un motif de passage outre, conservé dans le journal.
      if (warnings.length && !overrideReason) {
        return res.status(409).json({
          error: 'Des contrôles de clôture sont en alerte : un motif est nécessaire pour archiver quand même.',
          code: 'CHECKLIST_OVERRIDE_REQUIRED', checklist,
        });
      }

      const archivedAt = new Date().toISOString();
      const until = retentionUntil(archivedAt, await retentionYears(supabaseAdmin, tenantId));
      const reason = overrideReason || cleanReason(req.body?.reason);
      const { error } = await supabaseAdmin.from('projects').update({
        archived_at: archivedAt, archived_by: req.user.id, archive_reason: reason || null, retention_until: until,
      }).eq('id', project.id).eq('tenant_id', tenantId);
      if (error) {
        if (isMissingSchema(error)) return res.status(503).json({ error: MIGRATION_MISSING });
        throw error;
      }
      await writeLog(tenantId, project.id, 'archive', reason, warnings, req);
      res.json({ archived: true, archived_at: archivedAt, retention_until: until, overridden: warnings.length });
    } catch (e: any) {
      console.error('[POST /api/projects/:id/archive]', e);
      res.status(500).json({ error: 'Impossible d’archiver l’affaire.' });
    }
  });

  app.post('/api/projects/:id/unarchive', requireRole('admin'), async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const reason = cleanReason(req.body?.reason);
      if (!reason) return res.status(400).json({ error: 'Un motif de réouverture est obligatoire.' });
      const project = await loadProject(tenantId, req.params.id);
      if (!project) return res.status(404).json({ error: 'Affaire introuvable.' });
      if (!project.archived_at) return res.status(409).json({ error: 'Cette affaire n’est pas archivée.' });

      const { error } = await supabaseAdmin.from('projects').update({
        archived_at: null, archived_by: null, archive_reason: null, retention_until: null,
      }).eq('id', project.id).eq('tenant_id', tenantId);
      if (error) {
        if (isMissingSchema(error)) return res.status(503).json({ error: MIGRATION_MISSING });
        throw error;
      }
      await writeLog(tenantId, project.id, 'unarchive', reason, [], req);
      res.json({ archived: false });
    } catch (e: any) {
      console.error('[POST /api/projects/:id/unarchive]', e);
      res.status(500).json({ error: 'Impossible de rouvrir l’affaire.' });
    }
  });

  app.get('/api/projects/:id/archive-log', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await supabaseAdmin.from('project_archive_log').select('*')
        .eq('tenant_id', tenantId).eq('project_id', req.params.id).order('created_at', { ascending: false });
      if (error) {
        if (isMissingSchema(error)) return res.json([]);
        throw error;
      }
      res.json(data || []);
    } catch (e: any) {
      console.error('[GET /api/projects/:id/archive-log]', e);
      res.status(500).json({ error: 'Impossible de lire le journal d’archivage.' });
    }
  });
}
