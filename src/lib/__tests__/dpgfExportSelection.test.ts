import { describe, it, expect } from 'vitest';
import type { DPGF, Ligne } from '../../types/dpgf';
import { filtrerDpgfPourExport, compterArticles, SELECTION_COMPLETE, SANS_AFFECTATION_EXPORT } from '../dpgfExportSelection';

const ligne = (id: string, extra: Partial<Ligne> = {}): Ligne => ({
  id, numero: id, designation: id, unite: 'm2', quantite: 2, prixUnitaire: 10, prixTotal: 20, type: 'article', ...extra,
} as Ligne);

const doc = {
  id: 'd', titre: 'DPGF', version: 1, TVA: 20, totalHT: 0, totalTTC: 0,
  multiBatiments: true, multiPhases: true,
  batiments: [{ id: 'A', code: 'A', libelle: '', ordre: 1 }, { id: 'B', code: 'B', libelle: '', ordre: 2 }],
  phases: [{ id: 'P1', code: 'P1', libelle: '', ordre: 1 }],
  lots: [
    { id: 'l1', numero: '01', titre: 'Gros oeuvre', sousTotal: 0, chapitres: [
      { id: 'c1', numero: '1', titre: 'Murs', lignes: [
        ligne('a1', { batimentId: 'A', phaseId: 'P1' }),
        ligne('a2', { quantitesBatiments: { A: 1, B: 3 } }),
        ligne('a3'),
      ] },
      { id: 'c2', numero: '2', titre: 'CCTP', cctpOnly: true, lignes: [ligne('x')] },
    ] },
    { id: 'l2', numero: '02', titre: 'Charpente', sousTotal: 0, chapitres: [
      { id: 'c3', numero: '1', titre: 'Bois', lignes: [ligne('b1', { batimentId: 'B' })] },
    ] },
  ],
} as unknown as DPGF;

describe('filtrerDpgfPourExport', () => {
  it('renvoie le document tel quel pour la sélection complète', () => {
    expect(filtrerDpgfPourExport(doc, SELECTION_COMPLETE)).toBe(doc);
  });

  it('ne garde que les lots choisis', () => {
    const r = filtrerDpgfPourExport(doc, { lotIds: ['l2'], batimentIds: null, phaseIds: null });
    expect(r.lots.map(l => l.id)).toEqual(['l2']);
  });

  it('écarte les éléments réservés au CCTP', () => {
    const r = filtrerDpgfPourExport(doc, { lotIds: ['l1'], batimentIds: null, phaseIds: null });
    expect(r.lots[0].chapitres.map(c => c.id)).toEqual(['c1']);
  });

  it('filtre par bâtiment et réduit les quantités réparties', () => {
    const r = filtrerDpgfPourExport(doc, { lotIds: null, batimentIds: ['B'], phaseIds: null });
    const l1 = r.lots.find(l => l.id === 'l1')!;
    expect(l1.chapitres[0].lignes.map(l => l.id)).toEqual(['a2']);
    expect(l1.chapitres[0].lignes[0].quantite).toBe(3);
    expect(r.lots.map(l => l.id)).toEqual(['l1', 'l2']);
  });

  it('retient les articles sans bâtiment via le groupe « sans affectation »', () => {
    const r = filtrerDpgfPourExport(doc, { lotIds: ['l1'], batimentIds: [SANS_AFFECTATION_EXPORT], phaseIds: null });
    expect(r.lots[0].chapitres[0].lignes.map(l => l.id)).toEqual(['a3']);
  });

  it('filtre par phase', () => {
    const r = filtrerDpgfPourExport(doc, { lotIds: null, batimentIds: null, phaseIds: ['P1'] });
    expect(compterArticles(r)).toBe(1);
  });

  it('renvoie un document vide quand rien ne correspond', () => {
    const r = filtrerDpgfPourExport(doc, { lotIds: [], batimentIds: null, phaseIds: null });
    expect(compterArticles(r)).toBe(0);
  });
});
