import { describe, expect, it } from 'vitest';
import { appliquerProposition, propositionsListe } from '../src/components/pro/EditableCell';
import { localisationsConnues, localisationsDeLigne } from '../src/lib/cctpImages';
import type { Ligne } from '../src/types/dpgf';

const ligne = (id: string, localisation?: string, children: Ligne[] = []): Ligne => ({
  id, numero: id, designation: id, unite: 'u', quantite: 1, prixUnitaire: 0, prixTotal: 0, type: 'ouvrage', localisation, children,
});
const doc = (lignes: Ligne[]) => ({ lots: [{ id: 'l', numero: '01', titre: 'L', sousTotal: 0, chapitres: [{ id: 'c', numero: '1', titre: 'C', lignes }] }] });

describe('localisations séparées par des virgules', () => {
  it('découpe, nettoie et ignore les vides', () => {
    expect(localisationsDeLigne(' Sanitaire PMR ,  WC  personnel,, ')).toEqual(['Sanitaire PMR', 'WC personnel']);
    expect(localisationsDeLigne(undefined)).toEqual([]);
  });

  it('chaque localisation du projet compte à part, les plus fréquentes d\'abord', () => {
    const d = doc([ligne('a', 'Cuisine, Salle'), ligne('b', 'Salle'), ligne('d', 'salle'), ligne('c', 'Réserve', [ligne('c1', 'Cuisine')])]);
    expect(localisationsConnues(d)).toEqual(['Salle', 'Cuisine', 'Réserve']);
  });
});

describe('propositions', () => {
  const connues = ['Cuisine', 'Sanitaire PMR', 'Sanitaires publics', 'Salle'];

  it('filtre sur la dernière valeur, sans tenir compte des accents ni de la casse', () => {
    expect(propositionsListe('san', connues)).toEqual(['Sanitaire PMR', 'Sanitaires publics']);
    expect(propositionsListe('Cuisine, SA', connues)).toEqual(['Sanitaire PMR', 'Sanitaires publics', 'Salle']);
  });

  it('n\'offre pas ce qui est déjà saisi', () => {
    expect(propositionsListe('Cuisine, ', connues)).not.toContain('Cuisine');
    expect(propositionsListe('Cuisine', connues)).toEqual([]);
  });

  it('une proposition remplace la dernière valeur', () => {
    expect(appliquerProposition('Cuisine, san', 'Sanitaire PMR')).toBe('Cuisine, Sanitaire PMR');
    expect(appliquerProposition('sal', 'Salle')).toBe('Salle');
  });
});
