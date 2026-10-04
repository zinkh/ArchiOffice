import { describe, expect, it } from 'vitest';
import {
  affecterBatiments, articlesSansBatiment, basculerBatiment, basculerBatimentEnMasse, cctpPourBatiment,
  etatBatimentSelection, fixerQuantiteBatiment, quantitesParBatiment,
} from '../src/lib/batimentsArticles';
import type { DPGF, Ligne } from '../src/types/dpgf';

const ligne = (id: string, extra: Partial<Ligne> = {}): Ligne => ({
  id, numero: id, designation: id, unite: 'm²', quantite: 0, prixUnitaire: 10, prixTotal: 0, type: 'ouvrage', children: [], ...extra,
});

const doc = (): DPGF => ({
  id: 'd', projectId: 'p', titre: 'DPGF', version: '1', dateCreation: '', statut: 'draft', TVA: 20, totalHT: 0, totalTTC: 0,
  multiBatiments: true, batiments: [{ id: 'P', code: 'P', libelle: 'Préau', ordre: 1 }, { id: 'A', code: 'A', libelle: 'Bâtiment A', ordre: 2 }],
  lots: [
    { id: 'l1', numero: '01', titre: 'Bardage', sousTotal: 0, chapitres: [
      { id: 'c0', numero: '01.1', titre: 'Généralités', lignes: [], cctpDescription: 'Commun' },
      { id: 'c1', numero: '01.2', titre: 'Bardages', lignes: [
        ligne('vertical', { quantitesBatiments: { P: 100, A: 200 }, quantite: 300, prixTotal: 3000 }),
        ligne('horizontal', { quantitesBatiments: { A: 50 }, quantite: 50, prixTotal: 500 }),
        ligne('libre', { quantite: 7, prixTotal: 70 }),
        ligne('texte', { cctpOnly: true }),
      ] },
    ] },
    { id: 'l2', numero: '02', titre: 'Préau seul', sousTotal: 0, batimentId: 'P', chapitres: [
      { id: 'c2', numero: '02.1', titre: 'Charpente', lignes: [ligne('charpente', { quantite: 12, prixTotal: 120 })] },
    ] },
  ],
});

describe('bâtiments des articles', () => {
  it('lit les bâtiments explicites, hérités ou absents', () => {
    expect(quantitesParBatiment(ligne('x', { quantitesBatiments: { A: 2 } }))).toEqual({ A: 2 });
    expect(quantitesParBatiment(ligne('x', { quantite: 4 }), 'P')).toEqual({ P: 4 });
    expect(quantitesParBatiment(ligne('x', { quantite: 4, batimentId: '' }), 'P')).toEqual({});
  });

  it('affecte plusieurs bâtiments en gardant les quantités déjà saisies', () => {
    const l = affecterBatiments(ligne('x', { quantitesBatiments: { P: 100 }, quantite: 100 }), ['P', 'A']);
    expect(l.quantitesBatiments).toEqual({ P: 100, A: 0 });
    expect(l.quantite).toBe(100);
    expect(l.prixTotal).toBe(1000);
  });

  it('reporte la quantité d’un article sans bâtiment sur le premier choisi', () => {
    const l = affecterBatiments(ligne('x', { quantite: 7, prixTotal: 70 }), ['A', 'P']);
    expect(l.quantitesBatiments).toEqual({ A: 7, P: 0 });
    expect(l.batimentId).toBeUndefined();
  });

  it('retirer tous les bâtiments rend une quantité simple, sans héritage', () => {
    const l = basculerBatiment(ligne('x', { quantitesBatiments: { A: 5 }, quantite: 5 }), 'A', false);
    expect(l.quantitesBatiments).toBeUndefined();
    expect(l.batimentId).toBe('');
    expect(l.quantite).toBe(5);
  });

  it('saisit la quantité d’un bâtiment affecté, et refuse un bâtiment non affecté', () => {
    const base = ligne('x', { quantitesBatiments: { P: 1, A: 2 } });
    const l = fixerQuantiteBatiment(base, 'A', 20);
    expect(l.quantite).toBe(21);
    expect(l.prixTotal).toBe(210);
    expect(fixerQuantiteBatiment(base, 'Z', 3)).toBe(base);
  });

  it('coche un bâtiment pour toute une sélection, chapitre compris, et recalcule les montants', () => {
    const d = doc();
    expect(etatBatimentSelection(d.lots, ['chap-0-1'], 'P')).toBe('certains');
    const lots = basculerBatimentEnMasse(d.lots, ['chap-0-1'], 'P', true);
    expect(etatBatimentSelection(lots, ['chap-0-1'], 'P')).toBe('tous');
    const lignes = lots[0].chapitres[1].lignes;
    expect(lignes[1].quantitesBatiments).toEqual({ A: 50, P: 0 });
    expect(lignes[2].quantitesBatiments).toEqual({ P: 7 });
    expect(lots[0].sousTotal).toBe(3000 + 500 + 70);
  });

  it('décoche un bâtiment hérité du lot', () => {
    const lots = basculerBatimentEnMasse(doc().lots, ['ligne-1-0-0'], 'P', false);
    expect(lots[1].chapitres[0].lignes[0]).toMatchObject({ batimentId: '', quantite: 12 });
    expect(etatBatimentSelection(lots, ['lot-1'], 'P')).toBe('aucun');
  });
});

describe('CCTP par bâtiment', () => {
  it('garde les articles du bâtiment, les généralités et les textes communs', () => {
    const preau = cctpPourBatiment(doc(), 'P');
    expect(preau.lots.map(l => l.id)).toEqual(['l1', 'l2']);
    expect(preau.lots[0].chapitres.map(c => c.id)).toEqual(['c0', 'c1']);
    expect(preau.lots[0].chapitres[1].lignes.map(l => l.id)).toEqual(['vertical', 'texte']);
  });

  it('retire un lot entièrement affecté à un autre bâtiment', () => {
    const a = cctpPourBatiment(doc(), 'A');
    expect(a.lots.map(l => l.id)).toEqual(['l1']);
    expect(a.lots[0].chapitres[1].lignes.map(l => l.id)).toEqual(['vertical', 'horizontal', 'texte']);
  });

  it('signale les articles chiffrables sans bâtiment', () => {
    expect(articlesSansBatiment(doc()).map(l => l.id)).toEqual(['libre']);
  });
});

describe('contenu du CCTP exporté', async () => {
  const { cctpBlocs, cctpNomFichier } = await import('../src/lib/cctpExport');

  it('mentionne les bâtiments de chaque article dans l’opération complète, sans quantité', () => {
    const blocs = cctpBlocs(doc());
    const vertical = blocs.find(b => b.numero === 'vertical')!;
    expect(vertical).toMatchObject({ niveau: 3, batiments: ['P Préau', 'A Bâtiment A'] });
    expect(blocs.find(b => b.numero === 'horizontal')!.batiments).toEqual(['A Bâtiment A']);
    expect(blocs.find(b => b.numero === 'libre')!.batiments).toBeUndefined();
    expect(JSON.stringify(blocs)).not.toMatch(/quantite|300|200/);
  });

  it('ne garde que les articles du bâtiment, sans mention répétée', () => {
    const blocs = cctpBlocs(doc(), 'A');
    expect(blocs.filter(b => b.niveau >= 3).map(b => b.numero)).toEqual(['vertical', 'horizontal', 'texte']);
    expect(blocs.every(b => b.batiments === undefined)).toBe(true);
    expect(blocs.find(b => b.numero === '01.1')!.texte).toBe('Commun');
  });

  it('nomme le fichier sans accent ni espace', () => {
    expect(cctpNomFichier({ projectName: '26014 Villa Martin', batiment: { id: 'P', code: 'Préau', libelle: '', ordre: 1 } }, 'pdf'))
      .toBe('CCTP_26014_Villa_Martin_Preau.pdf');
  });
});
