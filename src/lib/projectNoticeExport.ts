import type { Project } from '../types';
import type { AgencySettings } from './proposalExport';
import type { ProjectNotice } from './projectNotices';
import { projectNoticeTitle } from './projectNotices';
import { agencyFooterLine, drawAgencyFooters, drawAgencyHeader, loadLogoDataUrl } from './pdfLetterhead';

const TEXT: [number, number, number] = [17, 24, 39];
const MUTED: [number, number, number] = [107, 114, 128];
const RULE: [number, number, number] = [209, 213, 219];

function safeName(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
}

function fileName(project: Partial<Project>, notice: ProjectNotice, ext: 'pdf' | 'docx'): string {
  const base = [projectNoticeTitle(notice.kind, notice.phase), project.name].filter(Boolean).join(' - ');
  return `${safeName(base) || 'notice'}.${ext}`;
}

function isHeading(line: string): boolean {
  return /^\s*\d+(?:\.\d+)*[.)]?\s+\S/.test(line);
}

export async function exportProjectNoticePdf(
  project: Partial<Project>,
  notice: ProjectNotice,
  settings: AgencySettings,
): Promise<void> {
  const { default: jsPDF } = await import('jspdf');
  const pdf = new jsPDF('p', 'mm', 'a4');
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 18;
  const contentW = pageW - margin * 2;
  const bottom = pageH - 19;
  const title = projectNoticeTitle(notice.kind, notice.phase);
  const logo = await loadLogoDataUrl(settings.logoUrl);
  const letterhead = {
    title,
    subtitle: project.name || '',
    reference: project.project_code || project.reference || '',
    margin,
    logo,
  };

  let y = drawAgencyHeader(pdf, settings, letterhead);
  const resetPage = () => { pdf.addPage(); y = drawAgencyHeader(pdf, settings, letterhead); };
  const ensure = (height: number) => { if (y + height > bottom) resetPage(); };
  const font = (style: 'normal' | 'bold' | 'italic', size: number, color = TEXT) => {
    pdf.setFont('helvetica', style);
    pdf.setFontSize(size);
    pdf.setTextColor(...color);
  };

  y += 10;
  font('bold', 18);
  const titleLines = pdf.splitTextToSize(title, contentW) as string[];
  pdf.text(titleLines, margin, y);
  y += titleLines.length * 7 + 2;

  if (project.name) {
    font('normal', 11, MUTED);
    const projectLines = pdf.splitTextToSize(project.name, contentW) as string[];
    pdf.text(projectLines, margin, y);
    y += projectLines.length * 5 + 3;
  }

  const location = [(project as any).adresse_terrain || project.address, (project as any).site_city].filter(Boolean).join(' · ');
  if (location) {
    font('normal', 9, MUTED);
    pdf.text(pdf.splitTextToSize(location, contentW), margin, y);
    y += 7;
  }

  pdf.setDrawColor(...RULE);
  pdf.setLineWidth(0.3);
  pdf.line(margin, y, pageW - margin, y);
  y += 8;

  const lines = (notice.content || '').split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { y += 2.5; continue; }
    const heading = isHeading(line);
    const bullet = /^\s*[-•]\s+/.test(line);
    const text = bullet ? line.replace(/^\s*[-•]\s+/, '') : line.trim();
    const indent = bullet ? 5 : 0;
    const wrapped = pdf.splitTextToSize(text, contentW - indent) as string[];
    ensure((wrapped.length + 1) * (heading ? 5.5 : 4.8));
    font(heading ? 'bold' : 'normal', heading ? 11 : 9.5, heading ? TEXT : TEXT);
    wrapped.forEach((part, index) => {
      ensure(5.5);
      if (bullet && index === 0) pdf.text('•', margin + 1, y);
      pdf.text(part, margin + indent, y);
      y += heading ? 5.5 : 4.8;
    });
    y += heading ? 2.2 : 1.2;
  }

  if (notice.generated_at) {
    ensure(10);
    y += 5;
    font('italic', 7.5, MUTED);
    pdf.text('Document de travail généré avec assistance IA — à relire et valider par le maître d’œuvre.', margin, y);
  }

  drawAgencyFooters(pdf, settings, letterhead);
  pdf.save(fileName(project, notice, 'pdf'));
}

export async function exportProjectNoticeDocx(
  project: Partial<Project>,
  notice: ProjectNotice,
  settings: AgencySettings,
): Promise<void> {
  const {
    Document, Packer, Paragraph, TextRun, Header, Footer, PageNumber,
    AlignmentType, HeadingLevel, BorderStyle,
  } = await import('docx');

  const title = projectNoticeTitle(notice.kind, notice.phase);
  const header = new Header({
    children: [
      new Paragraph({ children: [new TextRun({ text: settings.agencyName || '', bold: true, size: 20, color: '111827' })] }),
      new Paragraph({
        border: { bottom: { style: BorderStyle.SINGLE, size: 5, color: 'D1D5DB' } },
        children: [new TextRun({
          text: [settings.address, settings.phone, settings.email].filter(Boolean).join(' · '),
          size: 15, color: '6B7280',
        })],
      }),
    ],
  });

  const footer = new Footer({
    children: [
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
    ],
  });

  const body: InstanceType<typeof Paragraph>[] = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      spacing: { before: 500, after: 120 },
      children: [new TextRun({ text: title, bold: true, size: 40, color: '111827' })],
    }),
  ];
  if (project.name) {
    body.push(new Paragraph({
      spacing: { after: 100 },
      children: [new TextRun({ text: project.name, size: 24, color: '6B7280' })],
    }));
  }
  const location = [(project as any).adresse_terrain || project.address, (project as any).site_city].filter(Boolean).join(' · ');
  if (location) {
    body.push(new Paragraph({
      spacing: { after: 300 },
      children: [new TextRun({ text: location, size: 18, color: '6B7280' })],
    }));
  }

  for (const raw of (notice.content || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const heading = isHeading(line);
    const bullet = /^[-•]\s+/.test(line);
    const text = bullet ? line.replace(/^[-•]\s+/, '') : line;
    body.push(new Paragraph({
      ...(heading ? { heading: HeadingLevel.HEADING_2 } : {}),
      ...(bullet ? { bullet: { level: 0 } } : {}),
      spacing: { before: heading ? 160 : 0, after: heading ? 100 : 80 },
      children: [new TextRun({ text, bold: heading, size: heading ? 23 : 20, color: '111827' })],
    }));
  }

  if (notice.generated_at) {
    body.push(new Paragraph({
      spacing: { before: 260 },
      children: [new TextRun({
        text: 'Document de travail généré avec assistance IA — à relire et valider par le maître d’œuvre.',
        italics: true, size: 16, color: '6B7280',
      })],
    }));
  }

  const doc = new Document({
    sections: [{ properties: {}, headers: { default: header }, footers: { default: footer }, children: body }],
  });
  const blob = await Packer.toBlob(doc);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName(project, notice, 'docx');
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
