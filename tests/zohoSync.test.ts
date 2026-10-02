// Couvre zohoItemIdentity() — la fonction pure qui décide du nom et de la
// description de l'« article » Zoho créé pour chaque ligne de facture
// ArchiOffice (server/zohoSync.ts). Testée séparément des routes zohoInvoice/
// zohoBooks : tests/fakeSupabaseAdmin.ts ne résout pas les relations imbriquées
// (`select('*, projects(...))')`), donc un test de bout en bout ne verrait
// jamais le numéro/nom d'affaire réellement circuler — cette fonction pure
// est le seul endroit où ce comportement est directement vérifiable.
import { describe, expect, it } from 'vitest';
import { zohoItemIdentity } from '../server/zohoSync';

describe('zohoItemIdentity', () => {
  it('garde le seul intitulé de la ligne quand aucune affaire n\'est rattachée — rien à indiquer', () => {
    expect(zohoItemIdentity('Honoraires ESQ', undefined)).toEqual({ name: 'Honoraires ESQ', description: undefined });
    expect(zohoItemIdentity(undefined, {})).toEqual({ name: 'Honoraires', description: undefined });
  });

  it('inscrit le numéro et le nom d\'affaire dans le NOM de l\'article, et l\'adresse dans sa description', () => {
    const result = zohoItemIdentity('Honoraires ESQ', {
      projectCode: '26014', projectName: 'Villa Martin', projectAddress: '12 rue des Lilas, 54000 Nancy',
    });
    expect(result.name).toBe('Honoraires ESQ — 26014 Villa Martin');
    expect(result.description).toBe('12 rue des Lilas, 54000 Nancy');
  });

  it('se limite au nom d\'affaire quand le contrat/projet ne porte pas de numéro', () => {
    const result = zohoItemIdentity('Honoraires', { projectName: 'Villa Martin' });
    expect(result.name).toBe('Honoraires — Villa Martin');
    expect(result.description).toBeUndefined();
  });

  // Zoho impose un nom d'article unique par organisation : deux affaires
  // portant la même ligne générique ("Honoraires") ne doivent jamais produire
  // le même nom, sous peine de voir la seconde réutiliser l'article — et donc
  // l'historique de facturation — de la première.
  it('deux affaires différentes ne produisent jamais le même nom d\'article pour une ligne identique', () => {
    const a = zohoItemIdentity('Honoraires ESQ', { projectCode: '26014', projectName: 'Villa Martin' });
    const b = zohoItemIdentity('Honoraires ESQ', { projectCode: '26015', projectName: 'Villa Dupont' });
    expect(a.name).not.toBe(b.name);
  });

  it('une seconde facture sur la MÊME affaire (un second acompte) retombe sur le même nom d\'article', () => {
    const a = zohoItemIdentity('Honoraires APS', { projectCode: '26014', projectName: 'Villa Martin' });
    const b = zohoItemIdentity('Honoraires APS', { projectCode: '26014', projectName: 'Villa Martin' });
    expect(a.name).toBe(b.name);
  });
});
