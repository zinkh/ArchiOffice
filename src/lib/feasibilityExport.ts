// Exports PDF et Word de l'étude de faisabilité d'une proposition, à la charte
// du cabinet : en-tête avec logo et coordonnées, pied de page avec l'adresse et
// les mentions légales, pagination « P1|2 » en bas à droite, nuances de gris
// (voir « Exports PDF et Excel : une seule charte » dans CLAUDE.md).
// jsPDF et docx ne sont chargés qu'au moment de l'export.
import type { Proposal } from '../types';

type ProposalForExport = Partial<Proposal>;
import type { AgencySettings } from './proposalExport';
import { classifyContentLine, feasibilityCoverFields, feasibilityFilename, parseInlineMarkdown, stripInlineMarkdown, type FeasibilitySection } from './feasibilityBlocks';
import { partnerLogosParagraph } from './docxPartnerLogos';
import { agencyFooterLine, drawAgencyFooters, drawAgencyHeader, drawCompactHeader, loadLogoDataUrl } from './pdfLetterhead';
import { compressImage, type CompressedImage } from './imageCompression';
import { resolveSignedUrl } from './signedStorageUrl';

const DOC_TITLE = 'Étude de faisabilité';
const GRIS_TEXTE: [number, number, number] = [17, 24, 39];
const GRIS_DOUX: [number, number, number] = [107, 114, 128];
const GRIS_FILET: [number, number, number] = [209, 213, 219];

async function loadIllustration(fileUrl: string): Promise<CompressedImage | null> {
  try {
    const url = await resolveSignedUrl(fileUrl);
    return await compressImage(url, 1600, 1100, 0.85);
  } catch {
    return null;
  }
}

// ── PDF ──────────────────────────────────────────────────────────────────────

export interface FeasibilityExportOptions {
  /** Indice de révision du document (A, B, C...). */
  indice?: string;
  /** Date de diffusion, au format AAAA-MM-JJ. */
  issueDate?: string;
}

function formatIssueDate(iso?: string): string {
  const d = iso ? new Date(`${iso}T12:00:00`) : new Date();
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Éléments communs aux deux exports : même repère d'en-tête, mêmes lignes de garde. */
function documentMeta(p: ProposalForExport, options: FeasibilityExportOptions) {
  const indice = (options.indice ?? p.feasibility_indice ?? 'A').trim();
  const issueDate = options.issueDate || p.feasibility_issue_date?.slice(0, 10) || undefined;
  const repere = [p.reference, DOC_TITLE, indice ? `Indice ${indice}` : ''].filter(Boolean).join(' | ');
  const fields: Array<[string, string]> = [
    ...feasibilityCoverFields(p),
    ...(indice ? [['Indice', indice] as [string, string]] : []),
    ['Date de diffusion', formatIssueDate(issueDate)],
  ];
  return { repere, fields: fields.filter(([, v]) => v) };
}

// ── PDF ──────────────────────────────────────────────────────────────────────
// Même aspect que l'export Word : logo et repère sur la première page seulement,
// repère seul ensuite, titre en majuscules, champs en lignes, sommaire, rubriques
// à la suite (sans saut de page) sous un titre majuscule souligné.

export async function exportFeasibilityPdf(p: ProposalForExport, sections: FeasibilitySection[], settings: AgencySettings, options: FeasibilityExportOptions = {}): Promise<void> {
  const { default: jsPDF } = await import('jspdf');
  const pdf = new jsPDF('p', 'mm', 'a4');
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 25.4;
  const contentW = pageW - margin * 2;
  const bottom = pageH - 18;
  const top = 15;
  const logo = await loadLogoDataUrl(settings.logoUrl);
  const { repere, fields } = documentMeta(p, options);
  const letterhead = { title: DOC_TITLE, margin, logo };

  const font = (style: 'normal' | 'bold' | 'italic' | 'bolditalic', size: number, color = GRIS_TEXTE) => {
    pdf.setFont('helvetica', style); pdf.setFontSize(size); pdf.setTextColor(...color);
  };
  const rule = (y0: number, w: number, x0 = margin) => {
    pdf.setDrawColor(...GRIS_TEXTE); pdf.setLineWidth(w); pdf.line(x0, y0, pageW - margin, y0);
  };

  let y = top;
  const drawHeader = (first: boolean) => {
    let yy = top;
    if (first && logo) {
      const h = 12.7;
      const w = (logo.width / logo.height) * h;
      try { pdf.addImage(logo.dataUrl, logo.format, margin, yy, w, h); } catch { /* logo illisible : on garde le repère */ }
      font('normal', 8.5, GRIS_DOUX);
      pdf.text(repere, pageW - margin, yy + h - 2, { align: 'right' });
      yy += h + 2;
    } else if (first) {
      font('bold', 12);
      pdf.text(settings.agencyName || '', margin, yy + 4);
      font('normal', 8.5, GRIS_DOUX);
      pdf.text(repere, pageW - margin, yy + 4, { align: 'right' });
      yy += 8;
    } else {
      font('normal', 8.5, GRIS_DOUX);
      pdf.text(repere, pageW - margin, yy + 4, { align: 'right' });
      yy += 7;
    }
    rule(yy, first ? 0.5 : 0.4);
    return yy + 8;
  };
  y = drawHeader(true);
  // Pages suivantes : l'en-tête réduit de la charte (agence à gauche, repère du document à droite).
  const newPage = () => { pdf.addPage(); drawCompactHeader(pdf, settings, { title: repere, margin }); y = top + 15; };
  const ensure = (h: number) => { if (y + h > bottom) newPage(); };

  // Page de garde : titre, sous-titre, champs, sommaire.
  y += 4;
  font('bold', 22);
  for (const line of pdf.splitTextToSize(DOC_TITLE.toUpperCase(), contentW) as string[]) { pdf.text(line, margin, y); y += 9; }
  if (p.title) {
    font('normal', 13, GRIS_DOUX);
    for (const line of pdf.splitTextToSize(p.title, contentW) as string[]) { pdf.text(line, margin, y); y += 6; }
  }
  y += 6;
  for (const [k, v] of fields) {
    font('bold', 9.5, GRIS_DOUX);
    const label = `${k} : `;
    const lw = pdf.getTextWidth(label);
    font('normal', 10);
    const vl = pdf.splitTextToSize(v, contentW - lw) as string[];
    ensure(vl.length * 5 + 1.5);
    font('bold', 9.5, GRIS_DOUX);
    pdf.text(label, margin, y);
    font('normal', 10);
    pdf.text(vl, margin + lw, y);
    y += vl.length * 5 + 1.5;
  }

  if (sections.length) {
    y += 8;
    ensure(14);
    font('bold', 12);
    pdf.text('Sommaire', margin, y);
    y += 6.5;
    sections.forEach((s, i) => {
      font('normal', 10);
      const line = pdf.splitTextToSize(`${i + 1}. ${s.title}`, contentW) as string[];
      ensure(line.length * 5 + 1);
      pdf.text(line, margin, y);
      y += line.length * 5 + 1;
    });
  }

  // Un paragraphe avec gras et italique en ligne, coupé aux mots.
  const drawRuns = (text: string, x0: number, width: number, baseBold: boolean, size: number) => {
    type Tok = { w: string; style: 'normal' | 'bold' | 'italic' | 'bolditalic' };
    const toks: Tok[] = [];
    for (const r of parseInlineMarkdown(text)) {
      const bold = r.bold || baseBold;
      const style = bold && r.italics ? 'bolditalic' : bold ? 'bold' : r.italics ? 'italic' : 'normal';
      for (const w of r.text.split(/(\s+)/)) if (w) toks.push({ w, style });
    }
    const lines: Tok[][] = [[]];
    let lineW = 0;
    for (const t of toks) {
      pdf.setFont('helvetica', t.style); pdf.setFontSize(size);
      const tw = pdf.getTextWidth(t.w);
      const isSpace = /^\s+$/.test(t.w);
      if (!isSpace && lineW + tw > width && lines[lines.length - 1].length) { lines.push([]); lineW = 0; }
      if (isSpace && !lines[lines.length - 1].length) continue;
      lines[lines.length - 1].push(t); lineW += tw;
    }
    for (const line of lines) {
      ensure(5);
      let x = x0;
      for (const t of line) {
        font(t.style, size);
        pdf.text(t.w, x, y);
        x += pdf.getTextWidth(t.w);
      }
      y += 4.8;
    }
  };

  for (const [i, s] of sections.entries()) {
    ensure(24);
    y += 8;
    font('bold', 13);
    const heading = pdf.splitTextToSize(`${i + 1}. ${s.title}`.toUpperCase(), contentW) as string[];
    pdf.text(heading, margin, y);
    y += heading.length * 6 - 1;
    rule(y, 0.6);
    y += 6;

    for (const para of (s.content || '').split(/\n/)) {
      if (!para.trim()) continue;
      const line0 = classifyContentLine(para);
      const isBullet = line0.kind === 'bullet';
      if (line0.kind === 'heading') y += 2;
      ensure(6);
      if (isBullet) { font('normal', 10); pdf.text('•', margin + 1, y); }
      drawRuns(line0.text, margin + (isBullet ? 5 : 0), contentW - (isBullet ? 5 : 0), line0.kind === 'heading', line0.kind === 'heading' ? 11 : 10);
      y += isBullet ? 0.8 : 1.4;
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

export async function exportFeasibilityDocx(p: ProposalForExport, sections: FeasibilitySection[], settings: AgencySettings, options: FeasibilityExportOptions = {}): Promise<void> {
  const {
    Document, Packer, Paragraph, TextRun, ImageRun, Header, Footer, PageNumber, AlignmentType, HeadingLevel, BorderStyle,
    TabStopType, TabStopPosition,
  } = await import('docx');

  // En-tête de la première page : logo à gauche, repère du document à droite, filet noir.
  // Les pages suivantes n'ont pas de logo : seul le repère, en gris, sous un filet.
  const { repere, fields } = documentMeta(p, options);
  const logo = settings.logoUrl ? await compressImage(settings.logoUrl, 600, 400, 0.92) : null;
  const firstHeaderChildren: InstanceType<typeof Paragraph>[] = [
    new Paragraph({
      tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
      border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: '111827', space: 6 } },
      spacing: { after: 240 },
      children: [
        ...(logo ? [new ImageRun({ type: 'jpg', data: logo.buffer, transformation: { width: Math.round((logo.w / logo.h) * 48), height: 48 } })] : [
          new TextRun({ text: settings.agencyName || '', bold: true, size: 24, color: '111827' }),
        ]),
        new TextRun({ text: `\t${repere}`, size: 17, color: '6B7280' }),
      ],
    }),
  ];
  const nextHeaderChildren: InstanceType<typeof Paragraph>[] = [
    new Paragraph({
      tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '111827', space: 4 } },
      spacing: { after: 240 },
      children: [
        new TextRun({ text: settings.agencyName || '', bold: true, size: 16, color: '111827' }),
        new TextRun({ text: `\t${repere}`, size: 16, color: '6B7280' }),
      ],
    }),
  ];
  const bandeau = await partnerLogosParagraph();
  if (bandeau) firstHeaderChildren.push(bandeau);

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
    new Paragraph({ heading: HeadingLevel.TITLE, spacing: { before: 200, after: 80 }, children: [new TextRun({ text: DOC_TITLE.toUpperCase(), bold: true, size: 44, color: '111827' })] }),
  ];
  if (p.title) body.push(new Paragraph({ spacing: { after: 240 }, children: [new TextRun({ text: p.title, size: 26, color: '6B7280' })] }));
  for (const [k, v] of fields) {
    body.push(new Paragraph({ spacing: { after: 60 }, children: [
      new TextRun({ text: `${k} : `, bold: true, size: 19, color: '6B7280' }),
      new TextRun({ text: v, size: 20, color: '111827' }),
    ] }));
  }
  if (sections.length) {
    body.push(new Paragraph({ spacing: { before: 400, after: 120 }, children: [new TextRun({ text: 'Sommaire', bold: true, size: 24, color: '111827' })] }));
    sections.forEach((s, i) => body.push(new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: `${i + 1}. ${s.title}`, size: 20 })] })));
  }

  // Les rubriques s'enchaînent à la suite de la page de garde, sans saut de page.
  for (const [i, s] of sections.entries()) {
    body.push(new Paragraph({
      heading: HeadingLevel.HEADING_1, keepNext: true, spacing: { before: 400, after: 160 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: '111827', space: 2 } },
      children: [new TextRun({ text: `${i + 1}. ${s.title}`.toUpperCase(), bold: true, size: 26, color: '111827' })],
    }));
    for (const para of (s.content || '').split(/\n/)) {
      if (!para.trim()) continue;
      const line = classifyContentLine(para);
      const runs = parseInlineMarkdown(line.text).map((r) => new TextRun({
        text: r.text, bold: r.bold || line.kind === 'heading', italics: r.italics, size: line.kind === 'heading' ? 22 : 20, color: '111827',
      }));
      body.push(new Paragraph({
        spacing: { before: line.kind === 'heading' ? 160 : 0, after: line.kind === 'bullet' ? 60 : 100 },
        alignment: AlignmentType.LEFT,
        ...(line.kind === 'bullet' ? { bullet: { level: 0 } } : {}),
        children: runs,
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
    styles: {
      default: {
        document: { run: { font: 'Arial', size: 20, color: '111827' }, paragraph: { spacing: { line: 276 } } },
        heading1: { run: { font: 'Arial', bold: true, size: 28, color: '111827' } },
        title: { run: { font: 'Arial', bold: true, size: 44, color: '111827' } },
      },
    },
    sections: [{
      properties: { titlePage: true },
      headers: { first: new Header({ children: firstHeaderChildren }), default: new Header({ children: nextHeaderChildren }) },
      footers: { first: new Footer({ children: footerChildren }), default: new Footer({ children: footerChildren }) },
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
