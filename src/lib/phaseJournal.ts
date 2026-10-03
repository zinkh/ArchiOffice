// Journal de l'opération : logique partagée par l'écran (PhaseJournal,
// stepper de l'en-tête) et le serveur (server/routes/projectPhaseNotes.ts).

export const PHASE_NOTE_PHASES = ['ESQ', 'APS', 'APD', 'PC', 'PRO', 'DCE', 'ACT', 'VISA', 'DET', 'AOR'] as const;
export type PhaseNotePhase = (typeof PHASE_NOTE_PHASES)[number];

export const PHASE_NOTE_KINDS = ['observation', 'programme', 'budget', 'decision_moa', 'attention'] as const;
export type PhaseNoteKind = (typeof PHASE_NOTE_KINDS)[number];

export const PHASE_NOTE_MAX_CHARS = 5000;

export interface PhaseNote {
  id: string;
  project_id: string;
  phase: string;
  kind: PhaseNoteKind;
  body: string;
  occurred_on: string;
  budget_before?: number | null;
  budget_after?: number | null;
  author_id?: string | null;
  author_name?: string | null;
  created_at?: string;
  updated_at?: string;
}

/** Phase suivante dans la liste affichée (missions du contrat), ou rien en fin de mission. */
export function nextPhase<T extends string>(phases: readonly T[], current: T | undefined): T | undefined {
  if (!current) return phases[0];
  const index = phases.indexOf(current);
  return index === -1 ? undefined : phases[index + 1];
}

/** Écart d'un dépassement de budget, ou rien s'il manque un des deux montants. */
export function budgetDelta(note: Pick<PhaseNote, 'budget_before' | 'budget_after'>): { amount: number; pct: number | null } | null {
  const before = note.budget_before;
  const after = note.budget_after;
  if (before == null || after == null) return null;
  const amount = Number(after) - Number(before);
  const pct = Number(before) > 0 ? (amount / Number(before)) * 100 : null;
  return { amount, pct };
}

/** Une hausse de l'estimation (écart strictement positif) est un dépassement. */
export function isBudgetOverrun(note: Pick<PhaseNote, 'kind' | 'budget_before' | 'budget_after'>): boolean {
  if (note.kind !== 'budget') return false;
  const delta = budgetDelta(note);
  return !!delta && delta.amount > 0;
}

export interface PhaseNoteSummary { count: number; overrun: boolean }

/** Nombre d'entrées par phase et présence d'un dépassement, pour le stepper. */
export function summarizeByPhase(notes: readonly PhaseNote[]): Record<string, PhaseNoteSummary> {
  const out: Record<string, PhaseNoteSummary> = {};
  for (const note of notes) {
    const entry = out[note.phase] ?? (out[note.phase] = { count: 0, overrun: false });
    entry.count += 1;
    if (isBudgetOverrun(note)) entry.overrun = true;
  }
  return out;
}

/** Plus récent d'abord : date de l'évènement, puis date de saisie. */
export function sortPhaseNotes(notes: readonly PhaseNote[]): PhaseNote[] {
  return [...notes].sort((a, b) =>
    (b.occurred_on || '').localeCompare(a.occurred_on || '')
    || (b.created_at || '').localeCompare(a.created_at || ''));
}
