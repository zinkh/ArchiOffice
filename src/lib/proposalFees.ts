// Calcul des honoraires d'une proposition : brut, périmètre de mission (PC seul),
// remise, arrondi, TVA et TTC. Logique pure, testée dans `__tests__/proposalFees.test.ts`.
//
// Ordre des opérations (toujours le même, à l'écran comme à l'export) :
//   1. brut théorique = coût des travaux x % honoraires de base x taux de complexité
//   2. périmètre : mission complète = 100 % ; PC seul = part (%) de la mission complète
//   3. arrondi du brut selon le mode choisi (aucun, à l'euro, à 10 €, à 100 €)
//   4. remise (pourcentage ou montant fixe), plafonnée au brut
//   5. arrondi du net HT selon le même mode ; la remise affichée est brut - net,
//      de sorte que les lignes du document s'additionnent toujours
//   6. TVA arrondie au centime, TTC = net + TVA

export type FeeRounding = 'none' | 'euro' | 'ten' | 'hundred';
export type DiscountMode = 'percent' | 'amount';
export type MissionScope = 'complete' | 'pc';

export const FEE_ROUNDING_OPTIONS: Array<{ value: FeeRounding; label: string }> = [
  { value: 'none', label: 'Au centime (aucun arrondi)' },
  { value: 'euro', label: 'À l’euro' },
  { value: 'ten', label: 'À la dizaine d’euros' },
  { value: 'hundred', label: 'À la centaine d’euros' },
];

/**
 * Part des honoraires d'une mission complète revenant à une mission « PC seul »
 * (esquisse, APS, APD et dossier de permis), proposée par défaut : elle se corrige à l'écran.
 */
export const PC_SCOPE_DEFAULT_SHARE_PCT = 36;

/** Missions de la répartition retenues pour un PC seul. */
export const PC_SCOPE_MISSION_IDS = ['esquisse', 'aps', 'apd'];

const STEP: Record<FeeRounding, number> = { none: 0, euro: 1, ten: 10, hundred: 100 };

const cents = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export function roundFee(value: number, mode: FeeRounding | null | undefined): number {
  const v = Number.isFinite(value) ? value : 0;
  const step = STEP[mode ?? 'none'] ?? 0;
  return step === 0 ? cents(v) : Math.round(v / step) * step;
}

export interface FeeInputs {
  constructionCost?: number | null;
  baseFeePercent?: number | null;
  complexityRate?: number | null;
  scope?: MissionScope | null;
  scopeSharePct?: number | null;
  rounding?: FeeRounding | null;
  discountMode?: DiscountMode | null;
  discountValue?: number | null;
  vatRate?: number | null;
}

export interface FeeBreakdown {
  /** Honoraires de la mission complète, avant périmètre. */
  missionComplete: number;
  /** Part appliquée (100 pour une mission complète). */
  sharePct: number;
  /** Brut après périmètre et arrondi. */
  brut: number;
  remise: number;
  netHT: number;
  tva: number;
  ttc: number;
}

const num = (v: number | null | undefined): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export function scopeShare(scope: MissionScope | null | undefined, sharePct: number | null | undefined): number {
  if (scope !== 'pc') return 100;
  const s = num(sharePct);
  return s > 0 && s <= 100 ? s : PC_SCOPE_DEFAULT_SHARE_PCT;
}

/** Honoraires bruts théoriques, avant arrondi : null si une donnée manque. */
export function grossFee(i: FeeInputs): number | null {
  const cost = num(i.constructionCost);
  const pct = num(i.baseFeePercent);
  if (cost <= 0 || pct <= 0) return null;
  const complexity = num(i.complexityRate) > 0 ? num(i.complexityRate) : 1;
  const complete = cost * (pct / 100) * complexity;
  return complete * (scopeShare(i.scope, i.scopeSharePct) / 100);
}

/** Décompose des honoraires bruts (déjà calculés ou saisis) en remise, net, TVA et TTC. */
export function applyDiscountAndVat(brutTheorique: number, i: FeeInputs): FeeBreakdown {
  const sharePct = scopeShare(i.scope, i.scopeSharePct);
  const brut = roundFee(brutTheorique, i.rounding);
  const dv = Math.max(0, num(i.discountValue));
  const remiseBrute = i.discountMode === 'percent' ? brut * (Math.min(dv, 100) / 100) : Math.min(dv, brut);
  const netHT = Math.max(0, roundFee(brut - remiseBrute, i.rounding));
  const remise = cents(brut - netHT);
  const tva = cents(netHT * (num(i.vatRate) / 100));
  return {
    missionComplete: sharePct > 0 ? cents(brutTheorique / (sharePct / 100)) : cents(brutTheorique),
    sharePct, brut, remise, netHT, tva, ttc: cents(netHT + tva),
  };
}

export function computeFees(i: FeeInputs): FeeBreakdown | null {
  const g = grossFee(i);
  return g === null ? null : applyDiscountAndVat(g, i);
}
