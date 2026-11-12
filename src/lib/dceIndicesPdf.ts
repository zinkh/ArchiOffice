// Tableau d'indices du DCE en PDF, à la charte du cabinet (nuances de gris,
// pagination « P1|2 »). Joint au mail d'invitation à soumissionner.
import type { LigneIndice } from './dceIndices';
import {
  drawAgencyFooters, drawAgencyHeader, fetchAgencySettings, loadLogoDataUrl, tableauGris,
} from './pdfLetterhead';

export async function genererTableauIndicesPdf(opts: {
  projectName: string;
  lignes: LigneIndice[];
  /** Lots concernés (« Lot 02, Lot 03 »), rappelés sous le titre. */
  lots?: string;
}): Promise<File> {
  const [{ default: jsPDF }, { default: autoTable }, settings] = await Promise.all([
    import('jspdf'), import('jspdf-autotable'), fetchAgencySettings(),
  ]);
  const logo = await loadLogoDataUrl(settings.logoUrl);
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const margin = 14;
  const lettrine = {
    title: 'Tableau des indices du DCE', subtitle: opts.projectName, margin, logo,
  };
  let y = drawAgencyHeader(doc, settings, lettrine);

  if (opts.lots) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(107, 114, 128);
    doc.text(opts.lots, margin, y + 2);
    y += 7;
  }

  autoTable(doc, {
    ...tableauGris(margin),
    startY: y,
    head: [['N°', 'Désignation', 'Fichier', 'Indice', 'Date']],
    body: opts.lignes.map(l => [l.numero, l.designation, l.manquant ? 'À joindre' : l.fichier, l.indice || '-', l.date || '-']),
    columnStyles: { 0: { cellWidth: 12 }, 3: { cellWidth: 16, halign: 'center' }, 4: { cellWidth: 24 } },
  });

  drawAgencyFooters(doc, settings, lettrine);
  const nom = `Tableau_indices_DCE_${opts.projectName.replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, '')}.pdf`;
  return new File([doc.output('blob')], nom, { type: 'application/pdf' });
}
