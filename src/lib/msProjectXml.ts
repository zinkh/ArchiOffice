import type { Project, Task, TeamMember } from '../types';
import {
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

export function parseMsProject(root: any): ParsedPlanningXml {
  const project = root.Project;

  const resources = new Map<string, string>();
  for (const resource of asArray(project?.Resources?.Resource)) {
    const uid = asText(resource?.UID).trim();
    const name = asText(resource?.Name).trim();
    if (uid && name) resources.set(uid, name);
  }

  const resourcesByTask = new Map<string, string[]>();
  for (const assignment of asArray(project?.Assignments?.Assignment)) {
    const taskUid = asText(assignment?.TaskUID).trim();
    const resourceUid = asText(assignment?.ResourceUID).trim();
    const name = resources.get(resourceUid);
    if (!taskUid || !name) continue;
    const list = resourcesByTask.get(taskUid) || [];
    if (!list.includes(name)) list.push(name);
    resourcesByTask.set(taskUid, list);
  }

  const tasks = asArray(project?.Tasks?.Task)
    .map((task: any): ImportedPlanningTask | null => {
      const id = asText(task?.UID ?? task?.ID).trim();
      const title = asText(task?.Name).trim();
      if (!id || !title) return null;
      if (asText(task?.Summary) === '1' && asText(task?.ID) === '0') return null;

      const start = isoDay(task?.Start);
      const finish = isoDay(task?.Finish, start);
      return {
        sourceId: id,
        title,
        description: asText(task?.Notes).trim() || null,
        start_date: start,
        end_date: finish,
        progress: clampProgress(task?.PercentComplete),
        dependencies: asArray(task?.PredecessorLink)
          .map((link: any) => asText(link?.PredecessorUID).trim())
          .filter(Boolean),
        resourceNames: resourcesByTask.get(id) || [],
        milestone: asText(task?.Milestone) === '1',
      };
    })
    .filter((task: ImportedPlanningTask | null): task is ImportedPlanningTask => !!task);

  return {
    format: 'msproject',
    projectName: asText(project?.Name ?? project?.Title).trim() || undefined,
    tasks,
  };
}

function dateTime(date: string, time = '08:00:00') {
  return `${date}T${time}`;
}

export function exportMsProjectXml(project: Project, tasks: Task[], team: TeamMember[] = []): string {
  const taskUid = new Map(tasks.map((task, index) => [task.id, String(index + 1)]));
  const members = assignedMembers(tasks, team);
  const resourceUid = new Map(members.map((member, index) => [member.id, String(index + 1)]));
  let assignmentUid = 1;

  const xml = {
    Project: {
      '@_xmlns': 'http://schemas.microsoft.com/project',
      SaveVersion: '14',
      Name: project.name,
      Title: project.name,
      ScheduleFromStart: '1',
      StartDate: dateTime(project.start_date),
      FinishDate: dateTime(project.end_date, '17:00:00'),
      MinutesPerDay: '480',
      MinutesPerWeek: '2400',
      DaysPerMonth: '20',
      CalendarUID: '1',
      Tasks: {
        Task: tasks.map((task, index) => {
          const durationDays = inclusiveDays(task.start_date, task.end_date);
          const duration = `PT${durationDays * 8}H0M0S`;
          return {
            UID: String(index + 1),
            ID: String(index + 1),
            Name: task.title,
            Type: '0',
            IsNull: '0',
            WBS: String(index + 1),
            OutlineNumber: String(index + 1),
            OutlineLevel: '1',
            Priority: task.priority === 'urgent'
              ? '1000'
              : task.priority === 'high'
                ? '750'
                : task.priority === 'low'
                  ? '250'
                  : '500',
            Start: dateTime(task.start_date),
            Finish: dateTime(task.end_date, '17:00:00'),
            Duration: duration,
            DurationFormat: '7',
            Work: duration,
            Milestone: durationDays === 1 ? '1' : '0',
            Summary: '0',
            PercentComplete: String(task.progress || 0),
            PercentWorkComplete: String(task.progress || 0),
            Active: '1',
            Manual: '0',
            ...(task.description ? { Notes: task.description } : {}),
            ...(task.dependencies?.length ? {
              PredecessorLink: task.dependencies
                .filter(dep => taskUid.has(dep))
                .map(dep => ({
                  PredecessorUID: taskUid.get(dep),
                  Type: '1',
                  CrossProject: '0',
                  LinkLag: '0',
                  LagFormat: '7',
                })),
            } : {}),
          };
        }),
      },
      Resources: {
        Resource: members.map(member => ({
          UID: resourceUid.get(member.id),
          ID: resourceUid.get(member.id),
          Name: member.name,
          Type: '1',
          IsNull: '0',
          MaxUnits: '1',
          PeakUnits: '1',
        })),
      },
      Assignments: {
        Assignment: tasks
          .filter(task => task.assignee_id && resourceUid.has(task.assignee_id))
          .map(task => ({
            UID: String(assignmentUid++),
            TaskUID: taskUid.get(task.id),
            ResourceUID: resourceUid.get(task.assignee_id!),
            Units: '1',
          })),
      },
    },
  };

  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + planningXmlBuilder.build(xml);
}
