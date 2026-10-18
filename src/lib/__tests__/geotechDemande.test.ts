import { describe, expect, it } from 'vitest';
import {
  APROX_A_PRECISER, buildGeotechBody, buildGeotechSubject, dateFrancaise, parseEmailList, type DemandeGeotech,
} from '../geotechDemande';

const demandeVide: DemandeGeotech = {
  projet: { name: 'Villa Martin' },
  etudes: [],
  sondages: {},
  batiment: { sousSol: false },
  calendrier: {},
};

describe('buildGeotechBody', () => {
  it('writes « à préciser » for every unknown field instead of inventing a value', () => {
    const corps = buildGeotechBody(demandeVide);

    expect(corps).toContain(`- Référence cadastrale : ${APROX_A_PRECISER}`);
    expect(corps).toContain(`- Zone du PLU : ${APROX_A_PRECISER}`);
    expect(corps).toContain(`- Réponse attendue avant le : ${APROX_A_PRECISER}`);
  });

  it('reprend les données de l’affaire telles qu’elles sont saisies', () => {
    const corps = buildGeotechBody({
      ...demandeVide,
      projet: { name: 'Villa Martin', refCadastrale: 'AB 123', zonePlu: 'UB', sismicite: 'Zone 2' },
    });

    expect(corps).toContain('- Intitulé : Villa Martin');
    expect(corps).toContain('- Référence cadastrale : AB 123');
    expect(corps).toContain('- Zone du PLU : UB');
    expect(corps).toContain('- Zone de sismicité : Zone 2');
  });

  it('liste les études cochées et précise le sous-sol', () => {
    const corps = buildGeotechBody({
      ...demandeVide,
      etudes: ['G1 : étude géotechnique préalable (site)', 'G2 : étude géotechnique de conception, projet (PRO)'],
      batiment: { niveaux: 'R+2', sousSol: true },
    });

    expect(corps).toContain('- G1 : étude géotechnique préalable (site)');
    expect(corps).toContain('- Niveaux : R+2, avec sous-sol');
  });

  it('n’utilise jamais le tiret quadratin', () => {
    const corps = buildGeotechBody({ ...demandeVide, commentaire: 'Accès par la rue, sans restriction' });

    expect(corps).not.toContain('—');
  });

  it('ajoute les commentaires seulement quand il y en a', () => {
    expect(buildGeotechBody(demandeVide)).not.toContain('COMMENTAIRES');
    expect(buildGeotechBody({ ...demandeVide, commentaire: 'Urgent' })).toContain('COMMENTAIRES\nUrgent');
  });
});

describe('dateFrancaise', () => {
  it('convertit une date ISO au format français', () => {
    expect(dateFrancaise('2026-11-30')).toBe('30/11/2026');
  });

  it('renvoie « à préciser » pour une date vide ou illisible', () => {
    expect(dateFrancaise('')).toBe(APROX_A_PRECISER);
    expect(dateFrancaise('30/11/2026')).toBe(APROX_A_PRECISER);
  });
});

describe('buildGeotechSubject', () => {
  it('ajoute la référence entre parenthèses seulement si elle existe', () => {
    expect(buildGeotechSubject({ name: 'Villa Martin', projectCode: '26014' }))
      .toBe('Demande de devis, étude de sol : Villa Martin (26014)');
    expect(buildGeotechSubject({ name: 'Villa Martin' }))
      .toBe('Demande de devis, étude de sol : Villa Martin');
  });
});

describe('parseEmailList', () => {
  it('sépare les adresses valides, dédoublonne et signale les autres', () => {
    const { valides, invalides } = parseEmailList('geo@sol.fr, geo@sol.fr; bureau@etudes.fr  pas-une-adresse');

    expect(valides).toEqual(['geo@sol.fr', 'bureau@etudes.fr']);
    expect(invalides).toEqual(['pas-une-adresse']);
  });

  it('renvoie des listes vides pour une saisie vide', () => {
    expect(parseEmailList('   ')).toEqual({ valides: [], invalides: [] });
  });
});
