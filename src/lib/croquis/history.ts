// Historique d'annulation d'un croquis : pile de « présents » successifs.
// Fonctions pures : chaque opération renvoie un nouvel historique. Les états
// (listes d'éléments immuables) sont gardés par référence, sans copie profonde.

export const HISTORY_LIMIT = 100;

export interface History<T> {
  past: readonly T[];
  present: T;
  future: readonly T[];
}

export function createHistory<T>(initial: T): History<T> {
  return { past: [], present: initial, future: [] };
}

/**
 * Enregistre un nouvel état. Rien ne change si c'est le même (par référence) :
 * un geste sans effet ne crée pas d'étape. Toute modification vide le futur ;
 * le passé est plafonné pour ne pas grossir sans limite.
 */
export function pushHistory<T>(h: History<T>, next: T, limit: number = HISTORY_LIMIT): History<T> {
  if (Object.is(next, h.present)) return h;
  const past = [...h.past, h.present];
  return { past: past.length > limit ? past.slice(past.length - limit) : past, present: next, future: [] };
}

export const canUndo = <T>(h: History<T>): boolean => h.past.length > 0;
export const canRedo = <T>(h: History<T>): boolean => h.future.length > 0;

export function undoHistory<T>(h: History<T>): History<T> {
  if (!canUndo(h)) return h;
  const previous = h.past[h.past.length - 1];
  return { past: h.past.slice(0, -1), present: previous, future: [h.present, ...h.future] };
}

export function redoHistory<T>(h: History<T>): History<T> {
  if (!canRedo(h)) return h;
  const [next, ...rest] = h.future;
  return { past: [...h.past, h.present], present: next, future: rest };
}
