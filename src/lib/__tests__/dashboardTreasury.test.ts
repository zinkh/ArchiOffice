import { describe, it, expect } from 'vitest';
import { computeTreasury } from '../dashboardTreasury';

const NOW = new Date(2026, 9, 7);
const invoices = [
  { status: 'Draft', total_amount: 5000, issue_date: '2026-10-02' },
  { status: 'Paid', total_amount: 1000, issue_date: '2026-10-01' },
  { status: 'Paid', total_amount: 400, issue_date: '2026-08-10' },
  { status: 'Sent', total_amount: 300, issue_date: '2026-09-20' },
  { status: 'Overdue', total_amount: 200, issue_date: '2026-07-01' },
];

describe('computeTreasury', () => {
  it('ignore les brouillons et sépare encaissé, à encaisser et retard', () => {
    const t = computeTreasury(invoices, NOW);
    expect(t.paid).toBe(1400);
    expect(t.receivable).toBe(500);
    expect(t.unpaidCount).toBe(2);
    expect(t.overdueCount).toBe(1);
    expect(t.overdueAmount).toBe(200);
  });

  it('encaissé du mois : seulement le mois courant', () => {
    expect(computeTreasury(invoices, NOW).paidThisMonth).toBe(1000);
  });

  it('sans facture, tout vaut zéro', () => {
    expect(Object.values(computeTreasury([], NOW)).every(v => v === 0)).toBe(true);
  });
});
