// Statuts de présence d'un compte rendu de chantier, partagés par l'export PDF et ses tests
// (siteReportExport.ts importe pdf.js, que l'environnement de test ne sait pas charger).

/** Statut P/R/AE/ANE déduit des champs anciens (present/excused) quand `status` est absent. */
export function attendeeStatus(a: { present?: boolean; excused?: boolean; status?: string }): string {
  if (a.status) return a.status;
  if (a.present) return 'P';
  return a.excused ? 'AE' : 'ANE';
}

/**
 * Statut de présence d'un lot : la saisie vit dans `attendance` (ligne repérée par l'intitulé du lot,
 * comme à l'écran), pas dans `lot_tracking`. « Présent » tant qu'aucune ligne n'existe, comme à l'écran.
 */
export function lotPresenceStatus(
  lot: { lot_title: string },
  attendance: { role: string; present?: boolean; excused?: boolean; status?: string }[],
  trackingStatus?: string,
): string {
  const row = attendance.find(a => a.role === lot.lot_title);
  if (row) return attendeeStatus(row);
  return trackingStatus || 'P';
}

export type LotConcerned = 'W' | 'D' | 'WD';

export const CONCERNED_OPTIONS: { value: LotConcerned | ''; label: string; long: string }[] = [
  { value: '', label: '', long: 'Aucun' },
  { value: 'W', label: 'W', long: 'Travaux (W)' },
  { value: 'D', label: 'D', long: 'Documents (D)' },
  { value: 'WD', label: 'W/D', long: 'Travaux et documents (W/D)' },
];

/** Mention « travaux / documents » d'un lot, telle qu'imprimée au tableau de suivi : W, D, W/D ou vide. */
export function concernedLabel(concerned?: string): string {
  return CONCERNED_OPTIONS.find(o => o.value === concerned)?.label ?? '';
}

/** Orientation de la page du PDF : paysage seulement si le compte-rendu le demande. */
export function pdfOrientation(pageFormat?: string | null): 'portrait' | 'landscape' {
  return pageFormat === 'landscape' ? 'landscape' : 'portrait';
}
