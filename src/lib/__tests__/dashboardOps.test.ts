import { describe, it, expect } from 'vitest';
import { computeOpsKpis, type OpsInput } from '../dashboardOps';

// Mercredi 7 octobre 2026 : la semaine court du lundi 5 au dimanche 11.
const NOW = new Date(2026, 9, 7, 10, 0, 0);

const empty: OpsInput = {
  projects: [], permits: [], rfis: [], meetings: [], milestones: [], reserves: [], gpaReserves: [], tasks: [],
};

const sample: OpsInput = {
  projects: [
    { id: 'a', status: 'In Progress' },
    { id: 'b', status: 'Completed' },
    { id: 'c', status: 'étude' },
  ],
  permits: [
    { project_id: 'a', status: 'en_instruction' },
    { project_id: 'a', status: 'refuse' },
    { project_id: 'c', status: 'accorde' },
  ],
  rfis: [
    { project_id: 'a', status: 'en_attente', due_date: '2026-10-01' },
    { project_id: 'c', status: 'en_attente', due_date: '2026-10-20' },
    { project_id: 'a', status: 'repondu', due_date: '2026-09-01' },
  ],
  meetings: [
    { project_id: 'a', date: '2026-10-06' },
    { project_id: 'c', date: '2026-10-12' },
    { project_id: 'a', date: '2026-09-30' },
  ],
  milestones: [
    { project_id: 'a', due_date: '2026-10-01', completed: false },
    { project_id: 'a', due_date: '2026-10-20', completed: false },
    { project_id: 'a', due_date: '2026-12-31', completed: false },
    { project_id: 'c', due_date: '2026-10-02', completed: true },
  ],
  reserves: [
    { project_id: 'a', status: 'A faire', due_date: '2026-10-01' },
    { project_id: 'a', status: 'Levée', due_date: '2026-09-01' },
    { project_id: 'c', status: 'En cours', due_date: '2026-11-01' },
  ],
  gpaReserves: [{ project_id: 'a', status: 'A faire', due_date: '2026-09-15' }],
  tasks: [
    { project_id: 'a', status: 'todo', due_date: '2026-10-01', end_date: '2026-10-30' },
    { project_id: 'a', status: 'done', due_date: '2026-09-01' },
    { project_id: null, status: 'in_progress', end_date: '2026-09-20' },
  ],
};

describe('computeOpsKpis', () => {
  it('renvoie des zéros sans donnée', () => {
    const k = computeOpsKpis(empty, null, NOW);
    expect(Object.values(k).every(v => v === 0)).toBe(true);
  });

  it('couvre toute l\'agence quand le périmètre est null', () => {
    const k = computeOpsKpis(sample, null, NOW);
    expect(k.totalProjects).toBe(3);
    expect(k.activeProjects).toBe(2);
    expect(k.activePermits).toBe(2);
    expect(k.permitsInInstruction).toBe(1);
    expect(k.rfisPending).toBe(2);
    expect(k.rfisLate).toBe(1);
    expect(k.meetingsThisWeek).toBe(1);
    expect(k.upcomingDeadlines).toBe(2);
    expect(k.lateDeadlines).toBe(1);
    expect(k.oprOpen).toBe(2);
    expect(k.oprLate).toBe(1);
    expect(k.gpaOpen).toBe(1);
    expect(k.gpaLate).toBe(1);
    expect(k.tasksOpen).toBe(2);
    expect(k.tasksLate).toBe(2);
  });

  it('se limite aux affaires de l\'équipe pour un manager', () => {
    const k = computeOpsKpis(sample, new Set(['c']), NOW);
    expect(k.totalProjects).toBe(1);
    expect(k.activePermits).toBe(1);
    expect(k.rfisPending).toBe(1);
    expect(k.rfisLate).toBe(0);
    expect(k.oprOpen).toBe(1);
    expect(k.gpaOpen).toBe(0);
    expect(k.meetingsThisWeek).toBe(0);
  });

  it('exclut les tâches sans affaire d\'un périmètre d\'équipe, pas de l\'agence', () => {
    expect(computeOpsKpis(sample, new Set(['a']), NOW).tasksOpen).toBe(1);
    expect(computeOpsKpis(sample, null, NOW).tasksOpen).toBe(2);
  });

  it('un périmètre vide ne compte rien', () => {
    const k = computeOpsKpis(sample, new Set(), NOW);
    expect(Object.values(k).every(v => v === 0)).toBe(true);
  });

  it('ne tient jamais une date absente ou illisible pour un retard', () => {
    const k = computeOpsKpis(
      { ...empty, rfis: [{ project_id: 'a', status: 'en_attente', due_date: null }, { project_id: 'a', status: 'en_attente', due_date: 'n/a' }] },
      null,
      NOW,
    );
    expect(k.rfisPending).toBe(2);
    expect(k.rfisLate).toBe(0);
  });
});
