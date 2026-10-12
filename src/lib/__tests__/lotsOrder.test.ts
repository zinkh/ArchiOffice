import { describe, it, expect } from 'vitest';
import { appliquerOrdreLots, lotsDivergent, numeroDeLot, planImportLots, validerNumeroDeLot, numeroDeLotPris, numerosPourOrdre, comparerNumerosDeLot } from '../lotsOrder';

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
    // « Divers » est absent du projet : conservé en dernier, jamais supprimé.
    expect(r.lots.map(l => l.id)).toEqual(['b', 'a', 'c']);
    expect(r.lots[0].numero).toBe('01');
    expect(r.lots[0].projectLotId).toBe('p2');
    expect(r.lots[0].chapitres![0].numero).toBe('1');
    expect(r.lots[0].chapitres![0].lignes![0].numero).toBe('1.1');
    const gros = r.lots[1];
    expect(gros.numero).toBe('02');
    expect(gros.chapitres![0].numero).toBe('1');
    expect(gros.chapitres![0].lignes![0].numero).toBe('1.1');
    expect(gros.chapitres![0].lignes![0].children![0].numero).toBe('1.1.1');
    expect(gros.chapitres![0].lignes![1].numero).toBe('CODE-BIB');
  });
  it('crée les lots absents, ne supprime rien par défaut, rapproche et retire seulement sur demande', () => {
    const d = () => ({ lots: [
      { id: 'x', numero: '01', titre: 'GROS-OEUVRE - VRD - ESPACES VERTS', chapitres: [{ numero: '01.1', lignes: [{ numero: '01.1.1' }] }] },
      { id: 'y', numero: '02', titre: 'CHARPENTE BOIS', chapitres: [] },
      { id: 'w', numero: '06', titre: 'PEINTURE', chapitres: [{ numero: '06.1', lignes: [{ numero: '06.1.1' }] }] },
    ] as any[] });
    const projet = [
      { id: 'p1', lot_number: '01', lot_title: 'Gros-Oeuvre' },
      { id: 'p2', lot_number: '02', lot_title: 'Charpente' },
      { id: 'p3', lot_number: '03', lot_title: 'Plomberie' },
    ];
    expect(lotsDivergent(d(), projet)).toBe(true);
    // Sans rapprochement : rien n'est volé, tout est conservé.
    expect(appliquerOrdreLots(d(), projet).lots.length).toBe(6);
    const r = appliquerOrdreLots(d(), projet, { rapprocher: true, retirerHorsProjet: true });
    expect(r.lots.map(l => l.titre)).toEqual(['Gros-Oeuvre', 'Charpente', 'Plomberie']);
    expect(r.lots[0].id).toBe('x');
    expect(lotsDivergent(r, projet)).toBe(false);
    expect(lotsDivergent({ lots: [] }, projet)).toBe(false);
  });
  it('remplit la liste des lots depuis le document, numéros et intitulés du document', () => {
    const d = { lots: [
      { id: 'x', numero: '01', titre: 'GROS-OEUVRE - VRD' }, { id: 'y', numero: '02', titre: 'CHARPENTE BOIS' },
      { id: 'z', numero: '03', titre: 'COUVERTURE' },
    ] as any[] };
    const plan = planImportLots(d, [
      { id: 'p1', lot_number: '01', lot_title: 'Gros-Oeuvre' }, { id: 'p2', lot_number: '02', lot_title: 'Charpente' },
    ]);
    expect(plan).toEqual([
      { lotDocId: 'x', projectLotId: 'p1', numero: '01', titre: 'GROS-OEUVRE - VRD' },
      { lotDocId: 'y', projectLotId: 'p2', numero: '02', titre: 'CHARPENTE BOIS' },
      { lotDocId: 'z', projectLotId: undefined, numero: '03', titre: 'COUVERTURE' },
    ]);
  });
});

describe('numéros de lot libres', () => {
  it('accepte 00 et un lot scindé 01A / 01B', () => {
    expect(validerNumeroDeLot(' 00 ')).toEqual({ ok: true, numero: '00' });
    expect(validerNumeroDeLot('01A')).toEqual({ ok: true, numero: '01A' });
    expect(validerNumeroDeLot('01.1')).toEqual({ ok: true, numero: '01.1' });
  });
  it('refuse vide, point, espace et trop long', () => {
    for (const v of ['', '  ', '.01', '01.', '01..1', '01 A', '01/A', 'x'.repeat(13), 42]) expect(validerNumeroDeLot(v).ok).toBe(false);
  });
  it('trie 00 < 01A < 01B < 02 < 10', () => {
    expect(['10', '02', '01B', '00', '01A'].sort(comparerNumerosDeLot)).toEqual(['00', '01A', '01B', '02', '10']);
  });
  it('détecte un numéro déjà pris sans tenir compte de la casse, hors le lot lui-même', () => {
    const lots = [{ id: 'a', lot_number: '01A' }, { id: 'b', lot_number: '02' }];
    expect(numeroDeLotPris('01a', lots)).toBe(true);
    expect(numeroDeLotPris('01a', lots, 'a')).toBe(false);
    expect(numeroDeLotPris('03', lots)).toBe(false);
  });
  it('conserve la série personnalisée au changement d\'ordre', () => {
    const lots = [{ id: 'a', lot_number: '00' }, { id: 'b', lot_number: '01A' }, { id: 'c', lot_number: '01B' }];
    const m = numerosPourOrdre(lots, ['c', 'a', 'b']);
    expect([m.get('c'), m.get('a'), m.get('b')]).toEqual(['00', '01A', '01B']);
  });
  it('renumérote automatiquement une série standard en gardant son premier numéro', () => {
    const lots = [{ id: 'a', lot_number: '00' }, { id: 'b', lot_number: '01' }, { id: 'c', lot_number: '02' }];
    const m = numerosPourOrdre(lots, ['b', 'c', 'a']);
    expect([m.get('b'), m.get('c'), m.get('a')]).toEqual(['00', '01', '02']);
  });
  it('un lot créé reçoit les trois chapitres par défaut, deux masqués du DPGF', () => {
    const r = appliquerOrdreLots({ lots: [] as any[] }, [{ id: 'p', lot_number: '01', lot_title: 'Gros œuvre' }], { chapitresParDefaut: true });
    const chap = r.lots[0].chapitres;
    expect(chap.map((c: any) => [c.numero, c.titre, !!c.cctpOnly])).toEqual([
      ['1', 'PRESCRIPTIONS GENERALES', true], ['2', 'PRESCRIPTIONS TECHNIQUES', true], ['3', 'DESCRIPTION DES OUVRAGES', false],
    ]);
  });
  it('retombe sur 01, 02... si la série est incomplète ou en double', () => {
    const m = numerosPourOrdre([{ id: 'a', lot_number: '' }, { id: 'b', lot_number: '01' }], ['b', 'a']);
    expect([m.get('b'), m.get('a')]).toEqual(['01', '02']);
  });
});
