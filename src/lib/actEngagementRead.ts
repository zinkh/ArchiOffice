// Lecture d'un acte d'engagement PDF rempli : accès à pdf.js (chargé à la
// demande, avec son worker) puis interprétation par `lireActeFormulaire`. Partagé
// par le panneau « Documents du marché » (fichier choisi à la main) et par la
// lecture d'un acte remis sur le portail de dépôt.
import { champsDepuisPdf } from './actEngagementImport';
import { lireActeFormulaire, type ActeRempli } from './actEngagementForm';

export async function lireActeDepuisBuffer(
  data: ArrayBuffer,
  lots: Array<{ lot_number: string; lot_title: string }>,
): Promise<ActeRempli> {
  const { pdfjs } = await import('react-pdf');
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  }
  const champs = await champsDepuisPdf(data, pdfjs as never);
  return lireActeFormulaire(champs, lots.map(l => ({ numero: l.lot_number, titre: l.lot_title })));
}
