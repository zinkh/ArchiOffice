// Dossiers libres sous les phases d'une affaire (GED). Table document_folders et colonne
// documents.folder_id, supabase/migrate_document_folders.sql. Un dossier est LOGIQUE : le fichier
// reste où il est chez le fournisseur de stockage. Voir ROADMAP.md, « Document management (GED) ».
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';
import {
  DOCUMENT_PHASES, FOLDER_MAX_DEPTH, folderDepth, folderNameKey, normalizeFolderName, type DocFolder,
} from '../../src/lib/gedFolders';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
}

/** Table absente : instance dont la base n'a pas encore joué la migration. */
export function isMissingFoldersTable(error: any): boolean {
  const message = String(error?.message || '');
  return error?.code === '42P01' || (/document_folders/.test(message) && /does not exist|schema cache/i.test(message));
}

const MIGRATION_MISSING = 'Les dossiers ne sont pas encore disponibles sur cette instance (migration document_folders à appliquer).';

/**
 * Un dossier peut accueillir un document seulement s'il est de la même affaire et de la même phase.
 * Rend le dossier, ou un message d'erreur. Utilisé par POST et PUT /api/documents.
 */
export async function resolveFolderForDocument(
  supabaseAdmin: any, tenantId: string, folderId: string, projectId: string | null, phase: string | null,
): Promise<{ folder?: DocFolder; error?: string }> {
  const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'document_folders')
    .select('id, project_id, phase, parent_id, name').eq('id', folderId).maybeSingle();
  if (error) return { error: isMissingFoldersTable(error) ? MIGRATION_MISSING : 'Dossier illisible.' };
  const folder = data as DocFolder | null;
  if (!folder) return { error: 'Dossier introuvable pour ce cabinet.' };
  if (!projectId || folder.project_id !== projectId) return { error: 'Ce dossier appartient à une autre affaire.' };
  if (folder.phase !== (phase || 'Général')) return { error: 'Ce dossier appartient à une autre phase.' };
  return { folder };
}

export function registerDocumentFolderRoutes(app: Express, { supabaseAdmin, getTenantId }: RouteDeps) {
  const loadAll = async (tenantId: string, projectId?: string): Promise<{ rows?: DocFolder[]; error?: any }> => {
    let query = tenantScopedFrom(supabaseAdmin, tenantId, 'document_folders').select('id, project_id, phase, parent_id, name');
    if (projectId) query = query.eq('project_id', projectId);
    const { data, error } = await query;
    return error ? { error } : { rows: (data || []) as DocFolder[] };
  };

  app.get('/api/document-folders', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const projectId = typeof req.query.project_id === 'string' ? req.query.project_id : undefined;
      const { rows, error } = await loadAll(tenantId, projectId);
      if (error) {
        if (isMissingFoldersTable(error)) return res.json([]);
        throw error;
      }
      res.json(rows);
    } catch (e: any) {
      console.error('[GET /api/document-folders]', e);
      res.status(500).json({ error: 'Impossible de lire les dossiers.' });
    }
  });

  app.post('/api/document-folders', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const body = req.body || {};
      const { name, error: invalidName } = normalizeFolderName(body.name);
      if (invalidName) return res.status(400).json({ error: invalidName });
      if (!(DOCUMENT_PHASES as readonly string[]).includes(body.phase)) return res.status(400).json({ error: 'Phase inconnue.' });
      if (typeof body.project_id !== 'string' || !body.project_id) return res.status(400).json({ error: 'Affaire obligatoire.' });

      const { data: project } = await tenantScopedFrom(supabaseAdmin, tenantId, 'projects').select('id').eq('id', body.project_id).maybeSingle();
      if (!project) return res.status(404).json({ error: 'Affaire introuvable.' });

      const { rows, error: readError } = await loadAll(tenantId, body.project_id);
      if (readError) {
        if (isMissingFoldersTable(readError)) return res.status(503).json({ error: MIGRATION_MISSING, code: 'DOCUMENT_FOLDERS_UNAVAILABLE' });
        throw readError;
      }
      const siblings = rows || [];
      const parentId: string | null = body.parent_id || null;
      if (parentId) {
        const parent = siblings.find(f => f.id === parentId);
        if (!parent) return res.status(404).json({ error: 'Dossier parent introuvable.' });
        if (parent.phase !== body.phase) return res.status(400).json({ error: 'Le dossier parent est dans une autre phase.' });
        const depth = folderDepth(parentId, siblings);
        if (depth === null || depth >= FOLDER_MAX_DEPTH) return res.status(400).json({ error: `Les dossiers ne vont pas au-delà de ${FOLDER_MAX_DEPTH} niveaux.` });
      }
      const key = folderNameKey(name!);
      if (siblings.some(f => f.phase === body.phase && (f.parent_id || null) === parentId && folderNameKey(f.name) === key)) {
        return res.status(409).json({ error: 'Un dossier de ce nom existe déjà à cet endroit.' });
      }

      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'document_folders')
        .insert({ id: crypto.randomUUID(), project_id: body.project_id, phase: body.phase, parent_id: parentId, name, created_by: req.user.id })
        .select().single();
      if (error) {
        if (error.code === '23505') return res.status(409).json({ error: 'Un dossier de ce nom existe déjà à cet endroit.' });
        throw error;
      }
      res.status(201).json(data);
    } catch (e: any) {
      console.error('[POST /api/document-folders]', e);
      res.status(500).json({ error: 'Impossible de créer le dossier.' });
    }
  });

  app.put('/api/document-folders/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { name, error: invalidName } = normalizeFolderName((req.body || {}).name);
      if (invalidName) return res.status(400).json({ error: invalidName });
      const { rows, error: readError } = await loadAll(tenantId);
      if (readError) {
        if (isMissingFoldersTable(readError)) return res.status(503).json({ error: MIGRATION_MISSING, code: 'DOCUMENT_FOLDERS_UNAVAILABLE' });
        throw readError;
      }
      const folder = (rows || []).find(f => f.id === req.params.id);
      if (!folder) return res.status(404).json({ error: 'Dossier introuvable.' });
      const key = folderNameKey(name!);
      if ((rows || []).some(f => f.id !== folder.id && f.project_id === folder.project_id && f.phase === folder.phase
        && (f.parent_id || null) === (folder.parent_id || null) && folderNameKey(f.name) === key)) {
        return res.status(409).json({ error: 'Un dossier de ce nom existe déjà à cet endroit.' });
      }
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'document_folders').update({ name }).eq('id', folder.id);
      if (error) {
        if (error.code === '23505') return res.status(409).json({ error: 'Un dossier de ce nom existe déjà à cet endroit.' });
        throw error;
      }
      res.json({ ...folder, name });
    } catch (e: any) {
      console.error('[PUT /api/document-folders/:id]', e);
      res.status(500).json({ error: 'Impossible de renommer le dossier.' });
    }
  });

  // Un dossier non vide ne se supprime pas : ni documents, ni sous-dossiers. Rien n'est jamais déplacé en silence.
  app.delete('/api/document-folders/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { rows, error: readError } = await loadAll(tenantId);
      if (readError) {
        if (isMissingFoldersTable(readError)) return res.status(503).json({ error: MIGRATION_MISSING, code: 'DOCUMENT_FOLDERS_UNAVAILABLE' });
        throw readError;
      }
      const folder = (rows || []).find(f => f.id === req.params.id);
      if (!folder) return res.status(404).json({ error: 'Dossier introuvable.' });
      if ((rows || []).some(f => f.parent_id === folder.id)) {
        return res.status(409).json({ error: 'Ce dossier contient des sous-dossiers : videz-le avant de le supprimer.', code: 'FOLDER_NOT_EMPTY' });
      }
      const { data: docs, error: docsError } = await tenantScopedFrom(supabaseAdmin, tenantId, 'documents').select('id').eq('folder_id', folder.id).limit(1);
      if (docsError) throw docsError;
      if ((docs || []).length > 0) {
        return res.status(409).json({ error: 'Ce dossier contient des documents : déplacez-les avant de le supprimer.', code: 'FOLDER_NOT_EMPTY' });
      }
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'document_folders').delete().eq('id', folder.id);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) {
      console.error('[DELETE /api/document-folders/:id]', e);
      res.status(500).json({ error: 'Impossible de supprimer le dossier.' });
    }
  });
}
