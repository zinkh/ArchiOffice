// jsPDF/docx are only pulled in when an export actually runs (dynamic import
// below) — same lazy-loading convention as meetingExport.ts.
import type { DocumentTemplateVariable } from '../types';

export interface AgencySettings {
  agencyName?: string;
  logoUrl?: string;
  address?: string;
  phone?: string;
  email?: string;
}

function sanitizeFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9_\-]/g, '_');
}

// ── {{key}} substitution ─────────────────────────────────────────────────────

export function fillTemplate(content: string, values: Record<string, string>): string {
  let filled = content;
  for (const [key, value] of Object.entries(values)) {
    filled = filled.split(`{{${key}}}`).join(value ?? '');
  }
  return filled;
}

export function missingRequiredVariables(
  variables: DocumentTemplateVariable[],
  values: Record<string, string>,
): string[] {
  return variables.filter(v => v.required && !values[v.key]?.trim()).map(v => v.label);
}

// ── Restricted-markdown line model ───────────────────────────────────────────
// Supported: "# " / "## " headings, "- " bullets, blank-line paragraph breaks.
// Everything else (including "> " disclaimer lines and markdown tables) renders
// as plain paragraph text — good enough for a working draft, not a full renderer.

type Line = { kind: 'h1' | 'h2' | 'bullet' | 'text'; text: string };

function parseLines(content: string): Line[] {
  const lines: Line[] = [];
  for (const raw of content.split('\n')) {
    const line = raw.trimEnd();
    if (line.startsWith('## ')) lines.push({ kind: 'h2', text: line.slice(3) });
    else if (line.startsWith('# ')) lines.push({ kind: 'h1', text: line.slice(2) });
    else if (line.startsWith('- ')) lines.push({ kind: 'bullet', text: line.slice(2) });
    else lines.push({ kind: 'text', text: line });
  }
  return lines;
}

// ── PDF export ────────────────────────────────────────────────────────────────

export async function exportTemplatePdf(
  title: string,
  filledContent: string,
  settings: AgencySettings,
): Promise<Blob> {
  const { default: jsPDF } = await import('jspdf');
  const pdf = new jsPDF('p', 'mm', 'a4');
  const pageW = 210;
  const pageH = 297;
  const margin = 18;
  const contentW = pageW - margin * 2;
  let y = margin;

  const newPage = () => { pdf.addPage(); y = margin; };
  const ensureSpace = (h: number) => { if (y + h > pageH - margin - 10) newPage(); };

  const applyFont = (style: 'normal' | 'bold' | 'italic', size: number, hex = '#111827') => {
    pdf.setFont('helvetica', style);
    pdf.setFontSize(size);
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    pdf.setTextColor(r, g, b);
  };

  // Header banner (agency letterhead)
  applyFont('bold', 12);
  pdf.text(settings.agencyName || 'Mon Agence', margin, y + 5);
  applyFont('normal', 8, '#6b7280');
  let infoY = y + 10;
  if (settings.address) { pdf.text(settings.address, margin, infoY); infoY += 4; }
  if (settings.phone) { pdf.text(`Tél : ${settings.phone}`, margin, infoY); infoY += 4; }
  if (settings.email) { pdf.text(settings.email, margin, infoY); infoY += 4; }
  y = infoY + 2;

  pdf.setDrawColor(37, 99, 235);
  pdf.setLineWidth(0.6);
  pdf.line(margin, y, pageW - margin, y);
  y += 9;

  applyFont('bold', 15);
  const titleLines = pdf.splitTextToSize(title, contentW) as string[];
  pdf.text(titleLines, margin, y);
  y += titleLines.length * 7 + 4;

  for (const line of parseLines(filledContent)) {
    if (line.kind === 'h1') {
      ensureSpace(10);
      applyFont('bold', 13);
      const wrapped = pdf.splitTextToSize(line.text, contentW) as string[];
      pdf.text(wrapped, margin, y);
      y += wrapped.length * 6.5 + 2;
    } else if (line.kind === 'h2') {
      ensureSpace(9);
      applyFont('bold', 11, '#1e40af');
      const wrapped = pdf.splitTextToSize(line.text, contentW) as string[];
      pdf.text(wrapped, margin, y);
      y += wrapped.length * 5.5 + 2;
    } else if (line.kind === 'bullet') {
      ensureSpace(6);
      applyFont('normal', 9.5);
      const wrapped = pdf.splitTextToSize(`•  ${line.text}`, contentW - 4) as string[];
      pdf.text(wrapped, margin + 2, y);
      y += wrapped.length * 5;
    } else if (line.text.trim() === '') {
      y += 3;
    } else {
      ensureSpace(6);
      applyFont('normal', 9.5);
      const wrapped = pdf.splitTextToSize(line.text, contentW) as string[];
      pdf.text(wrapped, margin, y);
      y += wrapped.length * 5;
    }
  }

  const totalPages = (pdf as any).internal.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    pdf.setPage(p);
    pdf.setDrawColor(209, 213, 219);
    pdf.setLineWidth(0.25);
    pdf.line(margin, pageH - 12, pageW - margin, pageH - 12);
    applyFont('normal', 7, '#9ca3af');
    pdf.text(`${settings.agencyName || ''}  ·  ${title}`, margin, pageH - 7);
    pdf.text(`${p} / ${totalPages}`, pageW - margin, pageH - 7, { align: 'right' });
  }

  return pdf.output('blob');
}

export function downloadPdfBlob(blob: Blob, title: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${sanitizeFilename(title)}.pdf`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── DOCX export ───────────────────────────────────────────────────────────────

export async function exportTemplateDocx(
  title: string,
  filledContent: string,
  settings: AgencySettings,
): Promise<Blob> {
  const { Document, Packer, Paragraph, TextRun, BorderStyle } = await import('docx');

  const agencyParagraphs: InstanceType<typeof Paragraph>[] = [
    new Paragraph({ children: [new TextRun({ text: settings.agencyName || 'Agence', bold: true, size: 24 })] }),
    ...(settings.address ? [new Paragraph({ children: [new TextRun({ text: settings.address, size: 18, color: '6B7280' })] })] : []),
    ...(settings.phone ? [new Paragraph({ children: [new TextRun({ text: `Tél : ${settings.phone}`, size: 18, color: '6B7280' })] })] : []),
    ...(settings.email ? [new Paragraph({ children: [new TextRun({ text: settings.email, size: 18, color: '6B7280' })] })] : []),
  ];

  const bodyParagraphs = parseLines(filledContent).map(line => {
    if (line.kind === 'h1') return new Paragraph({ spacing: { before: 240, after: 120 }, children: [new TextRun({ text: line.text, bold: true, size: 28 })] });
    if (line.kind === 'h2') return new Paragraph({ spacing: { before: 200, after: 100 }, children: [new TextRun({ text: line.text, bold: true, size: 22, color: '1E40AF' })] });
    if (line.kind === 'bullet') return new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: line.text, size: 20 })] });
    if (line.text.trim() === '') return new Paragraph({ children: [], spacing: { after: 80 } });
    return new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: line.text, size: 20 })] });
  });

  const doc = new Document({
    sections: [{
      properties: {},
      children: [
        ...agencyParagraphs,
        new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: '2563EB' } },
          spacing: { before: 160, after: 280 },
          children: [],
        }),
        new Paragraph({ spacing: { after: 320 }, children: [new TextRun({ text: title, bold: true, size: 36, color: '111827' })] }),
        ...bodyParagraphs,
      ],
    }],
  });

  return Packer.toBlob(doc);
}

export function downloadDocxBlob(blob: Blob, title: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${sanitizeFilename(title)}.docx`;
  a.click();
  URL.revokeObjectURL(a.href);
}
