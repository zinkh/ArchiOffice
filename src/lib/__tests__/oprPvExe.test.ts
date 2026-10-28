// Cerfas EXE4 et EXE5 du marché public : contenu, cases cochées, annexes, pointillés, rendu.
import { describe, expect, it } from 'vitest';
import { pvVierge, controlerPv, type OprPv } from '../oprPv';
import type { BlocPv } from '../oprPvDocument';
import { construireExe, construireExe4, construireExe5, identiteEnLignes, type DonneesExe } from '../oprPvExe';
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
    expect(construireExe('EXE4', donnees()).titre).toBe('EXE4');
    expect(construireExe('EXE5', donnees()).titre).toBe('EXE5');
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
  it('EXE4 et EXE5 se rendent en PDF (annexe comprise) et en Word', async () => {
    const [{ jsPDF }, autoTable] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
    const { rendreDocPv } = await import('../oprPvPdf');
    const { construireDocxPv } = await import('../oprPvDocx');
    for (const code of ['EXE4', 'EXE5'] as const) {
      const doc = construireExe(code, donnees());
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      rendreDocPv({ pdf, autoTable: autoTable.default as any, settings: { agencyName: 'AAZS' } as any, logo: null }, doc);
      expect(pdf.getNumberOfPages()).toBeGreaterThanOrEqual(code === 'EXE4' ? 3 : 1);
      const blob = await construireDocxPv(doc, { agencyName: 'AAZS' } as any);
      expect(String.fromCharCode(...new Uint8Array(await blob.arrayBuffer()).slice(0, 2))).toBe('PK');
    }
  });
});
