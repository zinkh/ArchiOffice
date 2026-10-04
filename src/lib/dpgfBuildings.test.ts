import { describe, expect, it } from 'vitest';
import { buildingQuantities, forBuilding, recomputeBuildings } from './dpgfBuildings';
import type { DPGF, Ligne } from '../types/dpgf';

const line: Ligne = { id: 'a', numero: '1', designation: 'Peinture', unite: 'm2', quantite: 12, prixUnitaire: 10, prixTotal: 120, type: 'ouvrage' };
const doc: DPGF = { id: 'd', projectId: 'p', titre: 'DPGF', version: '1', dateCreation: '', statut: 'draft', TVA: 20, totalHT: 120, totalTTC: 144,
  lots: [{ id: 'l', numero: '1', titre: 'Lot', batimentId: 'A', sousTotal: 120, chapitres: [{ id: 'c', numero: '1.1', titre: 'Chapitre', lignes: [line] }] }] };

describe('quantités DPGF par bâtiment', () => {
  it('préserve les anciens articles et leur héritage', () => {
    expect(buildingQuantities(line, 'A')).toEqual({ A: 12 });
    expect(forBuilding(doc, 'A').totalHT).toBe(120);
    expect(forBuilding(doc, 'B').lots).toHaveLength(0);
  });
  it('exporte des quantités distinctes sans modifier la source', () => {
    const source = structuredClone(doc);
    source.lots[0].chapitres[0].lignes[0].quantitesBatiments = { A: 3, B: 7, C: 0 };
    const normalized = recomputeBuildings(source);
    expect(normalized.totalHT).toBe(100);
    expect(normalized.totalTTC).toBe(120);
    expect(forBuilding(normalized, 'A').totalHT).toBe(30);
    expect(forBuilding(normalized, 'B').lots[0].chapitres[0].lignes[0].quantite).toBe(7);
    expect(forBuilding(normalized, 'C', true).lots).toHaveLength(1);
    expect(source.lots[0].chapitres[0].lignes[0].quantite).toBe(12);
  });
  it('respecte les désaffectations explicites et les articles réservés au CCTP', () => {
    const source = structuredClone(doc);
    source.lots[0].chapitres[0].lignes = [{ ...line, quantitesBatiments: {} }, { ...line, id: 'b', cctpOnly: true }];
    expect(forBuilding(source, 'A').lots).toHaveLength(0);
    expect(forBuilding(source, 'A', true).lots[0].chapitres[0].lignes.map(l => l.id)).toEqual(['b']);
  });
  it('conserve les parents et descriptions des sous-articles sans doubler les totaux', () => {
    const source = structuredClone(doc);
    source.lots[0].chapitres[0].lignes = [{ ...line, cctpDescription: 'Description', children: [{ ...line, id: 'child', quantitesBatiments: { B: 4 } }] }];
    const result = forBuilding(source, 'B');
    expect(result.totalHT).toBe(40);
    expect(result.lots[0].chapitres[0].lignes[0].cctpDescription).toBe('Description');
    expect(forBuilding(source, 'A').lots).toHaveLength(0);
  });
});
