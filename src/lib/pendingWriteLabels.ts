import type { PendingWrite } from '../db';

/** Libellés affichés pour chaque type d'écriture en attente (badge, progression de l'envoi). */
export const ENTITY_LABELS: Record<PendingWrite['entity'], string> = {
  meeting: 'Réunion',
  meetingPhoto: 'Photo de réunion',
  meetingAttendee: 'Intervenant de réunion',
  phoneCall: 'Appel téléphonique',
  reserve: 'Réserve',
  reservePhoto: 'Photo de réserve',
  gpaReserve: 'Réserve GPA',
  gpaReservePhoto: 'Photo de réserve GPA',
  observation: 'Observation',
  observationPhoto: 'Photo d\'observation',
  siteReportNotePhoto: 'Photo de rubrique',
  project: 'Projet',
  siteReport: 'Compte-rendu de chantier',
  siteReportNote: 'Rubrique de compte-rendu',
  chantierDecoupage: 'Bâtiments et phases du chantier',
  proposal: 'Proposition',
  tender: 'Appel d\'offres',
  inspirationBoard: 'Planche d\'inspiration',
  inspirationItem: 'Image d\'inspiration',
  inspirationBoardItem: 'Composition de planche',
};

export function entityLabel(entity: PendingWrite['entity'] | null | undefined): string {
  return entity ? ENTITY_LABELS[entity] || entity : '';
}

/** « 2,4 Mo » / « 310 Ko » : taille d'une photo en cours d'envoi. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`;
  return `${Math.max(1, Math.round(bytes / 1024))} Ko`;
}
