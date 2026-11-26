import { describe, expect, it } from 'vitest';
import {
  buildFolderTree, folderAndDescendantIds, folderChoices, folderDepth, folderNameKey, folderPath, normalizeFolderName,
  type DocFolder,
} from '../gedFolders';
import { GED_ALL, NO_FILTERS, filterDocs, type GedDoc } from '../gedView';

const folders: DocFolder[] = [
  { id: 'plans', project_id: 'p1', phase: 'PRO', parent_id: null, name: 'Plans' },
  { id: 'struct', project_id: 'p1', phase: 'PRO', parent_id: 'plans', name: 'Structure' },
  { id: 'ecrit', project_id: 'p1', phase: 'PRO', parent_id: null, name: 'Pièces écrites' },
  { id: 'dce', project_id: 'p1', phase: 'DCE', parent_id: null, name: 'Plans' },
  { id: 'autre', project_id: 'p2', phase: 'PRO', parent_id: null, name: 'Plans' },
];

describe('gedFolders', () => {
  it('nettoie un nom et refuse les noms impossibles chez un fournisseur de stockage', () => {
    expect(normalizeFolderName('  Plans   RDC ')).toEqual({ name: 'Plans RDC' });
    expect(normalizeFolderName('')).toHaveProperty('error');
    expect(normalizeFolderName(42)).toHaveProperty('error');
    expect(normalizeFolderName('a/b')).toHaveProperty('error');
    expect(normalizeFolderName('Plans.')).toHaveProperty('error');
    expect(normalizeFolderName('..')).toHaveProperty('error');
    expect(normalizeFolderName('x'.repeat(81))).toHaveProperty('error');
  });

  it('compare les noms sans tenir compte de la casse, des accents ni des espaces multiples', () => {
    expect(folderNameKey('Pièces  Écrites')).toBe(folderNameKey('pieces ecrites'));
  });

  it('construit l’arbre d’une affaire et d’une phase, trié par nom', () => {
    const tree = buildFolderTree(folders.filter(f => f.project_id === 'p1' && f.phase === 'PRO'));
    expect(tree.map(n => n.name)).toEqual(['Pièces écrites', 'Plans']);
    expect(tree[1].children.map(n => n.name)).toEqual(['Structure']);
    expect(tree[1].children[0].depth).toBe(2);
  });

  it('calcule profondeur, descendants et chemin', () => {
    expect(folderDepth('plans', folders)).toBe(1);
    expect(folderDepth('struct', folders)).toBe(2);
    expect(folderDepth('inconnu', folders)).toBeNull();
    expect([...folderAndDescendantIds('plans', folders)].sort()).toEqual(['plans', 'struct']);
    expect(folderPath('struct', folders)).toEqual(['Plans', 'Structure']);
    expect(folderPath(null, folders)).toEqual([]);
  });

  it('détecte une chaîne de parents cyclique', () => {
    const cyc: DocFolder[] = [
      { id: 'a', project_id: 'p', phase: 'PRO', parent_id: 'b', name: 'A' },
      { id: 'b', project_id: 'p', phase: 'PRO', parent_id: 'a', name: 'B' },
    ];
    expect(folderDepth('a', cyc)).toBeNull();
    expect(folderPath('a', cyc).length).toBeLessThanOrEqual(2);
  });

  it('propose pour un document les dossiers de son affaire et de sa phase, avec leur chemin', () => {
    expect(folderChoices('p1', 'PRO', folders)).toEqual([
      { id: 'ecrit', label: 'Pièces écrites' }, { id: 'plans', label: 'Plans' }, { id: 'struct', label: 'Plans / Structure' },
    ]);
    expect(folderChoices('p1', 'ESQ', folders)).toEqual([]);
    expect(folderChoices(null, 'PRO', folders)).toEqual([]);
  });

  it('filtre les documents d’un dossier, sous-dossiers compris', () => {
    const docs: GedDoc[] = [
      { id: '1', name: 'a.pdf', project_id: 'p1', phase: 'PRO', folder_id: 'plans' },
      { id: '2', name: 'b.pdf', project_id: 'p1', phase: 'PRO', folder_id: 'struct' },
      { id: '3', name: 'c.pdf', project_id: 'p1', phase: 'PRO', folder_id: 'ecrit' },
      { id: '4', name: 'd.pdf', project_id: 'p1', phase: 'PRO', folder_id: null },
    ];
    const ctx = { favs: new Set<string>(), recent: new Set<string>(), projectName: () => '', folders };
    const ids = (nav: any) => filterDocs(docs, nav, NO_FILTERS, ctx).map(d => d.id);
    expect(ids({ kind: 'folder', folder: 'plans' })).toEqual(['1', '2']);
    expect(ids({ kind: 'folder', folder: 'struct' })).toEqual(['2']);
    expect(ids({ kind: 'folder' })).toEqual([]);
    expect(ids(GED_ALL)).toHaveLength(4);
    // La phase entière garde tous ses documents, rangés ou non.
    expect(ids({ kind: 'project', project: 'p1', value: 'PRO' })).toHaveLength(4);
  });
});
