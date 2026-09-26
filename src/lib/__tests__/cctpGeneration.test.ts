import { describe, expect, it } from 'vitest';
import { lotsDepuisGeneration } from '../cctpGeneration';

describe('lotsDepuisGeneration', () => {
  it('numérote à la suite des lots existants et marque la provenance IA', () => {
    let n = 0;
    const lots = lotsDepuisGeneration(
      [{ titre: 'Menuiseries extérieures', description: 'NF DTU 36.5', chapitres: [
        { titre: 'Fenêtres', description: '', articles: [{ designation: 'Fenêtre bois 2 vantaux', unite: 'U', localisation: 'Séjour', description: 'Uw ≤ 1,3' }] },
      ] }],
      3,
      'nomic',
      () => `id${n++}`,
    );
    expect(lots[0].numero).toBe('04');
    expect(lots[0].chapitres[0].numero).toBe('04.1');
    const ligne = lots[0].chapitres[0].lignes[0];
    expect(ligne).toMatchObject({ numero: '04.1.1', designation: 'Fenêtre bois 2 vantaux', localisation: 'Séjour', cctpDescription: 'Uw ≤ 1,3', genereParIa: 'nomic', quantite: 0, prixUnitaire: 0 });
    expect((lots[0] as any).cctpDescription).toBe('NF DTU 36.5');
  });
});
