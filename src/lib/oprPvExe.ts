// Cerfas EXE4 (procès-verbal des opérations préalables à la réception) et EXE5 (propositions
// du maître d'œuvre) du marché public. Même mécanique que le modèle simplifié du privé :
// le contenu est construit sous forme de blocs neutres (voir oprPvDocument.ts) puis rendu à
// l'identique en PDF et en Word.
//
// Le contenu reprend les intitulés des formulaires du ministère de l'Économie et des Finances
// (Direction des Affaires Juridiques, mise à jour du 01/04/2019). Le graphisme du cerfa n'est
// pas reproduit, ses mentions le sont. Une donnée absente s'imprime en pointillés, jamais
// inventée. Ces formulaires citent le CCAG Travaux de 2009 : le CCAG applicable à chaque marché
// est porté par le PV (`ccag_version`) et rappelé sur le formulaire.
import { type NatureReserve, type OprPv } from './oprPv';
import {
  blocsAnnexeReserves, casesExclusives, dateFr, type BlocPv, type DocPv, type ReservePv,
} from './oprPvDocument';

export const EXE_MISE_A_JOUR = '01/04/2019';
const POINTILLES = '..........';

export type FormulaireExeAvecRendu = 'EXE4' | 'EXE5';

export interface DonneesExe {
  pv: OprPv;
  /** Référence du PV (OPR-AAAA-NNN). */
  reference?: string | null;
  /** Les rubriques A à D du cerfa : une ligne par élément, vides si inconnus. */
  adjudicateur: string[];
  titulaire: string[];
  maitreOeuvre: string[];
  objet: string[];
  /** « Lot 01 · Gros œuvre », repris en sous-titre. */
  lot?: string | null;
  entreprise?: string | null;
  /** Lieu de signature (« À : ... », EXE5). */
  lieu?: string | null;
  reserves: ReservePv[];
}

/** Les lignes d'identité d'une personne ou d'une entreprise, à partir de ce qui est connu. */
export interface IdentiteSource {
  nom?: string | null;
  adresse?: string | null;
  codePostal?: string | null;
  ville?: string | null;
  siret?: string | null;
  telephone?: string | null;
  courriel?: string | null;
}

export function identiteEnLignes(s: IdentiteSource): string[] {
  const commune = [s.codePostal, s.ville].filter(Boolean).join(' ');
  return [
    s.nom ?? '',
    s.adresse ?? '',
    commune,
    s.siret ? `SIRET : ${s.siret}` : '',
    s.telephone ? `Tél : ${s.telephone}` : '',
    s.courriel ? `Courriel : ${s.courriel}` : '',
  ].map(l => l.trim()).filter(Boolean);
}

const ou = (v?: string | null): string => (v && v.trim() ? v.trim() : POINTILLES);
const date = (v?: string | null): string => dateFr(v) || POINTILLES;

const rubrique = (lettre: string, titre: string, lignes: string[]): BlocPv[] => [
  { t: 'titre', text: `${lettre} - ${titre}` },
  { t: 'texte', text: lignes.length ? lignes.join('\n') : POINTILLES },
];

const REFERENCES = { A: "Identification du pouvoir adjudicateur ou de l'entité adjudicatrice", B: 'Identification du titulaire du marché public', C: "Identification du maître d'œuvre", D: 'Objet du marché public' };

function identification(d: DonneesExe): BlocPv[] {
  return [
    ...rubrique('A', REFERENCES.A, d.adjudicateur),
    ...rubrique('B', REFERENCES.B, d.titulaire),
    ...rubrique('C', REFERENCES.C, d.maitreOeuvre),
    ...rubrique('D', REFERENCES.D, d.objet),
  ];
}

function enTete(d: DonneesExe, code: FormulaireExeAvecRendu, intitule: string): Omit<DocPv, 'blocs'> {
  const info = d.pv.public_info;
  const marche = info.reference_marche ? `Marché ${info.reference_marche}` : '';
  return {
    titre: code,
    intitule: `${code} · ${intitule}`,
    sousTitre: [d.lot, d.entreprise].filter(Boolean).join(' · '),
    // La notice demande de rappeler la référence du marché sur chaque page.
    reference: [marche, d.reference].filter(Boolean).join(' · '),
    date: dateFr(d.pv.date_opr),
  };
}

const ccag = (pv: OprPv): BlocPv[] =>
  pv.ccag_version ? [{ t: 'texte', text: `CCAG applicable : cahier des clauses administratives générales applicables aux marchés publics de travaux, version ${pv.ccag_version}.` }] : [];

const miseAJour = (code: FormulaireExeAvecRendu): BlocPv => ({
  t: 'texte',
  text: `Formulaire ${code} · ministère de l'Économie et des Finances, Direction des Affaires Juridiques · date de mise à jour : ${EXE_MISE_A_JOUR}.`,
});

const annexe = (pv: OprPv, nature: NatureReserve): string => pv.constats.annexes[nature] || '......';

// ---------------------------------------------------------------------------
// EXE4 : procès-verbal des opérations préalables à la réception

export function construireExe4(d: DonneesExe): DocPv {
  const { pv } = d;
  const { presences, constats, public_info: info } = pv;
  const annexeN = (n: NatureReserve) => `à l'annexe n° ${annexe(pv, n)} ci-jointe`;

  const blocs: BlocPv[] = [
    { t: 'texte', text: 'MARCHÉS PUBLICS · RÉCEPTION DES TRAVAUX', gras: true },
    ...ccag(pv),
    ...identification(d),

    { t: 'titre', text: 'E - Objet des opérations préalables à la réception des ouvrages' },
    { t: 'texte', text: `Date d'achèvement des travaux proposée par le titulaire du marché public : ${date(pv.date_achevement_annoncee ?? pv.date_avis_achevement)}` },
    { t: 'texte', text: 'Les opérations préalables à la réception des ouvrages portent sur :' },
    ...casesExclusives([
      ['totale', "la réception de l'ouvrage comportant les prestations suivantes :"],
      ['partielle', "la réception partielle de l'ouvrage relative aux prestations désignées ci-dessous :"],
    ], info.portee),
    ...(info.prestations ? [{ t: 'texte', text: info.prestations } as BlocPv] : []),

    { t: 'titre', text: 'F - Procès-verbal des opérations préalables à la réception des ouvrages' },
    { t: 'texte', text: `Je soussigné, ${ou(info.signataire)}, maître d'œuvre,` },
    ...casesExclusives([
      ['present', "en présence du représentant du pouvoir adjudicateur ou de l'entité adjudicatrice ;"],
      ['absent_avise', "en l'absence du représentant du pouvoir adjudicateur ou de l'entité adjudicatrice, dûment avisé par mes soins ;"],
      ...(presences.moa === 'absent' ? [['absent', "en l'absence du représentant du pouvoir adjudicateur ou de l'entité adjudicatrice ;"] as [string, string]] : []),
    ], presences.moa),
    ...casesExclusives([
      ['presente', 'en présence du titulaire du marché public ;'],
      ['absente_convoquee', `en l'absence du titulaire du marché public dûment convoqué, par courrier en date du ${date(presences.date_convocation)}.`],
    ], presences.entreprise),
    { t: 'texte', text: 'après avoir procédé aux examens et vérifications nécessaires, constate que :' },

    { t: 'texte', text: '1. les épreuves, prévues au marché public :', gras: true },
    ...casesExclusives([
      ['non_effectuees', "n'ont pas été effectuées ;"],
      ['effectuees_sauf_annexe', `ont été effectuées, à l'exception de celles indiquées ${annexeN('epreuves')} ;`],
      ['concluantes', 'et sont concluantes ;'],
      ['concluantes_sauf_annexe', `et sont concluantes, à l'exception de celles indiquées ${annexeN('epreuves')} ;`],
    ], constats.epreuves),
    { t: 'texte', text: '2. les travaux et prestations, prévus au marché public :', gras: true },
    ...casesExclusives([
      ['executes', 'ont été exécutés ;'],
      ['executes_sauf_annexe', `ont été exécutés, à l'exception de ceux indiqués ${annexeN('travaux')} ;`],
    ], constats.travaux),
    { t: 'texte', text: '3. les ouvrages :', gras: true },
    ...casesExclusives([
      ['conformes', 'sont conformes aux spécifications du marché public ;'],
      ['conformes_sauf_annexe', `sont conformes aux spécifications du marché public, à l'exception des imperfections ou malfaçons indiquées ${annexeN('malfacons')} ;`],
    ], constats.ouvrages),
    { t: 'texte', text: '4. les conditions de pose des équipements :', gras: true },
    ...casesExclusives([
      ['conforme', 'sont conformes aux spécifications des fournisseurs ;'],
      ['non_conforme', 'ne sont pas conformes aux spécifications des fournisseurs.'],
    ], constats.pose_equipements),
    { t: 'texte', text: '5. les installations de chantier :', gras: true },
    ...casesExclusives([
      ['repliees', 'ont été repliées ;'],
      ['non_repliees', "n'ont pas été repliées ;"],
    ], constats.installations),
    { t: 'texte', text: '6. les terrains et les lieux :', gras: true },
    ...casesExclusives([
      ['remis_en_etat', 'ont été remis en état ;'],
      ['non_remis_en_etat', "n'ont pas été remis en état."],
    ], constats.terrains),

    {
      t: 'signatures',
      cases: [
        { titre: "Le maître d'œuvre", sous: info.signataire ?? undefined, date: dateFr(pv.date_opr) },
        { titre: 'Le titulaire du marché public', sous: d.entreprise ? `${d.entreprise} · accepté le :` : 'Accepté le :' },
      ],
    },
    { t: 'case', niveau: 0, cochee: false, text: "J'atteste que le titulaire du marché public a refusé de signer le présent procès-verbal." },
    { t: 'signatures', cases: [{ titre: "Le maître d'œuvre", date: dateFr(pv.date_opr) }] },
    miseAJour('EXE4'),
    ...blocsAnnexeReserves([['Objet du marché', d.objet.join(' · ')], ['Lot', d.lot ?? ''], ['Date des OPR', dateFr(pv.date_opr)]].filter(([, v]) => v) as [string, string][], d.reserves),
  ];

  return { ...enTete(d, 'EXE4', 'PROCÈS-VERBAL DES OPÉRATIONS PRÉALABLES À LA RÉCEPTION'), blocs };
}

// ---------------------------------------------------------------------------
// EXE5 : propositions du maître d'œuvre relatives à la réception

export function construireExe5(d: DonneesExe): DocPv {
  const { pv } = d;
  const { proposition, public_info: info } = pv;
  const prononcee = proposition.avis === 'sans_reserve' || proposition.avis === 'sous_reserve' || proposition.avis === 'avec_reserve';
  const condition = (n: NatureReserve) => proposition.conditions.find(c => c.nature === n);
  const sous = proposition.avis === 'sous_reserve';
  const avec = proposition.avis === 'avec_reserve';
  const avant = (n: NatureReserve) => date(condition(n)?.avant_le);
  const annexeN = (n: NatureReserve) => `à l'annexe n° ${condition(n)?.annexe || annexe(pv, n)} ci-jointe`;
  const refaction = proposition.refaction_montant;

  const blocs: BlocPv[] = [
    { t: 'texte', text: 'MARCHÉS PUBLICS · RÉCEPTION DES TRAVAUX', gras: true },
    ...ccag(pv),
    ...identification(d),

    { t: 'titre', text: "E - Propositions du maître d'œuvre relatives au procès-verbal des opérations préalables à la réception des ouvrages" },
    { t: 'texte', text: `Au vu du procès-verbal des opérations préalables à la réception des ouvrages, en date du ${date(pv.date_opr)}, je, soussigné, ${ou(info.signataire)}, maître d'œuvre, propose :` },
    { t: 'case', niveau: 0, cochee: prononcee, text: `1. de prononcer la réception, en retenant, pour l'achèvement des travaux, la date du ${date(proposition.date_achevement_retenue)}` },
    { t: 'texte', text: 'Cette réception serait prononcée :' },
    { t: 'case', niveau: 1, cochee: proposition.avis === 'sans_reserve', text: '1.1. sans réserve.' },
    { t: 'case', niveau: 1, cochee: sous, text: '1.2. sous réserve :' },
    { t: 'case', niveau: 2, cochee: sous && !!condition('epreuves'), text: `1.2.1. de l'exécution concluante des épreuves énumérées ${annexeN('epreuves')}` },
    { t: 'case', niveau: 2, cochee: sous && !!condition('travaux'), text: `1.2.2. de l'exécution des travaux et prestations énumérés ${annexeN('travaux')}` },
    { t: 'case', niveau: 1, cochee: avec, text: '1.3. avec réserve :' },
    { t: 'case', niveau: 2, cochee: avec && !!condition('malfacons'), text: `1.3.1. le titulaire doit remédier, avant le ${avant('malfacons')}, aux imperfections et malfaçons indiquées ${annexeN('malfacons')}` },
    {
      t: 'case', niveau: 2, cochee: avec && refaction != null,
      text: '1.3.1.1. Toutefois, il est proposé que cette dernière réserve soit levée, si le titulaire du marché public accepte une réfaction égale en prix de base à :',
      valeur: refaction != null ? new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(refaction).replace(/[  ]/g, ' ') : '',
    },
    { t: 'case', niveau: 2, cochee: avec && !!condition('installations'), text: `1.3.2. les installations de chantier doivent être repliées et les terrains et les lieux doivent être remis en état, avant le ${avant('installations')}.` },
    { t: 'case', niveau: 2, cochee: avec && !!condition('pose'), text: `1.3.3. les conditions de pose des équipements doivent être mises en conformité avec les spécifications des fournisseurs, avant le ${avant('pose')}.` },
    { t: 'case', niveau: 0, cochee: proposition.avis === 'non_reception', text: '2. de ne pas prononcer la réception.' },

    { t: 'titre', text: "F - Signature du maître d'œuvre" },
    { t: 'texte', text: `À : ${ou(d.lieu)}, le ${date(proposition.date_proposition)}` },
    { t: 'signatures', cases: [{ titre: "Le maître d'œuvre", sous: info.signataire ?? undefined, date: dateFr(proposition.date_proposition) }] },
    miseAJour('EXE5'),
  ];

  return { ...enTete(d, 'EXE5', "PROPOSITIONS DU MAÎTRE D'ŒUVRE RELATIVES À LA RÉCEPTION DES OUVRAGES"), blocs };
}

export const construireExe = (code: FormulaireExeAvecRendu, d: DonneesExe): DocPv =>
  code === 'EXE4' ? construireExe4(d) : construireExe5(d);
