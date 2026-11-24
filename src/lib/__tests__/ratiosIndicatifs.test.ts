import { describe, expect, it } from 'vitest';
import { libelleRatios, ratioCorrespondant, ratiosPour, RATIO_MANUEL } from '../ratiosIndicatifs';

describe('ratiosIndicatifs', () => {
  it('liste des ratios par type', () => {
    expect(ratiosPour('rehabilitation').every(r => r.kind === 'rehabilitation')).toBe(true);
    expect(ratiosPour('extension').length).toBeGreaterThan(0);
  });

  it('retrouve le ratio indicatif d\'une valeur, sinon la saisie manuelle', () => {
    expect(ratioCorrespondant('extension', 1780)).toBe('ext_simple');
    expect(ratioCorrespondant('extension', 1234)).toBe(RATIO_MANUEL);
    expect(ratioCorrespondant('neuf', undefined)).toBe(RATIO_MANUEL);
  });

  it('libellé d\'une réhabilitation avec commentaire', () => {
    expect(libelleRatios({ nature: 'rehabilitation', ratioRehab: 900, ratioExtension: 1780, commentaire: 'Hors mise aux normes.' }))
      .toBe('Ratio appliqué : réhabilitation 900 €/m², extension 1780 €/m². Hors mise aux normes.');
  });

  it('libellé du neuf, sans commentaire, et vide sans ratio', () => {
    expect(libelleRatios({ nature: 'neuf', ratioRehab: 500, ratioExtension: 1800 })).toBe('Ratio appliqué : construction neuve 1800 €/m²');
    expect(libelleRatios({ nature: 'neuf', ratioRehab: 0, ratioExtension: 0, commentaire: 'x' })).toBe('');
  });
});
