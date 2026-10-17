// Rentabilité d'une affaire par phase : honoraires prévus (part de la mission
// dans le contrat MOE) face au coût du temps passé (heures x coût horaire de
// chaque membre). Logique pure, partagée par le serveur et l'écran, testée.
import type { DocumentPhase } from '../types';

/** Phases de la mission sur lesquelles le temps peut être imputé. */
export const MISSION_PHASES: DocumentPhase[] = ['ESQ', 'APS', 'APD', 'PC', 'PRO', 'DCE', 'ACT', 'VISA', 'DET', 'AOR'];

// Maps ContratMOEMission ids (Contrats.tsx uses 'pro', Proposals.tsx's
// fee_distribution uses 'projet' for the same phase, both are accepted here)
// to the DocumentPhase codes used by the "Phase actuelle" buttons.
export const MISSION_ID_TO_PHASE: Record<string, DocumentPhase> = {
  esquisse: 'ESQ', aps: 'APS', apd: 'APD', pro: 'PRO', projet: 'PRO',
  act: 'ACT', visa: 'VISA', det: 'DET', aor: 'AOR',
};

/** Clé des heures imputées à aucune phase. */
export const NO_PHASE = '';

/** Code de phase valide, sinon null (une saisie libre n'est jamais enregistrée). */
export function normalizePhase(value: unknown): DocumentPhase | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return (MISSION_PHASES as string[]).includes(code) ? (code as DocumentPhase) : null;
}

export interface TimeEntryLike {
  user_id: string;
  start_time: string;
  end_time?: string | null;
  phase?: string | null;
  billable?: boolean | null;
}

export function entryHours(entry: Pick<TimeEntryLike, 'start_time' | 'end_time'>): number {
  if (!entry.end_time) return 0;
  const ms = new Date(entry.end_time).getTime() - new Date(entry.start_time).getTime();
  return Number.isFinite(ms) && ms > 0 ? ms / 3_600_000 : 0;
}

export interface PhaseTotals {
  hours: number;
  billableHours: number;
  /** Coût du temps passé, en centimes (tout le temps, facturable ou non). */
  costCents: number;
}

/**
 * Heures et coût par phase. `costCentsByUser` donne le coût horaire de chaque
 * membre ; un membre sans coût renseigné compte pour 0 et est listé dans
 * `unratedUsers`, pour que l'écran dise que le coût est incomplet plutôt que
 * de présenter une marge flatteuse.
 */
export function summarizeTimeByPhase(
  entries: TimeEntryLike[],
  costCentsByUser: Record<string, number | null | undefined>,
): { byPhase: Record<string, PhaseTotals>; unratedUsers: string[] } {
  const byPhase: Record<string, PhaseTotals> = {};
  const unrated = new Set<string>();
  for (const entry of entries) {
    const hours = entryHours(entry);
    if (hours <= 0) continue;
    const phase = normalizePhase(entry.phase) ?? NO_PHASE;
    const rate = costCentsByUser[entry.user_id];
    if (rate == null) unrated.add(entry.user_id);
    const slot = (byPhase[phase] ||= { hours: 0, billableHours: 0, costCents: 0 });
    slot.hours += hours;
    if (entry.billable !== false) slot.billableHours += hours;
    slot.costCents += hours * (rate ?? 0);
  }
  for (const slot of Object.values(byPhase)) slot.costCents = Math.round(slot.costCents);
  return { byPhase, unratedUsers: [...unrated] };
}

export interface MissionLike {
  id: string;
  name?: string;
  pct?: number;
  incluse?: boolean;
}

export interface ProfitabilityRow {
  phase: string;
  /** Honoraires prévus pour la phase, en euros (0 hors mission). */
  budget: number;
  hours: number;
  billableHours: number;
  /** Coût du temps passé, en euros. */
  cost: number;
  /** budget - cost, en euros. */
  margin: number;
  /** margin / budget, ou null sans budget. */
  marginPct: number | null;
  /** Honoraires par heure passée, ou null sans heure. */
  feePerHour: number | null;
}

function buildRow(phase: string, budget: number, totals: PhaseTotals | undefined): ProfitabilityRow {
  const hours = totals?.hours ?? 0;
  const cost = (totals?.costCents ?? 0) / 100;
  const margin = budget - cost;
  return {
    phase,
    budget,
    hours,
    billableHours: totals?.billableHours ?? 0,
    cost,
    margin,
    marginPct: budget > 0 ? (margin / budget) * 100 : null,
    feePerHour: hours > 0 ? budget / hours : null,
  };
}

/**
 * Une ligne par phase de la mission (budget = honoraires x part de la mission),
 * puis une ligne « sans phase » si du temps y a été imputé, puis le total.
 * Les missions qui ne correspondent à aucune phase (OPC...) sont ignorées : le
 * temps qui leur revient se saisit sans phase.
 */
export function buildProfitability(
  honoraires: number,
  missions: MissionLike[],
  byPhase: Record<string, PhaseTotals>,
): { rows: ProfitabilityRow[]; total: ProfitabilityRow } {
  const budgets = new Map<string, number>();
  for (const mission of missions) {
    if (mission.incluse === false) continue;
    const phase = MISSION_ID_TO_PHASE[mission.id];
    if (!phase) continue;
    budgets.set(phase, (budgets.get(phase) ?? 0) + (honoraires * (Number(mission.pct) || 0)) / 100);
  }
  const phases = new Set<string>([...budgets.keys(), ...Object.keys(byPhase).filter(p => p !== NO_PHASE)]);
  const ordered = MISSION_PHASES.filter(p => phases.has(p));
  const rows = ordered.map(p => buildRow(p, budgets.get(p) ?? 0, byPhase[p]));
  if (byPhase[NO_PHASE]) rows.push(buildRow(NO_PHASE, 0, byPhase[NO_PHASE]));

  const sum = (pick: (r: ProfitabilityRow) => number) => rows.reduce((acc, r) => acc + pick(r), 0);
  const budget = sum(r => r.budget);
  const hours = sum(r => r.hours);
  const cost = sum(r => r.cost);
  const margin = budget - cost;
  return {
    rows,
    total: {
      phase: 'TOTAL', budget, hours, billableHours: sum(r => r.billableHours), cost, margin,
      marginPct: budget > 0 ? (margin / budget) * 100 : null,
      feePerHour: hours > 0 ? budget / hours : null,
    },
  };
}
