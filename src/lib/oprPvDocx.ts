// Rendu Word du PV d'OPR : parcourt les mêmes blocs que le PDF (oprPvDocument.ts), pour
// que le .docx modifiable porte exactement le contenu du PDF. Charte du cabinet : logo et
// coordonnées sur la première page, ligne réduite ensuite, pied de page avec l'adresse et
// pagination « P1|2 ».
import type { AgencySettings } from './proposalExport';
import { agencyFooterLine, loadLogoDataUrl } from './pdfLetterhead';
import { docxSectionChrome } from './docxRunningHeader';
import type { DocPv } from './oprPvDocument';

const MM_EN_TWIPS = 56.7;
const POINTILLES = '..........';

export async function construireDocxPv(doc: DocPv, settings: AgencySettings): Promise<Blob> {
  const {
    Document, Packer, Paragraph, TextRun, ImageRun, PageNumber, AlignmentType, BorderStyle,
    Table, TableRow, TableCell, WidthType, ShadingType,
  } = await import('docx');
  type Para = InstanceType<typeof Paragraph>;
  type Tab = InstanceType<typeof Table>;

  const logo = await loadLogoDataUrl(settings.logoUrl);
  const entete: Para[] = [];
  if (logo) {
    const h = 40;
    const data = Uint8Array.from(atob(logo.dataUrl.split(',')[1]), c => c.charCodeAt(0));
    entete.push(new Paragraph({ children: [new ImageRun({ type: 'png', data, transformation: { width: Math.round((logo.width / logo.height) * h), height: h } })] }));
  }
  entete.push(
    new Paragraph({ children: [new TextRun({ text: settings.agencyName || '', bold: true, size: 20, color: '111827' })] }),
    new Paragraph({
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'D1D5DB' } },
      spacing: { after: 120 },
      children: [new TextRun({ text: [settings.address, settings.phone ? `Tél : ${settings.phone}` : '', settings.email].filter(Boolean).join('  ·  '), size: 15, color: '6B7280' })],
    }),
  );
  const pied: Para[] = [
    new Paragraph({ border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'D1D5DB' } }, children: [new TextRun({ text: agencyFooterLine(settings), size: 13, color: '6B7280' })] }),
    new Paragraph({ alignment: AlignmentType.RIGHT, children: [
      new TextRun({ text: 'P', bold: true, size: 15, color: '111827' }),
      new TextRun({ children: [PageNumber.CURRENT], bold: true, size: 15, color: '111827' }),
      new TextRun({ text: '|', bold: true, size: 15, color: '111827' }),
      new TextRun({ children: [PageNumber.TOTAL_PAGES], bold: true, size: 15, color: '111827' }),
    ] }),
  ];

  const aucune = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const sansBordure = { top: aucune, bottom: aucune, left: aucune, right: aucune };
  const filet = { style: BorderStyle.SINGLE, size: 4, color: 'D1D5DB' };
  const avecBordure = { top: filet, bottom: filet, left: filet, right: filet };

  const enfants: (Para | Tab)[] = [
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 200, after: 60 }, children: [new TextRun({ text: doc.intitule, bold: true, size: 28, color: '111827' })] }),
    ...(doc.sousTitre ? [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 }, children: [new TextRun({ text: doc.sousTitre, size: 21, color: '6B7280' })] })] : []),
    ...(doc.reference || doc.date
      ? [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [new TextRun({ text: [doc.reference, doc.date].filter(Boolean).join('  ·  '), size: 18, color: '6B7280' })] })]
      : []),
  ];

  let saut = false;
  for (const b of doc.blocs) {
    switch (b.t) {
      case 'titre':
        enfants.push(new Paragraph({
          pageBreakBefore: saut, keepNext: true, spacing: { before: 280, after: 100 },
          shading: { type: ShadingType.CLEAR, fill: 'EBECEE' },
          children: [new TextRun({ text: b.text.toUpperCase(), bold: true, size: 20, color: '111827' })],
        }));
        saut = false;
        break;
      case 'texte':
        // Un retour à la ligne du contenu (adresse, identité) devient un paragraphe : Word ne coupe pas sur « \n ».
        for (const ligne of b.text.split('\n')) {
          enfants.push(new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: ligne, bold: b.gras, size: 20, color: '111827' })] }));
        }
        break;
      case 'case':
        enfants.push(new Paragraph({
          indent: { left: 120 + b.niveau * 520, hanging: 0 }, spacing: { after: 40 },
          children: [
            new TextRun({ text: b.cochee ? '☒ ' : '☐ ', font: 'Segoe UI Symbol', size: 20, color: '111827' }),
            new TextRun({ text: b.text, bold: b.cochee, size: 20, color: '111827' }),
            ...(b.valeur === undefined ? [] : [new TextRun({ text: ` ${b.valeur === '' ? POINTILLES : b.valeur}`, bold: true, size: 20, color: '111827' })]),
          ],
        }));
        break;
      case 'fiche':
        if (!b.lignes.length) break;
        enfants.push(new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: b.lignes.map(([k, v]) => new TableRow({ children: [
            new TableCell({ width: { size: 32, type: WidthType.PERCENTAGE }, borders: sansBordure, children: [new Paragraph({ children: [new TextRun({ text: k, bold: true, size: 19, color: '6B7280' })] })] }),
            new TableCell({ width: { size: 68, type: WidthType.PERCENTAGE }, borders: sansBordure, children: [new Paragraph({ children: [new TextRun({ text: v, size: 20, color: '111827' })] })] }),
          ] })),
        }), new Paragraph({ children: [] }));
        break;
      case 'signatures':
        enfants.push(new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [new TableRow({ height: { value: 1500, rule: 'atLeast' }, children: b.cases.map(c => new TableCell({
            borders: avecBordure,
            children: [
              new Paragraph({ children: [new TextRun({ text: c.titre, bold: true, size: 19, color: '111827' })] }),
              ...(c.sous ? [new Paragraph({ children: [new TextRun({ text: c.sous, size: 17, color: '6B7280' })] })] : []),
              new Paragraph({ spacing: { before: 700 }, children: [new TextRun({ text: `Date et signature${c.date ? `, le ${c.date}` : ''}`, size: 16, color: '6B7280' })] }),
            ],
          })) })],
        }), new Paragraph({ children: [] }));
        break;
      case 'saut':
        saut = true;
        break;
      case 'tableau': {
        enfants.push(new Paragraph({ spacing: { before: 120, after: 80 }, children: [new TextRun({ text: b.titre.toUpperCase(), bold: true, size: 20, color: '111827' })] }));
        const largeur = (i: number) => ({ size: Math.round(b.largeurs[i] * MM_EN_TWIPS), type: WidthType.DXA });
        enfants.push(new Table({
          width: { size: Math.round(b.largeurs.reduce((a, n) => a + n, 0) * MM_EN_TWIPS), type: WidthType.DXA },
          rows: [
            new TableRow({ tableHeader: true, children: b.entetes.map((e, i) => new TableCell({
              width: largeur(i), borders: avecBordure, shading: { type: ShadingType.CLEAR, fill: '3C3C3C' },
              children: [new Paragraph({ children: [new TextRun({ text: e, bold: true, size: 16, color: 'FFFFFF' })] })],
            })) }),
            ...b.lignes.map(l => Array.isArray(l)
              ? new TableRow({ height: { value: 520, rule: 'atLeast' }, children: l.map((c, i) => new TableCell({
                  width: largeur(i), borders: avecBordure,
                  children: c.split('\n').map(t => new Paragraph({ children: [new TextRun({ text: t, size: 17, color: '111827' })] })),
                })) })
              : new TableRow({ children: [new TableCell({
                  columnSpan: b.entetes.length, borders: avecBordure, shading: { type: ShadingType.CLEAR, fill: 'E1E1E1' },
                  children: [new Paragraph({ children: [new TextRun({ text: l.groupe, bold: true, size: 17, color: '111827' })] })],
                })] })),
          ],
        }));
        break;
      }
    }
  }

  const section = {
    ...await docxSectionChrome({ agencyName: settings.agencyName, documentTitle: doc.titre, firstHeader: entete, footer: pied }),
    children: enfants,
  };
  return Packer.toBlob(new Document({ sections: [section] }));
}
