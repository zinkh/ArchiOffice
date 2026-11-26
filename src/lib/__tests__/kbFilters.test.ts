// Logique pure de la base de données du cabinet : src/lib/kb.ts (filtres, tris, validation, arbre).
import { describe, expect, it } from 'vitest';
import {
  applyKbView, kbContentToText, kbDepth, kbFilterOps, kbOpNeedsValue, kbWouldCycle, sanitizeKbOptions, sanitizeKbValue,
  type KbPage, type KbProperty,
} from '../kb';

const options = [
  { id: 'o-vitree', label: 'Construction vitrée', color: 'bleu' as const },
  { id: 'o-pave', label: 'Pavés de verre', color: 'brique' as const },
  { id: 'o-metal', label: 'Structure métallique', color: 'gris' as const },
];
const properties: KbProperty[] = [
  { id: 'nom', database_id: 'db', name: 'Nom', type: 'title', options: [], position: 0 },
  { id: 'produits', database_id: 'db', name: 'Produits', type: 'multi_select', options, position: 1 },
  { id: 'poids', database_id: 'db', name: 'Poids', type: 'number', options: [], position: 2 },
  { id: 'actif', database_id: 'db', name: 'Actif', type: 'checkbox', options: [], position: 3 },
];
const row = (id: string, title: string, props: Record<string, unknown>, position = 0): KbPage => ({
  id, parent_id: 'db', kind: 'page', title, icon: null, properties: props, position, is_favorite: false,
});
const rows = [
  row('1', 'La Rochère', { produits: ['o-vitree', 'o-pave'], poids: 12, actif: true }, 1),
  row('2', 'SOTTAS', { produits: ['o-vitree', 'o-metal'], poids: 3 }, 2),
  row('3', 'Éléphant', { poids: 30 }, 3),
];

describe('applyKbView', () => {
  it('cherche sans tenir compte de la casse ni des accents, dans toutes les colonnes', () => {
    expect(applyKbView(rows, properties, {}, 'elephant').map(r => r.id)).toEqual(['3']);
    expect(applyKbView(rows, properties, {}, 'pavés').map(r => r.id)).toEqual(['1']);
  });

  it('filtre une étiquette (« a », « n\'a pas ») et les valeurs vides', () => {
    expect(applyKbView(rows, properties, { filters: [{ property_id: 'produits', op: 'has', value: 'o-vitree' }] }).map(r => r.id)).toEqual(['1', '2']);
    expect(applyKbView(rows, properties, { filters: [{ property_id: 'produits', op: 'has_not', value: 'o-vitree' }] }).map(r => r.id)).toEqual(['3']);
    expect(applyKbView(rows, properties, { filters: [{ property_id: 'produits', op: 'is_empty' }] }).map(r => r.id)).toEqual(['3']);
    expect(applyKbView(rows, properties, { filters: [{ property_id: 'actif', op: 'checked' }] }).map(r => r.id)).toEqual(['1']);
  });

  it('cumule les filtres (ET) et ignore une propriété disparue', () => {
    const filters = [
      { property_id: 'produits', op: 'has' as const, value: 'o-vitree' },
      { property_id: 'nom', op: 'contains' as const, value: 'sottas' },
      { property_id: 'supprimee', op: 'contains' as const, value: 'zzz' },
    ];
    expect(applyKbView(rows, properties, { filters }).map(r => r.id)).toEqual(['2']);
  });

  it('trie les nombres comme des nombres et les textes en français', () => {
    expect(applyKbView(rows, properties, { sorts: [{ property_id: 'poids', direction: 'desc' }] }).map(r => r.id)).toEqual(['3', '1', '2']);
    expect(applyKbView(rows, properties, { sorts: [{ property_id: 'nom', direction: 'asc' }] }).map(r => r.id)).toEqual(['3', '1', '2']);
  });

  it('sans tri, garde l\'ordre de position et ne modifie pas le tableau reçu', () => {
    const shuffled = [rows[2], rows[0], rows[1]];
    expect(applyKbView(shuffled, properties, {}).map(r => r.id)).toEqual(['1', '2', '3']);
    expect(shuffled.map(r => r.id)).toEqual(['3', '1', '2']);
  });
});

describe('sanitizeKbValue', () => {
  it('valide chaque type de cellule', () => {
    const p = (type: KbProperty['type']) => ({ type, options });
    expect(sanitizeKbValue(p('number'), '12,5')).toEqual({ value: 12.5 });
    expect(sanitizeKbValue(p('number'), 'abc').error).toBeDefined();
    expect(sanitizeKbValue(p('checkbox'), true)).toEqual({ value: true });
    expect(sanitizeKbValue(p('checkbox'), 'oui').error).toBeDefined();
    expect(sanitizeKbValue(p('date'), '2026-11-26T10:00:00Z')).toEqual({ value: '2026-11-26' });
    expect(sanitizeKbValue(p('date'), 'demain').error).toBeDefined();
    expect(sanitizeKbValue(p('select'), 'o-pave')).toEqual({ value: 'o-pave' });
    expect(sanitizeKbValue(p('select'), 'inconnue').error).toBeDefined();
    expect(sanitizeKbValue(p('multi_select'), ['o-pave', 'o-pave', 'o-metal'])).toEqual({ value: ['o-pave', 'o-metal'] });
    expect(sanitizeKbValue(p('multi_select'), ['o-pave', 'x']).error).toBeDefined();
    expect(sanitizeKbValue(p('text'), null)).toEqual({ value: null });
  });
});

describe('sanitizeKbOptions', () => {
  it('retire les doublons et libellés vides, borne la couleur à la palette et garde les ids existants', () => {
    let n = 0;
    const out = sanitizeKbOptions([
      { id: 'keep', label: ' Bois ', color: 'ocre' },
      { label: 'bois', color: 'bleu' },
      { label: '', color: 'bleu' },
      { label: 'Verre', color: 'fluo' },
    ], () => `new-${++n}`);
    expect(out).toEqual([
      { id: 'keep', label: 'Bois', color: 'ocre' },
      { id: 'new-1', label: 'Verre', color: 'gris' },
    ]);
  });
});

describe('arbre de pages', () => {
  const tree = [
    { id: 'a', parent_id: null }, { id: 'b', parent_id: 'a' }, { id: 'c', parent_id: 'b' },
  ];
  it('calcule la profondeur et détecte une chaîne bouclée', () => {
    expect(kbDepth('a', tree)).toBe(0);
    expect(kbDepth('c', tree)).toBe(2);
    expect(kbDepth('x', tree)).toBeNull();
    expect(kbDepth('a', [{ id: 'a', parent_id: 'b' }, { id: 'b', parent_id: 'a' }])).toBeNull();
  });
  it('refuse de placer une page sous elle-même ou sous un descendant', () => {
    expect(kbWouldCycle('a', 'c', tree)).toBe(true);
    expect(kbWouldCycle('a', 'a', tree)).toBe(true);
    expect(kbWouldCycle('c', 'a', tree)).toBe(false);
    expect(kbWouldCycle('c', null, tree)).toBe(false);
  });
});

describe('kbFilterOps', () => {
  it('propose des opérateurs adaptés au type de colonne, le premier par défaut', () => {
    expect(kbFilterOps('multi_select')[0]).toBe('has');
    expect(kbFilterOps('checkbox')).toEqual(['checked', 'unchecked']);
    expect(kbFilterOps('text')[0]).toBe('contains');
    expect(kbFilterOps('relation')).toEqual(['is_empty', 'is_not_empty']);
  });

  it('sait quels opérateurs attendent une valeur', () => {
    expect(kbOpNeedsValue('contains')).toBe(true);
    expect(kbOpNeedsValue('has')).toBe(true);
    expect(kbOpNeedsValue('is_empty')).toBe(false);
    expect(kbOpNeedsValue('checked')).toBe(false);
  });
});

describe('kbContentToText', () => {
  it('extrait le texte brut d\'un document Tiptap', () => {
    const doc = { type: 'doc', content: [
      { type: 'heading', content: [{ type: 'text', text: 'Titre' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Corps' }] },
    ] };
    expect(kbContentToText(doc)).toBe('Titre\nCorps');
    expect(kbContentToText(null)).toBe('');
  });
});
