// Report de la convocation d'un compte-rendu de chantier au suivant : statut de présence de chaque
// lot (dont « Non convoqué »), lieu, heure et case « Convoqué suiv. ». Logique pure, partagée par
// la route de création et ses tests (rien d'autre n'est importé ici que des types).
import type { SiteReportAttendee, SiteReportLotTracking } from '../types';

/** Champs du suivi d'un lot qui décrivent la convocation et se reportent d'une réunion à l'autre. */
const CHAMPS_CONVOCATION = ['status', 'convoque_reunion_suivante', 'lieu', 'heure'] as const;

export interface ConvocationReportee {
  attendance: SiteReportAttendee[];
  lot_tracking: SiteReportLotTracking[];
  heure_convocation: string | null;
}

/**
 * Convocation du compte-rendu suivant, reprise du précédent. Seuls les statuts de présence, le lieu,
 * l'heure et « Convoqué suiv. » sont repris : retards, effectifs, pénalités et intempéries restent
 * propres à chaque réunion (le retard de la semaine s'additionne d'un CR à l'autre, le recopier le
 * compterait deux fois).
 */
export function reporterConvocation(precedent: {
  attendance?: SiteReportAttendee[] | null;
  lot_tracking?: SiteReportLotTracking[] | null;
  heure_convocation?: string | null;
} | null | undefined): ConvocationReportee {
  const attendance = (Array.isArray(precedent?.attendance) ? precedent!.attendance! : []).map(a => ({ ...a }));
  const lot_tracking: SiteReportLotTracking[] = [];
  for (const t of Array.isArray(precedent?.lot_tracking) ? precedent!.lot_tracking! : []) {
    if (!t?.lot_id) continue;
    const repris: Record<string, unknown> = { lot_id: t.lot_id };
    for (const champ of CHAMPS_CONVOCATION) {
      if (t[champ] !== undefined && t[champ] !== null && t[champ] !== '') repris[champ] = t[champ];
    }
    if (Object.keys(repris).length > 1) lot_tracking.push(repris as unknown as SiteReportLotTracking);
  }
  return { attendance, lot_tracking, heure_convocation: precedent?.heure_convocation || null };
}
