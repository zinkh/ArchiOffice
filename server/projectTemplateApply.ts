// Applique un modèle de projet à une affaire qui vient d'être créée : lots,
// jalons et tâches types, datés à partir de la date de démarrage.
//
// Côté serveur et depuis la ligne du modèle, jamais depuis un corps de requête :
// le client ne fait que désigner le modèle (`template_id`), il ne peut donc pas
// faire écrire autre chose que ce que le cabinet a enregistré.
//
// Meilleur effort : l'affaire est déjà créée, un échec sur un jalon ne doit pas
// la faire perdre. Les erreurs sont rapportées (`failed`) plutôt qu'avalées.
import { addDaysIso } from '../src/lib/projectTemplates';
import type { ProjectTemplate } from '../src/types';

export interface TemplateApplyResult {
  lots: number;
  milestones: number;
  tasks: number;
  failed: string[];
}

export async function applyTemplateToProject(
  supabaseAdmin: any,
  tenantId: string,
  userId: string,
  projectId: string,
  template: Partial<ProjectTemplate>,
  startDate: string,
): Promise<TemplateApplyResult> {
  const result: TemplateApplyResult = { lots: 0, milestones: 0, tasks: 0, failed: [] };

  const lots = Array.isArray(template.default_lots) ? template.default_lots : [];
  if (lots.length) {
    const { error } = await supabaseAdmin.from('project_lots').insert(lots.map(l => ({
      id: crypto.randomUUID(), tenant_id: tenantId, project_id: projectId,
      lot_number: l.lot_number, lot_title: l.lot_title,
    })));
    if (error) result.failed.push(`lots : ${error.message}`); else result.lots = lots.length;
  }

  const milestones = Array.isArray(template.default_milestones) ? template.default_milestones : [];
  if (milestones.length) {
    const { error } = await supabaseAdmin.from('milestones').insert(milestones.map(m => ({
      id: crypto.randomUUID(), tenant_id: tenantId, project_id: projectId,
      title: m.title, due_date: addDaysIso(startDate, Number(m.due_date_offset_days) || 0),
      completed: false, duration_days: null, dependencies: [],
    })));
    if (error) result.failed.push(`jalons : ${error.message}`); else result.milestones = milestones.length;
  }

  const tasks = Array.isArray(template.default_tasks) ? template.default_tasks : [];
  if (tasks.length) {
    const { error } = await supabaseAdmin.from('tasks').insert(tasks.map(t => {
      const start = addDaysIso(startDate, Number(t.start_offset_days) || 0);
      const end = addDaysIso(startDate, (Number(t.start_offset_days) || 0) + Math.max(Number(t.duration_days) || 1, 1));
      return {
        id: crypto.randomUUID(), tenant_id: tenantId, project_id: projectId,
        title: t.title, description: t.description || null,
        start_date: start, end_date: end, due_date: end,
        progress: 0, dependencies: '[]', status: 'todo', priority: t.priority || 'normal',
        assignee_id: null, created_by: userId,
      };
    }));
    if (error) result.failed.push(`tâches : ${error.message}`); else result.tasks = tasks.length;
  }

  return result;
}
