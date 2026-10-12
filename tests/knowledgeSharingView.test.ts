// Ce que voit le cabinet : src/lib/knowledgeSharingView.ts
import { describe, expect, it } from 'vitest';
import {
  type Contribution, type Publication, describeMasked, splitMasked, stageOf, summaryOf, totalMasked,
} from '../src/lib/knowledgeSharingView';

const base: Contribution = { id: 'c1', document_id: 'd1', status: 'queued', sanitized_text: '', warnings: [], created_at: '2026-10-11T10:00:00Z', origin: 'auto' };
const pub = (overrides: Partial<Publication> = {}): Publication => ({
  contribution_id: 'c1', remote_document_id: 'r1', state: 'published', deletion_requested_at: null, deleted_at: null, ...overrides,
});

describe('stageOf : un état clair, en toutes lettres', () => {
  it.each([
    ['queued', 'En attente d’analyse'], ['analyzing', 'Analyse en cours'], ['held', 'Retenu, rien n’a été envoyé'],
    ['draft', 'Brouillon à relire'],
  ] as const)('%s', (status, label) => {
    expect(stageOf({ ...base, status }, undefined, true).label).toBe(label);
  });

  it('distingue prêt à l’envoi et envoi désactivé sur l’instance', () => {
    const reviewed = { ...base, status: 'reviewed' as const };
    expect(stageOf(reviewed, undefined, true)).toMatchObject({ key: 'ready', label: 'Prêt à l’envoi' });
    const off = stageOf(reviewed, undefined, false);
    expect(off.key).toBe('ready-off');
    expect(off.detail).toMatch(/rien ne quitte ArchiOffice/);
  });

  it('un extrait validé à la main n’est pas présenté comme prêt à partir', () => {
    expect(stageOf({ ...base, status: 'reviewed', origin: 'manual' }, undefined, true).label).toBe('Validé, non envoyé');
  });

  it('suit l’envoi puis le retrait', () => {
    expect(stageOf({ ...base, status: 'reviewed' }, pub(), true).label).toBe('Envoyé');
    expect(stageOf({ ...base, status: 'reviewed' }, pub({ state: 'uncertain', remote_document_id: null }), true).label).toBe('Envoi à vérifier');
    expect(stageOf({ ...base, status: 'reviewed' }, pub({ state: 'delete_pending', deletion_requested_at: '2026-10-11' }), true).label).toBe('Retrait en cours');
    expect(stageOf({ ...base, status: 'reviewed' }, pub({ state: 'deleted' }), true).label).toBe('Retiré');
  });

  it('signale un retrait en échec répété', () => {
    const stuck = stageOf({ ...base, status: 'reviewed' }, pub({ state: 'delete_pending', deletion_requested_at: '2026-10-11', delete_attempts: 6 }), true);
    expect(stuck).toMatchObject({ key: 'removal-stuck', tone: 'warn' });
  });

  it('un retenu cite sa raison', () => {
    const held = stageOf({ ...base, status: 'held', analysis: { reason: 'Aucun texte exploitable.' } }, undefined, true);
    expect(held.detail).toBe('Aucun texte exploitable.');
  });
});

describe('résumés', () => {
  it('décrit ce qui a été masqué, du plus fréquent au moins fréquent', () => {
    expect(describeMasked({ ADRESSE: 2, PERSONNE: 3, MONTANT: 1 })).toBe('3 personnes, 2 adresses, 1 montant');
    expect(describeMasked({})).toBe('Aucun élément masqué');
    expect(describeMasked(undefined)).toBe('Aucun élément masqué');
    expect(totalMasked({ A: 2, B: 3 })).toBe(5);
  });

  it('fait le bilan d’un document analysé', () => {
    const text = summaryOf({ ...base, analysis: { paragraphs: 12, kept: 9, withheld: 2, masked: { PERSONNE: 4, ADRESSE: 1 } } });
    expect(text).toBe('9 paragraphes sur 12 partageables · 2 retenus par prudence · 5 éléments masqués');
    expect(summaryOf(base)).toBe('');
  });
});

describe('splitMasked', () => {
  it('met en évidence les balises de masquage', () => {
    expect(splitMasked('Pose par [ENTREPRISE] au [PERMIS], entraxe 600 mm.')).toEqual([
      { text: 'Pose par ', masked: false }, { text: '[ENTREPRISE]', masked: true, label: 'entreprise' },
      { text: ' au ', masked: false }, { text: '[PERMIS]', masked: true, label: 'permis' },
      { text: ', entraxe 600 mm.', masked: false },
    ]);
  });

  it('laisse un texte sans balise intact, et ne prend pas un crochet technique pour un masquage', () => {
    expect(splitMasked('Entraxe [600 mm] et [a]')).toEqual([{ text: 'Entraxe [600 mm] et [a]', masked: false }]);
  });
});
