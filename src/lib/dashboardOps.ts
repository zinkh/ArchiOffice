// Indicateurs opérationnels des tableaux de bord administrateur et manager.
//
// Un seul calcul pour les deux : seul le PÉRIMÈTRE change. `null` vaut « toute
// l'agence » (administrateur), un ensemble d'identifiants d'affaires vaut « les
// affaires de l'équipe » (manager). Sorti des composants pour rester testable
// sans rendu React.

import { normalizeProjectStatus } from './dashboardMetrics';

export type ProjectScope = Set<string> | null;

export const UPCOMING_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const CLOSED_RESERVE_STATUSES = ['Levée', 'Quitus Transmis'];

export interface OpsInput {
  projects: { id: string; status?: string | null }[];
  permits: { project_id: string; status: string }[];
  rfis: { project_id: string; status: string; due_date?: string | null }[];
  meetings: { project_id?: string | null; date: string }[];
  milestones: { project_id?: string | null; due_date: string; completed: boolean }[];
  reserves: { project_id: string; status: string; due_date?: string | null }[];
  gpaReserves: { project_id: string; status: string; due_date?: string | null }[];
  tasks: { project_id: string | null; status?: string | null; due_date?: string | null; end_date?: string | null }[];
}

export interface OpsKpis {
  activeProjects: number;
  totalProjects: number;
  activePermits: number;
  permitsInInstruction: number;
  upcomingDeadlines: number;
  lateDeadlines: number;
  meetingsThisWeek: number;
  rfisPending: number;
  rfisLate: number;
  oprOpen: number;
  oprLate: number;
  gpaOpen: number;
  gpaLate: number;
  tasksOpen: number;
  tasksLate: number;
}

export function startOfDay(d: Date): Date {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function startOfWeek(d: Date): Date {
  const date = startOfDay(d);
  const day = date.getDay();
  date.setDate(date.getDate() + (day === 0 ? -6 : 1) - day);
  return date;
}

/** Une date absente ou illisible n'est jamais « en retard » : on ne devine pas. */
function isBefore(raw: string | null | undefined, limit: Date): boolean {
  if (!raw) return false;
  const time = new Date(raw).getTime();
  return Number.isFinite(time) && time < limit.getTime();
}

export function computeOpsKpis(input: OpsInput, scope: ProjectScope, now = new Date()): OpsKpis {
  const inScope = (projectId: string | null | undefined) =>
    scope === null || (!!projectId && scope.has(projectId));

  const today = startOfDay(now);
  const horizon = new Date(today.getTime() + (UPCOMING_WINDOW_DAYS + 1) * DAY_MS);
  const weekStart = startOfWeek(now);
  const weekEnd = new Date(weekStart.getTime() + 7 * DAY_MS);

  const projects = input.projects.filter(p => inScope(p.id));
  const permits = input.permits.filter(p => inScope(p.project_id) && p.status !== 'refuse');
  const openDeadlines = input.milestones.filter(m => inScope(m.project_id) && !m.completed && isBefore(m.due_date, horizon));
  const pendingRfis = input.rfis.filter(r => inScope(r.project_id) && r.status === 'en_attente');
  const openOpr = input.reserves.filter(r => inScope(r.project_id) && !CLOSED_RESERVE_STATUSES.includes(r.status));
  const openGpa = input.gpaReserves.filter(r => inScope(r.project_id) && !CLOSED_RESERVE_STATUSES.includes(r.status));
  const openTasks = input.tasks.filter(t => inScope(t.project_id) && t.status !== 'done');

  return {
    activeProjects: projects.filter(p => normalizeProjectStatus(p.status) === 'active').length,
    totalProjects: projects.length,
    activePermits: permits.length,
    permitsInInstruction: permits.filter(p => p.status === 'en_instruction').length,
    upcomingDeadlines: openDeadlines.length,
    lateDeadlines: openDeadlines.filter(m => isBefore(m.due_date, today)).length,
    meetingsThisWeek: input.meetings.filter(m => {
      if (!inScope(m.project_id)) return false;
      const time = new Date(m.date).getTime();
      return Number.isFinite(time) && time >= weekStart.getTime() && time < weekEnd.getTime();
    }).length,
    rfisPending: pendingRfis.length,
    rfisLate: pendingRfis.filter(r => isBefore(r.due_date, today)).length,
    oprOpen: openOpr.length,
    oprLate: openOpr.filter(r => isBefore(r.due_date, today)).length,
    gpaOpen: openGpa.length,
    gpaLate: openGpa.filter(r => isBefore(r.due_date, today)).length,
    tasksOpen: openTasks.length,
    tasksLate: openTasks.filter(t => isBefore(t.due_date || t.end_date, today)).length,
  };
}
