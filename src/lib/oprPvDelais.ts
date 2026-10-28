// Délais du PV d'OPR, communs aux marchés privés et publics.
//
// Les valeurs par défaut sont celles des notices EXE (marché public) : OPR sous 20 jours
// après l'avis d'achèvement, transmission du PV de levée des réserves sous 5 jours,
// décision du maître d'ouvrage sous 30 jours, carence du maître d'œuvre : 30 jours au
// maître d'ouvrage pour fixer la date après la lettre recommandée du titulaire.
// En marché privé ce sont les stipulations du contrat qui font foi : chaque marché peut
// donc porter ses propres délais (`Delais`), les valeurs ci-dessous ne comblent que l'absence.
// Une date absente ou illisible n'est jamais un retard.

import { ajouterJours, estDateIso, joursEntre, type Delais, type OprPv } from './oprPv';

export const DELAIS_PAR_DEFAUT = { opr: 20, transmission_levee: 5, decision: 30, carence: 30 } as const;
export const DELAI_MIN_JOURS = 1;
export const DELAI_MAX_JOURS = 365;
/** Une échéance qui tombe dans ce nombre de jours est signalée « proche ». */
export const SEUIL_PROCHE_JOURS = 5;

export type CleEcheance = 'opr' | 'decision' | 'transmission_levee' | 'carence';

export type EtatEcheance =
  /** Rien ne la déclenche encore (date de départ inconnue). */
  | 'sans_depart'
  | 'a_venir'
  | 'proche'
  | 'depasse'
  /** Faite dans le délai. */
  | 'respectee'
  /** Faite, mais après la date limite. */
  | 'hors_delai';

export interface Echeance {
  cle: CleEcheance;
  depart: string | null;
  date_limite: string | null;
  delai_jours: number;
  realisee_le: string | null;
  etat: EtatEcheance;
  /** Jours restants jusqu'à la date limite (négatif une fois dépassée), null si faite ou sans départ. */
  jours_restants: number | null;
}

/** Délai retenu : celui du marché s'il est un entier raisonnable, sinon la valeur par défaut. */
export function delaiEffectif(delais: Delais | null | undefined, cle: CleEcheance): number {
  const v = delais?.[cle];
  return typeof v === 'number' && Number.isInteger(v) && v >= DELAI_MIN_JOURS && v <= DELAI_MAX_JOURS
    ? v
    : DELAIS_PAR_DEFAUT[cle];
}

const dateOuNull = (v: string | null | undefined): string | null => (estDateIso(v) ? v : null);

/** Le plus tardif des deux, l'avis et la date d'achèvement annoncée (notice EXE4 : « si cette dernière est postérieure »). */
function departOpr(pv: Pick<OprPv, 'date_avis_achevement' | 'date_achevement_annoncee'>): string | null {
  const dates = [dateOuNull(pv.date_avis_achevement), dateOuNull(pv.date_achevement_annoncee)].filter((d): d is string => !!d);
  return dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null;
}

function calculer(
  cle: CleEcheance,
  depart: string | null,
  realisee: string | null,
  delais: Delais | undefined,
  aujourdhui: string,
): Echeance {
  const delai_jours = delaiEffectif(delais, cle);
  const realisee_le = dateOuNull(realisee);
  if (!depart) {
    return { cle, depart: null, date_limite: null, delai_jours, realisee_le, etat: 'sans_depart', jours_restants: null };
  }
  const date_limite = ajouterJours(depart, delai_jours);
  if (realisee_le) {
    return {
      cle, depart, date_limite, delai_jours, realisee_le,
      etat: realisee_le <= date_limite ? 'respectee' : 'hors_delai',
      jours_restants: null,
    };
  }
  const jours_restants = joursEntre(aujourdhui, date_limite);
  const etat: EtatEcheance = jours_restants < 0 ? 'depasse' : jours_restants <= SEUIL_PROCHE_JOURS ? 'proche' : 'a_venir';
  return { cle, depart, date_limite, delai_jours, realisee_le: null, etat, jours_restants };
}

/**
 * Les échéances d'un PV, à `aujourdhui` (AAAA-MM-JJ). La carence n'apparaît que si la
 * lettre du titulaire est datée ou si le délai des OPR est dépassé sans qu'elles aient eu lieu.
 */
export function echeances(pv: OprPv, aujourdhui: string): Echeance[] {
  const out: Echeance[] = [];

  const opr = calculer('opr', departOpr(pv), pv.date_opr, pv.delais, aujourdhui);
  out.push(opr);

  const carenceOuverte = !!dateOuNull(pv.carence.date_lettre) || opr.etat === 'depasse';
  if (carenceOuverte) {
    out.push(calculer('carence', dateOuNull(pv.carence.date_lettre), pv.carence.date_fixation, pv.delais, aujourdhui));
  }

  out.push(calculer('decision', dateOuNull(pv.date_opr), pv.decision.date_decision, pv.delais, aujourdhui));
  out.push(calculer('transmission_levee', dateOuNull(pv.levee.date_pv), pv.levee.date_transmission, pv.delais, aujourdhui));
  return out;
}

/** Vrai si au moins une échéance est dépassée ou a été tenue hors délai. */
export const aEcheanceEnRetard = (liste: Echeance[]): boolean =>
  liste.some(e => e.etat === 'depasse' || e.etat === 'hors_delai');
