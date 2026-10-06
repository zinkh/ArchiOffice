import { describe, expect, it } from 'vitest';
import { typographie } from '../feasibilityBlocks';

describe('typographie', () => {
  it('remplace *texte* par des guillemets français', () => {
    expect(typographie('le restaurant *Au Comptoir* ouvre')).toBe('le restaurant « Au Comptoir » ouvre');
  });
  it('remplace les guillemets droits', () => {
    expect(typographie('le "Comptoir"')).toBe('le « Comptoir »');
  });
  it('retire le gras Markdown', () => {
    expect(typographie('un **point** clé')).toBe('un point clé');
  });
  it('ne touche pas une multiplication', () => {
    expect(typographie('3 * 4 et 5 * 6')).toBe('3 * 4 et 5 * 6');
  });
});
