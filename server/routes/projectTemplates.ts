// Modèles de projet : une trame d'affaire (lots, jalons, tâches types) que la
// création d'un projet applique d'un geste (voir server/projectTemplateApply.ts).
//
// Trois façons d'en avoir un : le saisir, l'installer depuis le catalogue de
// démarrage (server/projectTemplateCatalog.ts), ou le tirer d'une affaire
// existante (`POST /from-project/:projectId`).
//
// Les trois listes structurées (`default_lots`, `default_milestones`,
// `default_tasks`) sont du jsonb : elles sont assainies ici, à l'écriture, pour
// qu'un corps de requête ne puisse pas y déposer autre chose qu'une trame.
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';
import { assertTenantEntity } from '../assertTenantEntity';
import { PROJECT_TEMPLATE_CATALOG, findCatalogEntry } from '../projectTemplateCatalog';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
}

const OPERATION_TYPES = ['neuf', 'rehabilitation', 'extension', 'maison_individuelle', 'permis_seul', 'autre'];
const MARCHE_TYPES = ['prive', 'public'];
const STATUSES = ['Planning', 'In Progress', 'Completed', 'On Hold'];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const MAX_ITEMS = 200;

const text = (v: unknown, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const days = (v: unknown) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(Math.max(n, 0), 3650) : 0;
};

export function sanitizeLots(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_ITEMS)
    .map((l: any) => ({ lot_number: text(l?.lot_number, 20), lot_title: text(l?.lot_title) }))
    .filter(l => l.lot_title);
}

export function sanitizeMilestones(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_ITEMS)
    .map((m: any) => ({ title: text(m?.title), due_date_offset_days: days(m?.due_date_offset_days) }))
    .filter(m => m.title);
}

export function sanitizeTasks(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_ITEMS)
    .map((t: any) => ({
      title: text(t?.title),
      ...(text(t?.description, 1000) ? { description: text(t?.description, 1000) } : {}),
      start_offset_days: days(t?.start_offset_days),
      duration_days: Math.max(days(t?.duration_days), 1),
      priority: PRIORITIES.includes(t?.priority) ? t.priority : 'normal',
    }))
    .filter(t => t.title);
}

/** Les seuls champs qu'un POST/PUT peut écrire ; ne retient que ce qui est fourni. */
function templateFields(body: any) {
  const out: Record<string, unknown> = {};
  if (body.name !== undefined) out.name = text(body.name, 200);
  if (body.description !== undefined) out.description = text(body.description, 2000);
  if (body.default_description !== undefined) out.default_description = text(body.default_description, 4000);
  if (body.default_status !== undefined && STATUSES.includes(body.default_status)) out.default_status = body.default_status;
  if (body.default_budget !== undefined) out.default_budget = Math.max(Number(body.default_budget) || 0, 0);
  if (body.operation_type !== undefined) out.operation_type = OPERATION_TYPES.includes(body.operation_type) ? body.operation_type : null;
  if (body.marche_type !== undefined) out.marche_type = MARCHE_TYPES.includes(body.marche_type) ? body.marche_type : null;
  if (body.default_lots !== undefined) out.default_lots = sanitizeLots(body.default_lots);
  if (body.default_milestones !== undefined) out.default_milestones = sanitizeMilestones(body.default_milestones);
  if (body.default_tasks !== undefined) out.default_tasks = sanitizeTasks(body.default_tasks);
  return out;
}

const dayDiff = (from: string, to: string) =>
  Math.round((Date.parse(`${to.slice(0, 10)}T12:00:00Z`) - Date.parse(`${from.slice(0, 10)}T12:00:00Z`)) / 86_400_000);

export function registerProjectTemplateRoutes(app: Express, { supabaseAdmin, getTenantId }: RouteDeps) {
  app.get('/api/project-templates', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'project_templates').select('*').order('name');
      if (error) throw error;
      res.json(data || []);
    } catch (e: any) {
      console.error('[GET /api/project-templates]', e);
      res.status(500).json({ error: 'Failed to fetch project templates' });
    }
  });

  // Catalogue de démarrage, chaque entrée marquée `installed` si le cabinet en
  // a déjà une copie (repérée par `catalog_key`, donc insensible à un renommage).
  app.get('/api/project-templates/catalog', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'project_templates').select('catalog_key');
      if (error) throw error;
      const installed = new Set((data || []).map((r: any) => r.catalog_key).filter(Boolean));
      res.json(PROJECT_TEMPLATE_CATALOG.map(e => ({ ...e, installed: installed.has(e.catalog_key) })));
    } catch (e: any) {
      console.error('[GET /api/project-templates/catalog]', e);
      res.status(500).json({ error: 'Failed to fetch template catalog' });
    }
  });

  // Installe des entrées du catalogue. Une entrée déjà installée est ignorée :
  // deux clics ne doublent pas un modèle que le cabinet a peut-être adapté.
  app.post('/api/project-templates/catalog/install', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const keys: unknown = req.body?.keys;
      if (!Array.isArray(keys) || keys.length === 0 || keys.some(k => typeof k !== 'string')) {
        return res.status(400).json({ error: 'keys doit être une liste non vide de clés de catalogue' });
      }
      const entries = [...new Set(keys as string[])].map(findCatalogEntry);
      if (entries.some(e => !e)) return res.status(400).json({ error: 'Clé de catalogue inconnue' });
      const { data: existing, error: readErr } = await tenantScopedFrom(supabaseAdmin, tenantId, 'project_templates').select('catalog_key');
      if (readErr) throw readErr;
      const installed = new Set((existing || []).map((r: any) => r.catalog_key).filter(Boolean));
      const rows = (entries as NonNullable<(typeof entries)[number]>[])
        .filter(e => !installed.has(e.catalog_key))
        .map(({ installed: _i, ...e }) => ({ ...e, id: crypto.randomUUID() }));
      if (rows.length) {
        const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'project_templates').insert(rows);
        if (error) throw error;
      }
      res.status(201).json({ installed: rows.length, skipped: entries.length - rows.length });
    } catch (e: any) {
      console.error('[POST /api/project-templates/catalog/install]', e);
      res.status(500).json({ error: 'Failed to install catalog templates: ' + e.message });
    }
  });

  // Tire un modèle d'une affaire existante : ses lots, ses jalons et ses tâches,
  // sans montants réels ni dates absolues (décalages depuis le démarrage).
  app.post('/api/project-templates/from-project/:projectId', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { projectId } = req.params;
      if (!(await assertTenantEntity(supabaseAdmin, 'projects', projectId, tenantId))) {
        return res.status(404).json({ error: 'Projet introuvable pour ce cabinet.' });
      }
      const { data: project, error: pe } = await tenantScopedFrom(supabaseAdmin, tenantId, 'projects').select('*').eq('id', projectId).single();
      if (pe || !project) return res.status(404).json({ error: 'Projet introuvable pour ce cabinet.' });
      const start: string = project.start_date || new Date().toISOString().slice(0, 10);
      const [lots, milestones, tasks] = await Promise.all([
        tenantScopedFrom(supabaseAdmin, tenantId, 'project_lots').select('*').eq('project_id', projectId).then((r: any) => r.data || []),
        tenantScopedFrom(supabaseAdmin, tenantId, 'milestones').select('*').eq('project_id', projectId).then((r: any) => r.data || []),
        tenantScopedFrom(supabaseAdmin, tenantId, 'tasks').select('*').eq('project_id', projectId).then((r: any) => r.data || []),
      ]);
      const name = text(req.body?.name, 200) || `${project.name} (modèle)`;
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'project_templates').insert({
        id: crypto.randomUUID(),
        name,
        description: text(req.body?.description, 2000) || `Modèle tiré de l'affaire « ${project.name} ».`,
        default_description: project.description || '',
        default_status: 'Planning',
        default_budget: 0,
        operation_type: OPERATION_TYPES.includes(req.body?.operation_type) ? req.body.operation_type : 'autre',
        marche_type: project.is_public_client ? 'public' : 'prive',
        default_lots: sanitizeLots([...lots]
          .sort((a: any, b: any) => String(a.lot_number ?? '').localeCompare(String(b.lot_number ?? ''), 'fr', { numeric: true }))
          .map((l: any) => ({ lot_number: l.lot_number, lot_title: l.lot_title }))),
        default_milestones: sanitizeMilestones(milestones.map((m: any) => ({
          title: m.title, due_date_offset_days: m.due_date ? dayDiff(start, m.due_date) : 0,
        }))),
        default_tasks: sanitizeTasks(tasks.map((t: any) => ({
          title: t.title, description: t.description, priority: t.priority,
          start_offset_days: t.start_date ? dayDiff(start, t.start_date) : 0,
          duration_days: t.start_date && t.end_date ? dayDiff(t.start_date, t.end_date) : 1,
        }))),
      }).select().single();
      if (error) throw error;
      res.status(201).json(data);
    } catch (e: any) {
      console.error('[POST /api/project-templates/from-project/:projectId]', e);
      res.status(500).json({ error: 'Failed to create template from project: ' + e.message });
    }
  });

  app.post('/api/project-templates', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const fields = templateFields(req.body || {});
      if (!fields.name) return res.status(400).json({ error: 'Le nom du modèle est obligatoire.' });
      const id = req.body.id || crypto.randomUUID();
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'project_templates')
        .insert({ default_status: 'Planning', default_budget: 0, ...fields, id })
        .select().single();
      if (error) throw error;
      res.status(201).json(data);
    } catch (e: any) {
      console.error('[POST /api/project-templates]', e);
      res.status(500).json({ error: 'Failed to create project template: ' + e.message });
    }
  });

  app.put('/api/project-templates/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const fields = templateFields(req.body || {});
      if ('name' in fields && !fields.name) return res.status(400).json({ error: 'Le nom du modèle est obligatoire.' });
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'project_templates')
        .update(fields)
        .eq('id', req.params.id).select().single();
      if (error) throw error;
      res.json(data);
    } catch (e: any) {
      console.error('[PUT /api/project-templates/:id]', e);
      res.status(500).json({ error: 'Failed to update project template: ' + e.message });
    }
  });

  app.delete('/api/project-templates/:id', async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'project_templates').delete().eq('id', req.params.id);
      if (error) throw error;
      res.json({ success: true });
    } catch (e: any) {
      console.error('[DELETE /api/project-templates/:id]', e);
      res.status(500).json({ error: 'Failed to delete project template' });
    }
  });
}
