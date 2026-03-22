import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { jsPDF } from 'jspdf';

export const generateWordDoc = async (data: any) => {
  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ text: data.projet.nom, heading: HeadingLevel.TITLE }),
        ...data.lots.flatMap((lot: any) => [
          new Paragraph({ text: `Lot ${lot.numero}: ${lot.intitule}`, heading: HeadingLevel.HEADING_1 }),
          ...lot.ouvrages.map((o: any) => new Paragraph({ text: `${o.designation} - ${o.total_ht} €` }))
        ])
      ]
    }]
  });
  const blob = await Packer.toBlob(doc);
  saveAs(blob, 'CCTP.docx');
};

export const generatePDFDoc = (data: any) => {
  const doc = new jsPDF();
  doc.setFontSize(20);
  doc.text(data.projet.nom, 20, 20);
  let y = 30;
  data.lots.forEach((lot: any) => {
    doc.setFontSize(14);
    doc.text(`Lot ${lot.numero}: ${lot.intitule}`, 20, y);
    y += 10;
    lot.ouvrages.forEach((o: any) => {
      doc.setFontSize(10);
      doc.text(`${o.designation} - ${o.total_ht} €`, 25, y);
      y += 7;
    });
    y += 5;
  });
  doc.save('CCTP.pdf');
};

export const generateExcelDoc = (data: any) => {
  const rows = data.lots.flatMap((l: any) => l.ouvrages.map((o: any) => ({
    Lot: l.numero,
    Designation: o.designation,
    Quantite: o.quantite,
    Unite: o.unite,
    PrixUnitaire: o.prix_unitaire,
    TotalHT: o.total_ht
  })));
  
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'DPGF');
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  saveAs(new Blob([wbout], { type: 'application/octet-stream' }), 'DPGF.xlsx');
};
