import { saveAs } from 'file-saver';
import type { TableRow } from 'docx';

interface DocumentOuvrage {
  designation: string;
  quantite: number;
  unite: string;
  prix_unitaire: number;
  total_ht: number;
}

interface DocumentLot {
  numero: string;
  intitule: string;
  ouvrages: DocumentOuvrage[];
}

interface DocumentData {
  projet: { nom: string };
  lots: DocumentLot[];
}

export const generateWordDoc = async (data: DocumentData) => {
  const {
    Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, ShadingType,
  } = await import('docx');

  const headerCell = (text: string) => new TableCell({
    children: [new Paragraph({ children: [new TextRun({ text, bold: true, size: 18 })] })],
    shading: { type: ShadingType.SOLID, color: 'EFF6FF' },
  });

  const cell = (text: string) => new TableCell({
    children: [new Paragraph({ children: [new TextRun({ text, size: 18 })] })],
  });

  const rows: TableRow[] = [
    new TableRow({
      children: ['Désignation', 'Unité', 'Quantité', 'P.U. HT (€)', 'Total HT (€)'].map(headerCell),
    }),
  ];

  data.lots.forEach(lot => {
    rows.push(new TableRow({
      children: [
        new TableCell({
          columnSpan: 5,
          children: [new Paragraph({ children: [new TextRun({ text: `${lot.numero} — ${lot.intitule}`, bold: true, size: 18 })] })],
          shading: { type: ShadingType.SOLID, color: 'F3F4F6' },
        }),
      ],
    }));
    lot.ouvrages.forEach(o => {
      rows.push(new TableRow({
        children: [
          cell(o.designation),
          cell(o.unite),
          cell(String(o.quantite)),
          cell(o.prix_unitaire.toFixed(2)),
          cell(o.total_ht.toFixed(2)),
        ],
      }));
    });
  });

  const doc = new Document({
    sections: [{
      properties: {},
      children: [
        new Paragraph({ children: [new TextRun({ text: data.projet.nom, bold: true, size: 32 })], spacing: { after: 240 } }),
        new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }),
      ],
    }],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, `${data.projet.nom.replace(/\s+/g, '_')}.docx`);
};

export const generateExcelDoc = async (data: DocumentData) => {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();

  const wsData: (string | number)[][] = [
    [data.projet.nom],
    [''],
    ['N°', 'Désignation', 'Unité', 'Quantité', 'P.U. HT (€)', 'Total HT (€)'],
  ];

  data.lots.forEach(lot => {
    wsData.push([lot.numero, lot.intitule, '', '', '', '']);
    lot.ouvrages.forEach(o => {
      wsData.push(['', o.designation, o.unite, o.quantite, o.prix_unitaire, o.total_ht]);
    });
  });

  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws['!cols'] = [{ wch: 10 }, { wch: 50 }, { wch: 10 }, { wch: 12 }, { wch: 15 }, { wch: 15 }];
  XLSX.utils.book_append_sheet(wb, ws, 'DPGF');

  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  saveAs(new Blob([buf], { type: 'application/octet-stream' }), `${data.projet.nom.replace(/\s+/g, '_')}.xlsx`);
};
