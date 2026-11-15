import { describe, expect, it } from 'vitest';
import { textePdf } from '../pdfTexte';

describe('textePdf', () => {
  it('remplace les symboles hors WinAnsi par un équivalent lisible', () => {
    expect(textePdf("Taux d'humidité ≤ 18 %")).toBe("Taux d'humidité <= 18 %");
    expect(textePdf('Entraxes ≥ 40 cm, Uw ≈ 1,3')).toBe('Entraxes >= 40 cm, Uw ~ 1,3');
  });

  it('remplace les espaces fines par une espace ordinaire', () => {
    expect(textePdf('18 898,25')).toBe('18 898,25');
  });

  it('garde intacts les accents, œ, €, tirets et guillemets WinAnsi', () => {
    const s = 'Mise en œuvre « dès » 12 m² – 3 500 € ’ ° ± ×';
    expect(textePdf(s)).toBe(s);
  });

  it('supprime ce qui reste illisible sans lever d’erreur', () => {
    expect(textePdf('a😀b')).toBe('ab');
  });
});
