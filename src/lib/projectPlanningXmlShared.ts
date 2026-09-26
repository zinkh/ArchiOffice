import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import type { Task, TeamMember } from '../types';

export type ProjectXmlFormat = 'ganttproject' | 'msproject';

export interface ImportedPlanningTask {
  sourceId: string;
  title: string;
  description?: string | null;
  start_date: string;
  end_date: string;
  progress: number;
  dependencies: string[];
  resourceNames: string[];
  milestone?: boolean;
}

export interface ParsedPlanningXml {
  format: ProjectXmlFormat;
  projectName?: string;
  tasks: ImportedPlanningTask[];
}

export const planningXmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  parseAttributeValue: false,
  removeNSPrefix: true,
  trimValues: true,
});

export const planningXmlBuilder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  format: true,
  suppressEmptyNode: true,
});

export function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

export function asText(value: unknown): string {
  return value == null ? '' : String(value);
}

export function clampProgress(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0;
}

export function isoDay(value: unknown, fallback?: string): string {
  const raw = asText(value).trim();
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  if (fallback) return fallback;
  throw new Error(`Date de planning invalide : ${raw || 'valeur vide'}`);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function inclusiveDays(start: string, end: string): number {
  const a = Date.parse(`${start}T12:00:00Z`);
  const b = Date.parse(`${end}T12:00:00Z`);
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
}

export function assignedMembers(tasks: Task[], team: TeamMember[]) {
  const ids = new Set(tasks.map(task => task.assignee_id).filter((id): id is string => !!id));
  return team.filter(member => ids.has(member.id));
}

function taskStatus(progress: number): 'todo' | 'in_progress' | 'review' | 'done' {
  if (progress >= 100) return 'done';
  if (progress > 0) return 'in_progress';
  return 'todo';
}

export function importedTasksToCreatePayloads(
  parsed: ParsedPlanningXml,
  projectId: string,
  team: TeamMember[] = [],
): Array<Partial<Task> & { id: string }> {
  const idMap = new Map(parsed.tasks.map(task => [task.sourceId, crypto.randomUUID()]));
  const normalizedTeam = new Map(team.map(member => [member.name.trim().toLocaleLowerCase(), member.id]));

  return parsed.tasks.map(task => {
    const assignee = task.resourceNames
      .map(name => normalizedTeam.get(name.trim().toLocaleLowerCase()))
      .find(Boolean) || null;
    return {
      id: idMap.get(task.sourceId)!,
      project_id: projectId,
      title: task.title,
      description: task.description || null,
      start_date: task.start_date,
      end_date: task.end_date,
      due_date: task.end_date,
      progress: task.progress,
      status: taskStatus(task.progress),
      priority: 'normal',
      assignee_id: assignee,
      dependencies: task.dependencies.flatMap(dep => {
        const mapped = idMap.get(dep);
        return mapped ? [mapped] : [];
      }),
    };
  });
}
