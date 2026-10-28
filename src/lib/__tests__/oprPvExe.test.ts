// Cerfas EXE4 et EXE5 du marché public : contenu, cases cochées, annexes, pointillés, rendu.
import { describe, expect, it } from 'vitest';
import { pvVierge, controlerPv, type OprPv } from '../oprPv';
import type { BlocPv } from '../oprPvDocument';
import { construireExe, construireExe4, construireExe5, construireExe6, construireExe7, construireExe8, construireExe9, identiteEnLignes, type DonneesExe } from '../oprPvExe';
import { donneesExe, identiteDepuisContact } from '../oprPvExport';
import { lirePv, sanitizeOprPayload } from '../oprPvSanitize';

const donnees = (pv: Partial<OprPv> = {}, extra: Partial<DonneesExe> = {}): DonneesExe => ({
  pv: { ...pvVierge('public'), marche_id: 'm1', date_opr: '2026-11-03', ccag_version: '2021', ...pv },
  reference: 'OPR-2026-001',
  adjudicateur: ['Commune de Fictiville', '1 place de la Mairie', '54000 NANCY'],
  titulaire: ['Entreprise BTS (fictive)', 'SIRET : 123 456 789 00012'],
  maitreOeuvre: ["ATELIER D'ARCHITECTURE ZOMENO SEKTAOUI (AAZS)", '23 Bd de l\'Europe 54500 VANDOEUVRE-LES-NANCY'],
  objet: ['Réhabilitation de la mairie', 'Lot 01 · Gros œuvre'],
  lot: 'Lot 01 · Gros œuvre',
  entreprise: 'Entreprise BTS (fictive)',
  reserves: [],
  ...extra,
});

type Case = Extract<BlocPv, { t: 'case' }>;
const cases = (blocs: BlocPv[]) => blocs.filter((b): b is Case => b.t === 'case');
const cochees = (blocs: BlocPv[]) => cases(blocs).filter(c => c.cochee).map(c => c.text);
const textes = (blocs: BlocPv[]) => blocs.filter((b): b is Extract<BlocPv, { t: 'texte' }> => b.t === 'texte').map(b => b.text);
const titres = (blocs: BlocPv[]) => blocs.filter((b): b is Extract<BlocPv, { t: 'titre' }> => b.t === 'titre').map(b => b.text);

describe('identité', () => {
  it('une ligne par élément connu, rien d\'inventé', () => {
    expect(identiteEnLignes({ nom: 'BTS', adresse: '3 rue X', codePostal: '54000', ville: 'Nancy', siret: '123', telephone: '0383000000', courriel: 'a@b.fr' }))
      .toEqual(['BTS', '3 rue X', '54000 Nancy', 'SIRET : 123', 'Tél : 0383000000', 'Courriel : a@b.fr']);
    expect(identiteEnLignes({ nom: 'BTS' })).toEqual(['BTS']);
    expect(identiteEnLignes({})).toEqual([]);
  });

  it("la fiche contact donne la raison sociale, à défaut la personne, et l'adresse de travail avant l'adresse générale", () => {
    expect(identiteDepuisContact({ company_name: 'BTS', address_work_street: '1 rue du Travail', address: '2 rue Perso', address_work_zip: '54000', city: 'Metz' }))
      .toMatchObject({ nom: 'BTS', adresse: '1 rue du Travail', codePostal: '54000', ville: 'Metz' });
    expect(identiteDepuisContact({ first_name: 'Anne', last_name: 'Martin' }).nom).toBe('Anne Martin');
    expect(identiteDepuisContact(null)).toEqual({});
  });

  it('donneesExe assemble les rubriques A à D depuis les fiches, et retombe sur les noms connus sans fiche', () => {
    const d = donneesExe({
      pv: pvVierge('public'), reference: 'OPR-2026-001',
      projet: { nom: 'Mairie', objet: 'Réhabilitation', maitreOuvrage: 'Commune de Fictiville' },
      marche: { lot_numero: '01', lot_titre: 'Gros œuvre', entreprise_nom: 'BTS', entreprise_siret: '999' },
      agence: { agencyName: 'AAZS', architectName: 'K. S.', address: 'Nancy', siret: '102', phone: '06', email: 'c@aazs.fr' },
      reserves: [],
    });
    expect(d.adjudicateur).toEqual(['Commune de Fictiville']);
    expect(d.titulaire).toEqual(['BTS', 'SIRET : 999']);
    expect(d.maitreOeuvre[0]).toBe('AAZS · K. S.');
    expect(d.objet).toEqual(['Réhabilitation', 'Lot 01 · Gros œuvre']);
  });
});

describe('EXE4', () => {
  it('suit le cerfa : rubriques A à D, objet (E), procès-verbal (F), annexe', () => {
    const doc = construireExe4(donnees());
    expect(doc.titre).toBe('EXE4');
    expect(doc.intitule).toContain('PROCÈS-VERBAL DES OPÉRATIONS PRÉALABLES À LA RÉCEPTION');
    expect(titres(doc.blocs).slice(0, 6)).toEqual([
      "A - Identification du pouvoir adjudicateur ou de l'entité adjudicatrice",
      'B - Identification du titulaire du marché public',
      "C - Identification du maître d'œuvre",
      'D - Objet du marché public',
      'E - Objet des opérations préalables à la réception des ouvrages',
      'F - Procès-verbal des opérations préalables à la réception des ouvrages',
    ]);
    expect(titres(doc.blocs).at(-1)).toBe('Annexe au procès-verbal des opérations préalables à la réception');
    expect(textes(doc.blocs)).toContain('Commune de Fictiville\n1 place de la Mairie\n54000 NANCY');
    expect(textes(doc.blocs).some(t => t.includes('version 2021'))).toBe(true);
    expect(textes(doc.blocs).some(t => t.includes('mise à jour : 01/04/2019'))).toBe(true);
  });

  it("un PV vierge n'a aucune case cochée, et laisse des pointillés au lieu d'inventer", () => {
    const doc = construireExe4(donnees({}, { adjudicateur: [], titulaire: [] }));
    expect(cochees(doc.blocs)).toEqual([]);
    const t = textes(doc.blocs);
    expect(t.filter(x => x === '..........')).toHaveLength(2); // rubriques A et B sans donnée
    expect(t).toContain('Je soussigné, .........., maître d\'œuvre,');
    expect(t.some(x => x.startsWith("Date d'achèvement des travaux proposée par le titulaire du marché public : .........."))).toBe(true);
  });

  it('coche les constats, avec le numéro d\'annexe repris dans le texte', () => {
    const pv = pvVierge('public');
    pv.public_info = { portee: 'partielle', prestations: 'Lot 01 : gros œuvre du bâtiment A', signataire: 'Khaldoun Sektaoui', reference_marche: 'M-2026-01' };
    pv.presences = { moa: 'absent_avise', entreprise: 'absente_convoquee', date_convocation: '2026-10-20' };
    pv.constats = {
      epreuves: 'concluantes_sauf_annexe', travaux: 'executes_sauf_annexe', ouvrages: 'conformes_sauf_annexe',
      pose_equipements: 'non_conforme', installations: 'non_repliees', terrains: 'remis_en_etat',
      annexes: { epreuves: '1', travaux: '2' },
    };
    const doc = construireExe4(donnees(pv));
    expect(cochees(doc.blocs)).toEqual([
      "la réception partielle de l'ouvrage relative aux prestations désignées ci-dessous :",
      "en l'absence du représentant du pouvoir adjudicateur ou de l'entité adjudicatrice, dûment avisé par mes soins ;",
      "en l'absence du titulaire du marché public dûment convoqué, par courrier en date du 20/10/2026.",
      "et sont concluantes, à l'exception de celles indiquées à l'annexe n° 1 ci-jointe ;",
      "ont été exécutés, à l'exception de ceux indiqués à l'annexe n° 2 ci-jointe ;",
      "sont conformes aux spécifications du marché public, à l'exception des imperfections ou malfaçons indiquées à l'annexe n° ...... ci-jointe ;",
      'ne sont pas conformes aux spécifications des fournisseurs.',
      "n'ont pas été repliées ;",
      'ont été remis en état ;',
    ]);
    expect(textes(doc.blocs)).toContain('Lot 01 : gros œuvre du bâtiment A');
    expect(textes(doc.blocs)).toContain('Je soussigné, Khaldoun Sektaoui, maître d\'œuvre,');
    // La référence du marché est rappelée sur chaque page (en-tête).
    expect(doc.reference).toBe('Marché M-2026-01 · OPR-2026-001');
  });

  it('un CCAG non renseigné n\'est pas affirmé', () => {
    const doc = construireExe4(donnees({ ccag_version: null }));
    expect(textes(doc.blocs).some(t => t.includes('CCAG applicable'))).toBe(false);
  });

  it("l'attestation de refus de signer est une case à cocher, non cochée par défaut", () => {
    const refus = cases(construireExe4(donnees()).blocs).find(c => c.text.startsWith("J'atteste"))!;
    expect(refus.cochee).toBe(false);
  });
});

describe('EXE5', () => {
  it('numérote comme le cerfa : 1, 1.1, 1.2.1, 1.3.1.1, 2', () => {
    const textesCases = cases(construireExe5(donnees()).blocs).map(c => c.text.split(' ')[0]);
    expect(textesCases).toEqual(['1.', '1.1.', '1.2.', '1.2.1.', '1.2.2.', '1.3.', '1.3.1.', '1.3.1.1.', '1.3.2.', '1.3.3.', '2.']);
  });

  it('sans réserve : coche 1 et 1.1 avec la date d\'achèvement retenue', () => {
    const pv = pvVierge('public');
    pv.proposition = { ...pv.proposition, avis: 'sans_reserve', date_achevement_retenue: '2026-10-30', date_proposition: '2026-11-04' };
    const doc = construireExe5(donnees(pv));
    expect(cochees(doc.blocs)).toEqual(["1. de prononcer la réception, en retenant, pour l'achèvement des travaux, la date du 30/10/2026", '1.1. sans réserve.']);
    expect(textes(doc.blocs)).toContain('À : .........., le 04/11/2026');
  });

  it('sous réserve : épreuves et travaux, avec l\'annexe', () => {
    const pv = pvVierge('public');
    pv.proposition = {
      ...pv.proposition, avis: 'sous_reserve',
      conditions: [{ nature: 'epreuves', avant_le: null, annexe: '3' }, { nature: 'travaux', avant_le: null, annexe: null }],
    };
    const c = cochees(construireExe5(donnees(pv)).blocs);
    expect(c).toContain("1.2. sous réserve :");
    expect(c).toContain("1.2.1. de l'exécution concluante des épreuves énumérées à l'annexe n° 3 ci-jointe");
    expect(c).toContain("1.2.2. de l'exécution des travaux et prestations énumérés à l'annexe n° ...... ci-jointe");
    expect(c.some(x => x.startsWith('1.3.'))).toBe(false);
  });

  it('avec réserve : malfaçons avant une date, réfaction chiffrée, repli et pose', () => {
    const pv = pvVierge('public');
    pv.proposition = {
      ...pv.proposition, avis: 'avec_reserve', refaction_montant: 1500,
      conditions: [
        { nature: 'malfacons', avant_le: '2026-12-01', annexe: '4' },
        { nature: 'installations', avant_le: '2026-11-20', annexe: null },
        { nature: 'pose', avant_le: '2026-11-25', annexe: null },
      ],
    };
    const doc = construireExe5(donnees(pv));
    const c = cases(doc.blocs);
    expect(c.filter(x => x.cochee).map(x => x.text.split(' ')[0])).toEqual(['1.', '1.3.', '1.3.1.', '1.3.1.1.', '1.3.2.', '1.3.3.']);
    expect(c.find(x => x.text.startsWith('1.3.1. '))!.text).toBe("1.3.1. le titulaire doit remédier, avant le 01/12/2026, aux imperfections et malfaçons indiquées à l'annexe n° 4 ci-jointe");
    expect(c.find(x => x.text.startsWith('1.3.2.'))!.text).toContain('avant le 20/11/2026');
    expect(c.find(x => x.text.startsWith('1.3.1.1.'))!.valeur).toMatch(/^1\s?500,00\s?€$/);
    expect(c.find(x => x.text.startsWith('1.3.1.1.'))!.valeur).not.toMatch(/[  ]/);
  });

  it('ne pas prononcer la réception coche 2 et aucune des conditions', () => {
    const pv = pvVierge('public');
    pv.proposition = { ...pv.proposition, avis: 'non_reception' };
    expect(cochees(construireExe5(donnees(pv)).blocs)).toEqual(['2. de ne pas prononcer la réception.']);
  });

  it('rappelle la date des OPR et le soussigné', () => {
    const pv = pvVierge('public');
    pv.date_opr = '2026-11-03';
    pv.public_info = { portee: null, prestations: null, signataire: 'K. Sektaoui', reference_marche: null };
    const t = textes(construireExe5(donnees(pv)).blocs);
    expect(t.some(x => x.includes('en date du 03/11/2026') && x.includes('K. Sektaoui'))).toBe(true);
  });

  it('construireExe choisit le formulaire', () => {
    for (const code of ['EXE4', 'EXE5', 'EXE6', 'EXE7', 'EXE8', 'EXE9'] as const) expect(construireExe(code, donnees()).titre).toBe(code);
  });
});

describe('EXE6 : décision de réception', () => {
  const avecDecision = (issue: 'sans_reserve' | 'sous_reserve' | 'avec_reserve', extra: Partial<OprPv['decision']> = {}): OprPv => {
    const pv = pvVierge('public');
    pv.date_opr = '2026-11-03';
    pv.proposition = { ...pv.proposition, date_proposition: '2026-11-04' };
    pv.public_info = { portee: 'totale', prestations: 'Lot 01 : gros œuvre', signataire: null, reference_marche: null };
    pv.decision = { ...pv.decision, issue, date_decision: '2026-11-20', date_effet: '2026-10-30', ...extra };
    return pv;
  };

  it('suit le cerfa : A (maître de l\'ouvrage) à G, avec les prestations et le « au vu »', () => {
    const doc = construireExe6(donnees(avecDecision('sans_reserve')));
    expect(doc.titre).toBe('EXE6');
    expect(titres(doc.blocs).slice(0, 7)).toEqual([
      "A - Identification du maître de l'ouvrage", 'B - Identification du titulaire du marché public', "C - Identification du maître d'œuvre",
      'D - Objet du marché public', 'E - Objet de la décision de réception', "F - Décision du maître de l'ouvrage", "G - Signature du maître de l'ouvrage",
    ]);
    expect(textes(doc.blocs)).toContain('Lot 01 : gros œuvre');
    expect(cochees(doc.blocs)).toEqual([
      "du procès-verbal des opérations préalables à la réception, en date du 03/11/2026, et des propositions présentées le 04/11/2026 par le maître d'œuvre ;",
      "1. que la date retenue, pour l'achèvement des travaux, est fixée au 30/10/2026",
      '2. que la réception est prononcée ;',
      '2.1. sans réserve.',
    ]);
    expect(doc.date).toBe('20/11/2026');
  });

  it('sous réserve : épreuves et travaux, avec l\'annexe et la date', () => {
    const pv = avecDecision('sous_reserve', { conditions: [{ nature: 'epreuves', avant_le: null, annexe: '2' }, { nature: 'travaux', avant_le: '2026-12-15', annexe: '3' }] });
    const c = cochees(construireExe6(donnees(pv)).blocs);
    expect(c).toContain("2.2.1. de l'exécution concluante des épreuves énumérées à l'annexe n° 2 ci-jointe");
    expect(c).toContain("2.2.2. de l'exécution des travaux et prestations, énumérés à l'annexe n° 3 ci-jointe, avant le 15/12/2026");
    expect(c.some(x => x.startsWith('2.3'))).toBe(false);
  });

  it('avec réserve : malfaçons, réfaction acceptée par lettre, repli et pose', () => {
    const pv = avecDecision('avec_reserve', {
      refaction_montant: 800, refaction_acceptee_le: '2026-11-18',
      conditions: [{ nature: 'malfacons', avant_le: '2026-12-01', annexe: '4' }, { nature: 'installations', avant_le: '2026-11-25', annexe: null }, { nature: 'pose', avant_le: '2026-11-28', annexe: null }],
    });
    const doc = construireExe6(donnees(pv));
    expect(cochees(doc.blocs).map(x => x.split(' ')[0])).toEqual(['du', 'de', '1.', '2.', '2.3.', '2.3.1.', '2.3.1.1.', '2.3.2.', '2.3.3.']);
    expect(cochees(doc.blocs)).toContain("de la lettre, en date du 18/11/2026, par laquelle le titulaire du marché public accepte la réfaction proposée ;");
    expect(cases(doc.blocs).find(c => c.text.startsWith('2.3.1.1.'))!.valeur).toMatch(/^800,00\s?€$/);
  });

  it('un PV sans décision ne coche rien et laisse des pointillés', () => {
    const pv = pvVierge('public');
    const doc = construireExe6(donnees(pv, { titulaire: [] }));
    expect(cochees(doc.blocs)).toEqual([]);
    expect(textes(doc.blocs)).toContain('..........'); // prestations non renseignées
  });
});

describe('EXE7 : décision de non-réception', () => {
  it('reprend le PV et les propositions, et désigne les prestations', () => {
    const pv = pvVierge('public');
    pv.date_opr = '2026-11-03';
    pv.proposition = { ...pv.proposition, date_proposition: '2026-11-04' };
    pv.decision = { ...pv.decision, issue: 'non_receptionnee', date_decision: '2026-11-20' };
    pv.public_info = { portee: null, prestations: 'Couverture du bâtiment A', signataire: null, reference_marche: null };
    const doc = construireExe7(donnees(pv));
    expect(titres(doc.blocs).slice(4)).toEqual(["E - Décision du maître de l'ouvrage", "F - Signature du maître de l'ouvrage"]);
    const t = textes(doc.blocs);
    expect(t.some(x => x.includes('en date du 03/11/2026') && x.includes('présentées le 04/11/2026') && x.includes('décide de ne pas prononcer la réception'))).toBe(true);
    expect(t).toContain('Couverture du bâtiment A');
    expect(doc.titre).toBe('EXE7');
  });
});

describe('EXE8 : procès-verbal de levée des réserves', () => {
  const pvLevee = (): OprPv => {
    const pv = pvVierge('public');
    pv.date_opr = '2026-10-01';
    pv.levee.date_pv = '2026-11-20';
    pv.levee.presences = { moa: 'absent_avise', entreprise: 'presente', date_convocation: null };
    pv.levee.constats = {
      epreuves: 'concluantes', travaux: 'executes', ouvrages: 'conformes_sauf_annexe', pose_equipements: 'conforme',
      installations: 'repliees', terrains: 'remis_en_etat', annexes: { malfacons: '5' },
    };
    pv.public_info = { portee: 'totale', prestations: null, signataire: 'K. Sektaoui', reference_marche: null };
    return pv;
  };

  it('porte les constats de la levée, avec leurs propres textes, et ses propres présences', () => {
    const doc = construireExe8(donnees(pvLevee()));
    expect(doc.titre).toBe('EXE8');
    expect(doc.date).toBe('20/11/2026');
    expect(titres(doc.blocs).slice(4, 6)).toEqual(['E - Objet du procès-verbal de levée des réserves', 'F - Procès-verbal de levée des réserves']);
    expect(cochees(doc.blocs)).toEqual([
      "la réception de l'ouvrage comportant les prestations suivantes :",
      "en l'absence du représentant du pouvoir adjudicateur ou de l'entité adjudicatrice, dûment avisé par mes soins ;",
      'en présence du titulaire du marché public ;',
      'et sont concluantes ;',
      'ont été exécutés ;',
      "sont conformes aux spécifications du marché public, à l'exception des imperfections ou malfaçons indiquées à l'annexe n° 5 ci-jointe, qui n'ont pas été corrigées ;",
      'sont conformes aux spécifications des fournisseurs ;',
      'ont été repliées ;',
      'ont été remis en état ;',
    ]);
    expect(textes(doc.blocs)).toContain('Je, soussigné, K. Sektaoui, maître d\'œuvre,');
  });

  it("l'annexe ne liste que les réserves encore ouvertes", () => {
    const reserves = [
      { numero: 1, localisation: 'Hall', points: 'Peinture', statut: 'Levée' },
      { numero: 2, localisation: 'Façade', points: 'Enduit', statut: 'A faire' },
    ];
    const doc = construireExe8(donnees(pvLevee(), { reserves }));
    const tableau = doc.blocs.find((b): b is Extract<BlocPv, { t: 'tableau' }> => b.t === 'tableau')!;
    expect(tableau.lignes).toEqual([['2', 'Façade', '', 'Enduit', '', '']]);
  });
});

describe('EXE9 : propositions et décision sur la levée', () => {
  const pvExe9 = (proposition: Partial<OprPv['levee']['proposition']>, decision: Partial<OprPv['levee']['decision']>): OprPv => {
    const pv = pvVierge('public');
    pv.date_opr = '2026-10-01';
    pv.decision = { ...pv.decision, issue: 'avec_reserve', date_decision: '2026-10-20' };
    pv.levee.date_pv = '2026-11-20';
    pv.levee.proposition = { ...pv.levee.proposition, date: '2026-11-21', ...proposition };
    pv.levee.decision = { ...pv.levee.decision, date: '2026-11-25', ...decision };
    return pv;
  };

  it("numérote comme le cerfa : propositions 1 à 4.5, décision 1 et 2.1 à 2.4.5", () => {
    const doc = construireExe9(donnees(pvExe9({}, {})));
    // Les deux premières cases sont la portée de la levée (rubrique E), pas des propositions.
    const debuts = cases(doc.blocs).slice(2).map(c => c.text.split(' ')[0]);
    expect(debuts).toEqual(['1.', '2.', '3.', '4.', '4.1', '4.2', '4.3', '4.4', '4.5', '1.', '2.', '2.1', '2.2', '2.3', '2.4', '2.4.1', '2.4.2', '2.4.3', '2.4.4', '2.4.5']);
    expect(titres(doc.blocs)).toEqual([
      "A - Identification du maître de l'ouvrage", 'B - Identification du titulaire du marché public', "C - Identification du maître d'œuvre", 'D - Objet du marché public',
      'E - Objet de la levée des réserves', "F - Propositions du maître d'œuvre relatives au procès-verbal de levée des réserves", "G - Signature du maître d'œuvre",
      "H - Décision du maître de l'ouvrage", "I - Signature du maître de l'ouvrage",
    ]);
  });

  it("le maître d'ouvrage accepte : coche 1 de la décision et la proposition du maître d'œuvre", () => {
    const doc = construireExe9(donnees(pvExe9({ option: 'lever_toutes' }, { option: 'accepter' })));
    const c = cochees(doc.blocs);
    expect(c).toContain("2. de lever toutes les réserves dont était assortie la décision de réception des ouvrages, intervenue le 20/10/2026.");
    expect(c).toContain("1. d'accepter toutes les propositions complémentaires du maître d'œuvre relatives au procès-verbal de levée des réserves.");
    expect(c.some(x => x.startsWith('2.4') || x.startsWith('2.1') || x.startsWith('2.2'))).toBe(false);
  });

  it('levée partielle décidée autrement : annexe des réserves levées et réserves maintenues', () => {
    const maintenues = [{ nature: 'malfacons' as const, avant_le: null, annexe: '6' }, { nature: 'installations' as const, avant_le: '2026-12-20', annexe: null }];
    const doc = construireExe9(donnees(pvExe9({ option: 'lever_toutes' }, { option: 'lever_partie', annexe_levees: '7', maintenues }), {
      reserves: [{ numero: 1, localisation: 'Hall', points: 'Peinture', statut: 'Levée' }, { numero: 2, localisation: 'Façade', points: 'Enduit', statut: 'A faire' }],
    }));
    const c = cochees(doc.blocs);
    expect(c).toContain("2. de ne pas retenir les propositions complémentaires du maître d'œuvre relatives au procès-verbal de levée des réserves et de :");
    expect(c).toContain("2.4 parmi les réserves dont était assortie la décision de réception des ouvrages intervenue le 20/10/2026, lever celles figurant dans l'annexe n° 7 du présent formulaire.");
    expect(c).toContain("2.4.3 la correction des imperfections et malfaçons indiquées à l'annexe n° 6 ci-jointe.");
    expect(c).toContain('2.4.4 les installations de chantier doivent être repliées et les terrains et les lieux doivent être remis en état, avant le 20/12/2026.');
    expect(c).not.toContain("1. d'accepter toutes les propositions complémentaires du maître d'œuvre relatives au procès-verbal de levée des réserves.");
    const annexe = titres(doc.blocs).at(-1)!;
    expect(annexe).toBe('Annexe n° 7 au formulaire EXE9 · réserves levées');
    const tableau = doc.blocs.find((b): b is Extract<BlocPv, { t: 'tableau' }> => b.t === 'tableau')!;
    expect(tableau.lignes).toEqual([['1', 'Hall', '', 'Peinture', '', '']]);
  });

  it('sans réserve levée, aucune annexe', () => {
    const doc = construireExe9(donnees(pvExe9({ option: 'maintenir_toutes' }, {})));
    expect(doc.blocs.some(b => b.t === 'tableau')).toBe(false);
  });
});

describe('annexes ventilées par nature', () => {
  const reserves = [
    { numero: 1, localisation: 'Hall', points: 'Peinture', nature: 'malfacons' as const },
    { numero: 2, localisation: 'Toit', points: 'Essai d\'étanchéité', nature: 'epreuves' as const },
    { numero: 3, localisation: 'Façade', points: 'Enduit', nature: 'malfacons' as const },
    { numero: 4, localisation: 'Cour', points: 'Divers' },
  ];

  it('un tableau par nature sous le numéro d\'annexe que cite le formulaire, puis les réserves sans nature', () => {
    const pv = pvVierge('public');
    pv.constats = { ...pv.constats, annexes: { epreuves: '1', malfacons: '3' } };
    const doc = construireExe4(donnees(pv, { reserves }));
    const tableaux = doc.blocs.filter((b): b is Extract<BlocPv, { t: 'tableau' }> => b.t === 'tableau');
    expect(tableaux.map(t => t.titre)).toEqual([
      'Annexe n° 1 · Épreuves à exécuter ou à reprendre',
      'Annexe n° 3 · Imperfections et malfaçons à corriger',
      'Réserves sans nature précisée',
    ]);
    expect(tableaux[1].lignes.map(l => (Array.isArray(l) ? l[0] : ''))).toEqual(['1', '3']);
  });

  it('un numéro d\'annexe inconnu reste en pointillés, jamais inventé', () => {
    const doc = construireExe4(donnees(pvVierge('public'), { reserves: [{ numero: 1, localisation: 'x', points: 'y', nature: 'travaux' }] }));
    expect(doc.blocs.find((b): b is Extract<BlocPv, { t: 'tableau' }> => b.t === 'tableau')!.titre).toBe('Annexe n° ...... · Travaux et prestations à exécuter');
  });

  it("le repli du chantier et la pose des équipements n'ont pas de numéro d'annexe", () => {
    const doc = construireExe4(donnees(pvVierge('public'), { reserves: [
      { numero: 1, localisation: 'Cour', points: 'Base vie', nature: 'installations' },
      { numero: 2, localisation: 'Local technique', points: 'Fixation', nature: 'pose' },
    ] }));
    const titresTableaux = doc.blocs.filter((b): b is Extract<BlocPv, { t: 'tableau' }> => b.t === 'tableau').map(t => t.titre);
    expect(titresTableaux).toEqual(['Repli des installations de chantier et remise en état des lieux', 'Mise en conformité de la pose des équipements']);
  });

  it('sans aucune nature, une annexe unique comme au privé', () => {
    const doc = construireExe4(donnees(pvVierge('public'), { reserves: [{ numero: 1, localisation: 'x', points: 'y' }] }));
    expect(doc.blocs.filter(b => b.t === 'tableau')).toHaveLength(1);
    expect(titres(doc.blocs).at(-1)).toBe('Annexe au procès-verbal des opérations préalables à la réception');
  });

  it("l'EXE5 reprend le numéro d'annexe saisi sur la condition de réception", () => {
    const pv = pvVierge('public');
    pv.proposition = { ...pv.proposition, avis: 'avec_reserve', conditions: [{ nature: 'malfacons', avant_le: '2026-12-01', annexe: '9' }] };
    const doc = construireExe5(donnees(pv, { reserves: [{ numero: 1, localisation: 'x', points: 'y', nature: 'malfacons' }] }));
    expect(doc.blocs.find((b): b is Extract<BlocPv, { t: 'tableau' }> => b.t === 'tableau')!.titre).toContain('Annexe n° 9');
  });
});

describe('mentions du marché public (public_info)', () => {
  it('assainies côté serveur : portée de vocabulaire fermé, textes bornés', () => {
    const ok = sanitizeOprPayload({ public_info: { portee: 'partielle', prestations: '  Lot 02  ', signataire: 'K. S.', reference_marche: 'M-1', inconnu: 'x' } });
    expect(ok.erreurs).toEqual([]);
    expect(ok.colonnes.public_info).toEqual({ portee: 'partielle', prestations: 'Lot 02', signataire: 'K. S.', reference_marche: 'M-1' });
    expect(sanitizeOprPayload({ public_info: { portee: 'moitié' } }).erreurs.length).toBe(1);
    expect(sanitizeOprPayload({ public_info: { prestations: 'x'.repeat(2500) } }).erreurs.length).toBe(1);
  });

  it('lues avec leurs valeurs vides par défaut', () => {
    expect(lirePv({ regime: 'public' })!.public_info).toEqual({ portee: null, prestations: null, signataire: null, reference_marche: null });
  });

  it('une portée absente ou partielle sans prestations est signalée, sans bloquer', () => {
    const sans = controlerPv(donnees().pv);
    expect(sans.avertissements.map(a => a.code)).toContain('portee_manquante');
    const partielle = controlerPv(donnees({ public_info: { portee: 'partielle', prestations: null, signataire: null, reference_marche: null } }).pv);
    expect(partielle.avertissements.map(a => a.code)).toContain('prestations_manquantes');
    const complete = controlerPv(donnees({ public_info: { portee: 'totale', prestations: null, signataire: null, reference_marche: null } }).pv);
    expect(complete.avertissements.map(a => a.code)).not.toContain('portee_manquante');
    expect(partielle.erreurs).toEqual([]);
  });
});

describe('rendu', () => {
  it('les six formulaires se rendent en PDF (annexes comprises) et en Word', async () => {
    const [{ jsPDF }, autoTable] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
    const { rendreDocPv } = await import('../oprPvPdf');
    const { construireDocxPv } = await import('../oprPvDocx');
    for (const code of ['EXE4', 'EXE5', 'EXE6', 'EXE7', 'EXE8', 'EXE9'] as const) {
      const doc = construireExe(code, donnees());
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      rendreDocPv({ pdf, autoTable: autoTable.default as any, settings: { agencyName: 'AAZS' } as any, logo: null }, doc);
      expect(pdf.getNumberOfPages()).toBeGreaterThanOrEqual(code === 'EXE4' ? 3 : 1);
      expect(doc.titre).toBe(code);
      const blob = await construireDocxPv(doc, { agencyName: 'AAZS' } as any);
      expect(String.fromCharCode(...new Uint8Array(await blob.arrayBuffer()).slice(0, 2))).toBe('PK');
    }
  });
});
