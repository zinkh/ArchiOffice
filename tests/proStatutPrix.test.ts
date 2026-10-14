import { describe, expect, it } from 'vitest';
import { appliquerStatutLignes, totauxDocument } from '../src/components/pro/selectionOps';
import { parsePrixSaisi, recomputeLot, sumLigne, sumLigneNature } from '../src/components/pro/treeOps';
import { grouperDpgf } from '../src/lib/dpgfGrouping';
import { recalculerTotaux } from '../server/dpgfLignes';
import type { DPGF, Ligne, Lot } from '../src/types/dpgf';

const ligne = (id: string, prixTotal: number, extra: Partial<Ligne> = {}): Ligne => ({
  id, numero: id, designation: id, unite: 'u', quantite: 1, prixUnitaire: prixTotal, prixTotal, type: 'ouvrage', children: [], ...extra,
});

const lots = (lignes: Ligne[]): Lot[] => [{
  id: 'l1', numero: '01', titre: 'Lot', sousTotal: 0, chapitres: [{ id: 'c1', numero: '1', titre: 'Chap', lignes }],
}];

describe('saisie du prix « PM »', () => {
  it.each(['PM', 'pm', ' P.M. ', 'pour mémoire', 'Pour memoire'])('reconnaît %s', raw => {
    expect(parsePrixSaisi(raw)).toEqual({ pourMemoire: true });
  });

  it('lit un nombre ou une formule sinon', () => {
    expect(parsePrixSaisi('12.5')).toEqual({ pourMemoire: false, valeur: 12.5 });
    expect(parsePrixSaisi('=2*3')).toEqual({ pourMemoire: false, valeur: 6 });
  });
});

describe('totaux de base, PSE, options et variantes', () => {
  it('ne compte ni le pour mémoire ni les prestations hors base', () => {
    const l = lots([
      ligne('a', 100),
      ligne('b', 50, { pourMemoire: true }),
      ligne('c', 30, { nature: 'pse' }),
      ligne('d', 20, { nature: 'option' }),
      ligne('e', 10, { nature: 'variante' }),
      ligne('f', 5, { nature: 'base' }),
    ]);
    expect(recomputeLot(l[0]).sousTotal).toBe(105);
    const t = totauxDocument(l, 20);
    expect(t.totalHT).toBe(105);
    expect(t.totalTTC).toBeCloseTo(126);
    expect(t.horsBase.pse).toEqual({ totalHT: 30, nb: 1 });
    expect(t.horsBase.option).toEqual({ totalHT: 20, nb: 1 });
    expect(t.horsBase.variante).toEqual({ totalHT: 10, nb: 1 });
  });

  it('la nature d\'un parent vaut pour ses sous-articles', () => {
    const parent = ligne('p', 0, { nature: 'option', children: [ligne('p1', 40), ligne('p2', 60)] });
    expect(sumLigne(parent)).toBe(0);
    expect(sumLigneNature(parent, 'option')).toBe(100);
    expect(sumLigneNature(parent, 'pse')).toBe(0);
    const t = totauxDocument(lots([ligne('a', 10), parent]), 20);
    expect(t.totalHT).toBe(10);
    expect(t.horsBase.option).toEqual({ totalHT: 100, nb: 2 });
  });

  it('une option dans un parent de base est retirée du total du parent', () => {
    const parent = ligne('p', 0, { children: [ligne('p1', 40), ligne('p2', 60, { nature: 'option' })] });
    expect(sumLigne(parent)).toBe(40);
    expect(sumLigneNature(parent, 'option')).toBe(60);
  });

  it('un article pour mémoire n\'entre dans aucun total', () => {
    const l = ligne('a', 70, { pourMemoire: true, nature: 'option' });
    expect(sumLigneNature(l, 'option')).toBe(0);
    expect(totauxDocument(lots([l]), 20).horsBase.option.nb).toBe(1);
    expect(totauxDocument(lots([l]), 20).horsBase.option.totalHT).toBe(0);
  });
});

describe('appliquerStatutLignes', () => {
  it('pose une nature sur la sélection et recalcule le lot', () => {
    const l = lots([ligne('a', 100), ligne('b', 50)]);
    const next = appliquerStatutLignes(l, ['ligne-0-0-1'], { nature: 'pse' });
    expect(next[0].chapitres[0].lignes[1].nature).toBe('pse');
    expect(next[0].sousTotal).toBe(100);
    expect(l[0].chapitres[0].lignes[1].nature).toBeUndefined();
  });

  it('pour mémoire remet prix à 0, puis le retirer ne change pas la nature', () => {
    const l = lots([ligne('a', 100, { nature: 'option' })]);
    const pm = appliquerStatutLignes(l, ['ligne-0-0-0'], { pourMemoire: true });
    expect(pm[0].chapitres[0].lignes[0]).toMatchObject({ pourMemoire: true, prixUnitaire: 0, prixTotal: 0, nature: 'option' });
    const sansPm = appliquerStatutLignes(pm, ['ligne-0-0-0'], { pourMemoire: undefined });
    expect(sansPm[0].chapitres[0].lignes[0].pourMemoire).toBeUndefined();
    expect(sansPm[0].chapitres[0].lignes[0].nature).toBe('option');
  });

  it('« base » retire nature et PM, un chapitre vise tous ses articles', () => {
    const l = lots([ligne('a', 10, { nature: 'variante' }), ligne('b', 0, { pourMemoire: true })]);
    const next = appliquerStatutLignes(l, ['chap-0-0'], { nature: undefined, pourMemoire: undefined });
    for (const x of next[0].chapitres[0].lignes) {
      expect(x.nature).toBeUndefined();
      expect(x.pourMemoire).toBeUndefined();
    }
    expect(next[0].sousTotal).toBe(10);
  });
});

describe('vue groupée et serveur', () => {
  it('le total d\'un groupe exclut PM et hors base', () => {
    const dpgf = { lots: lots([
      ligne('a', 100),
      ligne('b', 40, { nature: 'option' }),
      ligne('c', 0, { pourMemoire: true }),
      ligne('d', 0, { nature: 'pse', children: [ligne('d1', 25)] }),
    ]) } as unknown as DPGF;
    const groupes = grouperDpgf(dpgf, 'batiment');
    expect(groupes).toHaveLength(1);
    expect(groupes[0][1].total).toBe(100);
    expect(groupes[0][1].articles.find(a => a.ligne.id === 'd1')?.nature).toBe('pse');
  });

  it('le recalcul serveur applique la même règle', () => {
    const doc: any = { TVA: 20, lots: lots([ligne('a', 100), ligne('b', 40, { nature: 'option' }), ligne('c', 9, { pourMemoire: true }), ligne('e', 3, { nature: 'base' })]) };
    const r = recalculerTotaux(doc);
    expect(r.total_ht).toBe(103);
    expect(r.total_ttc).toBe(123.6);
  });
});
