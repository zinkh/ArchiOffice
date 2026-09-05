import { describe, it, expect } from 'vitest';
import { bpuVersComparatif } from '../bpuToAct';
import type { BPU, OffreBPU } from '../../types/bpu';

const art = (id: string, numero: string, designation: string, q: number, pu: number, children?: any[]) => ({
  id, numero, designation, unite: 'm3', quantite: q, prixUnitaire: pu,
  prixTotal: q * pu, type: 'ouvrage' as const, ...(children ? { children } : {}),
});

const makeBpu = (projectLotId?: string): BPU => ({
  id: 'b1', projectId: 'p1', titre: 'BPU', version: '1.0',
  dateCreation: '2026-01-01', statut: 'draft',
  marche: { typeMarche: 'bons_de_commande' }, tranches: [], prixEnLettres: false,
  totalHT: 0, TVA: 20, totalTTC: 0,
  lots: [{
    id: 'lot1', numero: '01', titre: 'Gros œuvre', sousTotal: 3200, projectLotId,
    chapitres: [{
      id: 'c1', numero: '01.1', titre: 'Fondations',
      lignes: [art('a1', '01.1.1', 'Béton', 10, 100), art('a2', '01.1.2', 'Semelle', 40, 55)],
    }],
  }],
});

const offre = (id: string, entrepriseId: string | undefined, prix: Record<string, number | null>, statut: OffreBPU['statut'] = 'validee'): OffreBPU => ({
  id, entrepriseId, entrepriseNom: `Entreprise ${id}`,
  dateReception: '2026-02-01', fichierNom: 'offre.xlsx', importedAt: '2026-02-01',
  bpuVersion: '1.0', prix, anomalies: [], statut,
});

describe('bpuVersComparatif', () => {
  it('produit un lot, une section par chapitre, un article par ligne et un sous-total', () => {
    const { comparatif } = bpuVersComparatif(makeBpu('pl1'), [offre('o1', 'e1', { a1: 110, a2: 60 })]);
    expect(comparatif).toHaveLength(1);
    expect(comparatif[0].lot_id).toBe('pl1');

    const a = comparatif[0].articles;
    expect(a[0]).toMatchObject({ code: '01.1', titre: 'Fondations', is_section_header: true });
    expect(a[1]).toMatchObject({ code: '01.1.1', titre: 'Béton', quantite: 10, estimatif: 1000 });
    // Le comparatif porte des MONTANTS : quantité x prix unitaire remis.
    expect(a[1].prix.e1).toBe(1100);
    expect(a[2].prix.e1).toBe(2400);
    expect(a[3]).toMatchObject({ is_subtotal: true, estimatif: 3200 });
    expect(a[3].prix.e1).toBe(3500);
  });

  it('signale les lots non rattachés plutôt que de les laisser tomber', () => {
    const { comparatif, lotsNonRattaches } = bpuVersComparatif(makeBpu(undefined), []);
    expect(comparatif).toHaveLength(0);
    expect(lotsNonRattaches).toEqual([{ numero: '01', titre: 'Gros œuvre' }]);
  });

  it('laisse un poste non chiffré absent au lieu de l’inscrire à zéro', () => {
    const { comparatif } = bpuVersComparatif(makeBpu('pl1'), [offre('o1', 'e1', { a1: 110, a2: null })]);
    const a = comparatif[0].articles;
    expect(a[1].prix.e1).toBe(1100);
    expect(a[2].prix.e1).toBeUndefined();
    // Le sous-total ne compte que ce qui a été chiffré.
    expect(a[3].prix.e1).toBe(1100);
  });

  it('écarte les offres rejetées et celles sans entreprise identifiée', () => {
    const { comparatif } = bpuVersComparatif(makeBpu('pl1'), [
      offre('o1', 'e1', { a1: 110 }),
      offre('o2', 'e2', { a1: 90 }, 'ecartee'),
      offre('o3', undefined, { a1: 80 }),
    ]);
    expect(Object.keys(comparatif[0].articles[1].prix)).toEqual(['e1']);
  });

  it('descend dans les sous-articles sans chiffrer leur parent', () => {
    const bpu = makeBpu('pl1');
    bpu.lots[0].chapitres[0].lignes = [
      art('p1', '01.1.1', 'Parent', 0, 0, [art('e1', '01.1.1.1', 'Enfant', 2, 50)]),
    ];
    const { comparatif } = bpuVersComparatif(bpu, [offre('o1', 'ent1', { e1: 60 })]);
    const codes = comparatif[0].articles.filter(a => !a.is_section_header && !a.is_subtotal).map(a => a.code);
    expect(codes).toEqual(['01.1.1.1']);
    expect(comparatif[0].articles[1].prix.ent1).toBe(120);
  });
});
