import { describe, expect, it } from 'vitest';
import { elementsAExporter, estVide, inclusParDefaut } from '../src/components/pro/cctpExportOps';
import type { Ligne, Lot } from '../src/types/dpgf';

const ligne = (id: string, numero: string, extra: Partial<Ligne> = {}): Ligne => ({
  id, numero, designation: `Article ${id}`, unite: 'm²', quantite: 1, prixUnitaire: 12.5, prixTotal: 12.5, type: 'ouvrage', children: [], ...extra,
});

const makeLots = (): Lot[] => [
  {
    id: 'lot-1', numero: '01', titre: 'Gros œuvre', sousTotal: 0, chapitres: [
      { id: 'chap-1', numero: '1', titre: 'Fondations', cctpDescription: 'Généralités fondations', lignes: [
        ligne('a', '1.1', { cctpDescription: 'Béton C25/30' }),
        ligne('b', '1.2', { children: [ligne('b1', '1.2.1', { cctpDescription: 'Coffrage soigné' })] }),
        ligne('c', '1.3'),
      ] },
      { id: 'chap-2', numero: '2', titre: 'Élévation', lignes: [ligne('d', '2.1')] },
    ],
  },
  { id: 'lot-2', numero: '02', titre: 'Charpente', sousTotal: 0, chapitres: [{ id: 'chap-3', numero: '1', titre: 'Bois', lignes: [ligne('e', '1.1', { cctpDescription: 'Lamellé-collé' })] }] },
];

describe('elementsAExporter', () => {
  it('reprend le contenu d’un lot sans texte propre à partir de ses chapitres et articles', () => {
    const [lot] = elementsAExporter(makeLots(), ['lot-0'], { avecSousElements: true });
    expect(lot.type).toBe('clause');
    expect(lot.description).toBe(
      '[b]1 Fondations[/b]\nGénéralités fondations\n\n[b]1.1 Article a[/b]\nBéton C25/30\n\n[b]1.2 Article b[/b]\n[b]1.2.1 Article b1[/b]\nCoffrage soigné',
    );
    expect(lot.nbChapitres).toBe(2);
    expect(lot.nbArticles).toBe(5);
    expect(inclusParDefaut(lot)).toBe(true);
  });

  it('n’imprime pas l’intitulé d’un sous-élément qui n’a aucun texte', () => {
    const [chap] = elementsAExporter(makeLots(), ['chap-0-1'], { avecSousElements: true });
    expect(chap.description).toBe('');
    expect(estVide(chap, 'clause')).toBe(true);
    expect(inclusParDefaut(chap)).toBe(false);
  });

  it('sans les sous-éléments, ne garde que le texte propre au poste', () => {
    const [chap] = elementsAExporter(makeLots(), ['chap-0-0'], { avecSousElements: false });
    expect(chap.description).toBe('Généralités fondations');
    expect(chap.nbArticles).toBe(0);
  });

  it('exporte un article en ouvrage avec son unité, son prix et son texte', () => {
    const [a] = elementsAExporter(makeLots(), ['ligne-0-0-0'], { avecSousElements: true });
    expect(a).toMatchObject({ kind: 'article', type: 'ouvrage', titre: 'Article a', unite: 'm²', prix_unitaire: 12.5, description: 'Béton C25/30', dejaLie: false });
  });

  it('garde un ouvrage sans texte, mais écarte d’office un article déjà lié à la bibliothèque', () => {
    const lots = makeLots();
    lots[0].chapitres[0].lignes[2].articleTypeId = 'lib-1';
    const [c] = elementsAExporter(lots, ['ligne-0-0-2'], { avecSousElements: true });
    expect(c.description).toBe('');
    expect(estVide(c, 'ouvrage')).toBe(false);
    expect(c.dejaLie).toBe(true);
    expect(inclusParDefaut(c)).toBe(false);
  });

  it('ne compte pas deux fois un chapitre sélectionné avec son lot, sauf sans sous-éléments', () => {
    const avec = elementsAExporter(makeLots(), ['lot-0', 'chap-0-0', 'ligne-0-0-0'], { avecSousElements: true });
    expect(avec.map(e => e.cle)).toEqual(['lot-0']);
    const sans = elementsAExporter(makeLots(), ['lot-0', 'chap-0-0', 'ligne-0-0-0'], { avecSousElements: false });
    expect(sans.map(e => e.cle)).toEqual(['lot-0', 'chap-0-0', 'ligne-0-0-0']);
  });

  it('rend plusieurs lots dans l’ordre du document et ignore une clé périmée', () => {
    const r = elementsAExporter(makeLots(), ['lot-1', 'lot-0', 'lot-9', 'ligne-0-9-0'], { avecSousElements: true });
    expect(r.map(e => e.cle)).toEqual(['lot-0', 'lot-1']);
    expect(r[1].description).toBe('[b]1 Bois[/b]\n[b]1.1 Article e[/b]\nLamellé-collé');
  });

  it('ne modifie pas l’arbre reçu', () => {
    const lots = makeLots();
    const avant = structuredClone(lots);
    elementsAExporter(lots, ['lot-0', 'lot-1'], { avecSousElements: true });
    expect(lots).toEqual(avant);
  });
});
