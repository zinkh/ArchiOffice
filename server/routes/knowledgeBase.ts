// « Base de données » du cabinet (mini-Notion) : pages imbriquées, bases à propriétés typées et vues.
// Tables kb_pages, kb_properties et kb_views, supabase/migrate_kb_pages.sql. Une ligne de base est une
// page dont le parent est la base ; ses valeurs sont dans `properties` (clé = id de propriété).
// DELETE met en corbeille ; la suppression définitive est réservée aux rôles admin, manager et pm.
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';
import { firstForeignRelation } from '../assertTenantEntity';
import {
  KB_MAX_DEPTH, isKbPropertyType, kbContentToText, kbDepth, kbWouldCycle, sanitizeKbOptions, sanitizeKbValue,
  type KbProperty,
} from '../../src/lib/kb';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  requireRole: (...roles: string[]) => (req: any, res: any, next: any) => Promise<void>;
}

/** Table absente : instance dont la base n'a pas encore joué la migration. */
export function isMissingKbTable(error: any): boolean {
  const message = String(error?.message || '');
  return error?.code === '42P01' || (/kb_(pages|properties|views)/.test(message) && /does not exist|schema cache/i.test(message));
}

const MIGRATION_MISSING = 'La base de données du cabinet n\'est pas encore disponible sur cette instance (migration kb_pages à appliquer).';
const LIST_COLUMNS = 'id, parent_id, kind, title, icon, position, is_favorite, project_id, updated_at, trashed_at';
const MAX_CONTENT_BYTES = 2_000_000;

const cleanTitle = (value: unknown): string => (typeof value === 'string' ? value.slice(0, 200) : '');

export function registerKnowledgeBaseRoutes(app: Express, { supabaseAdmin, getTenantId, requireRole }: RouteDeps) {
  const table = (tenantId: string, name: 'kb_pages' | 'kb_properties' | 'kb_views') => tenantScopedFrom(supabaseAdmin, tenantId, name);

  const fail = (res: any, label: string, e: any, message: string) => {
    if (isMissingKbTable(e)) return res.status(503).json({ error: MIGRATION_MISSING, code: 'KB_UNAVAILABLE' });
    console.error(label, e);
    return res.status(500).json({ error: message });
  };

  const loadTree = async (tenantId: string) => {
    const { data, error } = await table(tenantId, 'kb_pages').select(LIST_COLUMNS);
    if (error) throw error;
    return (data || []) as any[];
  };

  const loadProperties = async (tenantId: string, databaseId: string): Promise<KbProperty[]> => {
    const { data, error } = await table(tenantId, 'kb_properties').select('*').eq('database_id', databaseId);
    if (error) throw error;
    return ((data || []) as KbProperty[]).sort((a, b) => a.position - b.position);
  };

  /** Valide un objet `properties` (clé = id de propriété) contre les propriétés de la base parente. */
  const sanitizeRowProperties = async (tenantId: string, databaseId: string, raw: unknown): Promise<{ value?: Record<string, unknown>; error?: string }> => {
    if (raw === undefined) return { value: undefined };
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'Valeurs de propriétés invalides.' };
    const properties = await loadProperties(tenantId, databaseId);
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      const property = properties.find(p => p.id === key);
      if (!property || property.type === 'title') return { error: 'Propriété inconnue.' };
      const checked = sanitizeKbValue(property, value);
      if (checked.error) return { error: `${property.name} : ${checked.error}` };
      out[key] = checked.value;
    }
    return { value: out };
  };

  // Liste légère de l'arbre (sans contenu). La corbeille est incluse pour l'écran dédié.
  app.get('/api/kb/tree', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      res.json(await loadTree(tenantId));
    } catch (e: any) {
      if (isMissingKbTable(e)) return res.json([]);
      fail(res, '[GET /api/kb/tree]', e, 'Impossible de lire la base de données.');
    }
  });

  app.get('/api/kb/search', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const q = typeof req.query.q === 'string' ? req.query.q.replace(/[,()\\%_]/g, ' ').trim().slice(0, 100) : '';
      if (q.length < 2) return res.json([]);
      const { data, error } = await table(tenantId, 'kb_pages').select(LIST_COLUMNS)
        .is('trashed_at', null).or(`title.ilike.%${q}%,content_text.ilike.%${q}%`).limit(20);
      if (error) throw error;
      res.json(data || []);
    } catch (e: any) {
      if (isMissingKbTable(e)) return res.json([]);
      fail(res, '[GET /api/kb/search]', e, 'Recherche impossible.');
    }
  });

  app.get('/api/kb/pages/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await table(tenantId, 'kb_pages').select('*').eq('id', req.params.id).maybeSingle();
      if (error) throw error;
      if (!data) return res.status(404).json({ error: 'Page introuvable.' });
      res.json(data);
    } catch (e: any) {
      fail(res, '[GET /api/kb/pages/:id]', e, 'Impossible de lire la page.');
    }
  });

  app.post('/api/kb/pages', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const body = req.body || {};
      const kind = body.kind === 'database' ? 'database' : 'page';
      const parentId: string | null = typeof body.parent_id === 'string' && body.parent_id ? body.parent_id : null;

      const foreign = await firstForeignRelation(supabaseAdmin, tenantId, [
        { table: 'kb_pages', id: parentId, label: 'Page parente' },
        { table: 'projects', id: body.project_id, label: 'Affaire' },
      ]);
      if (foreign) return res.status(400).json({ error: foreign });

      const tree = await loadTree(tenantId);
      let parent: any = null;
      if (parentId) {
        parent = tree.find(p => p.id === parentId);
        if (!parent || parent.trashed_at) return res.status(400).json({ error: 'Page parente introuvable pour ce cabinet.' });
        const depth = kbDepth(parentId, tree);
        if (depth === null || depth >= KB_MAX_DEPTH) return res.status(400).json({ error: `Les pages ne vont pas au-delà de ${KB_MAX_DEPTH} niveaux.` });
      }

      const isRow = parent?.kind === 'database';
      if (kind === 'database' && isRow) return res.status(400).json({ error: 'Une base ne se place pas dans une autre base.' });
      let properties: Record<string, unknown> = {};
      if (isRow && body.properties !== undefined) {
        const checked = await sanitizeRowProperties(tenantId, parentId!, body.properties);
        if (checked.error) return res.status(400).json({ error: checked.error });
        properties = checked.value || {};
      }
      const siblings = tree.filter(p => (p.parent_id || null) === parentId && !p.trashed_at);
      const position = siblings.length ? Math.max(...siblings.map(s => Number(s.position) || 0)) + 1 : 0;

      const id = crypto.randomUUID();
      const content = body.content && typeof body.content === 'object' ? body.content : null;
      if (content && JSON.stringify(content).length > MAX_CONTENT_BYTES) return res.status(413).json({ error: 'Contenu trop volumineux.' });
      const { data, error } = await table(tenantId, 'kb_pages').insert({
        id, parent_id: parentId, kind, title: cleanTitle(body.title),
        icon: typeof body.icon === 'string' ? body.icon.slice(0, 16) : null,
        content, content_text: content ? kbContentToText(content) : '', properties, position,
        project_id: typeof body.project_id === 'string' && body.project_id ? body.project_id : null,
        created_by: req.user.id,
      }).select().single();
      if (error) throw error;

      // Une nouvelle base démarre avec sa colonne titre et une vue tableau.
      if (kind === 'database') {
        const { error: propError } = await table(tenantId, 'kb_properties').insert({
          id: crypto.randomUUID(), database_id: id, name: 'Nom', type: 'title', options: [], position: 0,
        });
        if (propError) throw propError;
        const { error: viewError } = await table(tenantId, 'kb_views').insert({
          id: crypto.randomUUID(), database_id: id, name: 'Tableau', type: 'table', config: {}, position: 0,
        });
        if (viewError) throw viewError;
      }
      res.status(201).json(data);
    } catch (e: any) {
      fail(res, '[POST /api/kb/pages]', e, 'Impossible de créer la page.');
    }
  });

  // Enregistrement automatique : seuls les champs présents dans le corps sont modifiés.
  app.put('/api/kb/pages/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const body = req.body || {};
      const { data: current, error: readError } = await table(tenantId, 'kb_pages').select('id, parent_id, kind').eq('id', req.params.id).maybeSingle();
      if (readError) throw readError;
      if (!current) return res.status(404).json({ error: 'Page introuvable.' });

      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (body.title !== undefined) patch.title = cleanTitle(body.title);
      if (body.icon !== undefined) patch.icon = typeof body.icon === 'string' && body.icon ? body.icon.slice(0, 16) : null;
      if (body.is_favorite !== undefined) patch.is_favorite = body.is_favorite === true;
      if (body.content !== undefined) {
        if (body.content !== null && typeof body.content !== 'object') return res.status(400).json({ error: 'Contenu invalide.' });
        if (body.content && JSON.stringify(body.content).length > MAX_CONTENT_BYTES) return res.status(413).json({ error: 'Contenu trop volumineux.' });
        patch.content = body.content;
        patch.content_text = body.content ? kbContentToText(body.content) : '';
      }
      if (body.project_id !== undefined) {
        const foreign = await firstForeignRelation(supabaseAdmin, tenantId, [{ table: 'projects', id: body.project_id, label: 'Affaire' }]);
        if (foreign) return res.status(400).json({ error: foreign });
        patch.project_id = body.project_id || null;
      }
      if (body.properties !== undefined) {
        const parent = current.parent_id ? (await loadTree(tenantId)).find(p => p.id === current.parent_id) : null;
        if (parent?.kind !== 'database') return res.status(400).json({ error: 'Cette page n\'est pas une ligne de base de données.' });
        const checked = await sanitizeRowProperties(tenantId, parent.id, body.properties);
        if (checked.error) return res.status(400).json({ error: checked.error });
        // Fusion : seules les clés envoyées changent, les autres valeurs restent.
        const { data: existing } = await table(tenantId, 'kb_pages').select('properties').eq('id', current.id).maybeSingle();
        patch.properties = { ...((existing as any)?.properties || {}), ...(checked.value || {}) };
      }
      const { data, error } = await table(tenantId, 'kb_pages').update(patch).eq('id', current.id).select().single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) {
      fail(res, '[PUT /api/kb/pages/:id]', e, 'Impossible d\'enregistrer la page.');
    }
  });

  app.patch('/api/kb/pages/:id/move', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const body = req.body || {};
      const parentId: string | null = typeof body.parent_id === 'string' && body.parent_id ? body.parent_id : null;
      const tree = await loadTree(tenantId);
      const page = tree.find(p => p.id === req.params.id);
      if (!page) return res.status(404).json({ error: 'Page introuvable.' });
      if (parentId) {
        const parent = tree.find(p => p.id === parentId);
        if (!parent || parent.trashed_at) return res.status(400).json({ error: 'Page parente introuvable pour ce cabinet.' });
        if (kbWouldCycle(page.id, parentId, tree)) return res.status(400).json({ error: 'Une page ne peut pas être placée dans l\'une de ses sous-pages.' });
        if (page.kind === 'database' && parent.kind === 'database') return res.status(400).json({ error: 'Une base ne se place pas dans une autre base.' });
        const depth = kbDepth(parentId, tree);
        if (depth === null || depth >= KB_MAX_DEPTH) return res.status(400).json({ error: `Les pages ne vont pas au-delà de ${KB_MAX_DEPTH} niveaux.` });
      }
      const position = Number.isFinite(Number(body.position)) ? Number(body.position) : Date.now();
      const { data, error } = await table(tenantId, 'kb_pages')
        .update({ parent_id: parentId, position }).eq('id', page.id).select().single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) {
      fail(res, '[PATCH /api/kb/pages/:id/move]', e, 'Impossible de déplacer la page.');
    }
  });

  // Corbeille : la page et ses sous-pages disparaissent de l'arbre sans être effacées.
  const setTrashed = async (tenantId: string, id: string, trashedAt: string | null) => {
    const tree = await loadTree(tenantId);
    if (!tree.some(p => p.id === id)) return false;
    const ids = new Set<string>([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const p of tree) if (p.parent_id && ids.has(p.parent_id) && !ids.has(p.id)) { ids.add(p.id); grew = true; }
    }
    const { error } = await table(tenantId, 'kb_pages').update({ trashed_at: trashedAt }).in('id', Array.from(ids));
    if (error) throw error;
    return true;
  };

  app.delete('/api/kb/pages/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      if (!(await setTrashed(tenantId, req.params.id, new Date().toISOString()))) return res.status(404).json({ error: 'Page introuvable.' });
      res.json({ success: true });
    } catch (e: any) {
      fail(res, '[DELETE /api/kb/pages/:id]', e, 'Impossible de mettre la page à la corbeille.');
    }
  });

  app.post('/api/kb/pages/:id/restore', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      if (!(await setTrashed(tenantId, req.params.id, null))) return res.status(404).json({ error: 'Page introuvable.' });
      res.json({ success: true });
    } catch (e: any) {
      fail(res, '[POST /api/kb/pages/:id/restore]', e, 'Impossible de restaurer la page.');
    }
  });

  app.delete('/api/kb/pages/:id/permanent', requireRole('admin', 'manager', 'pm'), async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data: page, error: readError } = await table(tenantId, 'kb_pages').select('id, trashed_at').eq('id', req.params.id).maybeSingle();
      if (readError) throw readError;
      if (!page) return res.status(404).json({ error: 'Page introuvable.' });
      if (!(page as any).trashed_at) return res.status(409).json({ error: 'Mettez d\'abord la page à la corbeille.', code: 'KB_NOT_TRASHED' });
      const { error } = await table(tenantId, 'kb_pages').delete().eq('id', req.params.id);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) {
      fail(res, '[DELETE /api/kb/pages/:id/permanent]', e, 'Impossible de supprimer la page.');
    }
  });

  // ─── Propriétés d'une base ────────────────────────────────────────────────
  const requireDatabase = async (tenantId: string, id: string) => {
    const { data, error } = await table(tenantId, 'kb_pages').select('id, kind').eq('id', id).maybeSingle();
    if (error) throw error;
    return (data as any)?.kind === 'database' ? (data as any) : null;
  };

  app.get('/api/kb/databases/:id/properties', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      if (!(await requireDatabase(tenantId, req.params.id))) return res.status(404).json({ error: 'Base de données introuvable.' });
      res.json(await loadProperties(tenantId, req.params.id));
    } catch (e: any) {
      fail(res, '[GET /api/kb/databases/:id/properties]', e, 'Impossible de lire les propriétés.');
    }
  });

  app.post('/api/kb/databases/:id/properties', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      if (!(await requireDatabase(tenantId, req.params.id))) return res.status(404).json({ error: 'Base de données introuvable.' });
      const body = req.body || {};
      const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '';
      if (!name) return res.status(400).json({ error: 'Nom de propriété obligatoire.' });
      if (!isKbPropertyType(body.type) || body.type === 'title') return res.status(400).json({ error: 'Type de propriété inconnu.' });
      const existing = await loadProperties(tenantId, req.params.id);
      if (existing.some(p => p.name.toLowerCase() === name.toLowerCase())) return res.status(409).json({ error: 'Une propriété porte déjà ce nom.' });
      const { data, error } = await table(tenantId, 'kb_properties').insert({
        id: crypto.randomUUID(), database_id: req.params.id, name, type: body.type,
        options: sanitizeKbOptions(body.options, () => crypto.randomUUID()),
        position: existing.length ? Math.max(...existing.map(p => p.position)) + 1 : 0,
      }).select().single();
      if (error) throw error;
      res.status(201).json(data);
    } catch (e: any) {
      fail(res, '[POST /api/kb/databases/:id/properties]', e, 'Impossible de créer la propriété.');
    }
  });

  app.put('/api/kb/databases/:id/properties/:propertyId', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const props = await loadProperties(tenantId, req.params.id);
      const property = props.find(p => p.id === req.params.propertyId);
      if (!property) return res.status(404).json({ error: 'Propriété introuvable.' });
      const body = req.body || {};
      const patch: Record<string, unknown> = {};
      if (body.name !== undefined) {
        const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '';
        if (!name) return res.status(400).json({ error: 'Nom de propriété obligatoire.' });
        if (props.some(p => p.id !== property.id && p.name.toLowerCase() === name.toLowerCase())) return res.status(409).json({ error: 'Une propriété porte déjà ce nom.' });
        patch.name = name;
      }
      if (body.options !== undefined) {
        if (property.type !== 'select' && property.type !== 'multi_select') return res.status(400).json({ error: 'Cette propriété n\'a pas d\'options.' });
        patch.options = sanitizeKbOptions(body.options, () => crypto.randomUUID());
      }
      if (body.position !== undefined && Number.isFinite(Number(body.position))) patch.position = Number(body.position);
      if (body.width !== undefined) patch.width = Number.isFinite(Number(body.width)) ? Math.min(800, Math.max(60, Math.round(Number(body.width)))) : null;
      const { data, error } = await table(tenantId, 'kb_properties').update(patch).eq('id', property.id).select().single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) {
      fail(res, '[PUT /api/kb/databases/:id/properties/:propertyId]', e, 'Impossible de modifier la propriété.');
    }
  });

  app.delete('/api/kb/databases/:id/properties/:propertyId', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const props = await loadProperties(tenantId, req.params.id);
      const property = props.find(p => p.id === req.params.propertyId);
      if (!property) return res.status(404).json({ error: 'Propriété introuvable.' });
      if (property.type === 'title') return res.status(400).json({ error: 'La colonne titre ne se supprime pas.' });
      const { error } = await table(tenantId, 'kb_properties').delete().eq('id', property.id);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) {
      fail(res, '[DELETE /api/kb/databases/:id/properties/:propertyId]', e, 'Impossible de supprimer la propriété.');
    }
  });

  // ─── Vues enregistrées ────────────────────────────────────────────────────
  app.get('/api/kb/databases/:id/views', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      if (!(await requireDatabase(tenantId, req.params.id))) return res.status(404).json({ error: 'Base de données introuvable.' });
      const { data, error } = await table(tenantId, 'kb_views').select('*').eq('database_id', req.params.id);
      if (error) throw error;
      res.json(((data || []) as any[]).sort((a, b) => a.position - b.position));
    } catch (e: any) {
      fail(res, '[GET /api/kb/databases/:id/views]', e, 'Impossible de lire les vues.');
    }
  });

  app.put('/api/kb/databases/:id/views/:viewId', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const body = req.body || {};
      const { data: view, error: readError } = await table(tenantId, 'kb_views').select('id').eq('id', req.params.viewId).eq('database_id', req.params.id).maybeSingle();
      if (readError) throw readError;
      if (!view) return res.status(404).json({ error: 'Vue introuvable.' });
      const patch: Record<string, unknown> = {};
      if (body.name !== undefined) {
        const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '';
        if (!name) return res.status(400).json({ error: 'Nom de vue obligatoire.' });
        patch.name = name;
      }
      if (body.config !== undefined) {
        if (!body.config || typeof body.config !== 'object' || Array.isArray(body.config) || JSON.stringify(body.config).length > 50_000) {
          return res.status(400).json({ error: 'Configuration de vue invalide.' });
        }
        patch.config = body.config;
      }
      const { data, error } = await table(tenantId, 'kb_views').update(patch).eq('id', req.params.viewId).select().single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) {
      fail(res, '[PUT /api/kb/databases/:id/views/:viewId]', e, 'Impossible d\'enregistrer la vue.');
    }
  });
}
