import { describe, it, expect } from 'vitest';
import {
  normalizeProjectStatus,
  statusBreakdown,
  categoryBreakdown,
  monthlyRevenue,
  feesProgressByProject,
  deliveredThisMonth,
  UNCATEGORIZED,
  OTHER_CATEGORIES,
} from '../dashboardMetrics';

describe('normalizeProjectStatus', () => {
  it('reconnaît les statuts anglais du formulaire', () => {
    expect(normalizeProjectStatus('In Progress')).toBe('active');
    expect(normalizeProjectStatus('Planning')).toBe('planning');
    expect(normalizeProjectStatus('On Hold')).toBe('on_hold');
    expect(normalizeProjectStatus('Completed')).toBe('completed');
  });

  it('reconnaît les statuts saisis en français ou importés', () => {
    expect(normalizeProjectStatus('étude')).toBe('active');
    expect(normalizeProjectStatus('En cours (Études)')).toBe('active');
    expect(normalizeProjectStatus('Terminé')).toBe('completed');
    expect(normalizeProjectStatus('En attente')).toBe('on_hold');
  });

  it('ne perd aucun projet : le total du donut vaut le nombre de projets', () => {
    const projects = [{ status: 'Planning' }, { status: 'étude' }, { status: 'En cours (Études)' }, { status: 'Bizarre' }, { status: null }];
    const total = statusBreakdown(projects).reduce((s, d) => s + d.value, 0);
    expect(total).toBe(projects.length);
  });
});

describe('categoryBreakdown', () => {
  it('groupe par catégorie et non par client, « Non renseignée » en dernier', () => {
    const rows = categoryBreakdown([
      { category: 'Logement' }, { category: 'logement ' }, { category: 'Restauration' }, { category: null }, { category: '' },
    ]);
    expect(rows.map(r => [r.name, r.count])).toEqual([['Logement', 2], ['Restauration', 1], [UNCATEGORIZED, 2]]);
    expect(rows[0].pct).toBe(40);
  });

  it('regroupe le reliquat sous « Autres » sans rien perdre', () => {
    const rows = categoryBreakdown(['A', 'A', 'B', 'C', 'D'].map(category => ({ category })), 2);
    expect(rows.map(r => r.name)).toEqual(['A', 'B', OTHER_CATEGORIES]);
    expect(rows.reduce((s, r) => s + r.count, 0)).toBe(5);
  });
});

describe('monthlyRevenue', () => {
  const now = new Date(2026, 8, 25);
  it('répartit facturé et encaissé par mois, sans les brouillons', () => {
    const series = monthlyRevenue([
      { status: 'Paid', total_amount: 1000, issue_date: '2026-09-02' },
      { status: 'Sent', total_amount: 500, issue_date: '2026-09-10' },
      { status: 'Draft', total_amount: 9999, issue_date: '2026-09-10' },
      { status: 'Paid', amount: 200, created_at: '2026-07-15T10:00:00Z' },
      { status: 'Paid', total_amount: 50, issue_date: '2024-01-01' },
    ], now);
    expect(series).toHaveLength(12);
    expect(series[11]).toMatchObject({ key: '2026-09', invoiced: 1500, paid: 1000 });
    expect(series[9]).toMatchObject({ key: '2026-07', invoiced: 200, paid: 200 });
  });
});

describe('feesProgressByProject', () => {
  it('rapporte le facturé aux honoraires, jamais au budget travaux', () => {
    const rows = feesProgressByProject(
      [{ id: 'a', name: 'A', remuneration: 10000 }, { id: 'b', name: 'B', remuneration: 0 }, { id: 'c', name: 'C' }],
      [
        { project_id: 'a', status: 'Paid', total_amount: 2500 },
        { project_id: 'a', status: 'Sent', total_amount: 1500 },
        { project_id: 'b', status: 'Paid', total_amount: 300 },
      ],
    );
    expect(rows).toEqual([
      { id: 'a', name: 'A', fees: 10000, invoiced: 4000, paid: 2500, pct: 40 },
      { id: 'b', name: 'B', fees: 0, invoiced: 300, paid: 300, pct: null },
    ]);
  });
});

describe('deliveredThisMonth', () => {
  it('ne compte que les affaires terminées ce mois-ci', () => {
    const now = new Date(2026, 8, 25);
    expect(deliveredThisMonth([
      { status: 'Completed', date_fin_reelle: '2026-09-03' },
      { status: 'Completed', end_date: '2026-09-30' },
      { status: 'Completed', end_date: '2026-06-30' },
      { status: 'In Progress', end_date: '2026-09-10' },
    ], now)).toBe(2);
  });
});
