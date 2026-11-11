// Export PDF et Word d'un rapport de diagnostic (onglet DIAG). Même charte que
// les notices et les autres documents du cabinet : en-tête avec logo, pied de
// page avec l'adresse, pages numérotées « P1|2 » en bas à droite, présentation
// sobre en noir et gris.
//
// Le contenu vient de l'éditeur de texte riche (HTML) : `htmlToBlocks` le
// ramène à quelques blocs, rendus ici avec leur gras et leur italique.
import type { Project } from '../types';
import type { AgencySettings } from './proposalExport';
import { STYLES_WORD_ARIAL, docxSectionChrome } from './docxRunningHeader';
import { agencyFooterLine, drawAgencyFooters, drawAgencyHeader, loadLogoDataUrl } from './pdfLetterhead';
import { htmlToBlocks, type Run } from './diagReportBlocks';
import type { DiagReport } from './diagReports';

const DOC_TITLE = 'Rapport de diagnostic';
const TEXT: [number, number, number] = [17, 24, 39];
const MUTED: [number, number, number] = [107, 114, 128];
const RULE: [number, number, number] = [209, 213, 219];

const safeName = (value: string): string =>
  value.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');

function fileName(project: Partial<Project>, report: Pick<DiagReport, 'title'>, ext: 'pdf' | 'docx'): string {
  const base = [report.title || DOC_TITLE, project.name].filter(Boolean).join(' - ');
  return `${safeName(base) || 'rapport_diagnostic'}.${ext}`;
}

const location = (project: Partial<Project>): string =>
  [(project as any).adresse_terrain || project.address, (project as any).site_city].filter(Boolean).join(' · ');

// ─── PDF ────────────────────────────────────────────────────────────────────
interface Word { text: string; bold: boolean; italic: boolean }
type Token = Word | 'BR';

function tokens(runs: Run[]): Token[] {
  const out: Token[] = [];
  for (const run of runs) {
    run.text.split('\n').forEach((part, i) => {
      if (i > 0) out.push('BR');
      for (const word of part.split(' ')) if (word) out.push({ text: word, bold: !!run.bold, italic: !!run.italic });
    });
  }
  return out;
}

const styleOf = (w: { bold: boolean; italic: boolean }, base: 'normal' | 'bold' | 'italic'): 'normal' | 'bold' | 'italic' | 'bolditalic' => {
  const bold = w.bold || base === 'bold';
  const italic = w.italic || base === 'italic';
  return bold && italic ? 'bolditalic' : bold ? 'bold' : italic ? 'italic' : 'normal';
};

export async function exportDiagReportPdf(
  project: Partial<Project>,
  report: Pick<DiagReport, 'title' | 'content'>,
  settings: AgencySettings,
): Promise<void> {
  const { default: jsPDF } = await import('jspdf');
  const pdf = new jsPDF('p', 'mm', 'a4');
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 18;
  const contentW = pageW - margin * 2;
  const bottom = pageH - 19;
  const logo = await loadLogoDataUrl(settings.logoUrl);
  const letterhead = {
    title: DOC_TITLE,
    subtitle: project.name || '',
    reference: project.project_code || project.reference || '',
    margin,
    logo,
  };

  let y = drawAgencyHeader(pdf, settings, letterhead);
  const ensure = (height: number) => {
    if (y + height > bottom) { pdf.addPage(); y = drawAgencyHeader(pdf, settings, letterhead); }
  };
  const font = (style: 'normal' | 'bold' | 'italic' | 'bolditalic', size: number, color = TEXT) => {
    pdf.setFont('helvetica', style);
    pdf.setFontSize(size);
    pdf.setTextColor(...color);
  };

  /** Coupe des mots portant chacun leur style en lignes de largeur `maxW`. */
  const layout = (runs: Run[], size: number, base: 'normal' | 'bold' | 'italic', maxW: number): Word[][] => {
    font('normal', size);
    const space = pdf.getTextWidth(' ');
    const lines: Word[][] = [[]];
    let x = 0;
    for (const token of tokens(runs)) {
      if (token === 'BR') { lines.push([]); x = 0; continue; }
      font(styleOf(token, base), size);
      const w = pdf.getTextWidth(token.text);
      const line = lines[lines.length - 1];
      if (line.length && x + space + w > maxW) { lines.push([token]); x = w; }
      else { x += line.length ? space + w : w; line.push(token); }
    }
    return lines;
  };

  const drawLines = (lines: Word[][], size: number, base: 'normal' | 'bold' | 'italic', left: number, lineH: number, color = TEXT) => {
    for (const line of lines) {
      ensure(lineH);
      let x = left;
      font('normal', size, color);
      const space = pdf.getTextWidth(' ');
      for (const word of line) {
        font(styleOf(word, base), size, color);
        pdf.text(word.text, x, y);
        x += pdf.getTextWidth(word.text) + space;
      }
      y += lineH;
    }
  };

  y += 10;
  font('bold', 18);
  const titleLines = pdf.splitTextToSize(report.title || DOC_TITLE, contentW) as string[];
  pdf.text(titleLines, margin, y);
  y += titleLines.length * 7 + 2;
  if (project.name) {
    font('normal', 11, MUTED);
    const lines = pdf.splitTextToSize(project.name, contentW) as string[];
    pdf.text(lines, margin, y);
    y += lines.length * 5 + 3;
  }
  const place = location(project);
  if (place) {
    font('normal', 9, MUTED);
    pdf.text(pdf.splitTextToSize(place, contentW), margin, y);
    y += 7;
  }
  pdf.setDrawColor(...RULE);
  pdf.setLineWidth(0.3);
  pdf.line(margin, y, pageW - margin, y);
  y += 8;

  for (const block of htmlToBlocks(report.content)) {
    if (block.type === 'hr') {
      ensure(6);
      pdf.setDrawColor(...RULE);
      pdf.line(margin, y, pageW - margin, y);
      y += 5;
    } else if (block.type === 'h2' || block.type === 'h3') {
      const size = block.type === 'h2' ? 13 : 11;
      const lines = layout(block.runs, size, 'bold', contentW);
      y += block.type === 'h2' ? 3 : 1.5;
      ensure(lines.length * 5.8 + 4);
      drawLines(lines, size, 'bold', margin, size === 13 ? 6 : 5.2);
      y += 1.5;
    } else if (block.type === 'li') {
      const indent = 7;
      const lines = layout(block.runs, 9.5, 'normal', contentW - indent);
      ensure(4.8);
      font('normal', 9.5);
      pdf.text(block.ordered ? `${block.index}.` : '•', margin + 1.5, y);
      drawLines(lines, 9.5, 'normal', margin + indent, 4.8);
      y += 1;
    } else if (block.type === 'quote') {
      const lines = layout(block.runs, 9.5, 'italic', contentW - 8);
      ensure(4.8);
      const top = y;
      drawLines(lines, 9.5, 'italic', margin + 6, 4.8, MUTED);
      pdf.setDrawColor(...RULE);
      pdf.setLineWidth(0.8);
      pdf.line(margin + 2, top - 3.2, margin + 2, y - 3);
      pdf.setLineWidth(0.3);
      y += 1.5;
    } else {
      const lines = layout(block.runs, 9.5, 'normal', contentW);
      drawLines(lines, 9.5, 'normal', margin, 4.8);
      y += 1.8;
    }
  }

  drawAgencyFooters(pdf, settings, letterhead);
  pdf.save(fileName(project, report, 'pdf'));
}

// ─── Word ───────────────────────────────────────────────────────────────────
export async function exportDiagReportDocx(
  project: Partial<Project>,
  report: Pick<DiagReport, 'title' | 'content'>,
  settings: AgencySettings,
): Promise<void> {
  const {
    Document, Packer, Paragraph, TextRun, PageNumber, AlignmentType, HeadingLevel, BorderStyle,
  } = await import('docx');

  const runsOf = (runs: Run[], size: number, color = '111827', extra: { bold?: boolean; italics?: boolean } = {}) =>
    runs.flatMap(run => run.text.split('\n').map((part, i) => new TextRun({
      text: part,
      ...(i > 0 ? { break: 1 } : {}),
      bold: run.bold || extra.bold,
      italics: run.italic || extra.italics,
      size, color,
    })));

  const firstHeader = [
    new Paragraph({ children: [new TextRun({ text: settings.agencyName || '', bold: true, size: 20, color: '111827' })] }),
    new Paragraph({
      border: { bottom: { style: BorderStyle.SINGLE, size: 5, color: 'D1D5DB' } },
      children: [new TextRun({ text: [settings.address, settings.phone, settings.email].filter(Boolean).join(' · '), size: 15, color: '6B7280' })],
    }),
  ];
  const footer = [
    new Paragraph({
      border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'D1D5DB' } },
      children: [new TextRun({ text: agencyFooterLine(settings), size: 13, color: '6B7280' })],
    }),
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [
        new TextRun({ text: 'P', bold: true, size: 15 }),
        new TextRun({ children: [PageNumber.CURRENT], bold: true, size: 15 }),
        new TextRun({ text: '|', bold: true, size: 15 }),
        new TextRun({ children: [PageNumber.TOTAL_PAGES], bold: true, size: 15 }),
      ],
    }),
  ];

  const body: InstanceType<typeof Paragraph>[] = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      spacing: { before: 500, after: 120 },
      children: [new TextRun({ text: report.title || DOC_TITLE, bold: true, size: 40, color: '111827' })],
    }),
  ];
  if (project.name) body.push(new Paragraph({ spacing: { after: 100 }, children: [new TextRun({ text: project.name, size: 24, color: '6B7280' })] }));
  const place = location(project);
  if (place) body.push(new Paragraph({ spacing: { after: 300 }, children: [new TextRun({ text: place, size: 18, color: '6B7280' })] }));

  for (const block of htmlToBlocks(report.content)) {
    if (block.type === 'hr') {
      body.push(new Paragraph({ spacing: { before: 120, after: 120 }, border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'D1D5DB' } }, children: [] }));
    } else if (block.type === 'h2' || block.type === 'h3') {
      body.push(new Paragraph({
        heading: block.type === 'h2' ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
        spacing: { before: block.type === 'h2' ? 240 : 160, after: 100 },
        children: runsOf(block.runs, block.type === 'h2' ? 26 : 22, '111827', { bold: true }),
      }));
    } else if (block.type === 'li') {
      body.push(new Paragraph({
        ...(block.ordered ? { indent: { left: 540, hanging: 320 } } : { bullet: { level: 0 } }),
        spacing: { after: 60 },
        children: [
          ...(block.ordered ? [new TextRun({ text: `${block.index}.\t`, size: 20, color: '111827' })] : []),
          ...runsOf(block.runs, 20),
        ],
      }));
    } else if (block.type === 'quote') {
      body.push(new Paragraph({
        indent: { left: 360 },
        spacing: { after: 100 },
        border: { left: { style: BorderStyle.SINGLE, size: 12, color: 'D1D5DB', space: 8 } },
        children: runsOf(block.runs, 20, '6B7280', { italics: true }),
      }));
    } else {
      body.push(new Paragraph({ spacing: { after: 100 }, children: runsOf(block.runs, 20) }));
    }
  }

  const doc = new Document({
    styles: STYLES_WORD_ARIAL,
    sections: [{
      ...await docxSectionChrome({ agencyName: settings.agencyName, documentTitle: DOC_TITLE, firstHeader, footer }),
      children: body,
    }],
  });
  const blob = await Packer.toBlob(doc);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName(project, report, 'docx');
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
