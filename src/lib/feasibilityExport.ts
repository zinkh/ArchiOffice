// Exports PDF et Word de l'étude de faisabilité d'une proposition, à la charte
// du cabinet : en-tête avec logo et coordonnées, pied de page avec l'adresse et
// les mentions légales, pagination « P1|2 » en bas à droite, nuances de gris
// (voir « Exports PDF et Excel : une seule charte » dans CLAUDE.md).
// jsPDF et docx ne sont chargés qu'au moment de l'export.
import type { Proposal } from '../types';

type ProposalForExport = Partial<Proposal>;
import type { AgencySettings } from './proposalExport';
import { feasibilityCoverFields, feasibilityFilename, typographie, type FeasibilitySection } from './feasibilityBlocks';
import { agencyFooterLine, drawAgencyFooters, drawAgencyHeader, loadLogoDataUrl } from './pdfLetterhead';
import { compressImage, type CompressedImage } from './imageCompression';
import { resolveSignedUrl } from './signedStorageUrl';

const DOC_TITLE = 'Étude de faisabilité';
const GRIS_TEXTE: [number, number, number] = [17, 24, 39];
const GRIS_DOUX: [number, number, number] = [107, 114, 128];
const GRIS_FILET: [number, number, number] = [209, 213, 219];

const BULLET_RE = /^\s*[-*•]\s+/;

async function loadIllustration(fileUrl: string): Promise<CompressedImage | null> {
  try {
    const url = await resolveSignedUrl(fileUrl);
    return await compressImage(url, 1600, 1100, 0.85);
  } catch {
    return null;
  }
}

// ── PDF ──────────────────────────────────────────────────────────────────────

export async function exportFeasibilityPdf(p: ProposalForExport, sections: FeasibilitySection[], settings: AgencySettings): Promise<void> {
  const { default: jsPDF } = await import('jspdf');
  const pdf = new jsPDF('p', 'mm', 'a4');
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 18;
  const contentW = pageW - margin * 2;
  const bottom = pageH - 18;
  const logo = await loadLogoDataUrl(settings.logoUrl);
  const letterhead = { title: DOC_TITLE, subtitle: p.title || '', reference: p.reference || '', margin, logo };

  let y = drawAgencyHeader(pdf, settings, letterhead);
  const newPage = () => { pdf.addPage(); y = drawAgencyHeader(pdf, settings, letterhead); };
  const ensure = (h: number) => { if (y + h > bottom) newPage(); };
  const font = (style: 'normal' | 'bold' | 'italic', size: number, color = GRIS_TEXTE) => {
    pdf.setFont('helvetica', style); pdf.setFontSize(size); pdf.setTextColor(...color);
  };

  // Page de garde.
  y += 18;
  font('bold', 22);
  for (const line of pdf.splitTextToSize(DOC_TITLE, contentW) as string[]) { pdf.text(line, margin, y); y += 9; }
  if (p.title) {
    font('normal', 13, GRIS_DOUX);
    for (const line of pdf.splitTextToSize(p.title, contentW) as string[]) { pdf.text(line, margin, y); y += 6; }
  }
  y += 8;
  pdf.setDrawColor(...GRIS_FILET); pdf.setLineWidth(0.4); pdf.line(margin, y, pageW - margin, y);
  y += 8;
  const fields = feasibilityCoverFields(p).map(([k, v]) => [k, typographie(v)] as [string, string]);
  font('bold', 9);
  const labelW = Math.max(0, ...fields.map(([k]) => pdf.getTextWidth(`${k} :`))) + 4;
  for (const [k, v] of fields) {
    font('bold', 9, GRIS_DOUX);
    pdf.text(`${k} :`, margin, y);
    font('normal', 10);
    const vl = pdf.splitTextToSize(v, contentW - labelW) as string[];
    pdf.text(vl, margin + labelW, y);
    y += Math.max(1, vl.length) * 5 + 1.5;
  }

  if (sections.length) {
    y += 10;
    font('bold', 12);
    pdf.text('Sommaire', margin, y);
    y += 7;
    sections.forEach((s, i) => {
      ensure(6);
      font('normal', 10);
      const line = pdf.splitTextToSize(`${i + 1}. ${s.title}`, contentW) as string[];
      pdf.text(line, margin + 2, y);
      y += line.length * 5 + 0.5;
    });
  }

  // Rubriques, chacune sur une nouvelle page pour une lecture rubrique par rubrique.
  for (const [i, s] of sections.entries()) {
    newPage();
    font('bold', 13);
    const heading = pdf.splitTextToSize(`${i + 1}. ${s.title}`, contentW) as string[];
    pdf.text(heading, margin, y);
    y += heading.length * 6 + 1;
    pdf.setDrawColor(...GRIS_FILET); pdf.setLineWidth(0.3); pdf.line(margin, y, margin + 40, y);
    y += 6;

    font('normal', 10);
    const paragraphs = (s.content || '').split(/\n/);
    for (const para of paragraphs) {
      if (!para.trim()) { y += 2.5; continue; }
      const isBullet = BULLET_RE.test(para);
      const text = typographie(isBullet ? para.replace(BULLET_RE, '') : para);
      const indent = isBullet ? 5 : 0;
      const lineW = contentW - indent;
      const wrapped = pdf.splitTextToSize(text, lineW) as string[];
      for (const [li, line] of wrapped.entries()) {
        ensure(5);
        font('normal', 10);
        if (isBullet && li === 0) pdf.text('•', margin + 1, y);
        // Texte justifié : toutes les lignes sauf la dernière du paragraphe.
        const gaps = line.split(' ').length - 1;
        const justify = li < wrapped.length - 1 && gaps > 0;
        if (justify) {
          const spacing = ((lineW - pdf.getTextWidth(line)) / gaps) * pdf.internal.scaleFactor;
          (pdf.internal as any).write(`${spacing.toFixed(3)} Tw`);
          pdf.text(line, margin + indent, y);
          (pdf.internal as any).write('0 Tw');
        } else {
          pdf.text(line, margin + indent, y);
        }
        y += 4.8;
      }
      y += 1.2;
    }

    for (const ill of s.illustrations) {
      const img = await loadIllustration(ill.file_url);
      if (!img) continue;
      const w = contentW;
      const h = (img.h / img.w) * w;
      ensure(h + 10);
      y += 3;
      try { pdf.addImage(img.dataUrl, 'JPEG', margin, y, w, h); } catch { continue; }
      pdf.setDrawColor(...GRIS_FILET); pdf.setLineWidth(0.2); pdf.rect(margin, y, w, h);
      y += h + 4;
      if (ill.caption) {
        font('italic', 8.5, GRIS_DOUX);
        const cap = pdf.splitTextToSize(ill.caption, contentW) as string[];
        pdf.text(cap, margin, y);
        y += cap.length * 4 + 2;
      }
    }
  }

  drawAgencyFooters(pdf, settings, letterhead);
  pdf.save(feasibilityFilename(p, 'pdf'));
}

// ── Word ─────────────────────────────────────────────────────────────────────

// docx mesure les images en pixels (96 dpi) : 170 mm ≈ 642 px.
const DOCX_IMAGE_W = 642;

export async function exportFeasibilityDocx(p: ProposalForExport, sections: FeasibilitySection[], settings: AgencySettings): Promise<void> {
  const {
    Document, Packer, Paragraph, TextRun, ImageRun, Header, Footer, PageNumber, AlignmentType, HeadingLevel, BorderStyle,
    Table, TableRow, TableCell, WidthType, VerticalAlign,
  } = await import('docx');

  const logo = settings.logoUrl ? await compressImage(settings.logoUrl, 400, 400, 1, 'image/png') : null;
  const sansBordure = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const bordures = { top: sansBordure, bottom: sansBordure, left: sansBordure, right: sansBordure };
  const coordonnees = [settings.address, settings.phone ? `Tél : ${settings.phone}` : '', settings.email].filter(Boolean).join('  ·  ');
  const logoH = 40;
  const logoW = logo ? Math.round((logo.w / logo.h) * logoH) : 0;
  // Logo à gauche, nom et coordonnées à côté, comme dans l'export PDF.
  const headerChildren: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = [
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: { ...bordures, insideHorizontal: sansBordure, insideVertical: sansBordure },
      rows: [new TableRow({
        children: [
          ...(logo ? [new TableCell({
            width: { size: (logoW + 20) * 15, type: WidthType.DXA },
            borders: bordures,
            verticalAlign: VerticalAlign.CENTER,
            children: [new Paragraph({ children: [new ImageRun({ type: 'png', data: logo.buffer, transformation: { width: logoW, height: logoH } })] })],
          })] : []),
          new TableCell({
            borders: bordures,
            verticalAlign: VerticalAlign.CENTER,
            children: [
              new Paragraph({ children: [new TextRun({ text: settings.agencyName || '', bold: true, size: 22, color: '111827' })] }),
              new Paragraph({ children: [new TextRun({ text: coordonnees, size: 15, color: '6B7280' })] }),
            ],
          }),
        ],
      })],
    }),
    new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'D1D5DB' } }, spacing: { after: 120 }, children: [] }),
  ];

  const footerChildren = [
    new Paragraph({
      border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'D1D5DB' } },
      children: [new TextRun({ text: agencyFooterLine(settings), size: 13, color: '6B7280' })],
    }),
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [
        new TextRun({ text: 'P', bold: true, size: 15, color: '111827' }),
        new TextRun({ children: [PageNumber.CURRENT], bold: true, size: 15, color: '111827' }),
        new TextRun({ text: '|', bold: true, size: 15, color: '111827' }),
        new TextRun({ children: [PageNumber.TOTAL_PAGES], bold: true, size: 15, color: '111827' }),
      ],
    }),
  ];

  const body: InstanceType<typeof Paragraph>[] = [
    new Paragraph({ heading: HeadingLevel.TITLE, spacing: { before: 600, after: 120 }, children: [new TextRun({ text: DOC_TITLE, bold: true, size: 44, color: '111827' })] }),
  ];
  if (p.title) body.push(new Paragraph({ spacing: { after: 360 }, children: [new TextRun({ text: p.title, size: 26, color: '6B7280' })] }));
  for (const [k, v0] of feasibilityCoverFields(p)) {
    const v = typographie(v0);
    body.push(new Paragraph({ spacing: { after: 60 }, children: [
      new TextRun({ text: `${k} : `, bold: true, size: 19, color: '6B7280' }),
      new TextRun({ text: v, size: 20, color: '111827' }),
    ] }));
  }
  if (sections.length) {
    body.push(new Paragraph({ spacing: { before: 400, after: 120 }, children: [new TextRun({ text: 'Sommaire', bold: true, size: 24, color: '111827' })] }));
    sections.forEach((s, i) => body.push(new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: `${i + 1}. ${s.title}`, size: 20 })] })));
  }

  for (const [i, s] of sections.entries()) {
    body.push(new Paragraph({
      heading: HeadingLevel.HEADING_1, pageBreakBefore: true, spacing: { after: 200 },
      children: [new TextRun({ text: `${i + 1}. ${s.title}`, bold: true, size: 28, color: '111827' })],
    }));
    for (const para of (s.content || '').split(/\n/)) {
      if (!para.trim()) continue;
      const isBullet = BULLET_RE.test(para);
      const text = typographie(isBullet ? para.replace(BULLET_RE, '') : para);
      body.push(new Paragraph({
        alignment: AlignmentType.JUSTIFIED,
        spacing: { after: 100, line: 276 },
        ...(isBullet ? { bullet: { level: 0 } } : {}),
        children: [new TextRun({ text, size: 20, color: '111827' })],
      }));
    }
    for (const ill of s.illustrations) {
      const img = await loadIllustration(ill.file_url);
      if (!img) continue;
      body.push(new Paragraph({
        spacing: { before: 160, after: 60 },
        children: [new ImageRun({ type: 'jpg', data: img.buffer, transformation: { width: DOCX_IMAGE_W, height: Math.round((img.h / img.w) * DOCX_IMAGE_W) } })],
      }));
      if (ill.caption) body.push(new Paragraph({ spacing: { after: 200 }, children: [new TextRun({ text: ill.caption, italics: true, size: 17, color: '6B7280' })] }));
    }
  }

  const doc = new Document({
    // Police et styles du cabinet : sans cela Word retombe sur Times New Roman
    // et sur les styles de titre bleus par défaut.
    styles: {
      default: {
        document: { run: { font: 'Arial', size: 20, color: '111827' } },
        title: { run: { font: 'Arial', bold: true, size: 44, color: '111827' } },
        heading1: { run: { font: 'Arial', bold: true, size: 28, color: '111827' } },
      },
    },
    sections: [{
      properties: { page: { margin: { top: 1700, bottom: 1300, left: 1020, right: 1020, header: 567, footer: 567 } } },
      headers: { default: new Header({ children: headerChildren }) },
      footers: { default: new Footer({ children: footerChildren }) },
      children: body,
    }],
  });
  const blob = await Packer.toBlob(doc);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = feasibilityFilename(p, 'docx');
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
