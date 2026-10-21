import { describe, it, expect } from 'vitest';
import { computeCopilotSuggestions } from '../copilotSuggestions';
import type { Project, Milestone } from '../../types';

const NOW = new Date('2026-10-21T10:00:00Z');
const day = (offset: number) => new Date(NOW.getTime() + offset * 86400000).toISOString();

const project = (id: string, extra: Partial<Project> = {}) =>
  ({ id, name: `Projet ${id}`, client: 'Client', status: 'Planning', ...extra }) as Project;
const milestone = (id: string, projectId: string, offset: number) =>
  ({ id, project_id: projectId, title: `Jalon ${id}`, due_date: day(offset), completed: false }) as Milestone;

const base = { projects: [] as Project[], milestones: [] as Milestone[], invoices: [], now: NOW };
const types = (list: { type: string }[]) => list.map(s => s.type);

describe('computeCopilotSuggestions', () => {
  it('signale les tâches en retard par projet, sans compter les tâches terminées', () => {
    const list = computeCopilotSuggestions({
      ...base,
      projects: [project('p1')],
      tasks: [
        { id: 't1', project_id: 'p1', title: 'Plans', due_date: day(-3) },
        { id: 't2', project_id: 'p1', title: 'Coupes', end_date: day(-1), status: 'in_progress' },
        { id: 't3', project_id: 'p1', title: 'Faite', due_date: day(-5), status: 'done' },
        { id: 't4', project_id: 'p1', title: 'À 100 %', due_date: day(-5), progress: 100 },
      ],
    });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ type: 'task_overdue', tone: 'danger', params: { project: 'Projet p1', count: 2 } });
  });

  it('regroupe les tâches internes en retard sans projet', () => {
    const list = computeCopilotSuggestions({ ...base, tasks: [{ id: 't1', project_id: null, title: 'Archivage', due_date: day(-2) }] });
    expect(list[0]).toMatchObject({ type: 'task_overdue', params: { project: '', count: 1 } });
  });

  it('ne compte jamais une date absente ou illisible comme un retard', () => {
    const list = computeCopilotSuggestions({
      ...base,
      tasks: [
        { id: 't1', title: 'Sans date' },
        { id: 't2', title: 'Date cassée', due_date: 'pas une date' },
      ],
    });
    expect(list).toEqual([]);
  });

  it('prévient des tâches à échéance proche', () => {
    const list = computeCopilotSuggestions({
      ...base,
      tasks: [
        { id: 't1', title: 'Demain', due_date: day(1) },
        { id: 't2', title: 'Loin', due_date: day(20) },
      ],
    });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ type: 'task_due_soon', params: { count: 1 } });
  });

  it('relance un devis envoyé sans réponse depuis 15 jours ou plus', () => {
    const list = computeCopilotSuggestions({
      ...base,
      proposals: [
        { id: 'a', title: 'Villa', status: 'Sent', created_at: day(-20) },
        { id: 'b', title: 'Récent', status: 'Sent', created_at: day(-5) },
        { id: 'c', title: 'Brouillon', status: 'Draft', created_at: day(-40) },
        { id: 'd', title: 'Accepté', status: 'Accepted', created_at: day(-40) },
      ],
    });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ type: 'proposal_no_answer', params: { title: 'Villa', days: 20 } });
  });

  it('signale un appel d\'offres à remettre sous 7 jours, urgent à 2 jours ou moins', () => {
    const list = computeCopilotSuggestions({
      ...base,
      tenders: [
        { id: 'a', title: 'AO proche', status: 'Draft', submission_deadline: day(1.5) },
        { id: 'b', title: 'AO moyen', status: 'Draft', submission_deadline: day(6) },
        { id: 'c', title: 'AO déposé', status: 'Submitted', submission_deadline: day(1) },
        { id: 'd', title: 'AO archivé', status: 'Draft', submission_deadline: day(1), archived: true },
        { id: 'e', title: 'AO lointain', status: 'Draft', submission_deadline: day(30) },
      ],
    });
    expect(list.map(s => [s.id, s.tone])).toEqual([
      ['tender-deadline-a', 'danger'],
      ['tender-deadline-b', 'warning'],
    ]);
  });

  it('prévient des factures à échéance proche, sans doubler celles déjà en retard', () => {
    const list = computeCopilotSuggestions({
      ...base,
      invoices: [
        { id: '1', invoice_number: 'F-001', status: 'Sent', total_amount: 1000, due_date: day(3) },
        { id: '2', invoice_number: 'F-002', status: 'Sent', total_amount: 500, due_date: day(5) },
        { id: '3', invoice_number: 'F-003', status: 'Paid', total_amount: 900, due_date: day(2) },
        { id: '4', invoice_number: 'F-004', status: 'Overdue', total_amount: 700, due_date: day(-2) },
      ],
    });
    expect(types(list)).toEqual(['invoice_overdue', 'invoice_due_soon']);
    expect(list[1]).toMatchObject({ params: { count: 2, amount: 1500 } });
  });

  it('signale les factures restées en brouillon depuis plus de 7 jours', () => {
    const list = computeCopilotSuggestions({
      ...base,
      invoices: [
        { id: '1', invoice_number: 'F-010', status: 'Draft', total_amount: 300, issue_date: day(-10) },
        { id: '2', invoice_number: 'F-011', status: 'Draft', total_amount: 200, created_at: day(-2) },
      ],
    });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ type: 'invoice_draft_stale', params: { count: 1, amount: 300 } });
  });

  it('laisse une place à chaque type : les jalons ne masquent plus le reste', () => {
    const projects = ['p1', 'p2', 'p3', 'p4', 'p5'].map(id => project(id));
    const list = computeCopilotSuggestions({
      ...base,
      projects,
      milestones: projects.map((p, i) => milestone(`m${i}`, p.id, -2)),
      tasks: [{ id: 't1', project_id: 'p1', title: 'Plans', due_date: day(-1) }],
      proposals: [{ id: 'a', title: 'Villa', status: 'Sent', created_at: day(-30) }],
    });
    expect(types(list)).toEqual(expect.arrayContaining(['overdue_milestone', 'task_overdue', 'proposal_no_answer']));
    expect(list.filter(s => s.type === 'overdue_milestone')).toHaveLength(3);
  });

  it('ne dépasse jamais 8 suggestions', () => {
    const projects = ['p1', 'p2', 'p3', 'p4'].map(id => project(id));
    const list = computeCopilotSuggestions({
      ...base,
      projects,
      milestones: projects.map((p, i) => milestone(`m${i}`, p.id, -2)),
      tasks: projects.map((p, i) => ({ id: `t${i}`, project_id: p.id, title: 'T', due_date: day(-1) })),
      invoices: [1, 2, 3, 4].map(n => ({ id: `${n}`, invoice_number: `F-${n}`, status: 'overdue', total_amount: 100 })),
      proposals: [1, 2, 3, 4].map(n => ({ id: `${n}`, title: `D${n}`, status: 'Sent', created_at: day(-30) })),
      tenders: [1, 2, 3, 4].map(n => ({ id: `${n}`, title: `AO${n}`, status: 'Draft', submission_deadline: day(2) })),
    });
    expect(list).toHaveLength(8);
  });

  it('reste compatible avec un appel sans tâches, devis ni appels d\'offres', () => {
    const list = computeCopilotSuggestions({ ...base, projects: [project('p1')], milestones: [milestone('m1', 'p1', -4)] });
    expect(list).toHaveLength(1);
    expect(list[0].type).toBe('overdue_milestone');
  });
});
