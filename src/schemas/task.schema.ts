// Valide POST /api/tasks et PUT /api/tasks/:id.
//
// Jusqu'ici les deux routes n'avaient aucune validation : un `status`
// arbitraire passait, un `progress` hors bornes aussi, et les champs
// inconnus (dont `description`, que les agents envoyaient déjà) étaient
// avalés en silence. Les deux listes de valeurs ci-dessous sont la source
// unique du vocabulaire des tâches — src/types.ts en dérive ses types, et
// l'UI comme les agents s'y réfèrent plutôt que de redéclarer leur propre
// copie.
import { z } from 'zod';

export const TASK_STATUSES = ['todo', 'in_progress', 'review', 'done'] as const;
export const TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'date au format YYYY-MM-DD attendue');

export const createTaskSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1, 'title is required'),
  project_id: z.string().nullish(),
  description: z.string().nullish(),
  start_date: isoDate,
  end_date: isoDate,
  due_date: z.union([isoDate, z.literal('')]).nullish(),
  progress: z.number().int().min(0).max(100).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  assignee_id: z.string().nullish(),
  dependencies: z.array(z.string()).optional(),
});

// .passthrough() et non .strict() : Calendar.tsx et Gantt.tsx renvoient au
// PUT la ligne complète telle que l'API la leur a rendue (tenant_id,
// updated_at, created_at…), et .strict() les casserait par un 400. La vraie
// protection contre l'écriture d'un champ inattendu est la liste blanche
// TASK_UPDATABLE_FIELDS du handler, pas le rejet des clés inconnues.
export const updateTaskSchema = createTaskSchema.partial().passthrough();
