// Cerfas EXE4 à EXE9 du marché public : procès-verbal des opérations préalables à la réception
// (EXE4), propositions du maître d'œuvre (EXE5), décision de réception (EXE6) ou de non-réception
// (EXE7), procès-verbal de levée des réserves (EXE8), propositions du maître d'œuvre et décision du
// maître de l'ouvrage sur la levée (EXE9). Même mécanique que le modèle simplifié du privé : le
// contenu est construit sous forme de blocs neutres (voir oprPvDocument.ts) puis rendu à
// l'identique en PDF et en Word.
//
// Le contenu reprend les intitulés des formulaires du ministère de l'Économie et des Finances
// (Direction des Affaires Juridiques, mise à jour du 01/04/2019). Le graphisme du cerfa n'est
// pas reproduit, ses mentions le sont. Une donnée absente s'imprime en pointillés, jamais
// inventée. Ces formulaires citent le CCAG Travaux de 2009 : le CCAG applicable à chaque marché
// est porté par le PV (`ccag_version`) et rappelé sur le formulaire.
import { NATURES_AVEC_ANNEXE, NATURES_RESERVE, type ConditionReserve, type NatureReserve, type OprPv } from './oprPv';
import {
  ENTETES_RESERVES, LARGEURS_RESERVES, blocsAnnexeReserves, casesExclusives, dateFr, lignesReserves, reserveLevee,
  type BlocPv, type DocPv, type ReservePv,
} from './oprPvDocument';

export const EXE_MISE_A_JOUR = '01/04/2019';
const POINTILLES = '..........';

export type FormulaireExeAvecRendu = 'EXE4' | 'EXE5' | 'EXE6' | 'EXE7' | 'EXE8' | 'EXE9';

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
  /** Lieu de signature (« À : ... »). */
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

const ADJUDICATEUR = "Identification du pouvoir adjudicateur ou de l'entité adjudicatrice";
const MAITRE_OUVRAGE = "Identification du maître de l'ouvrage";

function identification(d: DonneesExe, intituleA: string = ADJUDICATEUR): BlocPv[] {
  return [
    ...rubrique('A', intituleA, d.adjudicateur),
    ...rubrique('B', 'Identification du titulaire du marché public', d.titulaire),
    ...rubrique('C', "Identification du maître d'œuvre", d.maitreOeuvre),
    ...rubrique('D', 'Objet du marché public', d.objet),
  ];
}

function enTete(d: DonneesExe, code: FormulaireExeAvecRendu, intitule: string, jour: string | null | undefined): Omit<DocPv, 'blocs'> {
  const marche = d.pv.public_info.reference_marche ? `Marché ${d.pv.public_info.reference_marche}` : '';
  return {
    titre: code,
    intitule: `${code} · ${intitule}`,
    sousTitre: [d.lot, d.entreprise].filter(Boolean).join(' · '),
    // La notice demande de rappeler la référence du marché sur chaque page.
    reference: [marche, d.reference].filter(Boolean).join(' · '),
    date: dateFr(jour),
  };
}

const ccag = (pv: OprPv): BlocPv[] =>
  pv.ccag_version ? [{ t: 'texte', text: `CCAG applicable : cahier des clauses administratives générales applicables aux marchés publics de travaux, version ${pv.ccag_version}.` }] : [];

const ministere: BlocPv = { t: 'texte', text: 'MARCHÉS PUBLICS · RÉCEPTION DES TRAVAUX', gras: true };

const miseAJour = (code: FormulaireExeAvecRendu): BlocPv => ({
  t: 'texte',
  text: `Formulaire ${code} · ministère de l'Économie et des Finances, Direction des Affaires Juridiques · date de mise à jour : ${EXE_MISE_A_JOUR}.`,
});

const euros = (n: number): string => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n).replace(/[  ]/g, ' ');

const annexeDe = (annexes: Partial<Record<NatureReserve, string>>, nature: NatureReserve): string => annexes[nature] || '......';

/** L'objet de la réception : entière ou partielle, avec les prestations concernées (EXE4 E, EXE8 E, EXE9 E). */
function blocsPortee(pv: OprPv, totale: string, partielle: string): BlocPv[] {
  return [
    ...casesExclusives([['totale', totale], ['partielle', partielle]], pv.public_info.portee),
    ...(pv.public_info.prestations ? [{ t: 'texte', text: pv.public_info.prestations } as BlocPv] : []),
  ];
}

// ---------------------------------------------------------------------------
// Annexes numérotées, ventilées par nature de réserve

const LIBELLES_ANNEXE: Record<NatureReserve, string> = {
  epreuves: 'Épreuves à exécuter ou à reprendre',
  travaux: 'Travaux et prestations à exécuter',
  malfacons: 'Imperfections et malfaçons à corriger',
  installations: 'Repli des installations de chantier et remise en état des lieux',
  pose: 'Mise en conformité de la pose des équipements',
};

/**
 * Les annexes d'un cerfa. Quand les réserves ont une nature, chaque nature a son tableau sous son
 * numéro d'annexe (celui que le formulaire cite : « annexe n° 2 ci-jointe ») ; les réserves sans
 * nature précisée sont regroupées à la suite. Sans aucune nature, une annexe unique, comme au privé.
 */
function blocsAnnexes(
  fiche: [string, string][], reserves: ReservePv[], annexes: Partial<Record<NatureReserve, string>>,
): BlocPv[] {
  if (!reserves.some(r => r.nature)) return blocsAnnexeReserves(fiche, reserves);
  const tableau = (titre: string, lignes: ReservePv[]): BlocPv => ({
    t: 'tableau', titre, entetes: ENTETES_RESERVES, largeurs: LARGEURS_RESERVES, lignes: lignesReserves(lignes),
  });
  const parNature = NATURES_RESERVE
    .map(n => ({ nature: n, lignes: reserves.filter(r => r.nature === n) }))
    .filter(g => g.lignes.length > 0);
  const sansNature = reserves.filter(r => !r.nature);
  return [
    { t: 'saut' },
    { t: 'titre', text: 'Annexes au procès-verbal des opérations préalables à la réception' },
    { t: 'fiche', lignes: fiche },
    // Le repli du chantier et la pose des équipements n'ont pas d'annexe numérotée dans les cerfas : leur
    // échéance est portée par la condition de réception elle-même.
    ...parNature.map(g => tableau(
      NATURES_AVEC_ANNEXE.includes(g.nature) ? `Annexe n° ${annexeDe(annexes, g.nature)} · ${LIBELLES_ANNEXE[g.nature]}` : LIBELLES_ANNEXE[g.nature],
      g.lignes,
    )),
    ...(sansNature.length ? [tableau('Réserves sans nature précisée', sansNature)] : []),
  ];
}

const fichePv = (d: DonneesExe): [string, string][] =>
  ([['Objet du marché', d.objet.join(' · ')], ['Lot', d.lot ?? ''], ['Date des OPR', dateFr(d.pv.date_opr)]] as [string, string][]).filter(([, v]) => v);

/** Numéros d'annexe d'un PV : ceux des constats, complétés par ceux des conditions de réception. */
function annexesDuPv(pv: OprPv): Partial<Record<NatureReserve, string>> {
  const out: Partial<Record<NatureReserve, string>> = { ...pv.constats.annexes };
  for (const c of [...pv.proposition.conditions, ...pv.decision.conditions]) {
    if (c.annexe && !out[c.nature]) out[c.nature] = c.annexe;
  }
  return out;
}

// ---------------------------------------------------------------------------
// EXE4 : procès-verbal des opérations préalables à la réception

export function construireExe4(d: DonneesExe): DocPv {
  const { pv } = d;
  const { presences, constats, public_info: info } = pv;
  const annexeN = (n: NatureReserve) => `à l'annexe n° ${annexeDe(constats.annexes, n)} ci-jointe`;

  const blocs: BlocPv[] = [
    ministere,
    ...ccag(pv),
    ...identification(d),

    { t: 'titre', text: 'E - Objet des opérations préalables à la réception des ouvrages' },
    { t: 'texte', text: `Date d'achèvement des travaux proposée par le titulaire du marché public : ${date(pv.date_achevement_annoncee ?? pv.date_avis_achevement)}` },
    { t: 'texte', text: 'Les opérations préalables à la réception des ouvrages portent sur :' },
    ...blocsPortee(pv, "la réception de l'ouvrage comportant les prestations suivantes :", "la réception partielle de l'ouvrage relative aux prestations désignées ci-dessous :"),

    { t: 'titre', text: 'F - Procès-verbal des opérations préalables à la réception des ouvrages' },
    { t: 'texte', text: `Je soussigné, ${ou(info.signataire)}, maître d'œuvre,` },
    ...blocsPresences(presences),
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
    ...blocsConstatsFinaux(pv.constats, 4),
    ...blocsSignaturesProcesVerbal(d, dateFr(pv.date_opr)),
    miseAJour('EXE4'),
    ...blocsAnnexes(fichePv(d), d.reserves, annexesDuPv(pv)),
  ];

  return { ...enTete(d, 'EXE4', 'PROCÈS-VERBAL DES OPÉRATIONS PRÉALABLES À LA RÉCEPTION', pv.date_opr), blocs };
}

/** Présences du pouvoir adjudicateur et du titulaire (EXE4 F, EXE8 F). */
function blocsPresences(presences: OprPv['presences']): BlocPv[] {
  return [
    ...casesExclusives([
      ['present', "en présence du représentant du pouvoir adjudicateur ou de l'entité adjudicatrice ;"],
      ['absent_avise', "en l'absence du représentant du pouvoir adjudicateur ou de l'entité adjudicatrice, dûment avisé par mes soins ;"],
      ...(presences.moa === 'absent' ? [['absent', "en l'absence du représentant du pouvoir adjudicateur ou de l'entité adjudicatrice ;"] as [string, string]] : []),
    ], presences.moa),
    ...casesExclusives([
      ['presente', 'en présence du titulaire du marché public ;'],
      ['absente_convoquee', `en l'absence du titulaire du marché public dûment convoqué, par courrier en date du ${date(presences.date_convocation)}.`],
    ], presences.entreprise),
  ];
}

/** Constats 4 à 6 (pose des équipements, installations, terrains), identiques dans l'EXE4 et l'EXE8. */
function blocsConstatsFinaux(constats: OprPv['constats'], debut: number): BlocPv[] {
  return [
    { t: 'texte', text: `${debut}. les conditions de pose des équipements :`, gras: true },
    ...casesExclusives([
      ['conforme', 'sont conformes aux spécifications des fournisseurs ;'],
      ['non_conforme', 'ne sont pas conformes aux spécifications des fournisseurs.'],
    ], constats.pose_equipements),
    { t: 'texte', text: `${debut + 1}. les installations de chantier :`, gras: true },
    ...casesExclusives([
      ['repliees', 'ont été repliées ;'],
      ['non_repliees', "n'ont pas été repliées ;"],
    ], constats.installations),
    { t: 'texte', text: `${debut + 2}. les terrains et les lieux :`, gras: true },
    ...casesExclusives([
      ['remis_en_etat', 'ont été remis en état ;'],
      ['non_remis_en_etat', "n'ont pas été remis en état."],
    ], constats.terrains),
  ];
}

/** Signatures du procès-verbal (maître d'œuvre, titulaire) et attestation de refus de signer. */
function blocsSignaturesProcesVerbal(d: DonneesExe, jour: string): BlocPv[] {
  return [
    {
      t: 'signatures',
      cases: [
        { titre: "Le maître d'œuvre", sous: d.pv.public_info.signataire ?? undefined, date: jour },
        { titre: 'Le titulaire du marché public', sous: d.entreprise ? `${d.entreprise} · accepté le :` : 'Accepté le :' },
      ],
    },
    { t: 'case', niveau: 0, cochee: false, text: "J'atteste que le titulaire du marché public a refusé de signer le présent procès-verbal." },
    { t: 'signatures', cases: [{ titre: "Le maître d'œuvre", date: jour }] },
  ];
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
  const annexes = annexesDuPv(pv);
  const annexeN = (n: NatureReserve) => `à l'annexe n° ${condition(n)?.annexe || annexeDe(annexes, n)} ci-jointe`;
  const refaction = proposition.refaction_montant;

  const blocs: BlocPv[] = [
    ministere,
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
      valeur: refaction != null ? euros(refaction) : '',
    },
    { t: 'case', niveau: 2, cochee: avec && !!condition('installations'), text: `1.3.2. les installations de chantier doivent être repliées et les terrains et les lieux doivent être remis en état, avant le ${avant('installations')}.` },
    { t: 'case', niveau: 2, cochee: avec && !!condition('pose'), text: `1.3.3. les conditions de pose des équipements doivent être mises en conformité avec les spécifications des fournisseurs, avant le ${avant('pose')}.` },
    { t: 'case', niveau: 0, cochee: proposition.avis === 'non_reception', text: '2. de ne pas prononcer la réception.' },

    { t: 'titre', text: "F - Signature du maître d'œuvre" },
    { t: 'texte', text: `À : ${ou(d.lieu)}, le ${date(proposition.date_proposition)}` },
    { t: 'signatures', cases: [{ titre: "Le maître d'œuvre", sous: info.signataire ?? undefined, date: dateFr(proposition.date_proposition) }] },
    miseAJour('EXE5'),
    ...blocsAnnexes(fichePv(d), d.reserves, annexes),
  ];

  return { ...enTete(d, 'EXE5', "PROPOSITIONS DU MAÎTRE D'ŒUVRE RELATIVES À LA RÉCEPTION DES OUVRAGES", pv.proposition.date_proposition), blocs };
}

// ---------------------------------------------------------------------------
// EXE6 : décision de réception ; EXE7 : décision de non-réception (maître de l'ouvrage)

export function construireExe6(d: DonneesExe): DocPv {
  const { pv } = d;
  const { decision } = pv;
  const condition = (n: NatureReserve) => decision.conditions.find(c => c.nature === n);
  const sous = decision.issue === 'sous_reserve';
  const avec = decision.issue === 'avec_reserve';
  const prononcee = decision.issue === 'sans_reserve' || sous || avec;
  const avant = (n: NatureReserve) => date(condition(n)?.avant_le);
  const annexes = annexesDuPv(pv);
  const annexeN = (n: NatureReserve) => `à l'annexe n° ${condition(n)?.annexe || annexeDe(annexes, n)} ci-jointe`;
  const refaction = decision.refaction_montant;

  const blocs: BlocPv[] = [
    ministere,
    ...ccag(pv),
    ...identification(d, MAITRE_OUVRAGE),

    { t: 'titre', text: 'E - Objet de la décision de réception' },
    { t: 'texte', text: 'La présente décision a pour objet la réception des prestations désignées ci-dessous :' },
    { t: 'texte', text: pv.public_info.prestations || POINTILLES },

    { t: 'titre', text: "F - Décision du maître de l'ouvrage" },
    { t: 'texte', text: 'Au vu :' },
    { t: 'case', niveau: 0, cochee: !!pv.date_opr, text: `du procès-verbal des opérations préalables à la réception, en date du ${date(pv.date_opr)}, et des propositions présentées le ${date(pv.proposition.date_proposition)} par le maître d'œuvre ;` },
    { t: 'case', niveau: 0, cochee: !!decision.refaction_acceptee_le, text: `de la lettre, en date du ${date(decision.refaction_acceptee_le)}, par laquelle le titulaire du marché public accepte la réfaction proposée ;` },
    { t: 'texte', text: "le maître de l'ouvrage décide :" },
    { t: 'case', niveau: 0, cochee: !!decision.date_effet, text: `1. que la date retenue, pour l'achèvement des travaux, est fixée au ${date(decision.date_effet)}` },
    { t: 'case', niveau: 0, cochee: prononcee, text: '2. que la réception est prononcée ;' },
    { t: 'case', niveau: 1, cochee: decision.issue === 'sans_reserve', text: '2.1. sans réserve.' },
    { t: 'case', niveau: 1, cochee: sous, text: '2.2. sous réserve :' },
    { t: 'case', niveau: 2, cochee: sous && !!condition('epreuves'), text: `2.2.1. de l'exécution concluante des épreuves énumérées ${annexeN('epreuves')}` },
    { t: 'case', niveau: 2, cochee: sous && !!condition('travaux'), text: `2.2.2. de l'exécution des travaux et prestations, énumérés ${annexeN('travaux')}, avant le ${avant('travaux')}` },
    { t: 'case', niveau: 1, cochee: avec, text: '2.3. avec réserve :' },
    { t: 'case', niveau: 2, cochee: avec && !!condition('malfacons'), text: `2.3.1. le titulaire doit remédier, avant le ${avant('malfacons')}, aux imperfections et malfaçons indiquées ${annexeN('malfacons')}` },
    {
      t: 'case', niveau: 2, cochee: avec && refaction != null,
      text: '2.3.1.1. Toutefois, il est proposé que cette dernière réserve soit levée, si le titulaire du marché public accepte une réfaction égale en prix de base à :',
      valeur: refaction != null ? euros(refaction) : '',
    },
    { t: 'case', niveau: 2, cochee: avec && !!condition('installations'), text: `2.3.2. les installations de chantier doivent être repliées et les terrains et les lieux doivent être remis en état, avant le ${avant('installations')}.` },
    { t: 'case', niveau: 2, cochee: avec && !!condition('pose'), text: `2.3.3. les conditions de pose des équipements doivent être mises en conformité avec les spécifications des fournisseurs, avant le ${avant('pose')}.` },

    { t: 'titre', text: "G - Signature du maître de l'ouvrage" },
    { t: 'texte', text: `À : ${ou(d.lieu)}, le ${date(decision.date_decision)}` },
    { t: 'signatures', cases: [{ titre: "Le maître de l'ouvrage", date: dateFr(decision.date_decision) }] },
    miseAJour('EXE6'),
    ...blocsAnnexes(fichePv(d), d.reserves, annexes),
  ];

  return { ...enTete(d, 'EXE6', 'DÉCISION DE RÉCEPTION', decision.date_decision), blocs };
}

export function construireExe7(d: DonneesExe): DocPv {
  const { pv } = d;
  const blocs: BlocPv[] = [
    ministere,
    ...ccag(pv),
    ...identification(d, MAITRE_OUVRAGE),

    { t: 'titre', text: "E - Décision du maître de l'ouvrage" },
    { t: 'texte', text: `Au vu du procès-verbal des opérations préalables à la réception, en date du ${date(pv.date_opr)}, et des propositions présentées le ${date(pv.proposition.date_proposition)} par le maître d'œuvre, le maître de l'ouvrage décide de ne pas prononcer la réception des travaux et prestations désignés ci-dessous :` },
    { t: 'texte', text: pv.public_info.prestations || POINTILLES },

    { t: 'titre', text: "F - Signature du maître de l'ouvrage" },
    { t: 'texte', text: `À : ${ou(d.lieu)}, le ${date(pv.decision.date_decision)}` },
    { t: 'signatures', cases: [{ titre: "Le maître de l'ouvrage", date: dateFr(pv.decision.date_decision) }] },
    miseAJour('EXE7'),
  ];
  return { ...enTete(d, 'EXE7', 'DÉCISION DE NON-RÉCEPTION', pv.decision.date_decision), blocs };
}

// ---------------------------------------------------------------------------
// EXE8 : procès-verbal de levée des réserves

export function construireExe8(d: DonneesExe): DocPv {
  const { pv } = d;
  const { levee, public_info: info } = pv;
  const constats = levee.constats;
  const annexeN = (n: NatureReserve) => `à l'annexe n° ${annexeDe(constats.annexes, n)} ci-jointe`;
  // L'annexe de l'EXE8 liste ce qui n'est toujours pas fait : les réserves encore ouvertes.
  const ouvertes = d.reserves.filter(r => !reserveLevee(r));

  const blocs: BlocPv[] = [
    ministere,
    ...ccag(pv),
    ...identification(d),

    { t: 'titre', text: 'E - Objet du procès-verbal de levée des réserves' },
    { t: 'texte', text: 'La levée des réserves porte sur :' },
    ...blocsPortee(pv, "la réception de l'ouvrage comportant les prestations suivantes :", "la réception partielle de l'ouvrage relative aux prestations désignées ci-dessous :"),

    { t: 'titre', text: 'F - Procès-verbal de levée des réserves' },
    { t: 'texte', text: `Je, soussigné, ${ou(info.signataire)}, maître d'œuvre,` },
    ...blocsPresences(levee.presences),
    { t: 'texte', text: 'après avoir procédé aux examens et vérifications nécessaires, constate que :' },

    { t: 'texte', text: '1. les épreuves, prévues au marché public :', gras: true },
    ...casesExclusives([
      ['non_effectuees', "n'ont pas été effectuées ;"],
      ['effectuees_sauf_annexe', `ont été effectuées, à l'exception de celles indiquées ${annexeN('epreuves')} ;`],
      ['concluantes', 'et sont concluantes ;'],
      ['concluantes_sauf_annexe', `et sont concluantes, à l'exception de celles indiquées ${annexeN('epreuves')} ;`],
    ], constats.epreuves),
    { t: 'texte', text: '2. les travaux et prestations, ayant fait l\'objet de réserves :', gras: true },
    ...casesExclusives([
      ['executes', 'ont été exécutés ;'],
      ['executes_sauf_annexe', `ont été exécutés, à l'exception de ceux indiqués ${annexeN('travaux')} ;`],
    ], constats.travaux),
    { t: 'texte', text: '3. les ouvrages :', gras: true },
    ...casesExclusives([
      ['conformes', 'sont conformes aux spécifications du marché public, les imperfections et malfaçons constatées ayant été corrigées ;'],
      ['conformes_sauf_annexe', `sont conformes aux spécifications du marché public, à l'exception des imperfections ou malfaçons indiquées ${annexeN('malfacons')}, qui n'ont pas été corrigées ;`],
    ], constats.ouvrages),
    ...blocsConstatsFinaux(constats, 4),
    ...blocsSignaturesProcesVerbal(d, dateFr(levee.date_pv)),
    miseAJour('EXE8'),
    ...blocsAnnexes(fichePv(d), ouvertes, constats.annexes),
  ];

  return { ...enTete(d, 'EXE8', 'PROCÈS-VERBAL DE LEVÉE DES RÉSERVES', levee.date_pv), blocs };
}

// ---------------------------------------------------------------------------
// EXE9 : propositions du maître d'œuvre et décision du maître de l'ouvrage sur la levée

/** Les cinq options d'une levée (proposition F ou décision H) : numérotées à partir de `base`. */
function optionsLevee(
  pv: OprPv, base: string, choisie: string | null, annexeLevees: string | null, maintenues: ConditionReserve[],
  numeros: { rapporter: string; lever: string; maintenir: string; partie: string; maintenues: string[] },
): BlocPv[] {
  const decisionReception = date(pv.decision.date_decision);
  const maintenue = (n: NatureReserve) => maintenues.find(c => c.nature === n);
  const partie = choisie === 'lever_partie';
  const annexesMaintenues = (n: NatureReserve) => `à l'annexe n° ${maintenue(n)?.annexe || '......'} ci-jointe`;
  const [n1, n2, n3, n4, n5] = numeros.maintenues;
  return [
    { t: 'case', niveau: 0, cochee: choisie === 'rapporter', text: `${numeros.rapporter} ${base === 'proposition' ? 'de' : ''} rapporter la réception des travaux et prestations, l'exécution des épreuves mentionnées dans la décision de réception des ouvrages du ${decisionReception} n'ayant pas été concluantes.`.replace(/\s+/g, ' ') },
    { t: 'case', niveau: 0, cochee: choisie === 'lever_toutes', text: `${numeros.lever} ${base === 'proposition' ? 'de' : ''} lever toutes les réserves dont était assortie la décision de réception des ouvrages, intervenue le ${decisionReception}.`.replace(/\s+/g, ' ') },
    { t: 'case', niveau: 0, cochee: choisie === 'maintenir_toutes', text: `${numeros.maintenir} ${base === 'proposition' ? 'de' : ''} maintenir l'ensemble des réserves dont était assortie la décision de réception des ouvrages, intervenue le ${decisionReception}.`.replace(/\s+/g, ' ') },
    { t: 'case', niveau: 0, cochee: partie, text: `${numeros.partie} parmi les réserves dont était assortie la décision de réception des ouvrages intervenue le ${decisionReception}, ${base === 'proposition' ? 'de lever' : 'lever'} celles figurant dans l'annexe n° ${ou(annexeLevees)} du présent formulaire.` },
    { t: 'texte', text: base === 'proposition' ? 'Il est proposé de maintenir les réserves suivantes :' : 'Il est décidé de maintenir les réserves suivantes :' },
    { t: 'case', niveau: 1, cochee: partie && !!maintenue('epreuves'), text: `${n1} l'exécution des épreuves énumérées ${annexesMaintenues('epreuves')}.` },
    { t: 'case', niveau: 1, cochee: partie && !!maintenue('travaux'), text: `${n2} l'exécution des travaux et prestations listés ${annexesMaintenues('travaux')}.` },
    { t: 'case', niveau: 1, cochee: partie && !!maintenue('malfacons'), text: `${n3} la correction des imperfections et malfaçons indiquées ${annexesMaintenues('malfacons')}.` },
    { t: 'case', niveau: 1, cochee: partie && !!maintenue('installations'), text: `${n4} les installations de chantier doivent être repliées et les terrains et les lieux doivent être remis en état, avant le ${date(maintenue('installations')?.avant_le)}.` },
    { t: 'case', niveau: 1, cochee: partie && !!maintenue('pose'), text: `${n5} les conditions de pose des équipements doivent être mises en conformité avec les spécifications des fournisseurs, avant le ${date(maintenue('pose')?.avant_le)}.` },
  ];
}

/** L'annexe de l'EXE9 : les réserves levées, sous le numéro d'annexe que cite le formulaire. */
function blocsAnnexeLevees(d: DonneesExe, levees: ReservePv[], numero: string | null): BlocPv[] {
  if (!levees.length) return [];
  return [
    { t: 'saut' },
    { t: 'titre', text: `Annexe n° ${ou(numero)} au formulaire EXE9 · réserves levées` },
    { t: 'fiche', lignes: fichePv(d) },
    { t: 'tableau', titre: 'Réserve(s) levée(s)', entetes: ENTETES_RESERVES, largeurs: LARGEURS_RESERVES, lignes: lignesReserves(levees) },
  ];
}

export function construireExe9(d: DonneesExe): DocPv {
  const { pv } = d;
  const { levee, public_info: info } = pv;
  const { proposition, decision } = levee;
  const accepte = decision.option === 'accepter';
  const autre = decision.option !== null && !accepte;
  const choixDecision = autre ? decision.option : null;
  // Les réserves levées : celles que liste l'annexe d'une levée partielle.
  const levees = d.reserves.filter(r => reserveLevee(r));

  const blocs: BlocPv[] = [
    ministere,
    ...ccag(pv),
    ...identification(d, MAITRE_OUVRAGE),

    { t: 'titre', text: 'E - Objet de la levée des réserves' },
    { t: 'texte', text: 'La levée des réserves porte sur :' },
    ...blocsPortee(pv, "la réception de l'ouvrage comportant les prestations suivantes :", "la réception partielle de l'ouvrage relative aux prestations désignées ci-dessous :"),

    { t: 'titre', text: "F - Propositions du maître d'œuvre relatives au procès-verbal de levée des réserves" },
    { t: 'texte', text: `Au vu du procès-verbal de levée des réserves, en date du ${date(levee.date_pv)} ; je soussigné, ${ou(info.signataire)}, maître d'œuvre, propose :` },
    ...optionsLevee(pv, 'proposition', proposition.option, proposition.annexe_levees, proposition.maintenues,
      { rapporter: '1.', lever: '2.', maintenir: '3.', partie: '4.', maintenues: ['4.1', '4.2', '4.3', '4.4', '4.5'] }),

    { t: 'titre', text: "G - Signature du maître d'œuvre" },
    { t: 'texte', text: `À : ${ou(d.lieu)}, le ${date(proposition.date)}` },
    { t: 'signatures', cases: [{ titre: "Le maître d'œuvre", sous: info.signataire ?? undefined, date: dateFr(proposition.date) }] },

    { t: 'titre', text: "H - Décision du maître de l'ouvrage" },
    { t: 'texte', text: `Au vu du procès-verbal de levée des réserves, en date du ${date(levee.date_pv)}, et des propositions complémentaires présentées le ${date(proposition.date)} par le maître d'œuvre ; le maître de l'ouvrage décide :` },
    { t: 'case', niveau: 0, cochee: accepte, text: "1. d'accepter toutes les propositions complémentaires du maître d'œuvre relatives au procès-verbal de levée des réserves." },
    { t: 'case', niveau: 0, cochee: autre, text: "2. de ne pas retenir les propositions complémentaires du maître d'œuvre relatives au procès-verbal de levée des réserves et de :" },
    ...optionsLevee(pv, 'decision', choixDecision, decision.annexe_levees, decision.maintenues,
      { rapporter: '2.1', lever: '2.2', maintenir: '2.3', partie: '2.4', maintenues: ['2.4.1', '2.4.2', '2.4.3', '2.4.4', '2.4.5'] }).map(b =>
      b.t === 'case' && b.niveau === 0 ? { ...b, niveau: 1 as const } : b.t === 'case' ? { ...b, niveau: 2 as const } : b),

    { t: 'titre', text: "I - Signature du maître de l'ouvrage" },
    { t: 'texte', text: `À : ${ou(d.lieu)}, le ${date(decision.date)}` },
    { t: 'signatures', cases: [{ titre: "Le maître de l'ouvrage", date: dateFr(decision.date) }] },
    miseAJour('EXE9'),
    ...blocsAnnexeLevees(d, levees, (autre && decision.option === 'lever_partie' ? decision.annexe_levees : proposition.annexe_levees)),
  ];

  return { ...enTete(d, 'EXE9', "PROPOSITIONS DU MAÎTRE D'ŒUVRE ET DÉCISION DU MAÎTRE DE L'OUVRAGE RELATIVES À LA LEVÉE DES RÉSERVES", decision.date ?? proposition.date ?? levee.date_pv), blocs };
}

export const construireExe = (code: FormulaireExeAvecRendu, d: DonneesExe): DocPv => {
  switch (code) {
    case 'EXE4': return construireExe4(d);
    case 'EXE5': return construireExe5(d);
    case 'EXE6': return construireExe6(d);
    case 'EXE7': return construireExe7(d);
    case 'EXE8': return construireExe8(d);
    case 'EXE9': return construireExe9(d);
  }
};
