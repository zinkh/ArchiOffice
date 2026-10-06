import type { Express } from 'express';
import { sanitizeFilename } from '../sanitizeFilename';
import { handleDocumentUpload } from '../documentUpload';
import { assertTenantEntity } from '../assertTenantEntity';
import { buildInspirationFolderPath } from '../externalStorage/businessFolderPath';
import { isOwnStorageRef } from '../externalStorage/externalRef';
import type { RemoveBusinessFile, StoreBusinessFile } from '../externalStorage/storeBusinessFile';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  storeBusinessFile: StoreBusinessFile;
  removeBusinessFile: RemoveBusinessFile;
}

const PHASES = new Set(['ESQ', 'APS', 'APD', 'PC', 'PRO', 'DCE']);
const FORMATS = new Set(['A4P', 'A4L', 'A3P', 'A3L', '16:9', 'FREE']);
const LAYOUTS = new Set(['grid', 'mosaic', 'materials']);

function phaseOf(value: unknown): string {
  const phase = String(value || 'ESQ').toUpperCase();
  return PHASES.has(phase) ? phase : 'ESQ';
}

function formatOf(value: unknown): string {
  const format = String(value || 'A3L');
  return FORMATS.has(format) ? format : 'A3L';
}

function layoutOf(value: unknown): string {
  const layout = String(value || 'grid');
  return LAYOUTS.has(layout) ? layout : 'grid';
}

function cleanText(value: unknown, max = 1000): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
}

export function registerInspirationRoutes(
  app: Express,
  { supabaseAdmin, getTenantId, storeBusinessFile, removeBusinessFile }: RouteDeps,
) {
  const loadProject = async (projectId: string, tenantId: string) => {
    const { data } = await supabaseAdmin.from('projects')
      .select('project_code, name')
      .eq('id', projectId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    return data as any;
  };

  const loadBoard = async (boardId: string, tenantId: string) => {
    const { data } = await supabaseAdmin.from('inspiration_boards')
      .select('*')
      .eq('id', boardId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    return data as any;
  };

  const loadItem = async (itemId: string, tenantId: string) => {
    const { data } = await supabaseAdmin.from('inspiration_items')
      .select('*')
      .eq('id', itemId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    return data as any;
  };

  const ensurePlacement = async (
    tenantId: string,
    projectId: string,
    boardId: string,
    itemId: string,
    requestedId?: string | null,
    zIndex = 0,
  ) => {
    const { data: existing } = await supabaseAdmin.from('inspiration_board_items')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('board_id', boardId)
      .eq('item_id', itemId)
      .maybeSingle();
    if (existing) return existing;

    const now = new Date().toISOString();
    const { data, error } = await supabaseAdmin.from('inspiration_board_items')
      .insert({
        id: requestedId || crypto.randomUUID(),
        tenant_id: tenantId,
        project_id: projectId,
        board_id: boardId,
        item_id: itemId,
        z_index: zIndex,
        created_at: now,
        updated_at: now,
      })
      .select().single();
    if (error) throw error;
    return data;
  };

  app.get('/api/inspiration-boards', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const projectId = String(req.query.project_id || '');
      if (!projectId || !(await assertTenantEntity(supabaseAdmin, 'projects', projectId, tenantId))) {
        return res.status(400).json({ error: 'Projet introuvable pour ce cabinet.' });
      }

      const [boardsResult, itemsResult, placementsResult] = await Promise.all([
        supabaseAdmin.from('inspiration_boards').select('*')
          .eq('tenant_id', tenantId).eq('project_id', projectId)
          .order('updated_at', { ascending: false }),
        supabaseAdmin.from('inspiration_items').select('*')
          .eq('tenant_id', tenantId).eq('project_id', projectId)
          .order('created_at', { ascending: false }),
        supabaseAdmin.from('inspiration_board_items').select('*')
          .eq('tenant_id', tenantId).eq('project_id', projectId)
          .order('z_index', { ascending: true }),
      ]);
      if (boardsResult.error) throw boardsResult.error;
      if (itemsResult.error) throw itemsResult.error;
      if (placementsResult.error) throw placementsResult.error;

      res.json({
        boards: boardsResult.data || [],
        items: itemsResult.data || [],
        placements: placementsResult.data || [],
      });
    } catch (e: any) {
      console.error('[GET /api/inspiration-boards]', e);
      res.status(500).json({ error: e.message || 'Impossible de charger les inspirations.' });
    }
  });

  app.post('/api/inspiration-boards', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const projectId = String(req.body?.project_id || '');
      if (!projectId || !(await assertTenantEntity(supabaseAdmin, 'projects', projectId, tenantId))) {
        return res.status(400).json({ error: 'Projet introuvable pour ce cabinet.' });
      }
      const title = cleanText(req.body?.title, 180);
      if (!title) return res.status(400).json({ error: 'Le titre de la planche est obligatoire.' });

      const now = new Date().toISOString();
      const row = {
        id: cleanText(req.body?.id, 100) || crypto.randomUUID(),
        tenant_id: tenantId,
        project_id: projectId,
        title,
        description: cleanText(req.body?.description, 4000),
        phase: phaseOf(req.body?.phase),
        format: formatOf(req.body?.format),
        layout: layoutOf(req.body?.layout),
        created_by: req.user.id,
        created_at: req.body?.created_at || now,
        updated_at: now,
      };
      const existing = await loadBoard(row.id, tenantId);
      if (existing) {
        if (existing.project_id !== projectId) return res.status(409).json({ error: 'Identifiant de planche déjà utilisé.' });
        return res.status(200).json(existing);
      }
      const { data, error } = await supabaseAdmin.from('inspiration_boards')
        .insert(row).select().single();
      if (error) throw error;
      res.status(201).json(data);
    } catch (e: any) {
      console.error('[POST /api/inspiration-boards]', e);
      res.status(e.status || 500).json({ error: e.message || 'Impossible de créer la planche.' });
    }
  });

  app.put('/api/inspiration-boards/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const board = await loadBoard(req.params.id, tenantId);
      if (!board) return res.status(404).json({ error: 'Planche introuvable.' });

      const patch: any = { updated_at: new Date().toISOString() };
      if (req.body?.title !== undefined) {
        const title = cleanText(req.body.title, 180);
        if (!title) return res.status(400).json({ error: 'Le titre de la planche est obligatoire.' });
        patch.title = title;
      }
      if (req.body?.description !== undefined) patch.description = cleanText(req.body.description, 4000);
      if (req.body?.phase !== undefined) patch.phase = phaseOf(req.body.phase);
      if (req.body?.format !== undefined) patch.format = formatOf(req.body.format);
      if (req.body?.layout !== undefined) patch.layout = layoutOf(req.body.layout);

      const { data, error } = await supabaseAdmin.from('inspiration_boards')
        .update(patch).eq('id', req.params.id).eq('tenant_id', tenantId)
        .select().single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) {
      console.error('[PUT /api/inspiration-boards/:id]', e);
      res.status(500).json({ error: e.message || 'Impossible de modifier la planche.' });
    }
  });

  app.delete('/api/inspiration-boards/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { error } = await supabaseAdmin.from('inspiration_boards')
        .delete().eq('id', req.params.id).eq('tenant_id', tenantId);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) {
      console.error('[DELETE /api/inspiration-boards/:id]', e);
      res.status(500).json({ error: e.message || 'Impossible de supprimer la planche.' });
    }
  });

  app.post('/api/inspiration-items', handleDocumentUpload('file'), async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const body = req.body || {};
      const projectId = String(body.project_id || '');
      if (!projectId || !(await assertTenantEntity(supabaseAdmin, 'projects', projectId, tenantId))) {
        return res.status(400).json({ error: 'Projet introuvable pour ce cabinet.' });
      }

      const boardId = cleanText(body.board_id, 100);
      if (boardId) {
        const board = await loadBoard(boardId, tenantId);
        if (!board || board.project_id !== projectId) {
          return res.status(400).json({ error: 'Planche introuvable pour ce projet.' });
        }
      }

      const id = cleanText(body.id, 100) || crypto.randomUUID();
      const existingItem = await loadItem(id, tenantId);
      if (existingItem) {
        if (existingItem.project_id !== projectId) {
          return res.status(409).json({ error: 'Identifiant d’inspiration déjà utilisé.' });
        }
        const placement = boardId
          ? await ensurePlacement(
              tenantId,
              projectId,
              boardId,
              id,
              cleanText(body.placement_id, 100),
              Number(body.z_index || 0),
            )
          : null;
        return res.status(200).json({ item: existingItem, placement });
      }

      const sourceUrl = cleanText(body.source_url, 3000);
      if (!req.file && !sourceUrl) {
        return res.status(400).json({ error: 'Une image ou une URL source est requise.' });
      }

      const phase = phaseOf(body.phase);
      let fileUrl: string | null = null;
      let storageBackend: string | null = null;
      if (req.file) {
        const stored = await storeBusinessFile({
          tenantId,
          bucket: 'documents',
          folderPath: buildInspirationFolderPath(await loadProject(projectId, tenantId), phase),
          fileName: req.file.originalname,
          supabasePath: tenantId + '/' + projectId + '/inspiration/' + phase + '/' + id + '-' + sanitizeFilename(req.file.originalname),
        }, req.file.buffer, req.file.mimetype);
        fileUrl = stored.fileUrl;
        storageBackend = stored.storageBackend;
      }

      const now = new Date().toISOString();
      const row = {
        id,
        tenant_id: tenantId,
        project_id: projectId,
        title: cleanText(body.title, 240) || (req.file ? req.file.originalname : null),
        caption: cleanText(body.caption, 4000),
        phase,
        category: cleanText(body.category, 80) || 'architecture',
        file_url: fileUrl,
        source_url: sourceUrl,
        storage_backend: storageBackend,
        created_by: req.user.id,
        created_at: body.created_at || now,
        updated_at: now,
      };
      const { data: item, error } = await supabaseAdmin.from('inspiration_items')
        .insert(row).select().single();
      if (error) {
        if (isOwnStorageRef(fileUrl, 'documents')) {
          removeBusinessFile(tenantId, 'documents', fileUrl as string).catch(() => {});
        }
        throw error;
      }

      const placement = boardId
        ? await ensurePlacement(
            tenantId,
            projectId,
            boardId,
            id,
            cleanText(body.placement_id, 100),
            Number(body.z_index || 0),
          )
        : null;

      res.status(201).json({ item, placement });
    } catch (e: any) {
      console.error('[POST /api/inspiration-items]', e);
      res.status(e.status || 500).json({ error: e.message || 'Impossible d’ajouter cette inspiration.' });
    }
  });

  app.put('/api/inspiration-items/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const item = await loadItem(req.params.id, tenantId);
      if (!item) return res.status(404).json({ error: 'Inspiration introuvable.' });

      const patch: any = { updated_at: new Date().toISOString() };
      if (req.body?.title !== undefined) patch.title = cleanText(req.body.title, 240);
      if (req.body?.caption !== undefined) patch.caption = cleanText(req.body.caption, 4000);
      if (req.body?.phase !== undefined) patch.phase = phaseOf(req.body.phase);
      if (req.body?.category !== undefined) patch.category = cleanText(req.body.category, 80) || 'architecture';
      if (req.body?.source_url !== undefined) patch.source_url = cleanText(req.body.source_url, 3000);

      const { data, error } = await supabaseAdmin.from('inspiration_items')
        .update(patch).eq('id', req.params.id).eq('tenant_id', tenantId)
        .select().single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) {
      console.error('[PUT /api/inspiration-items/:id]', e);
      res.status(500).json({ error: e.message || 'Impossible de modifier cette inspiration.' });
    }
  });

  app.delete('/api/inspiration-items/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const item = await loadItem(req.params.id, tenantId);
      if (!item) return res.status(404).json({ error: 'Inspiration introuvable.' });

      const { error } = await supabaseAdmin.from('inspiration_items')
        .delete().eq('id', req.params.id).eq('tenant_id', tenantId);
      if (error) throw error;
      if (isOwnStorageRef(item.file_url, 'documents')) {
        removeBusinessFile(tenantId, 'documents', item.file_url).catch(() => {});
      }
      res.json({ success: true });
    } catch (e: any) {
      console.error('[DELETE /api/inspiration-items/:id]', e);
      res.status(500).json({ error: e.message || 'Impossible de supprimer cette inspiration.' });
    }
  });

  app.post('/api/inspiration-boards/:id/items', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const board = await loadBoard(req.params.id, tenantId);
      const item = await loadItem(String(req.body?.item_id || ''), tenantId);
      if (!board || !item || board.project_id !== item.project_id) {
        return res.status(400).json({ error: 'Planche ou inspiration incompatible.' });
      }

      const data = await ensurePlacement(
        tenantId,
        board.project_id,
        board.id,
        item.id,
        cleanText(req.body?.id, 100),
        Number(req.body?.z_index || 0),
      );
      res.status(201).json(data);
    } catch (e: any) {
      console.error('[POST /api/inspiration-boards/:id/items]', e);
      res.status(500).json({ error: e.message || 'Impossible d’ajouter l’image à la planche.' });
    }
  });

  app.put('/api/inspiration-boards/:id/items/:itemId', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const patch: any = { updated_at: new Date().toISOString() };
      for (const key of ['position_x', 'position_y', 'width', 'height', 'rotation', 'z_index']) {
        if (req.body?.[key] !== undefined) patch[key] = Number(req.body[key]);
      }
      const { data, error } = await supabaseAdmin.from('inspiration_board_items')
        .update(patch)
        .eq('tenant_id', tenantId)
        .eq('board_id', req.params.id)
        .eq('item_id', req.params.itemId)
        .select().single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) {
      console.error('[PUT /api/inspiration-boards/:id/items/:itemId]', e);
      res.status(500).json({ error: e.message || 'Impossible de déplacer cette inspiration.' });
    }
  });

  app.delete('/api/inspiration-boards/:id/items/:itemId', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { error } = await supabaseAdmin.from('inspiration_board_items')
        .delete()
        .eq('tenant_id', tenantId)
        .eq('board_id', req.params.id)
        .eq('item_id', req.params.itemId);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) {
      console.error('[DELETE /api/inspiration-boards/:id/items/:itemId]', e);
      res.status(500).json({ error: e.message || 'Impossible de retirer cette inspiration.' });
    }
  });
}
