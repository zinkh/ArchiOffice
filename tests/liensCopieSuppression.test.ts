// Liens de quantité à la copie, au collage, à la duplication et à la suppression en cascade (phase 2).
import { describe, expect, it } from 'vitest';
import { deleteSelection, pasteLignes, suiveursEnCascade } from '../src/components/pro/selectionOps';
import { duplicateHierarchy, noeudSelectionne } from '../src/components/pro/hierarchyOps';
import { dupliquerSelection, noeudsRacines } from '../src/components/pro/cctpBulkOps';
import { propagerLiens } from '../src/lib/quantitesLiees';
import type { Chapitre, Ligne, Lot } from '../src/types/dpgf';

const ligne = (id: string, surcharge: Partial<Ligne> = {}): Ligne => ({
  id, numero: id, designation: `Poste ${id}`, unite: 'm²', quantite: 4, prixUnitaire: 10, prixTotal: 40, type: 'ouvrage', ...surcharge,
});
const chapitre = (id: string, lignes: Ligne[]): Chapitre => ({ id, numero: '1', titre: id, lignes } as Chapitre);
// lot 0 : chapitre 0 [a, b suit a, x suit un poste hors lot], chapitre 1 [c suit b] ; lot 1 : [d suit a]
const makeLots = (): Lot[] => [
  {
    id: 'lot0', numero: '01', titre: 'Lot 0', sousTotal: 0, chapitres: [
      chapitre('c0', [
        ligne('a'),
        ligne('b', { quantiteLiee: { sourceId: 'a' } }),
        ligne('x', { quantiteLiee: { sourceId: 'zz' } }),
      ]),
      chapitre('c1', [ligne('c', { quantiteLiee: { sourceId: 'b' } })]),
    ],
  },
  { id: 'lot1', numero: '02', titre: 'Lot 1', sousTotal: 0, chapitres: [chapitre('c2', [ligne('d', { quantiteLiee: { sourceId: 'a' } })])] },
];
const compteur = () => { let n = 0; return () => `n${++n}`; };
const lignesDe = (lots: Lot[]): Ligne[] => lots.flatMap(l => l.chapitres.flatMap(c => c.lignes));

describe('pasteLignes : liens des articles collés', () => {
  const presse = () => [ligne('a'), ligne('b', { quantiteLiee: { sourceId: 'a' } }), ligne('x', { quantiteLiee: { sourceId: 'zz' } })];
  const colle = (liens?: 'tout' | 'internes' | 'rompre') => {
    const r = pasteLignes(makeLots(), { kind: 'chapitre', lotIdx: 1, chapIdx: 0 }, presse(), compteur(), liens)!;
    return r.lots[1].chapitres[0].lignes.slice(1); // les trois copies, après `d`
  };
  const sources = (copies: Ligne[]) => copies.map(l => l.quantiteLiee?.sourceId);

  it('par défaut : le lien vers un article collé en même temps suit la copie, le lien externe reste', () => {
    const copies = colle();
    expect(copies.map(l => l.id)).toEqual(['n1', 'n2', 'n3']);
    expect(sources(copies)).toEqual([undefined, 'n1', 'zz']);
  });

  it('« internes » : seuls les liens entre copies sont gardés', () => {
    expect(sources(colle('internes'))).toEqual([undefined, 'n1', undefined]);
  });

  it('« rompre » : plus aucun lien, chaque copie garde sa quantité', () => {
    const copies = colle('rompre');
    expect(sources(copies)).toEqual([undefined, undefined, undefined]);
    expect(copies.map(l => l.quantite)).toEqual([4, 4, 4]);
  });

  it('ne modifie ni le presse-papier ni l\'arbre d\'origine', () => {
    const lots = makeLots();
    const avant = structuredClone(lots);
    const clip = presse();
    const clipAvant = structuredClone(clip);
    pasteLignes(lots, { kind: 'chapitre', lotIdx: 1, chapIdx: 0 }, clip, compteur(), 'rompre');
    expect(lots).toEqual(avant);
    expect(clip).toEqual(clipAvant);
  });

  it('collé deux fois, chaque collage suit ses propres copies', () => {
    const premier = pasteLignes(makeLots(), { kind: 'chapitre', lotIdx: 1, chapIdx: 0 }, presse(), compteur())!;
    const second = pasteLignes(premier.lots, { kind: 'chapitre', lotIdx: 1, chapIdx: 0 }, presse(), (() => { let n = 100; return () => `m${++n}`; })())!;
    const bs = lignesDe(second.lots).filter(l => l.quantiteLiee && l.id.startsWith('m')).map(l => l.quantiteLiee!.sourceId);
    expect(bs).toContain('m101');
    expect(bs).not.toContain('n1');
  });

  it('un collage propagé par `propagerLiens` donne à la copie la quantité de sa source copiée', () => {
    const clip = [ligne('a', { quantite: 9 }), ligne('b', { quantite: 1, quantiteLiee: { sourceId: 'a' } })];
    const r = pasteLignes(makeLots(), { kind: 'chapitre', lotIdx: 1, chapIdx: 0 }, clip, compteur())!;
    const propage = propagerLiens(r.lots);
    expect(lignesDe(propage).find(l => l.id === 'n2')!.quantite).toBe(9);
  });
});

describe('duplicateHierarchy et dupliquerSelection : liens des copies', () => {
  const uid = compteur;

  it('dupliquer un chapitre : les copies se suivent entre elles', () => {
    const r = duplicateHierarchy(makeLots(), { kind: 'chapitre', lotIdx: 0, chapIdx: 0 }, uid());
    const copie = r.lots[0].chapitres[1].lignes;
    expect(copie.map(l => l.quantiteLiee?.sourceId)).toEqual([undefined, copie[0].id, 'zz']);
  });

  it('dupliquer un article lié seul : la copie suit toujours le poste d\'origine', () => {
    const r = duplicateHierarchy(makeLots(), { kind: 'ligne', lotIdx: 0, chapIdx: 0, lignePath: [1] }, uid());
    expect(r.lots[0].chapitres[0].lignes[2].quantiteLiee).toEqual({ sourceId: 'a' });
  });

  it('« rompre » : la copie n\'a plus de lien et garde sa quantité', () => {
    const r = duplicateHierarchy(makeLots(), { kind: 'ligne', lotIdx: 0, chapIdx: 0, lignePath: [1] }, uid(), 'rompre');
    const copie = r.lots[0].chapitres[0].lignes[2];
    expect(copie.quantiteLiee).toBeUndefined();
    expect(copie.quantite).toBe(4);
  });

  it('« internes » sur un article lié seul : son lien, vers un poste resté en place, est rompu', () => {
    const r = duplicateHierarchy(makeLots(), { kind: 'ligne', lotIdx: 0, chapIdx: 0, lignePath: [1] }, uid(), 'internes');
    expect(r.lots[0].chapitres[0].lignes[2].quantiteLiee).toBeUndefined();
  });

  it('dupliquer un lot : les copies se suivent entre elles, pas les originaux', () => {
    const r = duplicateHierarchy(makeLots(), { kind: 'lot', lotIdx: 0 }, uid());
    const copie = r.lots[1];
    const [a2, b2] = copie.chapitres[0].lignes;
    expect(b2.quantiteLiee!.sourceId).toBe(a2.id);
    expect(copie.chapitres[1].lignes[0].quantiteLiee!.sourceId).toBe(b2.id);
  });

  it('dupliquerSelection applique le mode à chaque copie', () => {
    const r = dupliquerSelection(makeLots(), ['ligne-0-0-1', 'ligne-0-0-2'], uid(), 'rompre');
    const copies = lignesDe(r.lots).filter(l => /^n\d+$/.test(l.id));
    expect(copies).toHaveLength(2);
    expect(copies.every(l => !l.quantiteLiee)).toBe(true);
    expect(r.copies).toBe(2);
  });

  it('noeudSelectionne et noeudsRacines rendent les éléments à copier, une fois par racine', () => {
    const lots = makeLots();
    expect((noeudSelectionne(lots, { kind: 'ligne', lotIdx: 0, chapIdx: 0, lignePath: [1] }) as Ligne).id).toBe('b');
    expect((noeudSelectionne(lots, { kind: 'chapitre', lotIdx: 0, chapIdx: 1 }) as Chapitre).id).toBe('c1');
    expect(noeudSelectionne(lots, { kind: 'lot', lotIdx: 9 })).toBeUndefined();
    const racines = noeudsRacines(lots, ['chap-0-0', 'ligne-0-0-1', 'ligne-0-1-0']) as { id: string }[];
    expect(racines.map(n => n.id)).toEqual(['c0', 'c']);
  });
});

describe('suiveursEnCascade : supprimer aussi les postes liés', () => {
  const ids = (keys: string[]) => suiveursEnCascade(makeLots(), keys).lignes.map(l => l.id);

  it('prend les suiveurs d\'un article supprimé, et ceux de ces suiveurs, d\'un lot à l\'autre', () => {
    // a : suivi par b et d ; b : suivi par c
    expect(ids(['ligne-0-0-0']).sort()).toEqual(['b', 'c', 'd']);
  });

  it('donne les clés de ligne à ajouter à la sélection', () => {
    expect(suiveursEnCascade(makeLots(), ['ligne-0-0-0']).cles.sort()).toEqual(['ligne-0-0-1', 'ligne-0-1-0', 'ligne-1-0-0']);
  });

  it('ne reprend pas un suiveur déjà supprimé par la sélection', () => {
    expect(ids(['ligne-0-0-0', 'ligne-1-0-0']).sort()).toEqual(['b', 'c']);
    expect(ids(['lot-0'])).toEqual(['d']);
  });

  it('un article sans suiveur, ou une clé inconnue, ne donne rien', () => {
    expect(ids(['ligne-0-0-2'])).toEqual([]);
    expect(ids(['ligne-9-9-9'])).toEqual([]);
    expect(suiveursEnCascade(makeLots(), []).cles).toEqual([]);
  });

  it('supprimer la sélection et ces clés ne laisse plus aucun article lié à un poste disparu', () => {
    const { cles } = suiveursEnCascade(makeLots(), ['ligne-0-0-0']);
    const restant = deleteSelection(makeLots(), ['ligne-0-0-0', ...cles]);
    expect(lignesDe(restant).map(l => l.id)).toEqual(['x']);
  });

  it('sans les suiveurs, ils restent mais perdent leur lien et gardent leur quantité (figés)', () => {
    const restant = propagerLiens(deleteSelection(makeLots(), ['ligne-0-0-0']));
    const b = lignesDe(restant).find(l => l.id === 'b')!;
    expect(b.quantiteLiee).toBeUndefined();
    expect(b.quantite).toBe(4);
  });
});
