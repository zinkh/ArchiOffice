// ── Fichiers produits par un agent ──────────────────────────────────────────
// Le modèle décrit le fichier voulu dans un bloc ```artifact (voir
// systemPrompts.ts) ; ce module le fabrique réellement. Les quatre formats
// partagent la même charte : en-tête du cabinet (logo + coordonnées), pied de
// page avec l'adresse et le SIRET, pagination « P1|2 » en bas à droite.
//
// La version précédente écrivait le DOCX à la main, en assemblant du
// WordprocessingML dans une chaîne — ce qui donnait un fichier lisible mais
// sans en-tête, sans pied de page, sans tableau et sans pagination. On passe
// par la bibliothèque docx (déjà utilisée par src/lib/meetingExport.ts) pour
// obtenir un document réellement présentable, et par jsPDF pour le PDF, comme
// les exports de l'interface.
import type { AgentArtifact } from '../types.js';
import { agencyFooterLine, EMPTY_AGENCY, type AgencyIdentity } from './agencyIdentity.js';

export interface ArtifactSpec {
  type: 'excel' | 'csv' | 'docx' | 'pdf';
  filename: string;
  /** Titre imprimé sous l'en-tête. À défaut, le nom du fichier sans extension. */
  title?: string;
  subtitle?: string;
  sheets?: { name: string; rows: any[][] }[];
  rows?: any[][];
  content?: string;
  /** Range aussi le fichier sur une fiche du cabinet (pièces jointes de l'affaire, de l'appel d'offres...). */
  attach_to?: { resource: string; resource_id: string; category?: string };
}

const ARTIFACT_RE = /```artifact\n([\s\S]*?)\n```/g;

export function parseArtifactFromText(text: string): { cleanText: string; spec: ArtifactSpec | null } {
  const match = ARTIFACT_RE.exec(text);
  ARTIFACT_RE.lastIndex = 0;
  if (!match) return { cleanText: text, spec: null };

  try {
    const spec = JSON.parse(match[1]) as ArtifactSpec;
    const cleanText = text.replace(/```artifact\n[\s\S]*?\n```/g, '').trim();
    return { cleanText, spec };
  } catch {
    return { cleanText: text, spec: null };
  }
}

// ── Modèle de lignes (markdown restreint) ───────────────────────────────────
// Volontairement le même sous-ensemble que src/lib/templateExport.ts, plus les
// tableaux : titres « # », « ## », « ### », puces « - », lignes de tableau
// « | a | b | ». Le reste est du paragraphe.
type Line =
  | { kind: 'h1' | 'h2' | 'h3' | 'bullet' | 'text'; text: string }
  | { kind: 'table'; cells: string[][] };

function stripInlineMarkup(text: string): string {
  return text.replace(/\*\*(.*?)\*\*/g, '$1').replace(/`([^`]*)`/g, '$1');
}

function isTableRow(line: string): boolean {
  return line.trim().startsWith('|') && line.trim().endsWith('|') && line.includes('|');
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|[\s:|-]+\|\s*$/.test(line);
}

function splitRow(line: string): string[] {
  return line.trim().slice(1, -1).split('|').map(c => stripInlineMarkup(c.trim()));
}

export function parseLines(content: string): Line[] {
  const lines: Line[] = [];
  const raw = content.split('\n');
  let i = 0;
  while (i < raw.length) {
    const line = raw[i].trimEnd();
    if (isTableRow(line)) {
      const cells: string[][] = [];
      while (i < raw.length && isTableRow(raw[i].trimEnd())) {
        if (!isTableSeparator(raw[i])) cells.push(splitRow(raw[i]));
        i++;
      }
      if (cells.length > 0) lines.push({ kind: 'table', cells });
      continue;
    }
    if (line.startsWith('### ')) lines.push({ kind: 'h3', text: stripInlineMarkup(line.slice(4)) });
    else if (line.startsWith('## ')) lines.push({ kind: 'h2', text: stripInlineMarkup(line.slice(3)) });
    else if (line.startsWith('# ')) lines.push({ kind: 'h1', text: stripInlineMarkup(line.slice(2)) });
    else if (line.startsWith('- ') || line.startsWith('* ')) lines.push({ kind: 'bullet', text: stripInlineMarkup(line.slice(2)) });
    else lines.push({ kind: 'text', text: stripInlineMarkup(line.replace(/^>\s?/, '')) });
    i++;
  }
  return lines;
}

function baseName(filename: string): string {
  return filename.replace(/\.[a-zA-Z0-9]+$/, '');
}

// Le modèle propose parfois une extension qui ne correspond pas au type
// demandé (« rapport.doc » pour un docx, « tableau.xls » pour un xlsx) :
// on remplace une extension bureautique connue plutôt que d'empiler les deux.
const KNOWN_EXTENSIONS = /\.(docx?|pdf|xlsx?|csv|txt|odt|ods)$/i;

function withExtension(filename: string, ext: string): string {
  const name = filename.trim() || 'document';
  if (name.toLowerCase().endsWith(ext)) return name;
  return name.replace(KNOWN_EXTENSIONS, '') + ext;
}

// ── DOCX ────────────────────────────────────────────────────────────────────
async function buildDocx(spec: ArtifactSpec, agency: AgencyIdentity): Promise<Buffer> {
  const {
    Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType,
    AlignmentType, BorderStyle, Header, Footer, PageNumber, ImageRun, HeadingLevel,
  } = await import('docx');

  const title = spec.title || baseName(spec.filename);

  const headerChildren: any[] = [];
  if (agency.logo) {
    // Hauteur fixée, largeur déduite du rapport réel pour ne pas déformer.
    const height = 40;
    const width = Math.round((agency.logo.width / agency.logo.height) * height) || 40;
    headerChildren.push(
      new Paragraph({
        children: [
          new ImageRun({
            data: agency.logo.data,
            transformation: { width: Math.min(width, 180), height },
            type: agency.logo.format === 'png' ? 'png' : 'jpg',
          } as any),
        ],
      })
    );
  }
  if (agency.name) {
    headerChildren.push(new Paragraph({ children: [new TextRun({ text: agency.name, bold: true, size: 22 })] }));
  }
  const headerInfo = [agency.address, agency.phone ? `Tél : ${agency.phone}` : '', agency.email].filter(Boolean).join('  ·  ');
  if (headerInfo) {
    headerChildren.push(new Paragraph({ children: [new TextRun({ text: headerInfo, size: 15, color: '666666' })] }));
  }
  headerChildren.push(
    new Paragraph({
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '333333' } },
      spacing: { before: 60, after: 120 },
      children: [],
    })
  );

  const compactHeaderChildren = [
    new Paragraph({
      tabStops: [{ type: 'right' as any, position: 9026 }],
      border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'BBBBBB' } },
      spacing: { after: 120 },
      children: [
        new TextRun({ text: agency.name || '', bold: true, size: 16 }),
        new TextRun({ text: `\t${title}`, size: 16, color: '666666' }),
      ],
    }),
  ];

  const footerLine = agencyFooterLine(agency);
  const footerChildren = [
    ...(footerLine
      ? [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: footerLine, size: 13, color: '888888' })] })]
      : []),
    // Pagination « P1|2 » en bas à droite.
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [
        new TextRun({ text: 'P', size: 14, color: '888888' }),
        new TextRun({ children: [PageNumber.CURRENT], size: 14, color: '888888' }),
        new TextRun({ text: '|', size: 14, color: '888888' }),
        new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 14, color: '888888' }),
      ],
    }),
  ];

  const body: any[] = [
    new Paragraph({
      spacing: { after: 160 },
      heading: HeadingLevel.TITLE,
      children: [new TextRun({ text: title, bold: true, size: 32, color: '111111' })],
    }),
    ...(spec.subtitle
      ? [new Paragraph({ spacing: { after: 240 }, children: [new TextRun({ text: spec.subtitle, size: 20, color: '666666' })] })]
      : []),
  ];

  for (const line of parseLines(spec.content ?? '')) {
    if (line.kind === 'table') {
      const [head, ...rest] = line.cells;
      body.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              tableHeader: true,
              children: head.map(c => new TableCell({
                shading: { fill: 'F2F2F2' },
                children: [new Paragraph({ children: [new TextRun({ text: c, bold: true, size: 18 })] })],
              })),
            }),
            ...rest.map(row => new TableRow({
              children: row.map(c => new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text: c, size: 18 })] })],
              })),
            })),
          ],
        })
      );
      body.push(new Paragraph({ spacing: { after: 160 }, children: [] }));
      continue;
    }
    if (line.kind === 'h1') {
      body.push(new Paragraph({ spacing: { before: 280, after: 120 }, children: [new TextRun({ text: line.text, bold: true, size: 26 })] }));
    } else if (line.kind === 'h2') {
      body.push(new Paragraph({ spacing: { before: 220, after: 100 }, children: [new TextRun({ text: line.text, bold: true, size: 22 })] }));
    } else if (line.kind === 'h3') {
      body.push(new Paragraph({ spacing: { before: 180, after: 80 }, children: [new TextRun({ text: line.text, bold: true, size: 20, color: '444444' })] }));
    } else if (line.kind === 'bullet') {
      body.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: line.text, size: 20 })] }));
    } else if (line.text.trim() === '') {
      body.push(new Paragraph({ spacing: { after: 80 }, children: [] }));
    } else {
      body.push(new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: line.text, size: 20 })] }));
    }
  }

  const doc = new Document({
    creator: agency.name || 'ArchiOffice',
    title,
    sections: [{
      properties: { titlePage: true },
      // Première page : logo et coordonnées. Suivantes : une ligne (agence, puis document à droite).
      headers: {
        first: new Header({ children: headerChildren }),
        default: new Header({ children: compactHeaderChildren }),
      },
      footers: {
        first: new Footer({ children: footerChildren }),
        default: new Footer({ children: footerChildren }),
      },
      children: body,
    }],
  });

  return Packer.toBuffer(doc);
}

// ── PDF ─────────────────────────────────────────────────────────────────────
async function buildPdf(spec: ArtifactSpec, agency: AgencyIdentity): Promise<Buffer> {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF('p', 'mm', 'a4');
  const pageW = 210;
  const pageH = 297;
  const margin = 18;
  const contentW = pageW - margin * 2;
  const title = spec.title || baseName(spec.filename);

  const setFont = (style: 'normal' | 'bold', size: number, gray = 17) => {
    pdf.setFont('helvetica', style);
    pdf.setFontSize(size);
    pdf.setTextColor(gray, gray, gray);
  };

  // En-tête réimprimée sur chaque page : la hauteur qu'elle occupe est la
  // marge haute réelle du contenu.
  const drawHeader = (): number => {
    let y = margin;
    let textX = margin;
    if (agency.logo) {
      const h = 14;
      const w = Math.min((agency.logo.width / agency.logo.height) * h || 14, 45);
      try {
        pdf.addImage(agency.logo.data.toString('base64'), agency.logo.format === 'png' ? 'PNG' : 'JPEG', margin, y, w, h);
        textX = margin + w + 5;
      } catch {
        // Un logo illisible ne doit pas empêcher la sortie du document.
      }
    }
    setFont('bold', 12);
    if (agency.name) pdf.text(agency.name, textX, y + 5);
    setFont('normal', 8, 107);
    let infoY = y + 10;
    for (const info of [agency.address, agency.phone ? `Tél : ${agency.phone}` : '', agency.email].filter(Boolean)) {
      pdf.text(info, textX, infoY);
      infoY += 4;
    }
    const bottom = Math.max(infoY, y + (agency.logo ? 16 : 12));
    pdf.setDrawColor(51, 51, 51);
    pdf.setLineWidth(0.5);
    pdf.line(margin, bottom, pageW - margin, bottom);
    return bottom + 8;
  };

  // Pages suivantes : une seule ligne, l'agence à gauche et le document à droite
  // (le logo n'est imprimé que sur la première page).
  const drawCompactHeader = (): number => {
    setFont('bold', 8);
    const nom = agency.name || '';
    pdf.text(nom, margin, 10);
    setFont('normal', 8, 107);
    const [doc] = pdf.splitTextToSize(title, Math.max(contentW - pdf.getTextWidth(nom) - 8, 20)) as string[];
    pdf.text(doc ?? '', pageW - margin, 10, { align: 'right' });
    pdf.setDrawColor(210, 210, 210);
    pdf.setLineWidth(0.2);
    pdf.line(margin, 12.5, pageW - margin, 12.5);
    return margin + 4;
  };

  let y = drawHeader();
  const newPage = () => { pdf.addPage(); y = drawCompactHeader(); };
  const ensureSpace = (h: number) => { if (y + h > pageH - margin - 12) newPage(); };

  setFont('bold', 16);
  const titleLines = pdf.splitTextToSize(title, contentW) as string[];
  ensureSpace(titleLines.length * 7);
  pdf.text(titleLines, margin, y);
  y += titleLines.length * 7 + 2;
  if (spec.subtitle) {
    setFont('normal', 10, 107);
    pdf.text(spec.subtitle, margin, y);
    y += 7;
  }
  y += 3;

  const writeWrapped = (text: string, style: 'normal' | 'bold', size: number, indent = 0, gray = 17) => {
    setFont(style, size, gray);
    const wrapped = pdf.splitTextToSize(text, contentW - indent) as string[];
    ensureSpace(wrapped.length * (size * 0.5));
    pdf.text(wrapped, margin + indent, y);
    y += wrapped.length * (size * 0.5) + 1;
  };

  for (const line of parseLines(spec.content ?? '')) {
    if (line.kind === 'table') {
      const [head, ...rest] = line.cells;
      const colCount = Math.max(head.length, 1);
      const colW = contentW / colCount;
      const drawRow = (cells: string[], bold: boolean) => {
        ensureSpace(7);
        setFont(bold ? 'bold' : 'normal', 9);
        cells.forEach((c, idx) => {
          const wrapped = pdf.splitTextToSize(c, colW - 3) as string[];
          pdf.text(wrapped.slice(0, 3), margin + idx * colW + 1.5, y + 4);
        });
        pdf.setDrawColor(210, 210, 210);
        pdf.setLineWidth(0.2);
        pdf.line(margin, y + 6, pageW - margin, y + 6);
        y += 7;
      };
      drawRow(head, true);
      for (const row of rest) drawRow(row, false);
      y += 3;
      continue;
    }
    if (line.kind === 'h1') { y += 2; writeWrapped(line.text, 'bold', 13); }
    else if (line.kind === 'h2') { y += 1; writeWrapped(line.text, 'bold', 11); }
    else if (line.kind === 'h3') writeWrapped(line.text, 'bold', 10, 0, 68);
    else if (line.kind === 'bullet') writeWrapped(`•  ${line.text}`, 'normal', 9.5, 3);
    else if (line.text.trim() === '') y += 3;
    else writeWrapped(line.text, 'normal', 9.5);
  }

  const totalPages = (pdf as any).internal.getNumberOfPages();
  const footerLine = agencyFooterLine(agency);
  for (let p = 1; p <= totalPages; p++) {
    pdf.setPage(p);
    pdf.setDrawColor(210, 210, 210);
    pdf.setLineWidth(0.2);
    pdf.line(margin, pageH - 14, pageW - margin, pageH - 14);
    setFont('normal', 7, 136);
    if (footerLine) pdf.text(footerLine, margin, pageH - 9, { maxWidth: contentW - 20 });
    // Pagination « P1|2 » en bas à droite, comme les documents du cabinet.
    pdf.text(`P${p}|${totalPages}`, pageW - margin, pageH - 9, { align: 'right' });
  }

  return Buffer.from(pdf.output('arraybuffer') as ArrayBuffer);
}

// ── Tableur ─────────────────────────────────────────────────────────────────
// ExcelJS et non SheetJS : la version communautaire de SheetJS n'écrit ni la
// mise en forme, ni les en-têtes et pieds d'impression. Sans eux, impossible
// d'appliquer la charte (identité sur la première page seulement, une ligne
// « agence | document » ensuite, pagination « P1|2 »).
const echapperEntetePied = (t: string) => t.replace(/&/g, '&&');

async function buildExcel(spec: ArtifactSpec, agency: AgencyIdentity): Promise<string> {
  const { Workbook } = await import('exceljs');
  const wb = new Workbook();
  wb.creator = agency.name || 'ArchiOffice';
  wb.created = new Date();
  const sheets = spec.sheets ?? [{ name: 'Données', rows: spec.rows ?? [] }];
  const title = spec.title || baseName(spec.filename);

  // Pied : tenir en 255 caractères, en retirant des mentions entières.
  const mentions = agencyFooterLine(agency).split('  ·  ');
  while (mentions.length > 1 && mentions.join('  ·  ').length > 170) mentions.pop();
  const piedComplet = `&L&"Calibri,Regular"&7 ${echapperEntetePied(mentions.join('  ·  '))}&R&"Calibri,Bold"&8 P&P|&N`;

  sheets.forEach((sheet, index) => {
    const dataRows = sheet.rows ?? [];
    const colCount = dataRows.reduce((n, r) => Math.max(n, r.length), 1);
    const ws = wb.addWorksheet((sheet.name || `Données${index ? ` ${index + 1}` : ''}`).slice(0, 31), {
      views: [{ showGridLines: false }],
    });
    ws.columns = Array.from({ length: colCount }, (_, c) => {
      const width = dataRows.reduce((max, r) => Math.max(max, String(r?.[c] ?? '').length), 10);
      return { width: Math.min(Math.max(width + 2, 12), 60) };
    });

    // Bandeau d'identité (texte : l'agent n'a pas de logo à placer ici).
    const banner = [
      agency.name || 'Cabinet',
      [agency.address, agency.phone ? `Tél : ${agency.phone}` : '', agency.email].filter(Boolean).join('  ·  '),
      title,
      '',
    ];
    banner.forEach((texte, i) => {
      const row = ws.addRow([texte]);
      if (colCount > 1) ws.mergeCells(row.number, 1, row.number, colCount);
      row.getCell(1).font = { name: 'Calibri', size: i === 0 ? 11 : i === 2 ? 12 : 8, bold: i === 0 || i === 2, color: { argb: i === 1 ? 'FF6B7280' : 'FF111827' } };
    });

    const premiereDonnee = banner.length + 1; // 1-indexé
    dataRows.forEach((r, i) => {
      const row = ws.addRow(r.map(v => v ?? null));
      if (i === 0 && dataRows.length > 1) {
        row.eachCell(cell => {
          cell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3C3C3C' } };
        });
      }
    });

    if (dataRows.length > 1) {
      ws.views = [{ showGridLines: false, state: 'frozen', ySplit: premiereDonnee }];
      ws.autoFilter = { from: { row: premiereDonnee, column: 1 }, to: { row: premiereDonnee + dataRows.length - 1, column: colCount } };
    }
    ws.pageSetup = {
      paperSize: 9, orientation: colCount > 6 ? 'landscape' : 'portrait',
      fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      ...(dataRows.length > 1 ? { printTitlesRow: `${premiereDonnee}:${premiereDonnee}` } : {}),
    };
    // Identité sur la première page seulement : les suivantes portent une ligne.
    ws.headerFooter = {
      differentFirst: true,
      firstHeader: '',
      firstFooter: piedComplet,
      oddHeader: `&L&"Calibri,Bold"&8 ${echapperEntetePied(agency.name || '')}&R&"Calibri,Regular"&8 ${echapperEntetePied(title.slice(0, 90))}`,
      oddFooter: piedComplet,
    };
  });

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer).toString('base64');
}

function buildCsv(spec: ArtifactSpec): string {
  const rows = spec.rows ?? (spec.sheets?.[0]?.rows ?? []);
  const csv = rows.map(r => r.map((c: any) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  // Séparateur point-virgule et BOM sont les attentes d'Excel en français,
  // mais le CSV est aussi lu par des imports tiers : on garde la virgule et
  // on ajoute seulement le BOM, qui suffit à préserver les accents.
  return Buffer.from('﻿' + csv, 'utf-8').toString('base64');
}

export async function generateArtifact(spec: ArtifactSpec, agency: AgencyIdentity = EMPTY_AGENCY): Promise<AgentArtifact> {
  if (spec.type === 'excel') {
    return {
      type: 'excel',
      filename: withExtension(spec.filename, '.xlsx'),
      data: await buildExcel(spec, agency),
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  if (spec.type === 'csv') {
    return {
      type: 'csv',
      filename: withExtension(spec.filename, '.csv'),
      data: buildCsv(spec),
      mimeType: 'text/csv',
    };
  }

  if (spec.type === 'pdf') {
    const buffer = await buildPdf(spec, agency);
    return {
      type: 'pdf',
      filename: withExtension(spec.filename, '.pdf'),
      data: buffer.toString('base64'),
      mimeType: 'application/pdf',
    };
  }

  const buffer = await buildDocx(spec, agency);
  return {
    type: 'docx',
    filename: withExtension(spec.filename, '.docx'),
    data: buffer.toString('base64'),
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
}
