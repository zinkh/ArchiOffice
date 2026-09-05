import { describe, it, expect } from 'vitest';
import { dpgfToBpu, bpuToDpgf, assignerReferences } from '../bpuConvert';
import type { DPGF } from '../../types/dpgf';
import type { BPU } from '../../types/bpu';

const ligne = (id: string, numero: string, q: number, pu: number, children?: any[]) => ({
  id, numero, designation: `Article ${numero}`, unite: 'm2',
  quantite: q, prixUnitaire: pu, prixTotal: q * pu,
  type: 'ouvrage' as const, ...(children ? { children } : {}),
});

const makeDpgf = (): DPGF => ({
  id: 'd1', projectId: 'p1', titre: 'DPGF', version: '1.0',
  dateCreation: '2026-01-01', statut: 'draft', TVA: 20,
  totalHT: 0, totalTTC: 0,
  lots: [{
    id: 'lot1', numero: '01', titre: 'Gros œuvre', sousTotal: 0,
    chapitres: [{
      id: 'c1', numero: '01.1', titre: 'Fondations',
      lignes: [
        ligne('a1', '01.1.1', 10, 100),
        ligne('a2', '01.1.2', 0, 0, [ligne('a2a', '01.1.2.1', 5, 20)]),
      ],
    }],
  }],
});

describe('dpgfToBpu', () => {
  it('reprend l’arbre en conservant les identifiants', () => {
    const bpu = dpgfToBpu(makeDpgf());
    expect(bpu.lots[0].chapitres[0].lignes.map(l => l.id)).toEqual(['a1', 'a2']);
    expect(bpu.lots[0].chapitres[0].lignes[1].children![0].id).toBe('a2a');
    expect(bpu.dpgfId).toBe('d1');
    expect(bpu.lots[0].chapitres[0].lignes[0].nature).toBe('base');
  });

  it('calcule les sous-totaux en descendant dans les sous-articles', () => {
    const bpu = dpgfToBpu(makeDpgf());
    // 10 x 100 pour a1, plus 5 x 20 porté par l’enfant de a2.
    expect(bpu.lots[0].sousTotal).toBe(1100);
    expect(bpu.totalHT).toBe(1100);
  });

  it('est idempotent : relancer ne détruit pas les prix du bordereau', () => {
    let bpu = dpgfToBpu(makeDpgf());
    // L’architecte chiffre le bordereau et qualifie un article.
    bpu.lots[0].chapitres[0].lignes[0].prixUnitaire = 250;
    bpu.lots[0].chapitres[0].lignes[0].nature = 'pse';
    bpu.lots[0].chapitres[0].lignes[0].refBpu = 'A1F';
    bpu.lots[0].chapitres[0].lignes[0].prixUnitaireLettres = 'deux-cent-cinquante euros';

    bpu = dpgfToBpu(makeDpgf(), bpu);
    const a1 = bpu.lots[0].chapitres[0].lignes[0];
    expect(a1.prixUnitaire).toBe(250);
    expect(a1.nature).toBe('pse');
    expect(a1.refBpu).toBe('A1F');
    expect(a1.prixUnitaireLettres).toBe('deux-cent-cinquante euros');
    // Le montant suit le prix conservé, pas celui du DPGF.
    expect(a1.prixTotal).toBe(2500);
  });
});

describe('bpuToDpgf', () => {
  it('reverse les prix et rend le détail des écarts', () => {
    const dpgf = makeDpgf();
    const bpu = dpgfToBpu(dpgf);
    bpu.lots[0].chapitres[0].lignes[0].prixUnitaire = 150;

    const { dpgf: next, diff } = bpuToDpgf(bpu, dpgf);
    expect(next.lots[0].chapitres[0].lignes[0].prixUnitaire).toBe(150);
    expect(next.lots[0].chapitres[0].lignes[0].prixTotal).toBe(1500);
    expect(diff.modifies).toEqual([
      { id: 'a1', numero: '01.1.1', designation: 'Article 01.1.1', ancien: 100, nouveau: 150 },
    ]);
  });

  it('signale les articles que seul le bordereau possède, sans les ajouter', () => {
    const dpgf = makeDpgf();
    const bpu = dpgfToBpu(dpgf);
    bpu.lots[0].chapitres[0].lignes.push({
      id: 'nouveau', numero: '01.1.3', designation: 'Article propre au BPU',
      unite: 'u', quantite: 1, prixUnitaire: 42, prixTotal: 42, type: 'ouvrage',
    });

    const { dpgf: next, diff } = bpuToDpgf(bpu, dpgf);
    expect(next.lots[0].chapitres[0].lignes).toHaveLength(2);
    expect(diff.absentsDuDpgf).toEqual([{ numero: '01.1.3', designation: 'Article propre au BPU' }]);
  });

  it('ne reprend les quantités que si on le demande', () => {
    const dpgf = makeDpgf();
    const bpu = dpgfToBpu(dpgf);
    bpu.lots[0].chapitres[0].lignes[0].quantite = 99;

    expect(bpuToDpgf(bpu, dpgf).dpgf.lots[0].chapitres[0].lignes[0].quantite).toBe(10);
    expect(bpuToDpgf(bpu, dpgf, { reprendreQuantites: true }).dpgf.lots[0].chapitres[0].lignes[0].quantite).toBe(99);
  });
});

describe('assignerReferences', () => {
  it('attribue une référence unique à chaque article, sous-articles compris', () => {
    const bpu = assignerReferences(dpgfToBpu(makeDpgf()));
    const refs: string[] = [];
    for (const l of bpu.lots[0].chapitres[0].lignes) {
      refs.push(l.refBpu!);
      for (const c of l.children ?? []) refs.push(c.refBpu!);
    }
    expect(refs).toHaveLength(3);
    expect(new Set(refs).size).toBe(3);
    expect(refs.every(r => /^[0-9A-Z]{3,}$/.test(r))).toBe(true);
  });

  it('ne rebat pas les références déjà attribuées', () => {
    const first = assignerReferences(dpgfToBpu(makeDpgf()));
    const before = first.lots[0].chapitres[0].lignes[0].refBpu;
    const second = assignerReferences(first);
    expect(second).toBe(first); // aucun changement, donc même objet
    expect(second.lots[0].chapitres[0].lignes[0].refBpu).toBe(before);
  });

  it('n’entre pas en collision avec une référence existante', () => {
    const bpu: BPU = dpgfToBpu(makeDpgf());
    bpu.lots[0].chapitres[0].lignes[0].refBpu = '001';
    const out = assignerReferences(bpu);
    const refs = [
      out.lots[0].chapitres[0].lignes[0].refBpu,
      out.lots[0].chapitres[0].lignes[1].refBpu,
      out.lots[0].chapitres[0].lignes[1].children![0].refBpu,
    ];
    expect(new Set(refs).size).toBe(3);
  });
});
