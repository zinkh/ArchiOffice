import type { Project, Task, TeamMember } from '../types';
import {
  addDays,
  asArray,
  asText,
  assignedMembers,
  clampProgress,
  inclusiveDays,
  isoDay,
  planningXmlBuilder,
  type ImportedPlanningTask,
  type ParsedPlanningXml,
} from './projectPlanningXmlShared';

function collectTasks(nodes: any[], out: ImportedPlanningTask[], edges: Array<{ predecessor: string; successor: string }>) {
  for (const node of nodes) {
    const id = asText(node?.['@_id'] ?? node?.id).trim();
    const title = asText(node?.['@_name'] ?? node?.name).trim();
    if (!id || !title) continue;

    const start = isoDay(node?.['@_start'] ?? node?.start);
    const duration = Math.max(1, Number(node?.['@_duration'] ?? node?.duration ?? 1));
    out.push({
      sourceId: id,
      title,
      description: asText(node?.notes ?? node?.['@_notes']).trim() || null,
      start_date: start,
      end_date: addDays(start, duration - 1),
      progress: clampProgress(node?.['@_complete'] ?? node?.complete),
      dependencies: [],
      resourceNames: [],
      milestone: asText(node?.['@_milestone']).toLowerCase() === 'true',
    });

    for (const dep of asArray(node?.depend)) {
      const successor = asText((dep as any)?.['@_id'] ?? (dep as any)?.id).trim();
      if (successor) edges.push({ predecessor: id, successor });
    }

    collectTasks(asArray(node?.task), out, edges);
  }
}

export function parseGanttProject(root: any): ParsedPlanningXml {
  const project = root.project;
  const tasks: ImportedPlanningTask[] = [];
  const edges: Array<{ predecessor: string; successor: string }> = [];
  collectTasks(asArray(project?.tasks?.task), tasks, edges);

  const byId = new Map(tasks.map(task => [task.sourceId, task]));
  for (const edge of edges) {
    const successor = byId.get(edge.successor);
    if (successor && !successor.dependencies.includes(edge.predecessor)) {
      successor.dependencies.push(edge.predecessor);
    }
  }

  const resources = new Map<string, string>();
  for (const resource of asArray(project?.resources?.resource)) {
    const id = asText(resource?.['@_id'] ?? resource?.id).trim();
    const name = asText(resource?.['@_name'] ?? resource?.name).trim();
    if (id && name) resources.set(id, name);
  }

  for (const allocation of asArray(project?.allocations?.allocation)) {
    const taskId = asText(allocation?.['@_task-id']).trim();
    const resourceId = asText(allocation?.['@_resource-id']).trim();
    const task = byId.get(taskId);
    const resource = resources.get(resourceId);
    if (task && resource && !task.resourceNames.includes(resource)) task.resourceNames.push(resource);
  }

  return {
    format: 'ganttproject',
    projectName: asText(project?.['@_name'] ?? project?.name).trim() || undefined,
    tasks,
  };
}

export function exportGanttProjectXml(project: Project, tasks: Task[], team: TeamMember[] = []): string {
  const taskId = new Map(tasks.map((task, index) => [task.id, String(index + 1)]));
  const members = assignedMembers(tasks, team);
  const resourceId = new Map(members.map((member, index) => [member.id, String(index + 1)]));
  const successors = new Map<string, string[]>();
  for (const task of tasks) {
    for (const predecessor of task.dependencies || []) {
      if (!taskId.has(predecessor)) continue;
      const list = successors.get(predecessor) || [];
      list.push(task.id);
      successors.set(predecessor, list);
    }
  }

  const xml = {
    project: {
      '@_name': project.name,
      '@_company': 'ArchiOffice',
      '@_version': '3.3',
      '@_view-date': project.start_date,
      '@_date-format': 'yyyy-MM-dd',
      tasks: {
        task: tasks.map(task => ({
          '@_id': taskId.get(task.id),
          '@_name': task.title,
          '@_color': '#8b5cf6',
          '@_start': task.start_date,
          '@_duration': String(inclusiveDays(task.start_date, task.end_date)),
          '@_complete': String(task.progress || 0),
          '@_expand': 'true',
          ...(task.description ? { notes: task.description } : {}),
          ...(successors.get(task.id)?.length ? {
            depend: successors.get(task.id)!.map(successorId => ({
              '@_id': taskId.get(successorId),
              '@_type': '2',
              '@_difference': '0',
              '@_hardness': 'Strong',
            })),
          } : {}),
        })),
      },
      resources: {
        resource: members.map(member => ({
          '@_id': resourceId.get(member.id),
          '@_name': member.name,
          '@_function': '0',
        })),
      },
      allocations: {
        allocation: tasks
          .filter(task => task.assignee_id && resourceId.has(task.assignee_id))
          .map(task => ({
            '@_task-id': taskId.get(task.id),
            '@_resource-id': resourceId.get(task.assignee_id!),
            '@_load': '100.0',
            '@_function': '0',
          })),
      },
    },
  };

  return '<?xml version="1.0" encoding="UTF-8"?>\n' + planningXmlBuilder.build(xml);
}
