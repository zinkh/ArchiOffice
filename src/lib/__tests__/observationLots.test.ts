import { describe, it, expect } from 'vitest';
import {
  groupObservationsByLot, observationScopeLabel, observationSelectedLotIds, observationTargetsLot, selectionToFields,
} from '../observationLots';
import type { Observation, ProjectLot } from '../../types';

const lot = (id: string, n: string, title: string, contact_name = ''): ProjectLot =>
  ({ id, project_id: 'p1', lot_number: n, lot_title: title, contact_name } as ProjectLot);
const obs = (id: string, patch: Partial<Observation> = {}): Observation =>
  ({ id, project_id: 'p1', texte: `Texte ${id}`, statut: 'À faire', ...patch } as Observation);

const lots = [lot('l1', '02', 'Plâtrerie', 'Plâtres Martin - 06 00'), lot('l2', '03', 'Menuiserie', 'Bois SA'), lot('l3', '07', 'Électricité')];

describe('selectionToFields', () => {
  it('un seul lot : cas historique, sans lot_ids', () => {
    expect(selectionToFields(['l2'], lots, false)).toEqual({ lot_id: 'l2', lot_ids: [], tce: false });
  });

  it('plusieurs lots : le premier porte lot_id, tous sont dans lot_ids, sans doublon', () => {
    expect(selectionToFields(['l1', 'l3', 'l1'], lots, false)).toEqual({ lot_id: 'l1', lot_ids: ['l1', 'l3'], tce: false });
  });

  it('TCE explicite, ou tous les lots cochés : tce, sans lot', () => {
    expect(selectionToFields(['l1'], lots, true)).toEqual({ lot_id: null, lot_ids: [], tce: true });
    expect(selectionToFields(['l1', 'l2', 'l3'], lots, false)).toEqual({ lot_id: null, lot_ids: [], tce: true });
  });

  it('ignore un lot inconnu, et rend « sans lot » quand rien ne reste', () => {
    expect(selectionToFields(['x'], lots, false)).toEqual({ lot_id: null, lot_ids: [], tce: false });
  });
});

describe('observationTargetsLot / observationSelectedLotIds', () => {
  it('lot unique, plusieurs lots, TCE', () => {
    expect(observationTargetsLot(obs('a', { lot_id: 'l1' }), 'l1')).toBe(true);
    expect(observationTargetsLot(obs('a', { lot_id: 'l1' }), 'l2')).toBe(false);
    expect(observationTargetsLot(obs('b', { lot_id: 'l1', lot_ids: ['l1', 'l2'] }), 'l2')).toBe(true);
    expect(observationTargetsLot(obs('c', { tce: true }), 'l3')).toBe(true);
  });

  it('TCE ne coche aucun lot dans le sélecteur', () => {
    expect(observationSelectedLotIds(obs('c', { tce: true, lot_ids: ['l1'] }))).toEqual([]);
    expect(observationSelectedLotIds(obs('b', { lot_id: 'l1', lot_ids: ['l1', 'l2'] }))).toEqual(['l1', 'l2']);
  });
});

describe('observationScopeLabel', () => {
  it('dit TCE, les lots, le lot ou « Sans lot »', () => {
    expect(observationScopeLabel(obs('a', { tce: true }), lots)).toBe('TCE');
    expect(observationScopeLabel(obs('b', { lot_id: 'l1', lot_ids: ['l1', 'l2'] }), lots)).toBe('Lots 02, 03');
    expect(observationScopeLabel(obs('c', { lot_id: 'l2' }), lots)).toBe('03 · Menuiserie');
    expect(observationScopeLabel(obs('d'), lots)).toBe('Sans lot');
  });
});

describe('groupObservationsByLot', () => {
  it("TCE d'abord, puis les lots dans l'ordre, les lots multiples, et « sans lot » en dernier", () => {
    const groups = groupObservationsByLot([
      obs('sans'),
      obs('elec', { lot_id: 'l3' }),
      obs('multi', { lot_id: 'l1', lot_ids: ['l1', 'l2'] }),
      obs('tce', { tce: true }),
      obs('menu', { lot_id: 'l2' }),
      obs('menu2', { lot_id: 'l2' }),
    ], lots);
    expect(groups.map(g => [g.title, g.items.map(o => o.id)])).toEqual([
      ["TCE — Tout corps d'état", ['tce']],
      ['Lots 02, 03 — Plâtrerie, Menuiserie', ['multi']],
      ['03 — Menuiserie', ['menu', 'menu2']],
      ['07 — Électricité', ['elec']],
      ['Sans lot identifié', ['sans']],
    ]);
    expect(groups[1].entreprise).toBe('Plâtres Martin, Bois SA');
    expect(groups[2].entreprise).toBe('Bois SA');
  });
});
