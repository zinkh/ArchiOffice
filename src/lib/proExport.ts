import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { DPGF, Lot, Chapitre, Ligne } from '../types/dpgf';

// ── helpers ───────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

function flattenDPGF(lots: Lot[]): Array<{
  depth: number;
  numero: string;
  designation: string;
  unite: string;
  quantite: string;
  prixUnitaire: string;
  prixTotal: string;
  type: string;
}> {
  const rows: ReturnType<typeof flattenDPGF> = [];
  for (const lot of lots) {
    rows.push({ depth: 0, numero: lot.numero, designation: lot.titre, unite: '', quantite: '', prixUnitaire: '', prixTotal: fmt(lot.sousTotal), type: 'lot' });
    for (const chap of lot.chapitres) {
      rows.push({ depth: 1, numero: chap.numero, designation: chap.titre, unite: '', quantite: '', prixUnitaire: '', prixTotal: '', type: 'chapitre' });
      for (const ligne of chap.lignes) {
        rows.push({
          depth: 2,
          numero: ligne.numero,
          designation: ligne.designation,
          unite: ligne.unite,
          quantite: ligne.quantite > 0 ? fmt(ligne.quantite) : '',
          prixUnitaire: ligne.prixUnitaire > 0 ? fmt(ligne.prixUnitaire) : '',
          prixTotal: ligne.prixTotal > 0 ? fmt(ligne.prixTotal) : '',
          type: ligne.type,
        });
      }
    }
  }
  return rows;
}

// ── DPGF PDF ─────────────────────────────────────────────────────────────────

export function exportDPGFtoPDF(dpgf: DPGF, projectName?: string) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('DPGF — Décomposition du Prix Global et Forfaitaire', 14, 15);
  if (projectName) {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(projectName, 14, 22);
  }
  doc.setFontSize(9);
  doc.text(`Version ${dpgf.version} — ${new Date(dpgf.dateCreation).toLocaleDateString('fr-FR')}`, 14, 27);

  const rows = flattenDPGF(dpgf.lots);

  autoTable(doc, {
    startY: 32,
    head: [['N°', 'Désignation', 'Unité', 'Quantité', 'P.U. HT (€)', 'Total HT (€)']],
    body: rows.map(r => [r.numero, '  '.repeat(r.depth) + r.designation, r.unite, r.quantite, r.prixUnitaire, r.prixTotal]),
    headStyles: { fillColor: [30, 80, 140], textColor: 255, fontStyle: 'bold', fontSize: 8 },
    bodyStyles: { fontSize: 8 },
    columnStyles: {
      0: { cellWidth: 20 },
      1: { cellWidth: 'auto' },
      2: { cellWidth: 18, halign: 'center' },
      3: { cellWidth: 22, halign: 'right' },
      4: { cellWidth: 28, halign: 'right' },
      5: { cellWidth: 28, halign: 'right' },
    },
    didParseCell: (data) => {
      const row = rows[data.row.index];
      if (!row) return;
      if (row.type === 'lot') {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fillColor = [200, 220, 240];
      } else if (row.type === 'chapitre') {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fillColor = [235, 240, 248];
      } else if (row.type === 'titre') {
        data.cell.styles.fillColor = [248, 248, 248];
        data.cell.styles.fontStyle = 'italic';
      }
    },
    foot: [[
      '', 'TOTAL HT', '', '', '',
      fmt(dpgf.totalHT) + ' €',
    ]],
    footStyles: { fillColor: [30, 80, 140], textColor: 255, fontStyle: 'bold' },
  });

  doc.save(`DPGF_${dpgf.titre.replace(/\s+/g, '_')}.pdf`);
}

// ── Estimation PDF ────────────────────────────────────────────────────────────

export function exportEstimationtoPDF(dpgf: DPGF, projectName?: string) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('ESTIMATION — Récapitulatif par lot', 14, 15);
  if (projectName) {
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(projectName, 14, 22);
  }

  const lotRows = dpgf.lots.map(lot => [
    lot.numero,
    lot.titre,
    fmt(lot.sousTotal) + ' €',
    fmt(lot.sousTotal * (1 + dpgf.TVA / 100)) + ' €',
  ]);

  autoTable(doc, {
    startY: 28,
    head: [['N°', 'Lot', 'Montant HT', 'Montant TTC']],
    body: lotRows,
    headStyles: { fillColor: [30, 80, 140], textColor: 255, fontStyle: 'bold', fontSize: 9 },
    bodyStyles: { fontSize: 9 },
    columnStyles: {
      0: { cellWidth: 15 },
      1: { cellWidth: 'auto' },
      2: { cellWidth: 35, halign: 'right' },
      3: { cellWidth: 35, halign: 'right' },
    },
    foot: [['', 'TOTAL', fmt(dpgf.totalHT) + ' €', fmt(dpgf.totalTTC) + ' €']],
    footStyles: { fillColor: [30, 80, 140], textColor: 255, fontStyle: 'bold' },
  });

  const finalY = (doc as any).lastAutoTable.finalY + 8;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(`TVA ${dpgf.TVA}% : ${fmt(dpgf.totalTTC - dpgf.totalHT)} €`, 14, finalY);
  doc.setFont('helvetica', 'bold');
  doc.text(`Total TTC : ${fmt(dpgf.totalTTC)} €`, 14, finalY + 6);

  doc.save(`Estimation_${dpgf.titre.replace(/\s+/g, '_')}.pdf`);
}

// ── DPGF Excel ────────────────────────────────────────────────────────────────

export function exportDPGFtoExcel(dpgf: DPGF, projectName?: string) {
  const wb = XLSX.utils.book_new();
  const rows = flattenDPGF(dpgf.lots);

  const wsData: any[][] = [
    [projectName || dpgf.titre, '', '', '', '', ''],
    [`DPGF v${dpgf.version}`, '', '', '', '', ''],
    ['', '', '', '', '', ''],
    ['N°', 'Désignation', 'Unité', 'Quantité', 'P.U. HT (€)', 'Total HT (€)'],
    ...rows.map(r => [r.numero, '  '.repeat(r.depth) + r.designation, r.unite, r.quantite, r.prixUnitaire, r.prixTotal]),
    ['', '', '', '', 'TOTAL HT', fmt(dpgf.totalHT) + ' €'],
  ];

  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws['!cols'] = [{ wch: 10 }, { wch: 50 }, { wch: 10 }, { wch: 12 }, { wch: 15 }, { wch: 15 }];
  XLSX.utils.book_append_sheet(wb, ws, 'DPGF');

  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  saveAs(new Blob([buf], { type: 'application/octet-stream' }), `DPGF_${dpgf.titre.replace(/\s+/g, '_')}.xlsx`);
}

// ── Estimation Excel ──────────────────────────────────────────────────────────

export function exportEstimationtoExcel(dpgf: DPGF, projectName?: string) {
  const wb = XLSX.utils.book_new();

  const detailData: any[][] = [
    [projectName || dpgf.titre],
    ['ESTIMATION DÉTAILLÉE'],
    [''],
    ['N°', 'Désignation', 'Unité', 'Quantité', 'P.U. HT', 'Total HT', `TVA ${dpgf.TVA}%`, 'Total TTC'],
  ];

  for (const lot of dpgf.lots) {
    detailData.push([lot.numero, lot.titre, '', '', '', fmt(lot.sousTotal), fmt(lot.sousTotal * dpgf.TVA / 100), fmt(lot.sousTotal * (1 + dpgf.TVA / 100))]);
    for (const chap of lot.chapitres) {
      detailData.push(['', `  ${chap.numero} ${chap.titre}`, '', '', '', '', '', '']);
      for (const ligne of chap.lignes) {
        detailData.push([
          ligne.numero,
          `    ${ligne.designation}`,
          ligne.unite,
          ligne.quantite > 0 ? ligne.quantite : '',
          ligne.prixUnitaire > 0 ? ligne.prixUnitaire : '',
          ligne.prixTotal > 0 ? fmt(ligne.prixTotal) : '',
          '',
          '',
        ]);
      }
    }
  }

  detailData.push(['', 'TOTAL HT', '', '', '', fmt(dpgf.totalHT), fmt(dpgf.totalTTC - dpgf.totalHT), fmt(dpgf.totalTTC)]);

  const wsDet = XLSX.utils.aoa_to_sheet(detailData);
  wsDet['!cols'] = [{ wch: 10 }, { wch: 45 }, { wch: 10 }, { wch: 12 }, { wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, wsDet, 'Détail');

  // Récapitulatif sheet
  const recapData: any[][] = [
    ['N° Lot', 'Intitulé', 'Montant HT', `TVA ${dpgf.TVA}%`, 'Montant TTC'],
    ...dpgf.lots.map(l => [l.numero, l.titre, l.sousTotal, l.sousTotal * dpgf.TVA / 100, l.sousTotal * (1 + dpgf.TVA / 100)]),
    ['', 'TOTAL', dpgf.totalHT, dpgf.totalTTC - dpgf.totalHT, dpgf.totalTTC],
  ];
  const wsRecap = XLSX.utils.aoa_to_sheet(recapData);
  wsRecap['!cols'] = [{ wch: 10 }, { wch: 40 }, { wch: 15 }, { wch: 15 }, { wch: 15 }];
  XLSX.utils.book_append_sheet(wb, wsRecap, 'Récapitulatif');

  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  saveAs(new Blob([buf], { type: 'application/octet-stream' }), `Estimation_${dpgf.titre.replace(/\s+/g, '_')}.xlsx`);
}
