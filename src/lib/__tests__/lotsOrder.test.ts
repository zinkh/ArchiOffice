import { describe, it, expect } from 'vitest';
import { appliquerOrdreLots, numeroDeLot } from '../lotsOrder';

const doc = (): { lots: any[] } => ({
  lots: [
    { id: 'a', numero: '01', titre: 'Gros œuvre', projectLotId: 'p1', chapitres: [
      { numero: '01.1', lignes: [{ numero: '01.1.1', children: [{ numero: '01.1.1.1' }] }, { numero: 'CODE-BIB' }] },
    ] },
    { id: 'b', numero: '02', titre: 'Électricité', chapitres: [{ numero: '02.1', lignes: [{ numero: '02.1.1' }] }] },
    { id: 'c', numero: '09', titre: 'Divers', chapitres: [] },
  ],
});
const projet = [
  { id: 'p2', lot_number: '01', lot_title: 'electricite' },
  { id: 'p1', lot_number: '02', lot_title: 'Gros œuvre' },
];

describe('lotsOrder', () => {
  it('numérote sur deux chiffres', () => {
    expect(numeroDeLot(0)).toBe('01');
    expect(numeroDeLot(11)).toBe('12');
  });
  it('réordonne, renumérote en cascade et rattache par intitulé', () => {
    const r = appliquerOrdreLots(doc(), projet);
    expect(r.lots.map(l => l.id)).toEqual(['b', 'a', 'c']);
    expect(r.lots[0].numero).toBe('01');
    expect(r.lots[0].projectLotId).toBe('p2');
    expect(r.lots[0].chapitres![0].numero).toBe('01.1');
    expect(r.lots[0].chapitres![0].lignes![0].numero).toBe('01.1.1');
    const gros = r.lots[1];
    expect(gros.numero).toBe('02');
    expect(gros.chapitres![0].numero).toBe('02.1');
    expect(gros.chapitres![0].lignes![0].numero).toBe('02.1.1');
    expect(gros.chapitres![0].lignes![0].children![0].numero).toBe('02.1.1.1');
    expect(gros.chapitres![0].lignes![1].numero).toBe('CODE-BIB');
    expect(r.lots[2].numero).toBe('09');
  });
});
