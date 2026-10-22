import { describe, it, expect } from 'vitest';
import { computeCopilotSuggestions } from '../copilotSuggestions';
import type { Project, Milestone } from '../../types';

const NOW = new Date('2026-10-21T10:00:00Z');
const day = (offset: number) => new Date(NOW.getTime() + offset * 86400000).toISOString();

const COMPLETE = { address: 'a', start_date: '2026-01-01', end_date: '2027-01-01', project_code: 'c', project_manager: 'm', surface: 1, construction_cost: 1 };
const project = (id: string, extra: Partial<Project> = {}) =>
  ({ id, name: `Projet ${id}`, client: 'Client', status: 'Planning', ...COMPLETE, ...extra }) as Project;
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
        { id: 't1', assignee_id: 'u', project_id: 'p1', title: 'Plans', due_date: day(-3) },
        { id: 't2', assignee_id: 'u', project_id: 'p1', title: 'Coupes', end_date: day(-1), status: 'in_progress' },
        { id: 't3', assignee_id: 'u', project_id: 'p1', title: 'Faite', due_date: day(-5), status: 'done' },
        { id: 't4', assignee_id: 'u', project_id: 'p1', title: 'À 100 %', due_date: day(-5), progress: 100 },
      ],
    });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ type: 'task_overdue', tone: 'danger', params: { project: 'Projet p1', count: 2 } });
  });

  it('regroupe les tâches internes en retard sans projet', () => {
    const list = computeCopilotSuggestions({ ...base, tasks: [{ id: 't1', assignee_id: 'u', project_id: null, title: 'Archivage', due_date: day(-2) }] });
    expect(list[0]).toMatchObject({ type: 'task_overdue', params: { project: '', count: 1 } });
  });

  it('ne compte jamais une date absente ou illisible comme un retard', () => {
    const list = computeCopilotSuggestions({
      ...base,
      tasks: [
        { id: 't1', assignee_id: 'u', title: 'Sans date' },
        { id: 't2', assignee_id: 'u', title: 'Date cassée', due_date: 'pas une date' },
      ],
    });
    expect(list).toEqual([]);
  });

  it('prévient des tâches à échéance proche', () => {
    const list = computeCopilotSuggestions({
      ...base,
      tasks: [
        { id: 't1', assignee_id: 'u', title: 'Demain', due_date: day(1) },
        { id: 't2', assignee_id: 'u', title: 'Loin', due_date: day(20) },
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
      tasks: [{ id: 't1', assignee_id: 'u', project_id: 'p1', title: 'Plans', due_date: day(-1) }],
      proposals: [{ id: 'a', title: 'Villa', status: 'Sent', created_at: day(-30) }],
    });
    expect(types(list)).toEqual(expect.arrayContaining(['overdue_milestone', 'task_overdue', 'proposal_no_answer']));
    expect(list.filter(s => s.type === 'overdue_milestone')).toHaveLength(3);
  });

  it('ne dépasse jamais 10 suggestions', () => {
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
    expect(list).toHaveLength(10);
  });

  it('propose de compléter une fiche d\'affaire en cours, pas une affaire terminée', () => {
    const full = {};
    const list = computeCopilotSuggestions({
      ...base,
      projects: [
        project('p1', { ...full, address: '', surface: 0 }),
        project('p2', full),
        project('p3', { status: 'Completed', address: '' }),
      ],
    });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ type: 'project_incomplete', params: { project: 'Projet p1', fields: ['address', 'surface'] } });
  });

  it('signale une réunion passée sans compte rendu', () => {
    const list = computeCopilotSuggestions({
      ...base,
      meetings: [
        { id: 'a', title: 'OPR', date: day(-5), notes: '' },
        { id: 'b', title: 'Rédigée', date: day(-5), notes: 'ok' },
        { id: 'c', title: 'Hier', date: day(-1), notes: '' },
      ],
    });
    expect(list.map(s => s.id)).toEqual(['meeting-no-minutes-a']);
  });

  it('signale les réserves dont l\'échéance est dépassée, par projet', () => {
    const list = computeCopilotSuggestions({
      ...base,
      projects: [project('p1')],
      reserves: [
        { id: '1', project_id: 'p1', status: 'Ouverte', due_date: day(-3) },
        { id: '2', project_id: 'p1', status: 'Levée', due_date: day(-3) },
        { id: '3', project_id: 'p1', status: 'Ouverte', due_date: day(5) },
        { id: '4', project_id: 'p1', status: 'Ouverte' },
      ],
    });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ type: 'reserves_open', params: { count: 1 } });
  });

  it('signale un contrat signé non facturé, sauf si une note ou facture existe', () => {
    const contracts = [
      { id: 'c1', project_id: 'p1', status: 'Signé', numero: 'C1', date_debut: day(-60) },
      { id: 'c2', project_id: 'p2', status: 'Signé', numero: 'C2', date_debut: day(-60) },
      { id: 'c3', project_id: 'p3', status: 'Brouillon', numero: 'C3', date_debut: day(-60) },
    ];
    const list = computeCopilotSuggestions({ ...base, contracts, feeNotes: [{ project_id: 'p2', contrat_id: 'c2' }] });
    expect(list.map(s => s.id)).toEqual(['contract-not-invoiced-c1']);
  });

  it('se tait sur les contrats et les lots tant que ces données ne sont pas lues', () => {
    const list = computeCopilotSuggestions({ ...base, projects: [project('p1', { status: 'In Progress' })] });
    expect(types(list)).toEqual([]);
    const withData = computeCopilotSuggestions({
      ...base,
      projects: [project('p1', { status: 'In Progress' })],
      contracts: [],
      lots: [{ project_id: 'p1', contact_id: null }, { project_id: 'p1', contact_id: 'x' }],
    });
    expect(types(withData).sort()).toEqual(['lots_without_company', 'project_no_contract']);
  });

  it('signale les tâches sans responsable', () => {
    const list = computeCopilotSuggestions({
      ...base,
      tasks: [{ id: 't1', title: 'A' }, { id: 't2', title: 'B', assignee_id: 'u1' }, { id: 't3', title: 'C', status: 'done' }],
    });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ type: 'task_unassigned', params: { count: 1 } });
  });

  it('signale un permis dont le délai d\'instruction expire, ou vient d\'expirer', () => {
    const list = computeCopilotSuggestions({
      ...base,
      permits: [
        { id: 'a', type: 'DP', status: 'en_instruction', submission_date: '2026-09-22', reference: 'DP1' },
        { id: 'b', type: 'PC', status: 'en_instruction', submission_date: '2026-10-01', reference: 'PC2' },
        { id: 'c', type: 'DP', status: 'accorde', submission_date: '2026-09-25', reference: 'DP3' },
      ],
    });
    expect(list.map(s => s.id)).toEqual(['permit-deadline-a']);
    expect(list[0].tone).toBe('danger');
  });

  it('place le rouge avant l\'orange', () => {
    const list = computeCopilotSuggestions({
      ...base,
      tasks: [{ id: 't1', assignee_id: 'u', title: 'A', due_date: day(-1) }],
      proposals: [{ id: 'a', title: 'V', status: 'Sent', created_at: day(-30) }],
    });
    expect(list.map(s => s.tone)).toEqual(['danger', 'warning']);
  });

  it('signale les entreprises titulaires d\'un lot sans coordonnées ou sans SIRET valide', () => {
    const lots = [{ project_id: 'p1', contact_id: 'c1' }, { project_id: 'p1', contact_id: 'c2' }, { project_id: 'p1', contact_id: null }];
    const contacts = [
      { id: 'c1', company_name: 'Dupont SARL', siret: '12345678901234', email: 'a@b.fr' },
      { id: 'c2', company_name: 'Martin SAS', siret: '123' },
      { id: 'c3', company_name: 'Hors lot' },
    ];
    const list = computeCopilotSuggestions({ ...base, lots, contacts });
    expect(list.map(s => s.type).sort()).toEqual(['company_no_contact', 'company_no_siret']);
    expect(list.find(s => s.type === 'company_no_contact')).toMatchObject({ params: { count: 1, names: 'Martin SAS' } });
  });

  it('signale les OS sans accusé, les situations à vérifier et les observations en retard', () => {
    const list = computeCopilotSuggestions({
      ...base,
      projects: [project('p1')],
      orders: [
        { id: 'o1', project_id: 'p1', status: 'submitted', date: day(-10) },
        { id: 'o2', project_id: 'p1', status: 'approved', date: day(-10) },
        { id: 'o3', project_id: 'p1', status: 'submitted', date: day(-2) },
      ],
      situations: [
        { id: 's1', project_id: 'p1', etat: 'Brouillon', date_situation: day(-12) },
        { id: 's2', project_id: 'p1', etat: 'Validée', date_situation: day(-30) },
      ],
      observations: [
        { id: 'b1', project_id: 'p1', statut: 'À faire', due_date: day(-1) },
        { id: 'b2', project_id: 'p1', statut: 'Levée', due_date: day(-9) },
      ],
    });
    expect(list.map(s => s.type).sort()).toEqual(['observations_overdue', 'os_unacknowledged', 'situation_to_verify']);
    expect(list.find(s => s.type === 'os_unacknowledged')).toMatchObject({ params: { count: 1 } });
  });

  it('signale une qualification expirée ou proche, jamais l\'absence de qualification', () => {
    const lots = [{ project_id: 'p1', contact_id: 'c1' }, { project_id: 'p1', contact_id: 'c2' }, { project_id: 'p1', contact_id: 'c3' }];
    const contacts = [{ id: 'c1', company_name: 'A' }, { id: 'c2', company_name: 'B' }, { id: 'c3', company_name: 'C' }];
    const qualifications = [
      { id: 'q1', contact_id: 'c1', organisme: 'qualibat', date_fin: '2026-10-01' },
      { id: 'q2', contact_id: 'c2', organisme: 'qualibat', date_fin: '2028-01-01' },
    ] as any;
    const list = computeCopilotSuggestions({ ...base, lots, contacts, qualifications }).filter(s => s.type === 'qualification_expiring');
    expect(list.map(s => s.id)).toEqual(['qualification-expiring-c1']);
    expect(list[0].tone).toBe('danger');
  });

  it('signale une charge excessive au-delà de 15 tâches ouvertes', () => {
    const many = Array.from({ length: 16 }, (_, i) => ({ id: `t${i}`, title: 'T', assignee_id: 'u1' }));
    const list = computeCopilotSuggestions({ ...base, tasks: many, people: [{ id: 'u1', name: 'Sophie' }] });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ type: 'workload', params: { name: 'Sophie', count: 16 } });
  });

  it('reste compatible avec un appel sans tâches, devis ni appels d\'offres', () => {
    const list = computeCopilotSuggestions({ ...base, projects: [project('p1')], milestones: [milestone('m1', 'p1', -4)] });
    expect(list).toHaveLength(1);
    expect(list[0].type).toBe('overdue_milestone');
  });
});
