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
