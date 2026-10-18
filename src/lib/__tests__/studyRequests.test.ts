import { describe, expect, it } from 'vitest';
import {
  APROX_A_PRECISER, STUDY_KIND_DEFS, STUDY_RECIPIENT_FILTER, buildStudyRequestBody, buildStudySubject, parseEmailList,
  studyProjetFromProject, type StudyRequest,
} from '../studyRequests';

const projetVide = { name: 'Villa Martin' };

function demande(etudes: string[], values: StudyRequest['values'] = {}): StudyRequest {
  return { projet: projetVide, etudes, values };
}

describe('buildStudyRequestBody', () => {
  it('écrit « à préciser » pour chaque information inconnue au lieu d’inventer', () => {
    const corps = buildStudyRequestBody('geotechnique', demande(['G1']));

    expect(corps).toContain(`- Référence cadastrale : ${APROX_A_PRECISER}`);
    expect(corps).toContain(`- Réponse attendue avant le : ${APROX_A_PRECISER}`);
  });

  it('liste les missions du contrôle technique avec leur libellé', () => {
    const corps = buildStudyRequestBody('controle_technique', demande(['L', 'SEI']));

    expect(corps).toContain('MISSIONS DEMANDÉES');
    expect(corps).toContain('- L : solidité des ouvrages');
    expect(corps).toContain('- SEI : sécurité incendie');
    expect(corps).not.toContain('- S : sécurité des personnes');
  });

  it('reprend les données de chantier propres au CSPS', () => {
    const corps = buildStudyRequestBody('csps', demande(['COORD'], { nombreLots: '7', effectifMax: '25', debutTravaux: '2027-03-01' }));

    expect(corps).toContain('CHANTIER');
    expect(corps).toContain('- Nombre d’entreprises (lots) prévues : 7');
    expect(corps).toContain('- Effectif maximal simultané : 25');
    expect(corps).toContain('- Début prévisionnel des travaux : 01/03/2027');
  });

  it('ajoute les commentaires seulement quand il y en a', () => {
    expect(buildStudyRequestBody('csps', demande(['DIU']))).not.toContain('COMMENTAIRES');
    expect(buildStudyRequestBody('csps', demande(['DIU'], { commentaire: 'Urgent' }))).toContain('COMMENTAIRES\nUrgent');
  });

  it('n’utilise jamais le tiret quadratin', () => {
    for (const kind of ['geotechnique', 'controle_technique', 'csps'] as const) {
      expect(buildStudyRequestBody(kind, demande(['G1', 'L', 'DIU']))).not.toContain('—');
    }
  });
});

describe('buildStudySubject', () => {
  it('nomme la nature, puis ajoute la référence entre parenthèses si elle existe', () => {
    expect(buildStudySubject('controle_technique', { name: 'Villa Martin', reference: '26014' }))
      .toBe('Consultation, contrôle technique : Villa Martin (26014)');
    expect(buildStudySubject('csps', { name: 'Villa Martin' }))
      .toBe('Consultation, coordination SPS : Villa Martin');
  });
});

describe('STUDY_RECIPIENT_FILTER', () => {
  it('propose le bureau de contrôle au contrôle technique, et jamais un contact sans catégorie', () => {
    expect(STUDY_RECIPIENT_FILTER.controle_technique({ category: 'Bureau de contrôle' })).toBe(true);
    expect(STUDY_RECIPIENT_FILTER.controle_technique({ category: 'Bureau d’études' })).toBe(false);
    expect(STUDY_RECIPIENT_FILTER.controle_technique({ category: '' })).toBe(false);
    expect(STUDY_RECIPIENT_FILTER.controle_technique({ category: null })).toBe(false);
  });

  it('propose le coordinateur SPS au CSPS, et le géotechnicien à l’étude de sol', () => {
    expect(STUDY_RECIPIENT_FILTER.csps({ category: 'Coordinateur SPS' })).toBe(true);
    expect(STUDY_RECIPIENT_FILTER.geotechnique({ category: 'Bureau d’études' })).toBe(true);
    expect(STUDY_RECIPIENT_FILTER.geotechnique({ category: 'Bureau de contrôle' })).toBe(false);
  });
});

describe('studyProjetFromProject', () => {
  it('reprend les champs de la fiche et laisse vide ce qui manque', () => {
    const projet = studyProjetFromProject({
      id: 'p1', name: 'Villa Martin', client: 'M. Martin', project_code: '26014',
      ref_cadastrale: 'AB 123', site_postcode: '54500', site_city: 'Vandœuvre',
    } as never);

    expect(projet.name).toBe('Villa Martin');
    expect(projet.reference).toBe('26014');
    expect(projet.maitreOuvrage).toBe('M. Martin');
    expect(projet.cpVille).toBe('54500 Vandœuvre');
    expect(projet.zonePlu).toBeUndefined();
  });
});

describe('STUDY_KIND_DEFS', () => {
  it('donne à chaque champ de formulaire un groupe qui existe', () => {
    for (const def of Object.values(STUDY_KIND_DEFS)) {
      const groupes = new Set(def.groupes.flatMap(g => g.champs));
      for (const champ of def.champs) {
        expect(groupes.has(champ.id), `${def.kind} : ${champ.id} sans groupe`).toBe(true);
      }
    }
  });
});

describe('parseEmailList', () => {
  it('sépare les adresses valides, dédoublonne et signale les autres', () => {
    const { valides, invalides } = parseEmailList('geo@sol.fr, geo@sol.fr; bureau@etudes.fr  pas-une-adresse');

    expect(valides).toEqual(['geo@sol.fr', 'bureau@etudes.fr']);
    expect(invalides).toEqual(['pas-une-adresse']);
  });
});
