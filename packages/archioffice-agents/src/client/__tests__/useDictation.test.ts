import { describe, expect, it } from 'vitest';
import { cumulativeDictationDelta } from '../useDictation.js';

describe('cumulativeDictationDelta', () => {
  it('keeps the first recognized phrase intact', () => {
    expect(cumulativeDictationDelta('', 'ajouter un rappel')).toBe('ajouter un rappel');
  });

  it('returns only the continuation of an Android cumulative result', () => {
    expect(cumulativeDictationDelta('ajouter', 'ajouter un rappel')).toBe('un rappel');
    expect(cumulativeDictationDelta(
      'ajouter un rappel envoyer le plan',
      'ajouter un rappel envoyer le plan à GVA',
    )).toBe('à GVA');
  });

  it('ignores an identical or shorter replay after an automatic restart', () => {
    expect(cumulativeDictationDelta('ajouter un rappel', 'ajouter un rappel')).toBe('');
    expect(cumulativeDictationDelta('ajouter un rappel', 'Ajouter')).toBe('');
  });

  it('does not remove an unrelated new phrase', () => {
    expect(cumulativeDictationDelta('ajouter un rappel', 'envoyer le plan')).toBe('envoyer le plan');
  });

  it('compares prefixes without being tripped by case or punctuation', () => {
    expect(cumulativeDictationDelta('Ajouter un rappel.', 'ajouter un rappel envoyer le plan')).toBe('envoyer le plan');
  });
});
