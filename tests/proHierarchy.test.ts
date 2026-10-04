import { describe, expect, it } from 'vitest';
import { duplicateHierarchy, moveHierarchy, promoteHierarchy } from '../src/components/pro/hierarchyOps';
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
