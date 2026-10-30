// Modifications en masse des réserves (OPR et GPA) : logique pure, sans écran ni réseau.
//
// Même principe que la sélection multiple du DPGF (`basculerBatimentEnMasse`) : une case de menu est
// « cochée » quand toutes les réserves choisies portent la valeur, « partielle » quand une partie
// seulement la porte, et un clic la pose partout (ou la retire partout si elle y était déjà).
import { parseJsonList } from './jsonList';

export type ListField = 'lots' | 'entreprises';
export type ListState = 'tous' | 'certains' | 'aucun';

/** Ce que la fiche d'une réserve expose et que l'on modifie en masse. */
export interface BulkRow {
  id: string;
  status: string;
  due_date?: string;
  lots?: unknown;
  entreprises?: unknown;
}

/** Valeur partagée par la sélection : toutes les réserves, une partie ou aucune. */
export function listState(rows: readonly BulkRow[], field: ListField, value: string): ListState {
  if (!rows.length) return 'aucun';
  const withValue = rows.filter(r => parseJsonList(r[field]).includes(value)).length;
  if (withValue === 0) return 'aucun';
  return withValue === rows.length ? 'tous' : 'certains';
}

/**
 * Réserves modifiées par un clic sur une valeur de liste : retirée de toutes si toutes la portent,
 * sinon ajoutée à celles qui ne l'ont pas. Une réserve déjà conforme n'est pas rendue (rien à écrire).
 */
export function toggleListValue<T extends BulkRow>(rows: readonly T[], field: ListField, value: string): T[] {
  const remove = listState(rows, field, value) === 'tous';
  const changed: T[] = [];
  for (const row of rows) {
    const list = parseJsonList(row[field]);
    const has = list.includes(value);
    if (remove ? !has : has) continue;
    const next = remove ? list.filter(v => v !== value) : [...list, value];
    changed.push({ ...row, [field]: JSON.stringify(next) } as T);
  }
  return changed;
}

export function setStatus<T extends BulkRow>(rows: readonly T[], status: T['status']): T[] {
  return rows.filter(r => r.status !== status).map(r => ({ ...r, status }) as T);
}

/** Date AAAA-MM-JJ, `days` jours après `from` (heure locale : un chantier se pense en jours civils). */
export function dueInDays(days: number, from: Date = new Date()): string {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Échéance posée sur toutes les réserves (la fiche d'une réserve a toujours une échéance). */
export function setDueDate<T extends BulkRow>(rows: readonly T[], due: string): T[] {
  return rows.filter(r => (r.due_date || '').split('T')[0] !== due).map(r => ({ ...r, due_date: due }) as T);
}
