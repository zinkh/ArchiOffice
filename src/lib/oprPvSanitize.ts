// Assainissement du corps d'un PV d'OPR (voir oprPv.ts).
//
// Le client n'envoie jamais que des valeurs de vocabulaire fermé, des dates et de courts
// textes : tout est revalidé ici avant d'atteindre la base. Une section absente du corps
// n'est pas touchée ; une section présente remplace la section enregistrée.
// Le régime n'est volontairement pas lu : le serveur le déduit de l'affaire.

import {
  AVIS_RECEPTION, EPREUVES, INSTALLATIONS, ISSUES_DECISION, NATURES_RESERVE, OUVRAGES,
  POSE_EQUIPEMENTS, PRESENCES_ENTREPRISE, PRESENCES_MOA, TERRAINS, TRAVAUX,
  constatsVierges, estDateIso, pvVierge,
  type CcagVersion, type ConditionReserve, type Constats, type Decision, type Delais,
  type NatureReserve, type OprPv, type Proposition, type RegimeMarche,
} from './oprPv';
import { DELAI_MAX_JOURS, DELAI_MIN_JOURS } from './oprPvDelais';

/** Colonnes de `receptions` qu'un PV d'OPR écrit, en plus des colonnes historiques. */
export const OPR_COLONNES = [
  'marche_id', 'lot_id', 'ccag_version', 'date_avis_achevement', 'date_achevement_annoncee', 'date_opr',
  'presences', 'constats', 'proposition', 'decision', 'levee', 'carence', 'delais',
] as const;

export const ID_MAX = 64;
export const ANNEXE_MAX = 20;
export const CONDITIONS_MAX = 10;
export const REFACTION_MAX = 1_000_000_000;

export interface OprPayload {
  /** Les seules colonnes présentes dans le corps, assainies. */
  colonnes: Record<string, unknown>;
  erreurs: string[];
}

type Corps = Record<string, unknown>;
const estObjet = (v: unknown): v is Corps => !!v && typeof v === 'object' && !Array.isArray(v);

function enumOuNull<T extends string>(v: unknown, permis: readonly T[], champ: string, erreurs: string[]): T | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'string' && (permis as readonly string[]).includes(v)) return v as T;
  erreurs.push(`${champ} : valeur inconnue.`);
  return null;
}

function dateOuNull(v: unknown, champ: string, erreurs: string[]): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (estDateIso(v)) return v;
  erreurs.push(`${champ} : date invalide (AAAA-MM-JJ attendu).`);
  return null;
}

function texteOuNull(v: unknown, max: number, champ: string, erreurs: string[]): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') { erreurs.push(`${champ} : texte attendu.`); return null; }
  const t = v.trim();
  if (!t) return null;
  if (t.length > max) { erreurs.push(`${champ} : ${max} caractères au plus.`); return t.slice(0, max); }
  return t;
}

function montantOuNull(v: unknown, champ: string, erreurs: string[]): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n < 0 || n > REFACTION_MAX) { erreurs.push(`${champ} : montant invalide.`); return null; }
  return Math.round(n * 100) / 100;
}

function conditions(v: unknown, champ: string, erreurs: string[]): ConditionReserve[] {
  if (v === null || v === undefined) return [];
  if (!Array.isArray(v)) { erreurs.push(`${champ} : liste attendue.`); return []; }
  if (v.length > CONDITIONS_MAX) erreurs.push(`${champ} : ${CONDITIONS_MAX} conditions au plus.`);
  const vues = new Set<NatureReserve>();
  const out: ConditionReserve[] = [];
  for (const c of v.slice(0, CONDITIONS_MAX)) {
    if (!estObjet(c)) { erreurs.push(`${champ} : condition invalide.`); continue; }
    const nature = enumOuNull(c.nature, NATURES_RESERVE, `${champ}.nature`, erreurs);
    if (!nature || vues.has(nature)) continue;
    vues.add(nature);
    out.push({
      nature,
      avant_le: dateOuNull(c.avant_le, `${champ}.avant_le`, erreurs),
      annexe: texteOuNull(c.annexe, ANNEXE_MAX, `${champ}.annexe`, erreurs),
    });
  }
  return out;
}

function constats(v: unknown, erreurs: string[]): Constats {
  const base = constatsVierges();
  if (!estObjet(v)) return base;
  const annexes: Constats['annexes'] = {};
  if (estObjet(v.annexes)) {
    for (const nature of NATURES_RESERVE) {
      const a = texteOuNull(v.annexes[nature], ANNEXE_MAX, `constats.annexes.${nature}`, erreurs);
      if (a) annexes[nature] = a;
    }
  }
  return {
    epreuves: enumOuNull(v.epreuves, EPREUVES, 'constats.epreuves', erreurs),
    travaux: enumOuNull(v.travaux, TRAVAUX, 'constats.travaux', erreurs),
    ouvrages: enumOuNull(v.ouvrages, OUVRAGES, 'constats.ouvrages', erreurs),
    pose_equipements: enumOuNull(v.pose_equipements, POSE_EQUIPEMENTS, 'constats.pose_equipements', erreurs),
    installations: enumOuNull(v.installations, INSTALLATIONS, 'constats.installations', erreurs),
    terrains: enumOuNull(v.terrains, TERRAINS, 'constats.terrains', erreurs),
    annexes,
  };
}

function proposition(v: unknown, erreurs: string[]): Proposition {
  const vide = pvVierge('prive').proposition;
  if (!estObjet(v)) return vide;
  return {
    avis: enumOuNull(v.avis, AVIS_RECEPTION, 'proposition.avis', erreurs),
    date_proposition: dateOuNull(v.date_proposition, 'proposition.date_proposition', erreurs),
    date_achevement_retenue: dateOuNull(v.date_achevement_retenue, 'proposition.date_achevement_retenue', erreurs),
    conditions: conditions(v.conditions, 'proposition.conditions', erreurs),
    refaction_montant: montantOuNull(v.refaction_montant, 'proposition.refaction_montant', erreurs),
  };
}

function decision(v: unknown, erreurs: string[]): Decision {
  const vide = pvVierge('prive').decision;
  if (!estObjet(v)) return vide;
  return {
    issue: enumOuNull(v.issue, ISSUES_DECISION, 'decision.issue', erreurs),
    date_decision: dateOuNull(v.date_decision, 'decision.date_decision', erreurs),
    date_effet: dateOuNull(v.date_effet, 'decision.date_effet', erreurs),
    conditions: conditions(v.conditions, 'decision.conditions', erreurs),
    refaction_montant: montantOuNull(v.refaction_montant, 'decision.refaction_montant', erreurs),
    refaction_acceptee_le: dateOuNull(v.refaction_acceptee_le, 'decision.refaction_acceptee_le', erreurs),
  };
}

function delais(v: unknown, erreurs: string[]): Delais {
  if (!estObjet(v)) return {};
  const out: Delais = {};
  for (const cle of ['opr', 'transmission_levee', 'decision', 'carence'] as const) {
    const brut = v[cle];
    if (brut === undefined || brut === null || brut === '') continue;
    const n = Number(brut);
    if (!Number.isInteger(n) || n < DELAI_MIN_JOURS || n > DELAI_MAX_JOURS) {
      erreurs.push(`delais.${cle} : entre ${DELAI_MIN_JOURS} et ${DELAI_MAX_JOURS} jours.`);
      continue;
    }
    out[cle] = n;
  }
  return out;
}

/** Les sections JSON, chacune avec son assainisseur : une section présente dans le corps remplace l'enregistrée. */
const SECTIONS: Record<string, (v: unknown, erreurs: string[]) => unknown> = {
  presences: (v, e) => {
    const o = estObjet(v) ? v : {};
    return {
      moa: enumOuNull(o.moa, PRESENCES_MOA, 'presences.moa', e),
      entreprise: enumOuNull(o.entreprise, PRESENCES_ENTREPRISE, 'presences.entreprise', e),
      date_convocation: dateOuNull(o.date_convocation, 'presences.date_convocation', e),
    };
  },
  constats,
  proposition,
  decision,
  levee: (v, e) => {
    const o = estObjet(v) ? v : {};
    return { date_pv: dateOuNull(o.date_pv, 'levee.date_pv', e), date_transmission: dateOuNull(o.date_transmission, 'levee.date_transmission', e) };
  },
  carence: (v, e) => {
    const o = estObjet(v) ? v : {};
    return { date_lettre: dateOuNull(o.date_lettre, 'carence.date_lettre', e), date_fixation: dateOuNull(o.date_fixation, 'carence.date_fixation', e) };
  },
  delais,
};

export function sanitizeOprPayload(body: unknown): OprPayload {
  const colonnes: Record<string, unknown> = {};
  const erreurs: string[] = [];
  if (!estObjet(body)) return { colonnes, erreurs };

  for (const cle of ['marche_id', 'lot_id'] as const) {
    if (cle in body) colonnes[cle] = texteOuNull(body[cle], ID_MAX, cle, erreurs);
  }
  if ('ccag_version' in body) colonnes.ccag_version = enumOuNull<CcagVersion>(body.ccag_version, ['2009', '2021'], 'ccag_version', erreurs);
  for (const cle of ['date_avis_achevement', 'date_achevement_annoncee', 'date_opr'] as const) {
    if (cle in body) colonnes[cle] = dateOuNull(body[cle], cle, erreurs);
  }
  for (const [cle, assainir] of Object.entries(SECTIONS)) {
    if (cle in body) colonnes[cle] = body[cle] === null ? null : assainir(body[cle], erreurs);
  }
  return { colonnes, erreurs };
}

/**
 * Lit une ligne de `receptions` en PV complet : les sections absentes ou abîmées
 * prennent leur valeur vide, jamais d'exception. Null pour un PV générique (sans régime).
 */
export function lirePv(row: Corps | null | undefined): OprPv | null {
  if (!row || (row.regime !== 'prive' && row.regime !== 'public')) return null;
  const sansErreur: string[] = [];
  const pv = pvVierge(row.regime as RegimeMarche);
  const lu = <T,>(cle: string, defaut: T): T => (row[cle] == null ? defaut : (SECTIONS[cle](row[cle], sansErreur) as T));
  return {
    ...pv,
    ccag_version: enumOuNull<CcagVersion>(row.ccag_version, ['2009', '2021'], 'ccag_version', sansErreur),
    marche_id: texteOuNull(row.marche_id, ID_MAX, 'marche_id', sansErreur),
    lot_id: texteOuNull(row.lot_id, ID_MAX, 'lot_id', sansErreur),
    date_avis_achevement: dateOuNull(row.date_avis_achevement, 'date_avis_achevement', sansErreur),
    date_achevement_annoncee: dateOuNull(row.date_achevement_annoncee, 'date_achevement_annoncee', sansErreur),
    date_opr: dateOuNull(row.date_opr, 'date_opr', sansErreur),
    presences: lu('presences', pv.presences),
    constats: lu('constats', pv.constats),
    proposition: lu('proposition', pv.proposition),
    decision: lu('decision', pv.decision),
    levee: lu('levee', pv.levee),
    carence: lu('carence', pv.carence),
    delais: lu('delais', pv.delais),
  };
}
