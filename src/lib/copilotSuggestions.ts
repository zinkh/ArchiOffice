// Copilot "next steps" suggestion engine — rule-based, no AI call.
//
// This module is intentionally framework-free (no React/DOM) so it can be
// imported both from the frontend bundle (Dashboard.tsx, the global
// AgentChat badge) and from the Express backend (server/routes/copilotSuggestions.ts),
// which computes the same suggestions for pages other than the Dashboard.
//
// computeCopilotSuggestions() returns raw descriptors (type + params) rather
// than final text, so the i18n formatting stays entirely on the client via
// formatCopilotSuggestion() — the server never needs a translation layer.
import type { Project, Milestone } from '../types';

const MAX_SUGGESTIONS = 8;
// Plafond par type de suggestion : sans lui, un type très bavard (une carte par
// affaire en retard de jalons) occupait toute la liste et masquait les autres.
const MAX_PER_TYPE = 3;
const BEHIND_SCHEDULE_WINDOW_DAYS = 14;
const BEHIND_SCHEDULE_PROGRESS_THRESHOLD = 80;
const TASK_DUE_SOON_DAYS = 3;
const PROPOSAL_NO_ANSWER_DAYS = 15;
const TENDER_DEADLINE_WINDOW_DAYS = 7;
const TENDER_DEADLINE_URGENT_DAYS = 2;
const INVOICE_DUE_SOON_DAYS = 7;
const DRAFT_INVOICE_STALE_DAYS = 7;
const MAX_TITLES = 3;
const DAY_MS = 86400000;

// `status` is typed loosely (not the `Invoice` interface's capitalized enum)
// because rows fetched straight from Supabase have been observed with both
// casings ("overdue" and "Overdue") — same tolerance the original Dashboard
// rule (pre-extraction) applied.
export interface CopilotInvoiceInput {
  id: string;
  invoice_number: string;
  project_name?: string | null;
  client?: string | null;
  status: string;
  total_amount?: number;
  amount?: number;
  due_date?: string | null;
  issue_date?: string | null;
  created_at?: string | null;
}

export interface CopilotTaskInput {
  id: string;
  project_id?: string | null;
  title: string;
  status?: string | null;
  progress?: number | null;
  due_date?: string | null;
  end_date?: string | null;
}

export interface CopilotProposalInput {
  id: string;
  title: string;
  reference?: string | null;
  client_name?: string | null;
  nom_societe?: string | null;
  status?: string | null;
  created_at?: string | null;
}

export interface CopilotTenderInput {
  id: string;
  title: string;
  client?: string | null;
  status?: string | null;
  submission_deadline?: string | null;
  archived?: boolean | null;
}

export type CopilotSuggestionRaw =
  | { id: string; tone: 'danger'; type: 'overdue_milestone'; params: { project: string; client: string; count: number; titles: string } }
  | { id: string; tone: 'warning'; type: 'project_behind'; params: { project: string; client: string; progress: number; days: number } }
  | { id: string; tone: 'danger'; type: 'invoice_overdue'; params: { number: string; client: string; amount: number } }
  | { id: string; tone: 'danger'; type: 'task_overdue'; params: { project: string; count: number; titles: string } }
  | { id: string; tone: 'warning'; type: 'task_due_soon'; params: { count: number; titles: string } }
  | { id: string; tone: 'warning'; type: 'proposal_no_answer'; params: { title: string; client: string; days: number } }
  | { id: string; tone: 'danger' | 'warning'; type: 'tender_deadline'; params: { title: string; client: string; days: number } }
  | { id: string; tone: 'warning'; type: 'invoice_due_soon'; params: { count: number; amount: number; numbers: string } }
  | { id: string; tone: 'warning'; type: 'invoice_draft_stale'; params: { count: number; amount: number; numbers: string } };

export interface CopilotSuggestion {
  id: string;
  tone: 'danger' | 'warning';
  text: string;
  draft: string;
}

const strip = (v: string | null | undefined) =>
  (v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// Une date absente ou illisible n'est jamais comptée comme un retard.
function parseDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

const daysBetween = (from: Date, to: Date) => Math.floor((to.getTime() - from.getTime()) / DAY_MS);
const invoiceAmount = (inv: CopilotInvoiceInput) => inv.total_amount || inv.amount || 0;
const joinTitles = (titles: string[]) => {
  const shown = titles.slice(0, MAX_TITLES).join(', ');
  return titles.length > MAX_TITLES ? `${shown}…` : shown;
};

function overdueMilestones(projects: Project[], milestones: Milestone[], now: Date): CopilotSuggestionRaw[] {
  const byProject = new Map<string, Milestone[]>();
  milestones
    .filter(m => !m.completed && m.project_id && new Date(m.due_date) < now)
    .forEach(m => {
      const arr = byProject.get(m.project_id!) || [];
      arr.push(m);
      byProject.set(m.project_id!, arr);
    });
  const list: CopilotSuggestionRaw[] = [];
  for (const [projectId, ms] of byProject) {
    const project = projects.find(p => p.id === projectId);
    if (!project) continue;
    list.push({
      id: `overdue-milestone-${projectId}`,
      tone: 'danger',
      type: 'overdue_milestone',
      params: { project: project.name, client: project.client, count: ms.length, titles: ms.map(m => m.title).join(', ') },
    });
  }
  // Les affaires les plus en retard d'abord.
  return list.sort((a, b) => (b.params as { count: number }).count - (a.params as { count: number }).count);
}

function projectsBehind(projects: Project[], now: Date): CopilotSuggestionRaw[] {
  const list: CopilotSuggestionRaw[] = [];
  projects
    .filter(p => p.status === 'In Progress' && p.end_date)
    .forEach(p => {
      const daysLeft = Math.ceil((new Date(p.end_date).getTime() - now.getTime()) / DAY_MS);
      if (daysLeft >= 0 && daysLeft <= BEHIND_SCHEDULE_WINDOW_DAYS && (p.progression || 0) < BEHIND_SCHEDULE_PROGRESS_THRESHOLD) {
        list.push({
          id: `behind-schedule-${p.id}`,
          tone: 'warning',
          type: 'project_behind',
          params: { project: p.name, client: p.client, progress: p.progression || 0, days: daysLeft },
        });
      }
    });
  return list;
}

function overdueInvoices(invoices: CopilotInvoiceInput[]): CopilotSuggestionRaw[] {
  return invoices
    .filter(inv => strip(inv.status) === 'overdue')
    .map(inv => ({
      id: `overdue-invoice-${inv.id}`,
      tone: 'danger' as const,
      type: 'invoice_overdue' as const,
      params: { number: inv.invoice_number, client: inv.project_name || inv.client || '', amount: invoiceAmount(inv) },
    }));
}

// Une tâche est ouverte tant qu'elle n'est ni « done » ni à 100 % (même règle
// que getTaskStatus, src/components/tasks/taskDisplay.ts).
const isOpenTask = (t: CopilotTaskInput) => strip(t.status) !== 'done' && (t.progress ?? 0) < 100;
const taskDeadline = (t: CopilotTaskInput) => parseDate(t.due_date || t.end_date);

function overdueTasks(projects: Project[], tasks: CopilotTaskInput[], now: Date): CopilotSuggestionRaw[] {
  const byProject = new Map<string, CopilotTaskInput[]>();
  tasks.filter(isOpenTask).forEach(t => {
    const d = taskDeadline(t);
    if (!d || d >= now) return;
    const key = t.project_id || '';
    const arr = byProject.get(key) || [];
    arr.push(t);
    byProject.set(key, arr);
  });
  const list: CopilotSuggestionRaw[] = [];
  for (const [projectId, ts] of byProject) {
    const project = projects.find(p => p.id === projectId);
    list.push({
      id: `overdue-task-${projectId || 'none'}`,
      tone: 'danger',
      type: 'task_overdue',
      // Une tâche interne, sans affaire, reste signalée avec un nom vide
      // (le texte i18n sait l'afficher).
      params: { project: project?.name || '', count: ts.length, titles: joinTitles(ts.map(t => t.title)) },
    });
  }
  return list.sort((a, b) => (b.params as { count: number }).count - (a.params as { count: number }).count);
}

function tasksDueSoon(tasks: CopilotTaskInput[], now: Date): CopilotSuggestionRaw[] {
  const soon = tasks.filter(t => {
    if (!isOpenTask(t)) return false;
    const d = taskDeadline(t);
    if (!d) return false;
    const days = (d.getTime() - now.getTime()) / DAY_MS;
    return days >= 0 && days <= TASK_DUE_SOON_DAYS;
  });
  if (soon.length === 0) return [];
  return [{
    id: 'tasks-due-soon',
    tone: 'warning',
    type: 'task_due_soon',
    params: { count: soon.length, titles: joinTitles(soon.map(t => t.title)) },
  }];
}

function proposalsWithoutAnswer(proposals: CopilotProposalInput[], now: Date): CopilotSuggestionRaw[] {
  const list: CopilotSuggestionRaw[] = [];
  proposals
    .filter(p => strip(p.status) === 'sent')
    .forEach(p => {
      const created = parseDate(p.created_at);
      if (!created) return;
      const days = daysBetween(created, now);
      if (days < PROPOSAL_NO_ANSWER_DAYS) return;
      list.push({
        id: `proposal-no-answer-${p.id}`,
        tone: 'warning',
        type: 'proposal_no_answer',
        params: { title: p.reference || p.title, client: p.nom_societe || p.client_name || '', days },
      });
    });
  // Les devis les plus anciens d'abord.
  return list.sort((a, b) => (b.params as { days: number }).days - (a.params as { days: number }).days);
}

function tendersClosingSoon(tenders: CopilotTenderInput[], now: Date): CopilotSuggestionRaw[] {
  const list: CopilotSuggestionRaw[] = [];
  tenders
    .filter(t => !t.archived && !['submitted', 'won', 'lost'].includes(strip(t.status)))
    .forEach(t => {
      const deadline = parseDate(t.submission_deadline);
      if (!deadline) return;
      const days = Math.ceil((deadline.getTime() - now.getTime()) / DAY_MS);
      if (days < 0 || days > TENDER_DEADLINE_WINDOW_DAYS) return;
      list.push({
        id: `tender-deadline-${t.id}`,
        tone: days <= TENDER_DEADLINE_URGENT_DAYS ? 'danger' : 'warning',
        type: 'tender_deadline',
        params: { title: t.title, client: t.client || '', days },
      });
    });
  return list.sort((a, b) => (a.params as { days: number }).days - (b.params as { days: number }).days);
}

function invoicesDueSoon(invoices: CopilotInvoiceInput[], now: Date): CopilotSuggestionRaw[] {
  const soon = invoices.filter(inv => {
    const status = strip(inv.status);
    // Émise et pas encore réglée ; une facture déjà « overdue » a sa propre règle.
    if (!status || status === 'draft' || status === 'paid' || status === 'overdue') return false;
    const d = parseDate(inv.due_date);
    if (!d) return false;
    const days = (d.getTime() - now.getTime()) / DAY_MS;
    return days >= 0 && days <= INVOICE_DUE_SOON_DAYS;
  });
  if (soon.length === 0) return [];
  return [{
    id: 'invoices-due-soon',
    tone: 'warning',
    type: 'invoice_due_soon',
    params: {
      count: soon.length,
      amount: soon.reduce((sum, inv) => sum + invoiceAmount(inv), 0),
      numbers: joinTitles(soon.map(inv => inv.invoice_number)),
    },
  }];
}

function staleDraftInvoices(invoices: CopilotInvoiceInput[], now: Date): CopilotSuggestionRaw[] {
  const stale = invoices.filter(inv => {
    if (strip(inv.status) !== 'draft') return false;
    const created = parseDate(inv.issue_date || inv.created_at);
    return !!created && daysBetween(created, now) >= DRAFT_INVOICE_STALE_DAYS;
  });
  if (stale.length === 0) return [];
  return [{
    id: 'invoices-draft-stale',
    tone: 'warning',
    type: 'invoice_draft_stale',
    params: {
      count: stale.length,
      amount: stale.reduce((sum, inv) => sum + invoiceAmount(inv), 0),
      numbers: joinTitles(stale.map(inv => inv.invoice_number || '—')),
    },
  }];
}

// Ordre de priorité des règles : ce qui est déjà en retard, puis l'imminent,
// puis les relances commerciales.
export function computeCopilotSuggestions(input: {
  projects: Project[];
  milestones: Milestone[];
  invoices: CopilotInvoiceInput[];
  tasks?: CopilotTaskInput[];
  proposals?: CopilotProposalInput[];
  tenders?: CopilotTenderInput[];
  now?: Date;
}): CopilotSuggestionRaw[] {
  const { projects, milestones, invoices, tasks = [], proposals = [], tenders = [] } = input;
  const now = input.now ?? new Date();

  const groups: CopilotSuggestionRaw[][] = [
    overdueInvoices(invoices),
    overdueTasks(projects, tasks, now),
    overdueMilestones(projects, milestones, now),
    tendersClosingSoon(tenders, now),
    tasksDueSoon(tasks, now),
    projectsBehind(projects, now),
    invoicesDueSoon(invoices, now),
    proposalsWithoutAnswer(proposals, now),
    staleDraftInvoices(invoices, now),
  ].map(g => g.slice(0, MAX_PER_TYPE));

  // Tour de rôle entre les règles : chacune a sa place avant qu'une seule
  // ne prenne la deuxième.
  const list: CopilotSuggestionRaw[] = [];
  for (let round = 0; round < MAX_PER_TYPE && list.length < MAX_SUGGESTIONS; round++) {
    for (const g of groups) {
      if (g[round] && list.length < MAX_SUGGESTIONS) list.push(g[round]);
    }
  }
  return list;
}

const formatEur = (n: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);

export function formatCopilotSuggestion(
  raw: CopilotSuggestionRaw,
  t: (key: string, params?: Record<string, unknown>) => string
): CopilotSuggestion {
  switch (raw.type) {
    case 'overdue_milestone':
      return {
        id: raw.id,
        tone: raw.tone,
        text: t('ai_suggestion_overdue_milestone', { count: raw.params.count, project: raw.params.project }),
        draft: t('ai_draft_overdue_milestone', { project: raw.params.project, client: raw.params.client, titles: raw.params.titles }),
      };
    case 'project_behind':
      return {
        id: raw.id,
        tone: raw.tone,
        text: t('ai_suggestion_project_behind', { project: raw.params.project, progress: raw.params.progress, days: raw.params.days }),
        draft: t('ai_draft_project_behind', { project: raw.params.project, client: raw.params.client, progress: raw.params.progress, days: raw.params.days }),
      };
    case 'invoice_overdue':
      return {
        id: raw.id,
        tone: raw.tone,
        text: t('ai_suggestion_invoice_overdue', { number: raw.params.number, client: raw.params.client }),
        draft: t('ai_draft_invoice_overdue', { number: raw.params.number, client: raw.params.client, amount: formatEur(raw.params.amount) }),
      };
    case 'task_overdue':
      return {
        id: raw.id,
        tone: raw.tone,
        text: raw.params.project
          ? t('ai_suggestion_task_overdue', { count: raw.params.count, project: raw.params.project })
          : t('ai_suggestion_task_overdue_no_project', { count: raw.params.count }),
        draft: t('ai_draft_task_overdue', { count: raw.params.count, titles: raw.params.titles, project: raw.params.project || t('ai_no_project') }),
      };
    case 'task_due_soon':
      return {
        id: raw.id,
        tone: raw.tone,
        text: t('ai_suggestion_task_due_soon', { count: raw.params.count, days: TASK_DUE_SOON_DAYS }),
        draft: t('ai_draft_task_due_soon', { count: raw.params.count, titles: raw.params.titles, days: TASK_DUE_SOON_DAYS }),
      };
    case 'proposal_no_answer':
      return {
        id: raw.id,
        tone: raw.tone,
        text: t('ai_suggestion_proposal_no_answer', { title: raw.params.title, days: raw.params.days }),
        draft: t('ai_draft_proposal_no_answer', { title: raw.params.title, client: raw.params.client || t('ai_the_client'), days: raw.params.days }),
      };
    case 'tender_deadline':
      return {
        id: raw.id,
        tone: raw.tone,
        text: t('ai_suggestion_tender_deadline', { title: raw.params.title, days: raw.params.days }),
        draft: t('ai_draft_tender_deadline', { title: raw.params.title, client: raw.params.client || t('ai_the_client'), days: raw.params.days }),
      };
    case 'invoice_due_soon':
      return {
        id: raw.id,
        tone: raw.tone,
        text: t('ai_suggestion_invoice_due_soon', { count: raw.params.count, days: INVOICE_DUE_SOON_DAYS }),
        draft: t('ai_draft_invoice_due_soon', { count: raw.params.count, numbers: raw.params.numbers, amount: formatEur(raw.params.amount), days: INVOICE_DUE_SOON_DAYS }),
      };
    case 'invoice_draft_stale':
      return {
        id: raw.id,
        tone: raw.tone,
        text: t('ai_suggestion_invoice_draft_stale', { count: raw.params.count, days: DRAFT_INVOICE_STALE_DAYS }),
        draft: t('ai_draft_invoice_draft_stale', { count: raw.params.count, numbers: raw.params.numbers, amount: formatEur(raw.params.amount) }),
      };
  }
}
