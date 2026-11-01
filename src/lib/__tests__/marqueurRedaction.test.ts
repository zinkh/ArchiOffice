import { describe, it, expect } from 'vitest';
import {
  PAR_AGENT, ancienMarqueur, compterMarqueurs, creerMarqueur, enCoursParAutre, estParAgent, libelleMarqueur,
  memeMarqueur, noeudsMarques, normaliserMarqueur,
} from '../marqueurRedaction';
import type { Lot } from '../../types/dpgf';

const MAINTENANT = new Date('2026-11-01T10:00:00Z');

describe('normaliserMarqueur', () => {
  it('garde un marqueur valide et borne les textes', () => {
    const m = normaliserMarqueur({ statut: 'en_cours', par: '  Sophie ', le: '2026-11-01T08:00:00Z', note: 'x'.repeat(500) });
    expect(m).toEqual({ statut: 'en_cours', par: 'Sophie', le: '2026-11-01T08:00:00Z', note: 'x'.repeat(300) });
  });

  it('rejette un statut inconnu ou une valeur qui n’est pas un objet', () => {
    expect(normaliserMarqueur({ statut: 'termine' })).toBeUndefined();
    expect(normaliserMarqueur('incomplet')).toBeUndefined();
    expect(normaliserMarqueur(null)).toBeUndefined();
  });

  it('ignore une date illisible, un auteur ou une note vides', () => {
    expect(normaliserMarqueur({ statut: 'incomplet', le: 'hier', par: ' ', note: '' })).toEqual({ statut: 'incomplet' });
  });
});

describe('creerMarqueur et memeMarqueur', () => {
  it('pose l’auteur et la date, et compare sans eux', () => {
    const a = creerMarqueur('incomplet', 'Sophie', 'Prix à confirmer', MAINTENANT);
    expect(a).toEqual({ statut: 'incomplet', par: 'Sophie', le: '2026-11-01T10:00:00.000Z', note: 'Prix à confirmer' });
    expect(memeMarqueur(a, creerMarqueur('incomplet', 'Marc', 'Prix à confirmer', new Date()))).toBe(true);
    expect(memeMarqueur(a, creerMarqueur('en_cours', 'Sophie', 'Prix à confirmer'))).toBe(false);
    expect(memeMarqueur(undefined, undefined)).toBe(true);
    expect(memeMarqueur(a, undefined)).toBe(false);
  });
});

describe('noeudsMarques et compterMarqueurs', () => {
  const lots: Lot[] = [{
    id: 'l1', numero: '01', titre: 'Gros œuvre', sousTotal: 0, marqueur: { statut: 'incomplet' }, chapitres: [{
      id: 'c1', numero: '1', titre: 'Fondations', lignes: [
        { id: 'a', numero: '1.1', designation: 'Dallage', unite: 'm²', quantite: 1, prixUnitaire: 0, prixTotal: 0, type: 'ouvrage', marqueur: { statut: 'en_cours', par: 'Sophie' },
          children: [{ id: 'a1', numero: '1.1.1', designation: 'Treillis', unite: 'm²', quantite: 1, prixUnitaire: 0, prixTotal: 0, type: 'ouvrage', marqueur: { statut: 'incomplet' } }] },
        { id: 'b', numero: '1.2', designation: 'Sans marqueur', unite: 'u', quantite: 1, prixUnitaire: 0, prixTotal: 0, type: 'ouvrage' },
      ],
    }],
  }];

  it('liste les éléments marqués dans l’ordre du document, sous-articles compris', () => {
    expect(noeudsMarques(lots).map(n => [n.cle, n.kind])).toEqual([['lot-0', 'lot'], ['ligne-0-0-0', 'article'], ['ligne-0-0-0-0', 'article']]);
  });

  it('compte par statut', () => {
    expect(compterMarqueurs(lots)).toEqual({ incomplet: 2, en_cours: 1, total: 3 });
  });

  it('ignore un marqueur illisible', () => {
    const casse: Lot[] = [{ ...lots[0], marqueur: { statut: 'inconnu' } as never, chapitres: [] }];
    expect(noeudsMarques(casse)).toEqual([]);
  });
});

describe('enCoursParAutre', () => {
  const enCours = { statut: 'en_cours' as const, par: 'Sophie' };

  it('un agent respecte l’édition d’une personne, pas la sienne', () => {
    expect(enCoursParAutre(enCours, PAR_AGENT)).toBe(true);
    expect(enCoursParAutre({ statut: 'en_cours', par: PAR_AGENT }, PAR_AGENT)).toBe(false);
  });

  it('une personne garde la main sur ce qu’elle a marqué, pas sur le travail d’un autre', () => {
    expect(enCoursParAutre(enCours, ' sophie ')).toBe(false);
    expect(enCoursParAutre(enCours, 'Marc')).toBe(true);
  });

  it('un élément simplement incomplet ou sans marqueur ne bloque jamais', () => {
    expect(enCoursParAutre({ statut: 'incomplet', par: 'Sophie' }, PAR_AGENT)).toBe(false);
    expect(enCoursParAutre(undefined, PAR_AGENT)).toBe(false);
  });

  it('reconnaît un auteur d’agent', () => {
    expect(estParAgent('Agent IA')).toBe(true);
    expect(estParAgent('agent secrétaire')).toBe(true);
    expect(estParAgent('Agnès')).toBe(false);
  });
});

describe('ancienMarqueur et libelleMarqueur', () => {
  it('signale un « en cours » de plus de 24 h, jamais un « incomplet »', () => {
    expect(ancienMarqueur({ statut: 'en_cours', le: '2026-10-30T10:00:00Z' }, MAINTENANT)).toBe(true);
    expect(ancienMarqueur({ statut: 'en_cours', le: '2026-11-01T09:00:00Z' }, MAINTENANT)).toBe(false);
    expect(ancienMarqueur({ statut: 'incomplet', le: '2026-01-01T00:00:00Z' }, MAINTENANT)).toBe(false);
    expect(ancienMarqueur({ statut: 'en_cours' }, MAINTENANT)).toBe(false);
  });

  it('écrit une phrase lisible', () => {
    expect(libelleMarqueur({ statut: 'incomplet' })).toBe('incomplet');
    expect(libelleMarqueur({ statut: 'en_cours', par: 'Sophie', note: 'reprise des prix' })).toBe("en cours d'édition par Sophie : reprise des prix");
    expect(libelleMarqueur({ statut: 'en_cours', par: 'Sophie', le: '2026-11-01T10:00:00Z' })).toContain('par Sophie depuis le ');
  });
});
