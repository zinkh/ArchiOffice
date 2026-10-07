import type { Observation } from '../types';

/** Observation que l'on peut encore reprendre en réserve de l'AOR : ni levée, ni refusée, ni déjà reprise. */
export const isReprenable = (o: Pick<Observation, 'reserve_id' | 'statut'>): boolean =>
  !o.reserve_id && o.statut !== 'Levée' && o.statut !== 'Refusée';

/** Observations « à lever » encore ouvertes, que l'on peut reprendre en bloc. Une écriture en attente de synchronisation est ignorée. */
export const compterReprenables = (observations: Observation[]): number =>
  observations.filter(o => (o.type || 'observation') === 'reserve' && isReprenable(o) && !o.pendingSync).length;
