import { describe, it, expect } from 'vitest';
import { milestonesForInsert } from '../server/routes/tenders';

describe('milestonesForInsert', () => {
  it('garde durée, dépendance et identifiant d’un jalon déjà rattaché à l’appel d’offres', () => {
    const rows = milestonesForInsert(
      [{ id: 'a', title: 'Visite', due_date: '2026-03-01', duration_days: 3 }, { id: 'b', title: 'Remise', due_date: '2026-03-10', dependencies: ['a'] }],
      't1', new Set(['a', 'b']),
    );
    expect(rows[0]).toMatchObject({ id: 'a', tender_id: 't1', duration_days: 3, dependencies: [] });
    expect(rows[1]).toMatchObject({ id: 'b', duration_days: null, dependencies: ['a'] });
  });
  it('n’adopte pas un identifiant étranger mais réécrit la dépendance vers le nouvel identifiant', () => {
    const rows = milestonesForInsert([{ id: 'x', title: 'A', due_date: '2026-03-01' }, { id: 'y', title: 'B', due_date: '2026-03-02', dependencies: ['x'] }], 't1');
    expect(rows[0].id).not.toBe('x');
    expect(rows[1].dependencies).toEqual([rows[0].id]);
  });
  it('ignore une dépendance vers un jalon absent de la liste', () => {
    const rows = milestonesForInsert([{ id: 'a', title: 'A', due_date: '2026-03-01', dependencies: ['zzz'] }], 't1', new Set(['a']));
    expect(rows[0].dependencies).toEqual([]);
  });
});
