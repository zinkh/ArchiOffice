import { describe, it, expect } from 'vitest';
import {
  pieceAtteintLot, lotsDeLaPiece, piecesDuLot, basculerCase, basculerTous, basculerColonne, lotsACompleter,
} from '../dceMatrice';

const LOTS = ['a', 'b', 'c'];
const p = (tous_lots: boolean, lots_ids: string[] = []) => ({ tous_lots, lots_ids });

describe('dceMatrice', () => {
  it('une pièce « tous les lots » atteint chaque lot', () => {
    expect(pieceAtteintLot(p(true), 'b')).toBe(true);
    expect(lotsDeLaPiece(p(true), LOTS)).toBe(3);
  });

  it('compte les lots d\'une pièce et les pièces d\'un lot', () => {
    const pieces = [p(false, ['a']), p(true), p(false)];
    expect(lotsDeLaPiece(pieces[0], LOTS)).toBe(1);
    expect(piecesDuLot(pieces, 'a')).toBe(2);
    expect(piecesDuLot(pieces, 'c')).toBe(1);
  });

  it('cocher puis décocher une case', () => {
    const coche = basculerCase(p(false), 'a', LOTS);
    expect(coche).toEqual(p(false, ['a']));
    expect(basculerCase(coche, 'a', LOTS)).toEqual(p(false, []));
  });

  it('décocher un lot sur « tous les lots » liste les autres', () => {
    expect(basculerCase(p(true), 'b', LOTS)).toEqual(p(false, ['a', 'c']));
  });

  it('une liste qui couvre tous les lots redevient « tous les lots »', () => {
    expect(basculerCase(p(false, ['a', 'b']), 'c', LOTS)).toEqual(p(true, []));
  });

  it('écarte les lots disparus de la liste', () => {
    expect(basculerCase(p(false, ['zz']), 'a', LOTS)).toEqual(p(false, ['a']));
  });

  it('bascule « tous les lots »', () => {
    expect(basculerTous(p(false, ['a']))).toEqual(p(true, []));
    expect(basculerTous(p(true))).toEqual(p(false, []));
  });

  it('colonne : donne à toutes les pièces, puis les retire toutes', () => {
    const pieces = [p(false), p(false, ['a']), p(true)];
    const donnee = basculerColonne(pieces, 'a', LOTS);
    expect(donnee.every(x => pieceAtteintLot(x, 'a'))).toBe(true);
    const retiree = basculerColonne(donnee, 'a', LOTS);
    expect(retiree.some(x => pieceAtteintLot(x, 'a'))).toBe(false);
    expect(retiree[2]).toEqual(p(false, ['b', 'c']));
  });

  it('liste de pièces vide : la colonne reste vide', () => {
    expect(basculerColonne([], 'a', LOTS)).toEqual([]);
  });

  it('lots à compléter', () => {
    const pieces = [p(false, ['a']), p(true)];
    expect(lotsACompleter(pieces, LOTS)).toEqual(['b', 'c']);
  });
});
