// Contenu du PV d'OPR privé (modèle simplifié du cabinet).
//
// Le contenu est construit UNE fois, sous forme de blocs neutres (titres, cases à cocher,
// fiches, signatures, tableau), puis rendu à l'identique en PDF (oprPvPdf.ts) et en Word
// (oprPvDocx.ts). Il suit le modèle simplifié : A constat des opérations, B proposition du
// maître d'œuvre, C décision du maître d'ouvrage, puis l'annexe des réserves à lever.
// Aucune donnée n'est inventée : un champ non renseigné s'imprime en pointillés.
import {
  estDateIso, type ConditionReserve, type NatureReserve, type OprPv,
} from './oprPv';

export type BlocPv =
  | { t: 'titre'; text: string }
  | { t: 'texte'; text: string; gras?: boolean }
  /** Case à cocher. `valeur` : ce qui suit le texte (date, montant) ; '' = à compléter en pointillés. */
  | { t: 'case'; text: string; cochee: boolean; niveau: 0 | 1; valeur?: string }
  | { t: 'fiche'; titre?: string; lignes: [string, string][] }
  | { t: 'signatures'; cases: { titre: string; sous?: string; date?: string }[] }
  | { t: 'saut' }
  | { t: 'tableau'; titre: string; entetes: string[]; largeurs: number[]; lignes: Array<string[] | { groupe: string }> };

export interface DocPv {
  /** Titre court, repris dans l'en-tête de chaque page (un titre long chevauche le nom de l'agence). */
  titre: string;
  /** Intitulé complet du document, imprimé en tête du Word. */
  intitule: string;
  sousTitre: string;
  reference: string;
  /** Date imprimée sous le titre (date des OPR). */
  date: string;
  blocs: BlocPv[];
}

export interface ReservePv {
  numero?: number | null;
  batiment?: string | null;
  localisation?: string | null;
  /** Date de constat (AAAA-MM-JJ ou date-heure ISO). */
  date?: string | null;
  points: string;
}

export interface DonneesPvPrive {
  pv: OprPv;
  reference?: string | null;
  maitreOuvrage?: string | null;
  objetMarche?: string | null;
  dateMarche?: string | null;
  /** « Lot 01 · Gros œuvre » (voir libelleLot). */
  lot?: string | null;
  entreprise?: string | null;
  /** Nom de l'agence ou de l'architecte, imprimé sous la signature du maître d'œuvre. */
  maitreOeuvre?: string | null;
  reserves: ReservePv[];
}

export const libelleLot = (numero?: string | null, titre?: string | null): string =>
  [numero ? `Lot ${numero}` : '', titre ?? ''].filter(Boolean).join(' · ');

/** AAAA-MM-JJ (ou date-heure ISO) en JJ/MM/AAAA ; vide si illisible. */
export function dateFr(valeur?: string | null): string {
  const jour = typeof valeur === 'string' ? valeur.slice(0, 10) : '';
  return estDateIso(jour) ? jour.split('-').reverse().join('/') : '';
}

/** Montant en euros avec des espaces ordinaires : l'espace fine de Intl s'imprime « / » dans jsPDF. */
const eur = (n: number): string =>
  `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`.replace(/[  ]/g, ' ');

const cases = (
  options: Array<[string, string]>, choisi: string | null,
): BlocPv[] => options.map(([valeur, text]) => ({ t: 'case', text, cochee: choisi === valeur, niveau: 0 }));

/**
 * Les conditions d'une réception sous réserve, dans l'ordre du modèle. Toutes sont
 * imprimées (cochées ou non) pour que le papier reste un formulaire ; la pose des
 * équipements, absente du modèle simplifié, n'est imprimée que si elle est retenue.
 */
function casesConditions(
  conditions: ConditionReserve[], refaction: number | null, actives: boolean, decision: boolean,
): BlocPv[] {
  const par = new Map<NatureReserve, ConditionReserve>(conditions.map(c => [c.nature, c]));
  const coche = (n: NatureReserve) => actives && par.has(n);
  const date = (n: NatureReserve) => dateFr(par.get(n)?.avant_le);
  const out: BlocPv[] = [
    { t: 'case', niveau: 1, cochee: coche('travaux'), text: "l'exécution des travaux annexés avant le :", valeur: date('travaux') },
    { t: 'case', niveau: 1, cochee: coche('epreuves'), text: "l'exécution concluante des épreuves annexées." },
    { t: 'case', niveau: 1, cochee: coche('malfacons'), text: 'la reprise des imperfections ou malfaçons annexées avant le :', valeur: date('malfacons') },
    decision
      ? { t: 'case', niveau: 1, cochee: actives && refaction != null, text: "ou l'application de la réfaction acceptée par l'entrepreneur", valeur: refaction != null ? eur(refaction) : undefined }
      : { t: 'case', niveau: 1, cochee: actives && refaction != null, text: 'ou la levée de cette réserve si une réfaction est appliquée, égale à :', valeur: refaction != null ? eur(refaction) : '' },
    { t: 'case', niveau: 1, cochee: coche('installations'), text: 'la remise en état des lieux et le repliement des installations avant le :', valeur: date('installations') },
  ];
  if (par.has('pose')) {
    out.push({ t: 'case', niveau: 1, cochee: coche('pose'), text: 'la mise en conformité de la pose des équipements avant le :', valeur: date('pose') });
  }
  return out;
}

function reserveEnLigne(r: ReservePv): string[] {
  return [r.numero != null ? String(r.numero) : '', r.localisation ?? '', dateFr(r.date), r.points, '', ''];
}

function lignesReserves(reserves: ReservePv[]): Array<string[] | { groupe: string }> {
  if (!reserves.length) return Array.from({ length: 4 }, () => ['', '', '', '', '', '']);
  const batiments = new Set(reserves.map(r => (r.batiment ?? '').trim()));
  const groupees = batiments.size > 1 || !batiments.has('');
  const tri = [...reserves].sort((a, b) =>
    (a.batiment ?? '').localeCompare(b.batiment ?? '', 'fr') || (a.numero ?? 0) - (b.numero ?? 0));
  const out: Array<string[] | { groupe: string }> = [];
  let courant: string | null = null;
  for (const r of tri) {
    const bat = (r.batiment ?? '').trim();
    if (groupees && bat !== courant) {
      out.push({ groupe: bat ? `Bâtiment ${bat}` : 'Sans bâtiment' });
      courant = bat;
    }
    out.push(reserveEnLigne(r));
  }
  return out;
}

export function construirePvPrive(d: DonneesPvPrive): DocPv {
  const { pv } = d;
  const { presences, constats, proposition, decision } = pv;
  const avecReserve = (avis: string | null) => avis === 'sous_reserve' || avis === 'avec_reserve';

  const identite: [string, string][] = ([
    ["Maître d'ouvrage", d.maitreOuvrage ?? ''],
    ['Objet du marché', d.objetMarche ?? ''],
    ['Date du marché', dateFr(d.dateMarche)],
    ['Date des OPR', dateFr(pv.date_opr)],
    ['Lot', d.lot ?? ''],
    ['Entreprise', d.entreprise ?? ''],
  ] as [string, string][]).filter(([, v]) => v);

  const convocation = presences.date_convocation ? ` (convocation par courrier du ${dateFr(presences.date_convocation)})` : '';

  const blocs: BlocPv[] = [
    { t: 'fiche', lignes: identite },

    { t: 'titre', text: 'A. Procès-verbal des opérations préalables à la réception' },
    { t: 'texte', text: "Je soussigné, maître d'œuvre," },
    ...cases([
      ['present', "en présence du maître d'ouvrage"],
      ['absent_avise', "en l'absence du maître d'ouvrage, dûment avisé"],
      ...(presences.moa === 'absent' ? [['absent', "en l'absence du maître d'ouvrage"] as [string, string]] : []),
    ], presences.moa),
    ...cases([
      ['presente', "en présence de l'entrepreneur dûment convoqué"],
      ['absente_convoquee', `en l'absence de l'entrepreneur dûment convoqué${convocation}`],
    ], presences.entreprise),
    { t: 'texte', text: 'après avoir procédé aux examens et vérifications nécessaires, constate que :' },

    { t: 'texte', text: 'Les épreuves prévues au marché :', gras: true },
    ...cases([
      ['non_effectuees', "n'ont pas été effectuées."],
      ['effectuees_sauf_annexe', "ont été effectuées, à l'exception de celles indiquées en annexe."],
      ['concluantes', 'sont concluantes.'],
      ['concluantes_sauf_annexe', "sont concluantes, à l'exception de celles indiquées en annexe."],
    ], constats.epreuves),
    { t: 'texte', text: 'Les travaux et prestations prévus au marché :', gras: true },
    ...cases([
      ['executes', 'ont été exécutés.'],
      ['executes_sauf_annexe', "ont été exécutés, à l'exception de ceux indiqués en annexe."],
    ], constats.travaux),
    { t: 'texte', text: 'Les ouvrages :', gras: true },
    ...cases([
      ['conformes', 'sont conformes aux spécifications du marché.'],
      ['conformes_sauf_annexe', "sont conformes aux spécifications du marché, à l'exception des imperfections ou malfaçons indiquées en annexe."],
    ], constats.ouvrages),
    { t: 'texte', text: 'Les installations de chantier :', gras: true },
    ...cases([
      ['repliees', 'ont été repliées.'],
      ['non_repliees', "n'ont pas été repliées."],
    ], constats.installations),
    { t: 'texte', text: 'Les terrains et lieux :', gras: true },
    ...cases([
      ['remis_en_etat', 'ont été remis en état.'],
      ['non_remis_en_etat', "n'ont pas été remis en état."],
    ], constats.terrains),
    { t: 'case', text: "J'atteste que l'entrepreneur a refusé de signer le présent procès-verbal.", cochee: false, niveau: 0 },
    {
      t: 'signatures',
      cases: [
        { titre: "Le maître d'œuvre", sous: d.maitreOeuvre ?? undefined, date: dateFr(pv.date_opr) },
        { titre: "L'entrepreneur", sous: 'Accepté le :' },
      ],
    },

    { t: 'titre', text: "B. Proposition du maître d'œuvre au maître de l'ouvrage" },
    { t: 'texte', text: "Sur le vu du procès-verbal ci-dessus, le maître d'œuvre propose de prononcer la réception :" },
    { t: 'case', niveau: 0, cochee: proposition.avis === 'sans_reserve', text: "sans réserve, en retenant pour l'achèvement des travaux la date du :", valeur: dateFr(proposition.date_achevement_retenue) },
    { t: 'case', niveau: 0, cochee: avecReserve(proposition.avis), text: 'sous réserve de :' },
    ...casesConditions(proposition.conditions, proposition.refaction_montant, avecReserve(proposition.avis), false),
    { t: 'case', niveau: 0, cochee: proposition.avis === 'non_reception', text: 'Je propose de ne pas prononcer la réception.' },
    ...(avecReserve(proposition.avis) ? [{ t: 'texte', text: `Date retenue pour l'achèvement des travaux : ${dateFr(proposition.date_achevement_retenue) || '........'}` } as BlocPv] : []),
    { t: 'signatures', cases: [{ titre: "Le maître d'œuvre", sous: d.maitreOeuvre ?? undefined, date: dateFr(proposition.date_proposition) }] },

    { t: 'titre', text: "C. Décision du maître de l'ouvrage" },
    { t: 'texte', text: "Sur le vu du procès-verbal et de la proposition du maître d'œuvre, décide que la réception est prononcée :" },
    { t: 'case', niveau: 0, cochee: decision.issue === 'sans_reserve', text: 'sans réserve, avec effet à la date du :', valeur: dateFr(decision.date_effet) },
    { t: 'case', niveau: 0, cochee: avecReserve(decision.issue), text: 'sous réserve de :' },
    ...casesConditions(decision.conditions, decision.refaction_montant, avecReserve(decision.issue), true),
    ...(avecReserve(decision.issue) ? [{ t: 'texte', text: `Date d'effet de la réception : ${dateFr(decision.date_effet) || '........'}` } as BlocPv] : []),
    { t: 'case', niveau: 0, cochee: decision.issue === 'non_receptionnee', text: 'Il n\'y a pas lieu de prononcer la réception.' },
    { t: 'case', niveau: 0, cochee: false, text: "La réception prononcée le ........ avec effet à la date du ........ est rapportée, les épreuves n'ayant pas été concluantes." },
    { t: 'signatures', cases: [{ titre: "Le maître d'ouvrage", date: dateFr(decision.date_decision) }] },

    { t: 'saut' },
    { t: 'titre', text: 'Annexe au procès-verbal des opérations préalables à la réception' },
    { t: 'fiche', lignes: identite.filter(([k]) => k === 'Objet du marché' || k === 'Lot' || k === 'Date des OPR') },
    {
      t: 'tableau',
      titre: 'Réserve(s) à lever',
      entetes: ['N°', 'Localisation', 'Date', 'Points à lever', "Levée par l'entreprise (date)", 'Vérification MOE (date)'],
      largeurs: [10, 36, 20, 62, 28, 26],
      lignes: lignesReserves(d.reserves),
    },
  ];

  return {
    titre: "PROCÈS-VERBAL D'OPR",
    intitule: 'PROCÈS-VERBAL DES OPÉRATIONS PRÉALABLES À LA RÉCEPTION',
    sousTitre: [d.lot, d.entreprise].filter(Boolean).join(' · '),
    reference: d.reference ?? '',
    date: dateFr(pv.date_opr),
    blocs,
  };
}
