import { describe, expect, it } from 'vitest';
import {
  GED_ALL, NO_FILTERS, NO_PROJECT, countBy, extensionOf, filterDocs, highlightParts, recentIds, sortDocs, emetteurKey, emetteurLabels,
  type GedDoc, type GedFilters,
} from '../gedView';

const docs: GedDoc[] = [
  { id: 'a', name: 'Plan RDC.pdf', project_id: 'p1', phase: 'PRO', doc_type: 'Plan', doc_statut: 'approuve', indice: 'C', uploaded_at: '2026-10-14T10:00:00Z' },
  { id: 'b', name: 'CCTP Lot 01.docx', project_id: 'p1', phase: 'PRO', doc_type: 'CCTP', uploaded_at: '2026-10-09T10:00:00Z' },
  { id: 'c', name: 'Esquisse volumétrie.pdf', project_id: 'p2', phase: 'APS', doc_type: 'Plan', uploaded_at: '2026-08-30T10:00:00Z' },
  { id: 'd', name: 'references-1.pdf', project_id: null, uploaded_at: '2026-10-31T10:00:00Z' },
];
const names: Record<string, string> = { p1: 'SELIA', p2: 'GOGI' };
const projectName = (id?: string | null) => (id ? names[id] || '' : '');
const ctx = (favs: string[] = []) => ({ favs: new Set(favs), recent: recentIds(docs, 2), projectName });
const run = (nav = GED_ALL, f: Partial<GedFilters> = {}, favs: string[] = []) =>
  filterDocs(docs, nav, { ...NO_FILTERS, ...f }, ctx(favs)).map(d => d.id);

describe('gedView', () => {
  it("lit l'extension d'un nom de fichier", () => {
    expect(extensionOf('Plan RDC.PDF')).toBe('pdf');
    expect(extensionOf('sans-extension')).toBe('');
    expect(extensionOf('.cache')).toBe('');
  });

  it('navigue par affaire, phase, sans projet, récents et favoris', () => {
    expect(run({ kind: 'project', project: 'p1' })).toEqual(['a', 'b']);
    expect(run({ kind: 'project', project: 'p1', value: 'PRO' })).toEqual(['a', 'b']);
    expect(run({ kind: 'project', project: 'p2', value: 'PRO' })).toEqual([]);
    expect(run({ kind: 'project', project: NO_PROJECT })).toEqual(['d']);
    expect(run({ kind: 'toclass' })).toEqual(['d']);
    expect(run({ kind: 'phase', value: 'Général' })).toEqual(['d']);
    expect(run({ kind: 'recent' })).toEqual(['a', 'd']);
    expect(run({ kind: 'fav' }, {}, ['c'])).toEqual(['c']);
  });

  it('compte une phase absente comme « Général » et un statut absent comme « en cours »', () => {
    expect(run({ kind: 'statut', value: 'en_cours' })).toEqual(['b', 'c', 'd']);
    expect(run({ kind: 'statut', value: 'approuve' })).toEqual(['a']);
  });

  it('filtre par phase, type, statut et extension', () => {
    expect(run(GED_ALL, { phase: 'APS' })).toEqual(['c']);
    expect(run(GED_ALL, { type: 'Plan' })).toEqual(['a', 'c']);
    expect(run(GED_ALL, { statut: 'approuve' })).toEqual(['a']);
    expect(run(GED_ALL, { extensions: new Set(['docx']) })).toEqual(['b']);
  });

  it('cherche sans tenir compte des accents ni de la casse, y compris dans le nom du projet', () => {
    expect(run(GED_ALL, { search: 'VOLUMETRIE' })).toEqual(['c']);
    expect(run(GED_ALL, { search: 'selia' })).toEqual(['a', 'b']);
    expect(run(GED_ALL, { search: 'introuvable' })).toEqual([]);
  });

  it('trie par date décroissante puis par nom', () => {
    const sorted = sortDocs(docs, { key: 'date', dir: 'desc' }, projectName).map(d => d.id);
    expect(sorted).toEqual(['d', 'a', 'b', 'c']);
    expect(sortDocs(docs, { key: 'name', dir: 'asc' }, projectName).map(d => d.id)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('découpe le texte autour des termes cherchés, accents ignorés', () => {
    expect(highlightParts('Esquisse volumétrie.pdf', 'volumetrie')).toEqual([
      { text: 'Esquisse ', hit: false }, { text: 'volumétrie', hit: true }, { text: '.pdf', hit: false },
    ]);
    expect(highlightParts('Plan', '')).toEqual([{ text: 'Plan', hit: false }]);
    expect(highlightParts('Plan', 'zzz')).toEqual([{ text: 'Plan', hit: false }]);
  });

  it('compte les documents par clé', () => {
    expect(countBy(docs, d => d.phase || 'Général').get('PRO')).toBe(2);
  });
});

describe('classement par émetteur', () => {
  const docs = [
    { id: '1', name: 'a.pdf', emetteur: 'COPAS Systèmes' },
    { id: '2', name: 'b.pdf', emetteur: ' copas  systemes ' },
    { id: '3', name: 'c.pdf', emetteur: 'COPAS Systèmes' },
    { id: '4', name: 'd.pdf', emetteur: '' },
    { id: '5', name: 'e.pdf' },
  ] as GedDoc[];
  const ctx = { favs: new Set<string>(), recent: new Set<string>(), projectName: () => '' };

  it('regroupe les graphies d\'un même émetteur (casse, accents, espaces)', () => {
    expect(emetteurKey(docs[1])).toBe(emetteurKey(docs[0]));
    const counts = countBy(docs, emetteurKey);
    expect(counts.get('copas systemes')).toBe(3);
    expect(counts.get('')).toBe(2);
  });

  it('affiche la graphie la plus fréquente', () => {
    expect(emetteurLabels(docs).get('copas systemes')).toBe('COPAS Systèmes');
    expect(emetteurLabels(docs).has('')).toBe(false);
  });

  it('filtre par émetteur, « sans émetteur » compris', () => {
    const by = (value: string) => filterDocs(docs, { kind: 'emetteur', value }, NO_FILTERS, ctx).map(d => d.id);
    expect(by('copas systemes')).toEqual(['1', '2', '3']);
    expect(by('')).toEqual(['4', '5']);
  });

  it('trie par émetteur', () => {
    const sorted = sortDocs(docs, { key: 'emetteur', dir: 'desc' }, () => '').map(d => d.id);
    expect(sorted.slice(0, 3).sort()).toEqual(['1', '2', '3']);
  });
});
