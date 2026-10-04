import { describe, expect, it } from 'vitest';
import { collectSelectedLignes, deleteSelection, parseSelection, pasteLignes, totauxDocument } from '../src/components/pro/selectionOps';
import { foldForMobile, invokeToolbarAction, toolbarSignature, type ToolbarItem } from '../src/components/pro/toolbar/proToolbar';
import type { Ligne, Lot } from '../src/types/dpgf';

const ligne = (id: string, numero: string, prixTotal: number, children: Ligne[] = []): Ligne => ({
  id, numero, designation: id, unite: 'u', quantite: 1, prixUnitaire: prixTotal, prixTotal, type: 'ouvrage', children,
});

const makeLots = (): Lot[] => [
  {
    id: 'lot-1', numero: '01', titre: 'Gros œuvre', sousTotal: 999, chapitres: [
      { id: 'chap-1', numero: '01.1', titre: 'Fondations', lignes: [
        ligne('a', '01.1.1', 10),
        ligne('b', '01.1.2', 20, [ligne('b1', '01.1.2.1', 5), ligne('b2', '01.1.2.2', 7)]),
        ligne('c', '01.1.3', 30),
      ] },
      { id: 'chap-2', numero: '01.2', titre: 'Élévation', lignes: [ligne('d', '01.2.1', 40)] },
    ],
  },
  { id: 'lot-2', numero: '02', titre: 'Charpente', sousTotal: 0, chapitres: [
    { id: 'chap-3', numero: '02.1', titre: 'Bois', lignes: [ligne('e', '02.1.1', 100)] },
  ] },
];

describe('sélection PRO', () => {
  it('ordonne la sélection comme le document, parent avant descendant', () => {
    const keys = ['ligne-0-0-1-0', 'lot-1', 'chap-0-0', 'ligne-0-0-1', 'ligne-0-0-1', 'nimporte'];
    expect(parseSelection(keys).map(s => s.kind)).toEqual(['chapitre', 'ligne', 'ligne', 'lot']);
  });

  it('supprime plusieurs articles sans décaler les suivants et recalcule les sous-totaux', () => {
    const lots = makeLots();
    const before = structuredClone(lots);
    const next = deleteSelection(lots, ['ligne-0-0-0', 'ligne-0-0-2']);
    expect(next[0].chapitres[0].lignes.map(l => l.id)).toEqual(['b']);
    expect(next[0].sousTotal).toBe(12 + 40);
    expect(lots).toEqual(before);
  });

  it('supprime un parent et un de ses enfants sélectionnés ensemble', () => {
    const next = deleteSelection(makeLots(), ['ligne-0-0-1', 'ligne-0-0-1-0', 'chap-0-1', 'lot-1']);
    expect(next).toHaveLength(1);
    expect(next[0].chapitres.map(c => c.id)).toEqual(['chap-1']);
    expect(next[0].chapitres[0].lignes.map(l => l.id)).toEqual(['a', 'c']);
  });

  it('copie les articles sans doubler un enfant déjà emporté par son parent', () => {
    const copies = collectSelectedLignes(makeLots(), ['ligne-0-0-1-1', 'ligne-0-0-1', 'ligne-0-1-0', 'chap-0-0']);
    expect(copies.map(l => l.id)).toEqual(['b', 'd']);
    expect(copies[0].children?.map(l => l.id)).toEqual(['b1', 'b2']);
  });

  it('colle après l’article visé, avec de nouveaux identifiants et une numérotation suivie', () => {
    const lots = makeLots();
    const copies = collectSelectedLignes<Ligne>(lots, ['ligne-0-1-0']);
    let n = 0;
    const result = pasteLignes(lots, { kind: 'ligne', lotIdx: 0, chapIdx: 0, lignePath: [0] }, copies, () => `new-${n++}`)!;
    const lignes = result.lots[0].chapitres[0].lignes;
    expect(lignes.map(l => [l.id, l.numero])).toEqual([
      ['a', '01.1.1'], ['new-0', '01.1.2'], ['b', '01.1.3'], ['c', '01.1.4'],
    ]);
    expect(result.pasted).toEqual([{ kind: 'ligne', lotIdx: 0, chapIdx: 0, lignePath: [1] }]);
    expect(result.lots[0].sousTotal).toBe(10 + 40 + 12 + 30 + 40);
  });

  it('colle à la fin d’un chapitre visé, et refuse un lot comme destination', () => {
    const lots = makeLots();
    const result = pasteLignes(lots, { kind: 'chapitre', lotIdx: 1, chapIdx: 0 }, [ligne('x', '9', 1)], () => 'x2')!;
    expect(result.lots[1].chapitres[0].lignes.map(l => l.id)).toEqual(['e', 'x2']);
    expect(pasteLignes(lots, { kind: 'lot', lotIdx: 0 }, [ligne('x', '9', 1)], () => 'y')).toBeNull();
  });

  it('recalcule les totaux depuis les articles plutôt que depuis les montants enregistrés', () => {
    const totaux = totauxDocument(makeLots(), 20);
    expect(totaux.sousTotaux).toEqual([10 + 12 + 30 + 40, 100]);
    expect(totaux.totalHT).toBe(192);
    expect(totaux.montantTVA).toBeCloseTo(38.4);
    expect(totaux.totalTTC).toBeCloseTo(230.4);
  });
});

describe('barre d’outils PRO', () => {
  const calls: string[] = [];
  const items = (): ToolbarItem[] => [
    { kind: 'menu', id: 'add', label: 'Ajouter', mobile: true, entries: [
      { id: 'add-lot', label: 'Lot', onClick: () => calls.push('lot') },
      { id: 'add-art', label: 'Article', onClick: () => calls.push('article'), disabled: true },
    ] },
    { kind: 'button', id: 'lib', label: 'Bibliothèque', pressed: true, onClick: () => calls.push('lib') },
    { kind: 'segmented', id: 'cols', label: 'Colonnes', value: 'detail', onChange: v => calls.push(`cols:${v}`), options: [
      { id: 'synthese', label: 'Synthèse' }, { id: 'detail', label: 'Détail' },
    ] },
  ];

  it('exécute la dernière version d’une action et ignore une entrée grisée', () => {
    calls.length = 0;
    expect(invokeToolbarAction(items(), 'add-lot')).toBe(true);
    expect(invokeToolbarAction(items(), 'add-art')).toBe(false);
    expect(invokeToolbarAction(items(), 'cols', 'synthese')).toBe(true);
    expect(invokeToolbarAction(items(), 'cols::detail')).toBe(true);
    expect(calls).toEqual(['lot', 'cols:synthese', 'cols:detail']);
  });

  it('replie sur téléphone tout ce qui n’est pas marqué mobile', () => {
    const { visible, folded } = foldForMobile(items());
    expect(visible.map(i => i.id)).toEqual(['add']);
    expect(folded.map(e => e.id)).toEqual(['lib', 'cols__sep', 'cols__heading', 'cols::synthese', 'cols::detail']);
    expect(folded.find(e => e.id === 'lib')).toMatchObject({ checked: true });
    expect(folded.find(e => e.id === 'cols::detail')).toMatchObject({ checked: true });
  });

  it('ne change de signature que si l’apparence change', () => {
    const a = toolbarSignature(items());
    expect(toolbarSignature(items())).toBe(a);
    const changed = items();
    (changed[1] as Extract<ToolbarItem, { kind: 'button' }>).pressed = false;
    expect(toolbarSignature(changed)).not.toBe(a);
  });
});
