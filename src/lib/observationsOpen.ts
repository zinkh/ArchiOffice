// Observations « non levées » : toutes celles que l'onglet Observations garde sous « Ouverts seulement ».
import type { Observation } from '../types';

export const isOpenObservation = (o: Pick<Observation, 'statut'>): boolean => o.statut !== 'Levée';

export const countOpenObservations = (observations: Pick<Observation, 'statut'>[]): number =>
  observations.filter(isOpenObservation).length;
