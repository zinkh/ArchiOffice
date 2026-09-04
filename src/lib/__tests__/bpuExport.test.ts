import { describe, it, expect } from 'vitest';
import { flattenBPU, excelHeaders } from '../bpuExport';
import type { BPU } from '../../types/bpu';

const art = (id: string, numero: string, q: number, pu: number, extra: any = {}) => ({
  id, numero, designation: `Article ${numero}`, unite: 'm2',
  quantite: q, prixUnitaire: pu, prixTotal: q * pu, type: 'ouvrage' as const,
  refBpu: id.toUpperCase(), ...extra,
});

/** Arbre à trois niveaux d'articles, le cas que flattenDPGF perdait. */
const makeBpu = (over: Partial<BPU> = {}): BPU => ({
  id: 'b1', projectId: 'p1', titre: 'BPU', version: '1.0',
  dateCreation: '2026-01-01', statut: 'draft',
  marche: { typeMarche: 'bons_de_commande', montantMiniHT: 10000, montantMaxiHT: 100000 },
  tranches: [{ id: 't1', code: 'TF', libelle: 'Tranche ferme', type: 'ferme', ordre: 0 }],
  prixEnLettres: false,
  totalHT: 0, TVA: 20, totalTTC: 0,
  lots: [{
    id: 'lot1', numero: '01', titre: 'Gros œuvre', sousTotal: 0, trancheId: 't1',
    chapitres: [{
      id: 'c1', numero: '01.1', titre: 'Fondations',
      lignes: [
        art('a1', '01.1.1', 10, 100),
        art('a2', '01.1.2', 0, 0, {
          children: [
            art('a2a', '01.1.2.1', 5, 20),
            art('a2b', '01.1.2.2', 0, 0, { children: [art('a2b1', '01.1.2.2.1', 2, 50)] }),
          ],
        }),
      ],
    }],
  }],
  ...over,
});

describe('flattenBPU', () => {
  it('descend dans tous les niveaux de sous-articles', () => {
    const rows = flattenBPU(makeBpu());
    const articles = rows.filter(r => r.kind === 'article').map(r => r.numero);
    expect(articles).toEqual(['01.1.1', '01.1.2', '01.1.2.1', '01.1.2.2', '01.1.2.2.1']);
  });

  it('rend la profondeur pour l’indentation', () => {
    const rows = flattenBPU(makeBpu());
    const byNum = Object.fromEntries(rows.map(r => [r.numero, r.depth]));
    expect(byNum['01']).toBe(0);
    expect(byNum['01.1']).toBe(1);
    expect(byNum['01.1.1']).toBe(2);
    expect(byNum['01.1.2.1']).toBe(3);
    expect(byNum['01.1.2.2.1']).toBe(4);
  });

  it('donne aux lots et chapitres une référence de structure distincte', () => {
    const rows = flattenBPU(makeBpu());
    expect(rows[0].ref).toBe('#L1');
    expect(rows[1].ref).toBe('#C1.1');
    // Un article porte sa propre référence stable, jamais un marqueur #.
    expect(rows[2].ref).toBe('A1');
    expect(rows.filter(r => r.kind === 'article').every(r => !r.ref.startsWith('#'))).toBe(true);
  });

  it('propage la tranche du lot aux articles qui n’en ont pas', () => {
    const rows = flattenBPU(makeBpu());
    expect(rows.filter(r => r.kind === 'article').every(r => r.tranche === 'TF')).toBe(true);
  });

  it('rend la nature de chaque article', () => {
    const bpu = makeBpu();
    bpu.lots[0].chapitres[0].lignes[0].nature = 'pse';
    const rows = flattenBPU(bpu);
    expect(rows.find(r => r.numero === '01.1.1')!.nature).toBe('pse');
    expect(rows.find(r => r.numero === '01.1.2.1')!.nature).toBe('base');
  });

  it('dérive le prix en lettres quand il n’a pas été saisi', () => {
    const rows = flattenBPU(makeBpu());
    expect(rows.find(r => r.numero === '01.1.1')!.prixEnLettres).toBe('cent euros');
  });
});

describe('excelHeaders', () => {
  it('n’expose ni quantité ni montant sur un bordereau', () => {
    const h = excelHeaders(makeBpu(), 'bpu');
    expect(h).toEqual(['Réf.', 'N°', 'Désignation', 'Unité', 'P.U. HT (€)', 'Tranche']);
    expect(h).not.toContain('Quantité');
    expect(h).not.toContain('Montant HT (€)');
  });

  it('ajoute quantité et montant en DQE', () => {
    expect(excelHeaders(makeBpu(), 'dqe')).toEqual([
      'Réf.', 'N°', 'Désignation', 'Unité', 'Quantité', 'P.U. HT (€)', 'Montant HT (€)', 'Tranche',
    ]);
  });

  it('n’ajoute la colonne en lettres que si le document la demande', () => {
    expect(excelHeaders(makeBpu(), 'bpu')).not.toContain('P.U. en lettres');
    expect(excelHeaders(makeBpu({ prixEnLettres: true }), 'bpu')).toContain('P.U. en lettres');
  });

  it('omet la colonne tranche quand le marché n’en a pas', () => {
    expect(excelHeaders(makeBpu({ tranches: [] }), 'bpu')).not.toContain('Tranche');
  });
});
