// PV des opérations préalables à la réception (OPR), un par lot.
//
// Deux régimes qui partagent le même modèle de données :
//   - privé  : le modèle simplifié du cabinet (A constat, B proposition du maître
//              d'œuvre, C décision du maître d'ouvrage, puis annexe de réserves) ;
//   - public : les formulaires EXE4 (PV des OPR), EXE5 (propositions), EXE6
//              (décision de réception) ou EXE7 (décision de non-réception), puis
//              EXE8 (PV de levée des réserves) et EXE9 (propositions et décision).
// Partagé par le serveur (validation) et l'écran (statut, contrôles, rendu).
// Le statut d'un PV se déduit de ce qui est renseigné, il n'est jamais saisi.

export type RegimeMarche = 'prive' | 'public';
export type CcagVersion = '2009' | '2021';

/**
 * Les cinq natures de réserves communes aux formulaires : elles font le lien entre
 * les constats (EXE4), les propositions (EXE5), la décision (EXE6) et la levée
 * (EXE8, EXE9), et désignent les annexes numérotées.
 */
export const NATURES_RESERVE = ['epreuves', 'travaux', 'malfacons', 'installations', 'pose'] as const;
export type NatureReserve = (typeof NATURES_RESERVE)[number];

/** EXE5 1.2 / EXE6 2.2 : réception « sous réserve » de ces seules natures. */
export const NATURES_SOUS_RESERVE: readonly NatureReserve[] = ['epreuves', 'travaux'];
/** EXE5 1.3 / EXE6 2.3 : réception « avec réserve » de ces seules natures. */
export const NATURES_AVEC_RESERVE: readonly NatureReserve[] = ['malfacons', 'installations', 'pose'];
/** Natures qui doivent être corrigées avant une date (EXE6 2.3.1, 2.3.2, 2.3.3). */
export const NATURES_AVEC_DATE: readonly NatureReserve[] = ['malfacons', 'installations', 'pose'];
/** Natures qui renvoient à une annexe numérotée. */
export const NATURES_AVEC_ANNEXE: readonly NatureReserve[] = ['epreuves', 'travaux', 'malfacons'];

export const PRESENCES_MOA = ['present', 'absent_avise', 'absent'] as const;
export type PresenceMoa = (typeof PRESENCES_MOA)[number];
export const PRESENCES_ENTREPRISE = ['presente', 'absente_convoquee'] as const;
export type PresenceEntreprise = (typeof PRESENCES_ENTREPRISE)[number];

export interface Presences {
  moa: PresenceMoa | null;
  entreprise: PresenceEntreprise | null;
  /** Date du courrier de convocation, quand l'entreprise est absente. */
  date_convocation: string | null;
}

export const EPREUVES = ['non_effectuees', 'effectuees_sauf_annexe', 'concluantes', 'concluantes_sauf_annexe'] as const;
export const TRAVAUX = ['executes', 'executes_sauf_annexe'] as const;
export const OUVRAGES = ['conformes', 'conformes_sauf_annexe'] as const;
export const POSE_EQUIPEMENTS = ['conforme', 'non_conforme'] as const;
export const INSTALLATIONS = ['repliees', 'non_repliees'] as const;
export const TERRAINS = ['remis_en_etat', 'non_remis_en_etat'] as const;

export interface Constats {
  epreuves: (typeof EPREUVES)[number] | null;
  travaux: (typeof TRAVAUX)[number] | null;
  ouvrages: (typeof OUVRAGES)[number] | null;
  /** Marché public seulement (EXE4 4). */
  pose_equipements: (typeof POSE_EQUIPEMENTS)[number] | null;
  installations: (typeof INSTALLATIONS)[number] | null;
  terrains: (typeof TERRAINS)[number] | null;
  /** Numéro d'annexe par nature (« 1 », « A »...), pour les constats « à l'exception de ». */
  annexes: Partial<Record<NatureReserve, string>>;
}

export const AVIS_RECEPTION = ['sans_reserve', 'sous_reserve', 'avec_reserve', 'non_reception'] as const;
export type AvisReception = (typeof AVIS_RECEPTION)[number];

/** Une condition de la réception : ce qui doit être fait, et avant quand. */
export interface ConditionReserve {
  nature: NatureReserve;
  avant_le: string | null;
  annexe: string | null;
}

/** Proposition du maître d'œuvre (EXE5, volet B du modèle simplifié). */
export interface Proposition {
  avis: AvisReception | null;
  date_proposition: string | null;
  /** Date retenue pour l'achèvement des travaux. */
  date_achevement_retenue: string | null;
  conditions: ConditionReserve[];
  /** Réfaction proposée en prix de base (EXE5 1.3.1.1), en euros. */
  refaction_montant: number | null;
}

export const ISSUES_DECISION = ['sans_reserve', 'sous_reserve', 'avec_reserve', 'non_receptionnee'] as const;
export type IssueDecision = (typeof ISSUES_DECISION)[number];

/** Décision du maître d'ouvrage (EXE6 ou EXE7, volet C du modèle simplifié). */
export interface Decision {
  issue: IssueDecision | null;
  date_decision: string | null;
  /** Date d'achèvement retenue, donc date d'effet de la réception. */
  date_effet: string | null;
  conditions: ConditionReserve[];
  refaction_montant: number | null;
  /** Lettre par laquelle le titulaire accepte la réfaction (EXE6, « au vu de »). */
  refaction_acceptee_le: string | null;
}

/** Levée des réserves (EXE8, EXE9) : seules les dates qui portent les délais pour l'instant. */
export interface Levee {
  date_pv: string | null;
  date_transmission: string | null;
}

/** Carence du maître d'œuvre : le titulaire saisit le maître d'ouvrage par lettre recommandée. */
export interface Carence {
  date_lettre: string | null;
  /** Date à laquelle le maître d'ouvrage a fixé les opérations. */
  date_fixation: string | null;
}

export const PORTEES = ['totale', 'partielle'] as const;

/** Mentions propres au marché public (EXE4 E et F, rappel de la référence du marché en bas de page). */
export interface PublicInfo {
  /** La réception porte sur l'ouvrage entier ou sur une partie (réception partielle). */
  portee: (typeof PORTEES)[number] | null;
  /** Prestations concernées (« comportant les prestations suivantes », « désignées ci-dessous »). */
  prestations: string | null;
  /** Nom et prénom du maître d'œuvre soussigné. */
  signataire: string | null;
  /** Référence (numéro) du marché public, rappelée sur le formulaire. */
  reference_marche: string | null;
}

/** Délais propres au marché, en jours : absents = valeurs par défaut (voir oprPvDelais). */
export interface Delais {
  opr?: number;
  transmission_levee?: number;
  decision?: number;
  carence?: number;
}

export interface OprPv {
  regime: RegimeMarche;
  ccag_version: CcagVersion | null;
  marche_id: string | null;
  lot_id: string | null;
  date_avis_achevement: string | null;
  date_achevement_annoncee: string | null;
  date_opr: string | null;
  presences: Presences;
  constats: Constats;
  proposition: Proposition;
  decision: Decision;
  levee: Levee;
  carence: Carence;
  delais: Delais;
  public_info: PublicInfo;
}

export function constatsVierges(): Constats {
  return { epreuves: null, travaux: null, ouvrages: null, pose_equipements: null, installations: null, terrains: null, annexes: {} };
}

export function pvVierge(regime: RegimeMarche): OprPv {
  return {
    regime,
    ccag_version: null,
    marche_id: null,
    lot_id: null,
    date_avis_achevement: null,
    date_achevement_annoncee: null,
    date_opr: null,
    presences: { moa: null, entreprise: null, date_convocation: null },
    constats: constatsVierges(),
    proposition: { avis: null, date_proposition: null, date_achevement_retenue: null, conditions: [], refaction_montant: null },
    decision: { issue: null, date_decision: null, date_effet: null, conditions: [], refaction_montant: null, refaction_acceptee_le: null },
    levee: { date_pv: null, date_transmission: null },
    carence: { date_lettre: null, date_fixation: null },
    delais: {},
    public_info: { portee: null, prestations: null, signataire: null, reference_marche: null },
  };
}

/** Le régime se déduit du maître d'ouvrage de l'affaire (`projects.is_public_client`). */
export function regimeDepuisAffaire(isPublicClient: boolean | null | undefined): RegimeMarche {
  return isPublicClient ? 'public' : 'prive';
}

// ---------------------------------------------------------------------------
// Dates (AAAA-MM-JJ, calculées en UTC)

export function estDateIso(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export function ajouterJours(iso: string, jours: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + jours);
  return d.toISOString().slice(0, 10);
}

/** Nombre de jours de `de` à `a` (négatif si `a` précède `de`). */
export function joursEntre(de: string, a: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000);
}

// ---------------------------------------------------------------------------
// Statut et formulaire, déduits

export type StatutPv =
  | 'a_planifier'
  | 'opr_realisee'
  | 'proposition_emise'
  | 'receptionnee'
  | 'receptionnee_avec_reserves'
  | 'non_receptionnee';

export function statutPv(pv: Pick<OprPv, 'date_opr' | 'proposition' | 'decision'>): StatutPv {
  switch (pv.decision.issue) {
    case 'non_receptionnee': return 'non_receptionnee';
    case 'sans_reserve': return 'receptionnee';
    case 'sous_reserve':
    case 'avec_reserve': return 'receptionnee_avec_reserves';
    default: break;
  }
  if (pv.proposition.avis) return 'proposition_emise';
  return pv.date_opr ? 'opr_realisee' : 'a_planifier';
}

export type FormulaireExe = 'EXE4' | 'EXE5' | 'EXE6' | 'EXE7' | 'EXE8' | 'EXE9';

/**
 * Formulaire de décision du maître d'ouvrage : EXE7 quand la réception n'est pas
 * prononcée (ou proposée de ne pas l'être), EXE6 sinon. Null tant que ni la
 * proposition ni la décision n'existent. Le privé n'a qu'un volet C.
 */
export function formulaireDecision(pv: Pick<OprPv, 'regime' | 'proposition' | 'decision'>): 'EXE6' | 'EXE7' | null {
  if (pv.regime !== 'public') return null;
  if (pv.decision.issue) return pv.decision.issue === 'non_receptionnee' ? 'EXE7' : 'EXE6';
  if (pv.proposition.avis) return pv.proposition.avis === 'non_reception' ? 'EXE7' : 'EXE6';
  return null;
}

/** Formulaires que porte ce PV : la chaîne EXE4 à EXE9 en public, aucun cerfa en privé. */
export function formulairesDuPv(pv: Pick<OprPv, 'regime' | 'proposition' | 'decision'>): FormulaireExe[] {
  if (pv.regime !== 'public') return [];
  const decision = formulaireDecision(pv);
  const out: FormulaireExe[] = ['EXE4', 'EXE5'];
  if (decision) out.push(decision);
  // La levée des réserves ne suit qu'une réception : ni avant toute décision, ni après une non-réception.
  if (decision === 'EXE6') out.push('EXE8', 'EXE9');
  return out;
}

// ---------------------------------------------------------------------------
// Réserves déduites des constats

/**
 * Natures de réserves qu'impliquent les constats : un constat « à l'exception de »
 * ou négatif appelle une condition à la réception. Sert à préremplir la proposition
 * et à signaler une proposition « sans réserve » qui les contredit.
 */
export function naturesImpliquees(c: Constats): NatureReserve[] {
  const out = new Set<NatureReserve>();
  if (c.epreuves === 'non_effectuees' || c.epreuves === 'effectuees_sauf_annexe' || c.epreuves === 'concluantes_sauf_annexe') out.add('epreuves');
  if (c.travaux === 'executes_sauf_annexe') out.add('travaux');
  if (c.ouvrages === 'conformes_sauf_annexe') out.add('malfacons');
  if (c.installations === 'non_repliees' || c.terrains === 'non_remis_en_etat') out.add('installations');
  if (c.pose_equipements === 'non_conforme') out.add('pose');
  return NATURES_RESERVE.filter(n => out.has(n));
}

/** Conditions proposées par défaut d'après les constats, avec l'annexe déjà numérotée. */
export function conditionsSuggerees(c: Constats): ConditionReserve[] {
  return naturesImpliquees(c).map(nature => ({ nature, avant_le: null, annexe: c.annexes[nature] ?? null }));
}

// ---------------------------------------------------------------------------
// Contrôles de cohérence

export interface Anomalie {
  code: string;
  message: string;
}

export interface ControlePv {
  erreurs: Anomalie[];
  avertissements: Anomalie[];
}

export interface ContexteControle {
  /** Réserves du PV encore à lever, quand l'appelant les connaît. */
  reservesOuvertes?: number;
}

const natureAutorisee = (avis: AvisReception | IssueDecision | null, nature: NatureReserve): boolean => {
  if (avis === 'sous_reserve') return NATURES_SOUS_RESERVE.includes(nature);
  if (avis === 'avec_reserve') return NATURES_AVEC_RESERVE.includes(nature);
  return false;
};

function controlerConditions(
  portee: string,
  avis: AvisReception | IssueDecision | null,
  conditions: ConditionReserve[],
  regime: RegimeMarche,
  erreurs: Anomalie[],
): void {
  if ((avis === 'sous_reserve' || avis === 'avec_reserve') && conditions.length === 0) {
    erreurs.push({ code: `${portee}_conditions_manquantes`, message: 'Une réception sous réserve ou avec réserve doit préciser ce qui reste à faire.' });
  }
  if ((avis === 'sans_reserve' || avis === 'non_reception' || avis === 'non_receptionnee') && conditions.length > 0) {
    erreurs.push({ code: `${portee}_conditions_inattendues`, message: 'Sans réserve ou sans réception, aucune condition ne peut être indiquée.' });
  }
  for (const c of conditions) {
    // Le cerfa distingue « sous réserve » (épreuves, travaux) et « avec réserve » (malfaçons,
    // repli, pose) ; le modèle simplifié du privé les réunit sous un même volet.
    if (regime === 'public' && !natureAutorisee(avis, c.nature)) {
      erreurs.push({ code: `${portee}_nature_incompatible`, message: `La nature « ${c.nature} » ne peut pas figurer dans une réception « ${avis === 'sous_reserve' ? 'sous réserve' : 'avec réserve'} ».` });
    }
    if (NATURES_AVEC_DATE.includes(c.nature) && !c.avant_le) {
      erreurs.push({ code: `${portee}_date_manquante`, message: `Une date limite est requise pour « ${c.nature} ».` });
    }
  }
}

/** Contrôles de cohérence d'un PV : erreurs bloquantes et avertissements. Aucune date illisible n'est un retard. */
export function controlerPv(pv: OprPv, ctx: ContexteControle = {}): ControlePv {
  const erreurs: Anomalie[] = [];
  const avertissements: Anomalie[] = [];

  if (!pv.marche_id && !pv.lot_id) erreurs.push({ code: 'lot_manquant', message: 'Le lot (ou le marché) du PV est obligatoire : un PV par lot.' });
  if (pv.regime === 'public' && !pv.ccag_version) {
    avertissements.push({ code: 'ccag_manquant', message: 'CCAG applicable non renseigné : à reprendre du CCAP du marché.' });
  }

  const { proposition, decision, constats, presences } = pv;

  if (pv.regime === 'public') {
    if (!pv.public_info.portee) {
      avertissements.push({ code: 'portee_manquante', message: "Précisez si la réception porte sur l'ouvrage entier ou sur une partie de l'ouvrage." });
    } else if (pv.public_info.portee === 'partielle' && !pv.public_info.prestations) {
      avertissements.push({ code: 'prestations_manquantes', message: 'Réception partielle : désignez les prestations concernées.' });
    }
  }

  if (presences.entreprise === 'absente_convoquee' && !presences.date_convocation) {
    erreurs.push({ code: 'convocation_manquante', message: 'Entreprise absente : la date du courrier de convocation est requise.' });
  }

  if (pv.regime === 'public') {
    for (const [nature, ok] of [
      ['epreuves', constats.epreuves === 'effectuees_sauf_annexe' || constats.epreuves === 'concluantes_sauf_annexe'],
      ['travaux', constats.travaux === 'executes_sauf_annexe'],
      ['malfacons', constats.ouvrages === 'conformes_sauf_annexe'],
    ] as Array<[NatureReserve, boolean]>) {
      if (ok && !constats.annexes[nature]) {
        erreurs.push({ code: 'annexe_manquante', message: `Constat « à l'exception de » : le numéro d'annexe est requis (${nature}).` });
      }
    }
  }

  controlerConditions('proposition', proposition.avis, proposition.conditions, pv.regime, erreurs);
  controlerConditions('decision', decision.issue, decision.conditions, pv.regime, erreurs);

  if (proposition.avis === 'sans_reserve') {
    if ((ctx.reservesOuvertes ?? 0) > 0) {
      erreurs.push({ code: 'reserves_ouvertes', message: 'La réception ne peut pas être proposée sans réserve alors que des réserves restent à lever.' });
    }
    if (naturesImpliquees(constats).length > 0) {
      avertissements.push({ code: 'avis_incoherent_constats', message: 'Des constats appellent des réserves alors que la réception est proposée sans réserve.' });
    }
  }
  if (decision.issue === 'sans_reserve' && (ctx.reservesOuvertes ?? 0) > 0) {
    erreurs.push({ code: 'reserves_ouvertes', message: 'La réception ne peut pas être prononcée sans réserve alors que des réserves restent à lever.' });
  }

  const apres = (code: string, libelle: string, date: string | null, ref: string | null) => {
    if (date && ref && estDateIso(date) && estDateIso(ref) && date < ref) {
      erreurs.push({ code, message: `${libelle} ne peut pas précéder le ${ref.split('-').reverse().join('/')}.` });
    }
  };
  apres('proposition_avant_opr', 'La proposition', proposition.date_proposition, pv.date_opr);
  apres('decision_avant_opr', 'La décision', decision.date_decision, pv.date_opr);
  for (const c of [...proposition.conditions, ...decision.conditions]) {
    apres('echeance_avant_opr', 'Une date limite de réserve', c.avant_le, pv.date_opr);
  }

  return { erreurs, avertissements };
}
