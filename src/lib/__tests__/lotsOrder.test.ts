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
    // « Divers » est vide et absent du projet : il disparaît.
    expect(r.lots.map(l => l.id)).toEqual(['b', 'a']);
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
  });
  it('crée les lots du projet absents, rapproche les intitulés proches, garde un lot hors projet qui a du contenu', () => {
    const d = { lots: [
      { id: 'x', numero: '01', titre: 'GROS-OEUVRE - VRD - ESPACES VERTS', chapitres: [{ numero: '01.1', lignes: [{ numero: '01.1.1' }] }] },
      { id: 'y', numero: '02', titre: 'CHARPENTE BOIS', chapitres: [] },
      { id: 'z', numero: '05', titre: 'MENUISERIES INTERIEURES', chapitres: [] },
      { id: 'w', numero: '06', titre: 'PEINTURE', chapitres: [{ numero: '06.1', lignes: [{ numero: '06.1.1' }] }] },
    ] as any[] };
    const r = appliquerOrdreLots(d, [
      { id: 'p1', lot_number: '01', lot_title: 'Gros-Oeuvre' },
      { id: 'p2', lot_number: '02', lot_title: 'Charpente' },
      { id: 'p3', lot_number: '03', lot_title: 'Plomberie' },
    ]);
    expect(r.lots.map(l => l.titre)).toEqual(['Gros-Oeuvre', 'Charpente', 'Plomberie', 'PEINTURE']);
    expect(r.lots[0].id).toBe('x');
    expect(r.lots[2].projectLotId).toBe('p3');
    // Idempotent : un second passage ne change rien.
    expect(appliquerOrdreLots(r, [
      { id: 'p1', lot_number: '01', lot_title: 'Gros-Oeuvre' },
      { id: 'p2', lot_number: '02', lot_title: 'Charpente' },
      { id: 'p3', lot_number: '03', lot_title: 'Plomberie' },
    ]).lots.map(l => l.id)).toEqual(r.lots.map(l => l.id));
  });
});
