import { describe, expect, it } from 'vitest';
import { wordDiff } from '../wordDiff';

const texte = (segments: ReturnType<typeof wordDiff>, type: 'same' | 'add' | 'del') =>
  segments.filter(s => s.type === type).map(s => s.text).join('');

describe('wordDiff', () => {
  it('rend un seul segment inchangé pour deux textes identiques', () => {
    expect(wordDiff('Semelles filantes', 'Semelles filantes')).toEqual([{ type: 'same', text: 'Semelles filantes' }]);
  });

  it('rend une liste vide pour deux textes vides', () => {
    expect(wordDiff('', '')).toEqual([]);
  });

  it('repère un mot ajouté en fin de phrase', () => {
    const diff = wordDiff('joints de retrait sciés', 'joints de retrait sciés tous les 5 m');
    expect(texte(diff, 'add').trim()).toBe('tous les 5 m');
    expect(texte(diff, 'del')).toBe('');
  });

  it('repère un mot remplacé : l\'ancien est retiré, le nouveau ajouté', () => {
    const diff = wordDiff('mise en dépôt pour réemploi', 'mise en dépôt sur site pour réemploi');
    expect(texte(diff, 'add').trim()).toBe('sur site');
    expect(texte(diff, 'del')).toBe('');
    const remplace = wordDiff('béton dosé à 350 kg', 'béton dosé à 400 kg');
    expect(texte(remplace, 'del')).toBe('350');
    expect(texte(remplace, 'add')).toBe('400');
  });

  it('reconstitue exactement les deux textes à partir des segments', () => {
    const avant = 'Décapage de la terre végétale sur 30 cm.\nMise en dépôt.';
    const apres = 'Décapage de la terre végétale sur 20 cm.\nMise en dépôt sur site.';
    const diff = wordDiff(avant, apres);
    expect(diff.filter(s => s.type !== 'add').map(s => s.text).join('')).toBe(avant);
    expect(diff.filter(s => s.type !== 'del').map(s => s.text).join('')).toBe(apres);
  });

  it('retombe sur « tout retiré puis tout ajouté » quand les textes sont trop longs pour un calcul exact', () => {
    const long = (mot: string) => Array.from({ length: 2500 }, (_, i) => `${mot}${i}`).join(' ');
    const diff = wordDiff(long('a'), long('b'));
    expect(diff.map(s => s.type)).toEqual(['del', 'add']);
  });
});
