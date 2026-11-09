import { describe, expect, it } from 'vitest';
import {
  GROUPE_SANS_LOT, SANS_LOT_FILTRE, choixDeLots, cleGroupe, comparerNumerosLot, correspondAuLot, libelleGroupe,
  numerosParLot, trierGroupes, trierParLot, voisine,
} from '../reserveTri';

const lots = [
  { lot_number: '10', lot_title: 'PEINTURE' },
  { lot_number: '2', lot_title: 'GROS-OEUVRE' },
  { lot_number: '01A', lot_title: 'Démolition' },
  { lot_number: '01', lot_title: 'VRD' },
  { lot_number: '', lot_title: 'DIVERS' },
];
const numeros = numerosParLot(lots);
const r = (id: string, number: number, lotsList: string[], entreprises: string[] = []) =>
  ({ id, number, lots: JSON.stringify(lotsList), entreprises: JSON.stringify(entreprises) });

describe('comparerNumerosLot', () => {
  it('classe les numéros comme un humain et rejette les numéros vides en dernier', () => {
    const tries = ['10', '', '3', '2', '01A', '01'].sort(comparerNumerosLot);
    expect(tries).toEqual(['01', '01A', '2', '3', '10', '']);
  });

  it('lit les sous-numéros comme des nombres (01.2 avant 01.10)', () => {
    expect(['01.10', '01.2', '01'].sort(comparerNumerosLot)).toEqual(['01', '01.2', '01.10']);
  });
});

describe('trierGroupes', () => {
  it('range les groupes par numéro de lot, puis les lots sans numéro, puis les réserves sans lot', () => {
    const rows = [
      r('a', 1, ['PEINTURE']), r('b', 2, ['inconnu']), r('c', 3, []), r('d', 4, ['GROS-OEUVRE']),
      r('e', 5, ['VRD'], ['Martin']), r('f', 6, ['DIVERS']),
    ];
    const groupes = new Map<string, typeof rows>();
    for (const x of rows) {
      const cle = cleGroupe(x);
      groupes.set(cle, [...(groupes.get(cle) ?? []), x]);
    }
    const tries = trierGroupes([...groupes.entries()], numeros).map(([cle]) => cle);
    expect(tries).toEqual(['VRD / Martin', 'GROS-OEUVRE / ', 'PEINTURE / ', 'DIVERS / ', 'inconnu / ', GROUPE_SANS_LOT]);
  });

  it('retrouve le numéro malgré la casse et les accents', () => {
    expect(libelleGroupe(r('a', 1, ['DEMOLITION']), numeros)).toBe('01A · DEMOLITION');
  });
});

describe('libelleGroupe', () => {
  it('préfixe le numéro et n’ajoute la barre que s’il y a une entreprise', () => {
    expect(libelleGroupe(r('a', 1, ['PEINTURE']), numeros)).toBe('10 · PEINTURE');
    expect(libelleGroupe(r('a', 1, ['PEINTURE'], ['Dupont']), numeros)).toBe('10 · PEINTURE / Dupont');
    expect(libelleGroupe(r('a', 1, []), numeros)).toBe(GROUPE_SANS_LOT);
  });
});

describe('trierParLot', () => {
  it('classe par numéro de lot puis par numéro de réserve', () => {
    const rows = [r('a', 9, ['PEINTURE']), r('b', 3, ['VRD']), r('c', 1, ['PEINTURE']), r('d', 2, [])];
    expect(trierParLot(rows, numeros).map(x => x.id)).toEqual(['b', 'c', 'a', 'd']);
  });
});

describe('correspondAuLot', () => {
  it('filtre par intitulé, par « sans lot », ou ne filtre pas', () => {
    expect(correspondAuLot(r('a', 1, ['PEINTURE', 'VRD']), 'vrd')).toBe(true);
    expect(correspondAuLot(r('a', 1, ['PEINTURE']), 'VRD')).toBe(false);
    expect(correspondAuLot(r('a', 1, []), SANS_LOT_FILTRE)).toBe(true);
    expect(correspondAuLot(r('a', 1, ['VRD']), SANS_LOT_FILTRE)).toBe(false);
    expect(correspondAuLot(r('a', 1, ['VRD']), '')).toBe(true);
  });
});

describe('choixDeLots', () => {
  it('ne propose que les lots portant des réserves, classés par numéro, avec leur effectif', () => {
    const choix = choixDeLots([r('a', 1, ['PEINTURE']), r('b', 2, ['PEINTURE', 'VRD']), r('c', 3, ['orphelin'])], lots);
    expect(choix).toEqual([
      { value: 'VRD', label: '01 · VRD', count: 1 },
      { value: 'PEINTURE', label: '10 · PEINTURE', count: 2 },
      { value: 'orphelin', label: 'orphelin', count: 1 },
    ]);
  });
});

describe('voisine', () => {
  const liste = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  it('rend la précédente et la suivante, null aux extrémités ou si la réserve est absente', () => {
    expect(voisine(liste, 'b', -1)?.id).toBe('a');
    expect(voisine(liste, 'b', 1)?.id).toBe('c');
    expect(voisine(liste, 'a', -1)).toBeNull();
    expect(voisine(liste, 'c', 1)).toBeNull();
    expect(voisine(liste, 'zz', 1)).toBeNull();
    expect(voisine(liste, null, 1)).toBeNull();
  });
});
