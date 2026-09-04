// Phase 7 extraction — moved out of server.ts's Tasks section (Gantt
// planning tasks).
import type { Express } from 'express';
import { tenantScopedFrom } from '../tenantScopedFrom';
import { validateBody } from '../../src/lib/validateRequest';
import { createTaskSchema, updateTaskSchema } from '../../src/schemas/task.schema';

export interface RouteDeps {
  supabaseAdmin: any;
  getTenantId: (userId: string) => Promise<string>;
  getUserName: (tenantId: string, userId: string, email?: string) => Promise<string>;
  logActivity: (tenantId: string, userId: string, userName: string, action: string, target: string, targetId: string, targetType: string, category: string) => void;
}

// `tasks.dependencies` est une colonne TEXT : supabase-js y écrit le JSON du
// tableau, donc la base contient la chaîne "[]" et non un tableau. Tout
// consommateur qui faisait `(task.dependencies || []).map(...)`
// (src/pages/Gantt.tsx) ou `.includes(...)` plantait dès qu'une tâche
// existait. On normalise ici, au seul point de passage garanti : les GET
// atteignent toujours le serveur, y compris en mode desktop hors ligne.
function parseDependencies(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((d): d is string => typeof d === 'string');
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((d: unknown): d is string => typeof d === 'string') : [];
  } catch {
    return [];
  }
}

function serializeTask(row: any) {
  if (!row) return row;
  return { ...row, dependencies: parseDependencies(row.dependencies) };
}

// Liste blanche des colonnes qu'un PUT peut écrire. C'est elle, et non le
// schéma Zod, qui empêche un `tenant_id` ou un `created_by` venu du corps
// de requête d'atteindre l'UPDATE.
const UPDATABLE_FIELDS = [
  'project_id', 'title', 'description', 'start_date', 'end_date', 'due_date',
  'progress', 'status', 'priority', 'assignee_id',
] as const;

export function registerTaskRoutes(app: Express, { supabaseAdmin, getTenantId, getUserName, logActivity }: RouteDeps) {
  app.get("/api/tasks", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { project_id, status, assignee_id } = req.query;
      const query = tenantScopedFrom(supabaseAdmin, tenantId, 'tasks').select('*');
      // `project_id=none` cible les tâches hors projet — celles que les
      // agents créent sans rattachement, et qui n'étaient visibles nulle part.
      if (project_id === 'none') query.is('project_id', null);
      else if (project_id) query.eq('project_id', project_id as string);
      if (status) query.eq('status', status as string);
      if (assignee_id) query.eq('assignee_id', assignee_id as string);
      const { data, error } = await query;
      if (error) throw error;
      res.json((data || []).map(serializeTask));
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to fetch tasks" }); }
  });

  app.post("/api/tasks", validateBody(createTaskSchema), async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id: bodyId, project_id, title, description, start_date, end_date, due_date, progress, dependencies, status, priority, assignee_id } = req.body;
      const id = bodyId || crypto.randomUUID();
      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tasks').insert({
        id,
        project_id: project_id || null,
        title,
        description: description || null,
        start_date,
        end_date,
        due_date: due_date || null,
        progress: progress || 0,
        // Sérialisation explicite plutôt qu'effet de bord de supabase-js sur
        // une colonne TEXT — voir parseDependencies ci-dessus.
        dependencies: JSON.stringify(dependencies || []),
        status: status || 'todo',
        priority: priority || 'normal',
        assignee_id: assignee_id || null,
        created_by: req.user.id,
      }).select().single();
      if (error) throw error;
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Création de la tâche "${title}"`, title, id, 'task', 'Tâches');
      res.status(201).json(serializeTask(data));
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to create task: " + e.message }); }
  });

  app.put("/api/tasks/:id", validateBody(updateTaskSchema), async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      // Patch construit à partir des seules clés présentes : l'ancienne
      // version écrivait tous les champs à chaque fois et remettait
      // systématiquement `dependencies` à [], ce que le Calendrier et le
      // modal contournaient en renvoyant la ligne entière. Un
      // `{ progress: 60 }` est désormais réellement partiel.
      const patch: Record<string, any> = {};
      for (const field of UPDATABLE_FIELDS) {
        if (req.body[field] !== undefined) patch[field] = req.body[field] === '' ? null : req.body[field];
      }
      if (req.body.dependencies !== undefined) patch.dependencies = JSON.stringify(req.body.dependencies || []);
      if (Object.keys(patch).length === 0) return res.status(400).json({ error: "Aucun champ à mettre à jour" });
      patch.updated_at = new Date().toISOString();

      const { data, error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tasks').update(patch).eq('id', id).select().maybeSingle();
      if (error) throw error;
      if (!data) return res.status(404).json({ error: "Tâche introuvable" });
      // Le POST et le DELETE journalisaient déjà ; sans cette ligne les
      // modifications de tâche n'apparaissaient jamais dans ActivityFeed.
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Modification de la tâche "${data.title}"`, data.title, id, 'task', 'Tâches');
      res.json(serializeTask(data));
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to update task" }); }
  });

  app.delete("/api/tasks/:id", async (req: any, res: any) => {
    try {
      const tenantId = await getTenantId(req.user.id);
      const { id } = req.params;
      const { data: task } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tasks').select('title').eq('id', id).maybeSingle();
      const { error } = await tenantScopedFrom(supabaseAdmin, tenantId, 'tasks').delete().eq('id', id);
      if (error) throw error;
      const title = (task as any)?.title || '';
      const userName = await getUserName(tenantId, req.user.id, req.user.email);
      logActivity(tenantId, req.user.id, userName, `Suppression de la tâche "${title}"`, title, id, 'task', 'Tâches');
      res.json({ success: true });
    } catch (e: any) { console.error(e); res.status(500).json({ error: "Failed to delete task" }); }
  });
}
