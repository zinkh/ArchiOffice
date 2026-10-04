// Téléchargement, depuis le navigateur, du certificat de paiement d'une
// situation et du décompte de clôture d'un marché. Le rendu lui-même est dans
// certificatPaiementPdf.ts, partagé avec le serveur.
import type { AgencySettings } from './proposalExport';
import { fetchAgencySettings, loadLogoDataUrl } from './pdfLetterhead';
import { rendreCertificatPaiement, rendreDecompteCloture, type OperationInfo, type RenduPdf } from './certificatPaiementPdf';
import type { MarcheTravaux, SituationTravaux } from './certificatPaiement';

const nomFichier = (...parts: (string | number | null | undefined)[]): string =>
  parts.filter((p) => p !== null && p !== undefined && String(p).trim() !== '')
    .map((p) => String(p).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9-]+/g, '_'))
    .join('_')
    .slice(0, 120) + '.pdf';

async function preparer(settings?: AgencySettings): Promise<RenduPdf> {
  const reglages = settings && Object.keys(settings).length ? settings : await fetchAgencySettings();
  const [{ jsPDF }, autoTableModule, logo] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
    loadLogoDataUrl(reglages.logoUrl),
  ]);
  return {
    pdf: new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' }),
    autoTable: autoTableModule.default as any,
    settings: reglages,
    logo,
  };
}

export async function telechargerCertificatPaiement(
  situation: SituationTravaux, marche: MarcheTravaux, situationsMarche: SituationTravaux[],
  operation: OperationInfo, settings?: AgencySettings,
): Promise<void> {
  const r = await preparer(settings);
  rendreCertificatPaiement(r, situation, marche, situationsMarche, operation);
  r.pdf.save(nomFichier('Certificat_paiement', situation.numero_situation, marche.lot_numero, marche.entreprise_nom));
}

export async function telechargerDecompteCloture(
  marche: MarcheTravaux, situationsMarche: SituationTravaux[],
  operation: OperationInfo, settings?: AgencySettings,
): Promise<void> {
  const r = await preparer(settings);
  rendreDecompteCloture(r, marche, situationsMarche, operation);
  r.pdf.save(nomFichier('Decompte_cloture', marche.lot_numero, marche.entreprise_nom));
}
