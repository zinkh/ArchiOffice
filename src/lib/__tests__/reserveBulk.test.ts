import { describe, expect, it } from 'vitest';
import { dueInDays, listState, setDueDate, setStatus, toggleListValue, type BulkRow } from '../reserveBulk';

const row = (id: string, extra: Partial<BulkRow> = {}): BulkRow => ({ id, status: 'A faire', ...extra });

describe('listState', () => {
  it('distingue toutes, une partie et aucune des réserves', () => {
    const rows = [row('1', { lots: '["PLATRERIE"]' }), row('2', { lots: ['PLATRERIE', 'PEINTURE'] }), row('3')];
    expect(listState(rows.slice(0, 2), 'lots', 'PLATRERIE')).toBe('tous');
    expect(listState(rows, 'lots', 'PLATRERIE')).toBe('certains');
    expect(listState(rows, 'lots', 'CVC')).toBe('aucun');
    expect(listState([], 'lots', 'CVC')).toBe('aucun');
  });
});

describe('toggleListValue', () => {
  it('ajoute la valeur seulement aux réserves qui ne l’ont pas', () => {
    const rows = [row('1', { entreprises: '["Martin"]' }), row('2')];
    const changed = toggleListValue(rows, 'entreprises', 'Martin');
    expect(changed.map(r => r.id)).toEqual(['2']);
    expect(JSON.parse(changed[0].entreprises as string)).toEqual(['Martin']);
  });

  it('retire la valeur de toutes les réserves quand toutes la portent', () => {
    const rows = [row('1', { lots: '["A","B"]' }), row('2', { lots: '["A"]' })];
    const changed = toggleListValue(rows, 'lots', 'A');
    expect(changed.map(r => JSON.parse(r.lots as string))).toEqual([['B'], []]);
  });

  it('ne modifie pas les réserves d’origine', () => {
    const rows = [row('1')];
    toggleListValue(rows, 'lots', 'A');
    expect(rows[0].lots).toBeUndefined();
  });
});

describe('setStatus et setDueDate', () => {
  it('ne rend que les réserves à écrire', () => {
    const rows = [row('1', { status: 'Levée' }), row('2')];
    expect(setStatus(rows, 'Levée').map(r => r.id)).toEqual(['2']);
    expect(setDueDate([row('1', { due_date: '2026-11-14' }), row('2')], '2026-11-14').map(r => r.id)).toEqual(['2']);
  });

  it('reconnaît une échéance déjà posée, même avec une heure', () => {
    const changed = setDueDate([row('1', { due_date: '2026-11-14T00:00:00Z' }), row('2', { due_date: '2026-10-01' })], '2026-11-14');
    expect(changed.map(r => r.id)).toEqual(['2']);
    expect(changed[0].due_date).toBe('2026-11-14');
  });
});

describe('dueInDays', () => {
  it('compte en jours civils, y compris au changement de mois', () => {
    expect(dueInDays(15, new Date(2026, 9, 30))).toBe('2026-11-14');
    expect(dueInDays(0, new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});
