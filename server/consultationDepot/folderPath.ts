// Où une remise atterrit dans le drive du cabinet :
//
//     <racine>/<code affaire> - <nom affaire>/Consultation/<lot>/<entreprise>
//
// Une remise sans lot (acte d'engagement global, mémoire commun) va sous
// « Tous lots ». Mêmes règles de nommage que le reste du stockage externe
// (accents conservés, voir folderNaming.ts) : l'architecte ouvre ce dossier
// dans son propre Drive.
import { projectFolderName, type FolderProject } from '../externalStorage/businessFolderPath';
import { sanitizeFolderSegment } from '../externalStorage/folderNaming';

export const DOSSIER_CONSULTATION = 'Consultation';
export const DOSSIER_TOUS_LOTS = 'Tous lots';

export interface LotDossier {
  lot_number?: string | null;
  lot_title?: string | null;
}

export function libelleLot(lot: LotDossier | null | undefined): string {
  if (!lot) return DOSSIER_TOUS_LOTS;
  const numero = (lot.lot_number ?? '').trim();
  const titre = (lot.lot_title ?? '').trim();
  if (numero && titre) return sanitizeFolderSegment(`Lot ${numero} - ${titre}`);
  return sanitizeFolderSegment(numero ? `Lot ${numero}` : titre) || DOSSIER_TOUS_LOTS;
}

export function buildConsultationFolderPath(
  project: FolderProject | null | undefined,
  lot: LotDossier | null | undefined,
  entrepriseNom: string,
): string[] {
  return [
    projectFolderName(project),
    DOSSIER_CONSULTATION,
    libelleLot(lot),
    sanitizeFolderSegment(entrepriseNom),
  ];
}

/** « 2026-10-08 - devis.pdf » : le jour de réception en tête, pour un classement chronologique dans le drive. */
export function nomFichierDepot(recuLe: Date, nomOriginal: string): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const jour = `${recuLe.getUTCFullYear()}-${pad(recuLe.getUTCMonth() + 1)}-${pad(recuLe.getUTCDate())}`;
  return `${jour} - ${nomOriginal}`;
}
