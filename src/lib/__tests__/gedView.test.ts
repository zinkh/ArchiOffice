import { describe, expect, it } from 'vitest';
import {
  GED_ALL, NO_FILTERS, NO_PROJECT, countBy, extensionOf, filterDocs, highlightParts, recentIds, sortDocs,
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
