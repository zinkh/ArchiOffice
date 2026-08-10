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

const MAX_SUGGESTIONS = 5;
const BEHIND_SCHEDULE_WINDOW_DAYS = 14;
const BEHIND_SCHEDULE_PROGRESS_THRESHOLD = 80;
const MAX_OVERDUE_INVOICES = 3;

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
}

export type CopilotSuggestionRaw =
  | { id: string; tone: 'danger'; type: 'overdue_milestone'; params: { project: string; client: string; count: number; titles: string } }
  | { id: string; tone: 'warning'; type: 'project_behind'; params: { project: string; client: string; progress: number; days: number } }
  | { id: string; tone: 'danger'; type: 'invoice_overdue'; params: { number: string; client: string; amount: number } };

export interface CopilotSuggestion {
  id: string;
  tone: 'danger' | 'warning';
  text: string;
  draft: string;
}

export function computeCopilotSuggestions(input: {
  projects: Project[];
  milestones: Milestone[];
  invoices: CopilotInvoiceInput[];
}): CopilotSuggestionRaw[] {
  const { projects, milestones, invoices } = input;
  const list: CopilotSuggestionRaw[] = [];
  const now = new Date();

  const overdueMilestonesByProject = new Map<string, Milestone[]>();
  milestones
    .filter(m => !m.completed && m.project_id && new Date(m.due_date) < now)
    .forEach(m => {
      const arr = overdueMilestonesByProject.get(m.project_id!) || [];
      arr.push(m);
      overdueMilestonesByProject.set(m.project_id!, arr);
    });
  for (const [projectId, ms] of overdueMilestonesByProject) {
    const project = projects.find(p => p.id === projectId);
    if (!project) continue;
    list.push({
      id: `overdue-milestone-${projectId}`,
      tone: 'danger',
      type: 'overdue_milestone',
      params: { project: project.name, client: project.client, count: ms.length, titles: ms.map(m => m.title).join(', ') },
    });
  }

  projects
    .filter(p => p.status === 'In Progress' && p.end_date)
    .forEach(p => {
      const daysLeft = Math.ceil((new Date(p.end_date).getTime() - now.getTime()) / 86400000);
      if (daysLeft >= 0 && daysLeft <= BEHIND_SCHEDULE_WINDOW_DAYS && (p.progression || 0) < BEHIND_SCHEDULE_PROGRESS_THRESHOLD) {
        list.push({
          id: `behind-schedule-${p.id}`,
          tone: 'warning',
          type: 'project_behind',
          params: { project: p.name, client: p.client, progress: p.progression || 0, days: daysLeft },
        });
      }
    });

  invoices
    .filter(inv => inv.status === 'overdue' || inv.status === 'Overdue')
    .slice(0, MAX_OVERDUE_INVOICES)
    .forEach(inv => {
      list.push({
        id: `overdue-invoice-${inv.id}`,
        tone: 'danger',
        type: 'invoice_overdue',
        params: {
          number: inv.invoice_number,
          client: inv.project_name || inv.client || '',
          amount: inv.total_amount || inv.amount || 0,
        },
      });
    });

  return list.slice(0, MAX_SUGGESTIONS);
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
  }
}
