import { describe, expect, it } from 'vitest';
import { anonymizeTechnicalText, MAX_SHARED_EXCERPT_CHARS } from '../server/knowledge/anonymize';

describe('prévisualisation anonymisée — base commune', () => {
  it('masque emails, téléphones et adresses postales', () => {
    const result = anonymizeTechnicalText(
      'Contact : jean.dupont@example.fr, 06 12 34 56 78, 23 boulevard de l’Europe, Nancy. ' +
      'Bardage vertical en bois, entraxe 600 mm.',
    );
    expect(result.text).not.toContain('jean.dupont@example.fr');
    expect(result.text).not.toContain('06 12 34 56 78');
    expect(result.text).not.toContain('23 boulevard');
    expect(result.text).toContain('Bardage vertical');
    expect(result.replacements).toBeGreaterThanOrEqual(3);
  });

  it('ne traite pas un champ vide comme une contribution sûre', () => {
    const result = anonymizeTechnicalText('  ');
    expect(result.text).toBe('');
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('n’affirme jamais une anonymisation automatique complète', () => {
    const result = anonymizeTechnicalText('Entreprise Martin : lot couverture en ardoise.');
    expect(result.warnings.join(' ')).toContain('Contrôle humain obligatoire');
    expect(result.warnings.join(' ')).toMatch(/entreprises|projets/i);
  });

  it('borne la taille des extraits avant leur stockage', () => {
    const result = anonymizeTechnicalText('a'.repeat(MAX_SHARED_EXCERPT_CHARS + 50));
    expect(result.text.length).toBe(MAX_SHARED_EXCERPT_CHARS);
    expect(result.warnings.join(' ')).toContain('tronqué');
  });
});
