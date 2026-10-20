// PDF de l'atelier DOE côté serveur : le visa d'une entreprise et le bordereau de
// transmission au maître d'ouvrage. Le rendu (src/lib/doePdf.ts) est partagé ;
// ici on ne fait que charger la charte du cabinet (logo, coordonnées) et
// l'opération, comme server/etatAcompte.ts pour le certificat de paiement.
import { chargerCharte, chargerOperation } from '../etatAcompte';
import type { OperationInfo, RenduPdf } from '../../src/lib/certificatPaiementPdf';
import {
  rendreBordereauDoe, rendreVisaDoe, type BordereauDoePdf, type VisaDoePdf,
} from '../../src/lib/doePdf';

async function produire(
  supabaseAdmin: any, tenantId: string, projectId: string,
  rendre: (r: RenduPdf, operation: OperationInfo) => void,
): Promise<Buffer> {
  const [charte, operation] = await Promise.all([
    chargerCharte(supabaseAdmin, tenantId),
    chargerOperation(supabaseAdmin, tenantId, projectId),
  ]);
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default as any;
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  rendre({ pdf, autoTable, settings: charte.settings, logo: charte.logo }, operation);
  return Buffer.from(pdf.output('arraybuffer'));
}

export const construireVisaPdf = (supabaseAdmin: any, tenantId: string, projectId: string, visa: VisaDoePdf): Promise<Buffer> =>
  produire(supabaseAdmin, tenantId, projectId, (r, operation) => rendreVisaDoe(r, visa, operation));

export const construireBordereauPdf = (supabaseAdmin: any, tenantId: string, projectId: string, bordereau: BordereauDoePdf): Promise<Buffer> =>
  produire(supabaseAdmin, tenantId, projectId, (r, operation) => rendreBordereauDoe(r, bordereau, operation));
