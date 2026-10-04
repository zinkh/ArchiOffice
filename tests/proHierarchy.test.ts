import { describe, expect, it } from 'vitest';
import { canDemote, demoteHierarchy, duplicateHierarchy, moveHierarchy, promoteHierarchy } from '../src/components/pro/hierarchyOps';
import { renumeroterLignes } from '../src/components/pro/treeOps';
import type { Lot } from '../src/types/dpgf';

const makeLots = (): Lot[] => [{
  id: 'lot-1', numero: '01', titre: 'Gros œuvre', chapitres: [
    { id: 'chap-1', numero: '01.1', titre: 'Fondations', lignes: [
      { id: 'a', numero: '01.1.1', designation: 'Semelle', unite: 'u', quantite: 2, prixUnitaire: 10, prixTotal: 20, type: 'ouvrage', children: [] },
      { id: 'b', numero: '01.1.2', designation: 'Longrine', unite: 'u', quantite: 1, prixUnitaire: 30, prixTotal: 30, type: 'ouvrage', children: [] },
    ] },
    { id: 'chap-2', numero: '01.2', titre: 'Élévation', lignes: [] },
  ], sousTotal: 50,
}];

describe('hiérarchie PRO', () => {
  it('descend un article sous une feuille chiffrée sans perdre les prix ni les IDs', () => {
    const lots = makeLots();
    const before = structuredClone(lots);
    const result = demoteHierarchy(lots, { kind: 'ligne', lotIdx: 0, chapIdx: 0, lignePath: [1] }, () => 'group');
    const group = result.lots[0].chapitres[0].lignes[0];
    expect(group).toMatchObject({ id: 'group', type: 'titre' });
    expect(group.children?.map(l => [l.id, l.prixTotal, l.numero])).toEqual([
      ['a', 20, '01.1.1.1'], ['b', 30, '01.1.1.2'],
    ]);
    expect(result.selection).toEqual({ kind: 'ligne', lotIdx: 0, chapIdx: 0, lignePath: [0, 1] });
    expect(result.lots[0].sousTotal).toBe(50);
    expect(lots).toEqual(before);
  });

  it('convertit un chapitre en sous-groupe et conserve ses métadonnées et enfants', () => {
    const lots = makeLots();
    lots[0].chapitres[1] = { ...lots[0].chapitres[1], cctpDescription: 'Texte technique', batimentId: 'B', lignes: [{ ...lots[0].chapitres[0].lignes[0], id: 'c' }] };
    const result = demoteHierarchy(lots, { kind: 'chapitre', lotIdx: 0, chapIdx: 1 }, () => 'unused');
    expect(result.lots[0].chapitres).toHaveLength(1);
    const group = result.lots[0].chapitres[0].lignes[2];
    expect(group).toMatchObject({ id: 'chap-2', designation: 'Élévation', type: 'titre', batimentId: 'B', cctpDescription: 'Texte technique' });
    expect(group.children?.[0]).toMatchObject({ id: 'c', numero: '01.1.3.1', prixTotal: 20 });
    expect(result.lots[0].sousTotal).toBe(70);
    expect(result.selection).toEqual({ kind: 'ligne', lotIdx: 0, chapIdx: 0, lignePath: [2] });
    const restored = promoteHierarchy(result.lots, result.selection, () => 'unused');
    expect(restored.lots[0].chapitres[1]).toMatchObject({ id: 'chap-2', titre: 'Élévation', batimentId: 'B' });
    expect(restored.lots[0].sousTotal).toBe(70);
  });

  it('refuse le premier élément, les lots, et un sous-arbre qui dépasserait la limite', () => {
    const lots = makeLots();
    expect(canDemote(lots, { kind: 'lot', lotIdx: 0 })).toBe(false);
    expect(canDemote(lots, { kind: 'chapitre', lotIdx: 0, chapIdx: 0 })).toBe(false);
    expect(canDemote(lots, { kind: 'ligne', lotIdx: 0, chapIdx: 0, lignePath: [0] })).toBe(false);
    const selection = { kind: 'ligne' as const, lotIdx: 0, chapIdx: 0, lignePath: [1] };
    let line = lots[0].chapitres[0].lignes[1];
    for (let i = 0; i < 4; i++) {
      line.children = [{ ...line, id: `limit-${i}`, children: [] }];
      line = line.children[0];
    }
    expect(canDemote(lots, selection)).toBe(false);
    expect(demoteHierarchy(lots, selection, () => 'unused').lots).toBe(lots);
    lots[0].chapitres[1].lignes = [lots[0].chapitres[0].lignes[1]];
    expect(canDemote(lots, { kind: 'chapitre', lotIdx: 0, chapIdx: 1 })).toBe(false);
  });

  it('descend un sous-article au septième niveau, avec lettres et sélection correcte', () => {
    const lots = makeLots();
    const leaf = lots[0].chapitres[0].lignes[0];
    let parent = leaf;
    for (let i = 0; i < 3; i++) {
      parent.children = [{ ...leaf, id: `level-${i}`, children: [] }];
      parent = parent.children[0];
    }
    parent.children = [{ ...leaf, id: 'previous', type: 'titre', quantite: 0, prixUnitaire: 0, prixTotal: 0, children: [] }];
    // Les frères se trouvent au niveau 6 ; le déplacement atteint le niveau 7.
    const level6 = leaf.children![0].children![0].children!;
    level6.push({ ...leaf, id: 'selected', children: [] });
    const selection = { kind: 'ligne' as const, lotIdx: 0, chapIdx: 0, lignePath: [0, 0, 0, 1] };
    expect(canDemote(lots, selection)).toBe(true);
    const result = demoteHierarchy(lots, selection, () => 'unused');
    const moved = result.lots[0].chapitres[0].lignes[0].children![0].children![0].children![0].children![1];
    expect(moved).toMatchObject({ id: 'selected', numero: '01.1.1.1.1.1.b' });
    expect(result.selection).toEqual({ ...selection, lignePath: [0, 0, 0, 0, 1] });
    expect(canDemote(result.lots, result.selection)).toBe(false);
  });

  it('préserve les affectations héritées malgré celles du nouveau parent', () => {
    const lots = makeLots();
    lots[0].batimentId = 'source';
    lots[0].chapitres[0].lignes[0].batimentId = 'destination';
    lots[0].chapitres[0].lignes[0].children = [{ ...lots[0].chapitres[0].lignes[1], id: 'child' }];
    const result = demoteHierarchy(lots, { kind: 'ligne', lotIdx: 0, chapIdx: 0, lignePath: [1] }, () => 'unused');
    expect(result.lots[0].chapitres[0].lignes[0].children![1].batimentId).toBe('source');
  });

  it('déplace un chapitre et conserve la sélection logique', () => {
    const result = moveHierarchy(makeLots(), { kind: 'chapitre', lotIdx: 0, chapIdx: 1 }, -1);
    expect(result.lots[0].chapitres.map(c => c.id)).toEqual(['chap-2', 'chap-1']);
    expect(result.selection).toEqual({ kind: 'chapitre', lotIdx: 0, chapIdx: 0 });
  });

  it('duplique lot, chapitre et article avec des identifiants indépendants', () => {
    let n = 0; const id = () => `copy-${++n}`;
    const lot = duplicateHierarchy(makeLots(), { kind: 'lot', lotIdx: 0 }, id);
    expect(lot.lots).toHaveLength(2);
    expect(lot.lots[1].chapitres[0].id).not.toBe('chap-1');
    const article = duplicateHierarchy(makeLots(), { kind: 'ligne', lotIdx: 0, chapIdx: 0, lignePath: [0] }, id);
    expect(article.lots[0].chapitres[0].lignes).toHaveLength(3);
    expect(article.lots[0].chapitres[0].lignes[1].id).not.toBe('a');
  });

  it('remonte un article en chapitre sans perdre son montant', () => {
    const result = promoteHierarchy(makeLots(), { kind: 'ligne', lotIdx: 0, chapIdx: 0, lignePath: [0] }, () => 'new-chapter');
    const chapter = result.lots[0].chapitres[1];
    expect(chapter.titre).toBe('Semelle');
    expect(chapter.lignes[0]).toMatchObject({ id: 'a', prixTotal: 20 });
    expect(result.lots[0].sousTotal).toBe(50);
  });

  it('utilise des lettres au septième niveau', () => {
    const lots = makeLots();
    let node = lots[0].chapitres[0].lignes[0];
    for (let i = 0; i < 4; i++) {
      node.children = [{ ...node, id: `deep-${i}`, children: [] }];
      node = node.children[0];
    }
    const numbered = renumeroterLignes(lots[0].chapitres[0].lignes, '01.1');
    expect(numbered[0].children?.[0].children?.[0].children?.[0].children?.[0].numero).toBe('01.1.1.1.1.1.a');
  });
});
