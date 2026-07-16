// jsPDF/docx are only pulled in when an export actually runs (dynamic
// import below) — they're sizable libraries that shouldn't ship with every
// page that merely links to a meeting export button.
import type { Paragraph, TextRun, ImageRun, Table, TableRow } from 'docx';
import type { Meeting, MeetingAttendee } from '../types';

// ── Public types ──────────────────────────────────────────────────────────────

export interface AgencySettings {
  agencyName?: string;
  logoUrl?: string;
  address?: string;
  phone?: string;
  email?: string;
}

const SUBSECTION_LABELS: Record<string, string> = {
  projet: 'Réunion de projet',
  visite_candidature: 'Visite candidature',
  visite_proposition: 'Visite proposition',
};

function formatDate(iso: string) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
}

function attendeeName(att: MeetingAttendee): string {
  const c = att.contact;
  if (!c) return 'Inconnu';
  return [c.first_name, c.last_name].filter(Boolean).join(' ') || c.company_name || 'Sans nom';
}

function sanitizeFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9_\-]/g, '_');
}

// ── Image compression ─────────────────────────────────────────────────────────

interface CompressedImage {
  base64: string;   // JPEG base64 without data-URL prefix
  dataUrl: string;  // Full data-URL
  buffer: ArrayBuffer;
  w: number;        // actual pixel width after resize
  h: number;        // actual pixel height after resize
}

async function compressImage(
  url: string,
  maxW: number,
  maxH: number,
  quality = 0.72,
): Promise<CompressedImage | null> {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      const ratio = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1);
      const w = Math.round(img.naturalWidth * ratio);
      const h = Math.round(img.naturalHeight * ratio);

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);

      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      const base64 = dataUrl.split(',')[1];

      // Convert to ArrayBuffer for docx
      const bin = atob(base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

      resolve({ base64, dataUrl, buffer: bytes.buffer, w, h });
    };

    img.onerror = () => resolve(null);
    img.src = url;
  });
}

// ── PDF export ────────────────────────────────────────────────────────────────

export async function exportMeetingToPDF(
  meeting: Meeting,
  attendees: MeetingAttendee[],
  settings: AgencySettings,
  projectName: string,
): Promise<void> {
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

  // ── Header ─────────────────────────────────────────────────────────────────
  let headerH = 20;
  let logoW = 0;

  if (settings.logoUrl) {
    const logo = await compressImage(settings.logoUrl, 400, 400, 0.92);
    if (logo) {
      const lH = 18;
      logoW = Math.round((logo.w / logo.h) * lH);
      pdf.addImage(logo.dataUrl, 'JPEG', margin, y, logoW, lH);
    }
  }

  const textX = margin + (logoW > 0 ? logoW + 6 : 0);
  applyFont('bold', 12);
  pdf.text(settings.agencyName || 'Mon Agence', textX, y + 5);
  applyFont('normal', 8, '#6b7280');
  let infoY = y + 10;
  if (settings.address) { pdf.text(settings.address, textX, infoY); infoY += 4; }
  if (settings.phone) { pdf.text(`Tél : ${settings.phone}`, textX, infoY); infoY += 4; }
  if (settings.email) { pdf.text(settings.email, textX, infoY); infoY += 4; }
  headerH = Math.max(headerH, infoY - y + 2);

  y += headerH;

  // Blue rule
  pdf.setDrawColor(37, 99, 235);
  pdf.setLineWidth(0.6);
  pdf.line(margin, y, pageW - margin, y);
  y += 7;

  // ── Meeting title & meta ───────────────────────────────────────────────────
  applyFont('bold', 16);
  const titleLines = pdf.splitTextToSize(meeting.title, contentW) as string[];
  pdf.text(titleLines, margin, y);
  y += titleLines.length * 8;

  applyFont('normal', 9, '#6b7280');
  const typeLabel = SUBSECTION_LABELS[meeting.type] || meeting.type;
  pdf.text(`${typeLabel}  ·  ${projectName}  ·  ${formatDate(meeting.date)}`, margin, y);
  y += 9;

  // ── Attendees ─────────────────────────────────────────────────────────────
  if (attendees.length > 0) {
    ensureSpace(14);
    applyFont('bold', 10);
    pdf.text('Intervenants', margin, y);
    y += 5;

    const rowH = 7;
    const col1 = 68, col2 = 54;
    const headerRowY = y;

    // Header row background
    pdf.setFillColor(239, 246, 255);
    pdf.rect(margin, y, contentW, rowH, 'F');
    applyFont('bold', 8, '#1e40af');
    pdf.text('Nom', margin + 2, y + 5);
    pdf.text('Rôle / Entreprise', margin + col1 + 2, y + 5);
    pdf.text('Contact', margin + col1 + col2 + 2, y + 5);
    y += rowH;

    for (let i = 0; i < attendees.length; i++) {
      ensureSpace(rowH + 2);
      const att = attendees[i];
      if (i % 2 === 0) {
        pdf.setFillColor(249, 250, 251);
        pdf.rect(margin, y, contentW, rowH, 'F');
      }
      applyFont('normal', 8);
      const c = att.contact;
      const phone = c?.phone_mobile || c?.phone_work || c?.phone || '';
      const email = c?.email || c?.email_work || '';
      const contactStr = [phone, email].filter(Boolean).join('  ');
      pdf.text((pdf.splitTextToSize(attendeeName(att), col1 - 4) as string[])[0], margin + 2, y + 5);
      pdf.text((pdf.splitTextToSize(att.role || '', col2 - 4) as string[])[0], margin + col1 + 2, y + 5);
      pdf.text((pdf.splitTextToSize(contactStr, contentW - col1 - col2 - 4) as string[])[0], margin + col1 + col2 + 2, y + 5);
      y += rowH;
    }

    // Border around whole table
    pdf.setDrawColor(209, 213, 219);
    pdf.setLineWidth(0.25);
    pdf.rect(margin, headerRowY, contentW, rowH * (attendees.length + 1));
    y += 7;
  }

  // ── Notes ─────────────────────────────────────────────────────────────────
  if (meeting.notes?.trim()) {
    ensureSpace(12);
    applyFont('bold', 10);
    pdf.text('Notes de réunion', margin, y);
    y += 5;
    applyFont('normal', 9);
    const lineH = 5;
    const lines = pdf.splitTextToSize(meeting.notes, contentW) as string[];
    for (const line of lines) {
      ensureSpace(lineH + 1);
      pdf.text(line, margin, y);
      y += lineH;
    }
    y += 5;
  }

  // ── Photos grid ───────────────────────────────────────────────────────────
  const photos = meeting.photos || [];
  if (photos.length > 0) {
    ensureSpace(14);
    applyFont('bold', 10);
    pdf.text(`Photos (${photos.length})`, margin, y);
    y += 6;

    const COLS = 3;
    const GAP = 3;
    const thumbW = (contentW - GAP * (COLS - 1)) / COLS; // ~55mm
    const captionH = 4.5;

    let col = 0;
    let rowY = y;

    for (const photo of photos) {
      // Estimate row height before loading image
      const thumbH = thumbW * 0.75;
      const slotH = thumbH + captionH + GAP;

      if (col === 0) {
        ensureSpace(slotH + 2);
        rowY = y;
      }

      const compressed = await compressImage(photo.file_url, 360, 270, 0.65);
      if (compressed) {
        const aspect = compressed.h / compressed.w;
        const actualH = thumbW * aspect;
        const x = margin + col * (thumbW + GAP);

        // White background + subtle border
        pdf.setFillColor(248, 248, 248);
        pdf.roundedRect(x - 0.5, rowY - 0.5, thumbW + 1, actualH + 1, 1, 1, 'F');
        pdf.addImage(compressed.dataUrl, 'JPEG', x, rowY, thumbW, actualH);

        if (photo.caption) {
          applyFont('italic', 7, '#6b7280');
          pdf.text((pdf.splitTextToSize(photo.caption, thumbW) as string[])[0], x, rowY + actualH + 3);
        }

        // Advance to next cell
        col++;
        if (col >= COLS) {
          col = 0;
          // Move y past this row
          y = rowY + thumbW * 0.75 + captionH + GAP + 2;
          rowY = y;
        }
      }
    }
    // If last row wasn't complete
    if (col > 0) {
      y = rowY + thumbW * 0.75 + captionH + GAP + 2;
    }
  }

  // ── Footer on every page ──────────────────────────────────────────────────
  const totalPages = (pdf as any).internal.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    pdf.setPage(p);
    pdf.setDrawColor(209, 213, 219);
    pdf.setLineWidth(0.25);
    pdf.line(margin, pageH - 12, pageW - margin, pageH - 12);
    applyFont('normal', 7, '#9ca3af');
    pdf.text(
      `${settings.agencyName || ''}  ·  ${meeting.title}  ·  ${formatDate(meeting.date)}`,
      margin, pageH - 7,
    );
    pdf.text(`${p} / ${totalPages}`, pageW - margin, pageH - 7, { align: 'right' });
  }

  const filename = `reunion_${sanitizeFilename(meeting.title)}_${meeting.date}.pdf`;
  pdf.save(filename);
}

// ── DOCX export ───────────────────────────────────────────────────────────────

// docx transformation values are in pixels (library handles EMU conversion internally)
// 1 inch = 96px; 1mm ≈ 3.78px at 96dpi
const MM_TO_PX = 3.78;

export async function exportMeetingToDocx(
  meeting: Meeting,
  attendees: MeetingAttendee[],
  settings: AgencySettings,
  projectName: string,
): Promise<void> {
  const {
    Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell,
    WidthType, BorderStyle, ShadingType,
  } = await import('docx');

  const NO_BORDER = {
    top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  };

  const typeLabel = SUBSECTION_LABELS[meeting.type] || meeting.type;

  // ── Logo ─────────────────────────────────────────────────────────────────
  const logoChildren: (TextRun | ImageRun)[] = [];
  if (settings.logoUrl) {
    const logo = await compressImage(settings.logoUrl, 400, 400, 0.92);
    if (logo) {
      const targetH = 40; // px
      const targetW = Math.round((logo.w / logo.h) * targetH);
      logoChildren.push(new ImageRun({
        type: 'jpg',
        data: logo.buffer,
        transformation: { width: targetW, height: targetH },
      }));
    }
  }
  if (logoChildren.length === 0) {
    logoChildren.push(new TextRun({ text: settings.agencyName || 'Agence', bold: true, size: 28 }));
  }

  // ── Agency info paragraphs ───────────────────────────────────────────────
  const agencyParagraphs: Paragraph[] = [
    new Paragraph({ children: logoChildren }),
    ...(settings.agencyName
      ? [new Paragraph({ children: [new TextRun({ text: settings.agencyName, bold: true, size: 24 })] })]
      : []),
    ...(settings.address
      ? [new Paragraph({ children: [new TextRun({ text: settings.address, size: 18, color: '6B7280' })] })]
      : []),
    ...(settings.phone
      ? [new Paragraph({ children: [new TextRun({ text: `Tél : ${settings.phone}`, size: 18, color: '6B7280' })] })]
      : []),
    ...(settings.email
      ? [new Paragraph({ children: [new TextRun({ text: settings.email, size: 18, color: '6B7280' })] })]
      : []),
  ];

  // ── Attendees table ───────────────────────────────────────────────────────
  const attendeeRows: TableRow[] = [];
  if (attendees.length > 0) {
    attendeeRows.push(
      new TableRow({
        children: [
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: 'Nom', bold: true, size: 18 })] })],
            shading: { type: ShadingType.SOLID, color: 'EFF6FF' },
            width: { size: 34, type: WidthType.PERCENTAGE },
          }),
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: 'Rôle / Entreprise', bold: true, size: 18 })] })],
            shading: { type: ShadingType.SOLID, color: 'EFF6FF' },
            width: { size: 33, type: WidthType.PERCENTAGE },
          }),
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: 'Contact', bold: true, size: 18 })] })],
            shading: { type: ShadingType.SOLID, color: 'EFF6FF' },
            width: { size: 33, type: WidthType.PERCENTAGE },
          }),
        ],
      }),
    );
    attendees.forEach((att, i) => {
      const c = att.contact;
      const phone = c?.phone_mobile || c?.phone_work || c?.phone || '';
      const email = c?.email || c?.email_work || '';
      const shading = i % 2 === 0
        ? { type: ShadingType.SOLID, color: 'F9FAFB' }
        : undefined;
      attendeeRows.push(
        new TableRow({
          children: [
            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: attendeeName(att), size: 18 })] })], shading, width: { size: 34, type: WidthType.PERCENTAGE } }),
            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: att.role || '', size: 18 })] })], shading, width: { size: 33, type: WidthType.PERCENTAGE } }),
            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: [phone, email].filter(Boolean).join('  '), size: 18 })] })], shading, width: { size: 33, type: WidthType.PERCENTAGE } }),
          ],
        }),
      );
    });
  }

  // ── Photo grid (3 per row) ────────────────────────────────────────────────
  const photoSectionChildren: (Paragraph | Table)[] = [];
  const photos = meeting.photos || [];

  if (photos.length > 0) {
    photoSectionChildren.push(new Paragraph({
      children: [new TextRun({ text: `Photos (${photos.length})`, bold: true, size: 24 })],
      spacing: { before: 400, after: 200 },
    }));

    // Target: ~57mm per column at A4 (usable ~170mm with 2x20mm margins, 3 cols + 2x3mm gaps → 54mm each)
    const THUMB_W_MM = 54;
    const THUMB_W_PX = Math.round(THUMB_W_MM * MM_TO_PX); // ~204px

    // Compress all photos first
    const compressedPhotos: Array<{ img: CompressedImage; caption?: string } | null> = [];
    for (const photo of photos) {
      const img = await compressImage(photo.file_url, 360, 270, 0.65);
      compressedPhotos.push(img ? { img, caption: photo.caption } : null);
    }

    const COLS = 3;
    for (let i = 0; i < compressedPhotos.length; i += COLS) {
      const chunk = compressedPhotos.slice(i, i + COLS);
      // Pad to COLS
      while (chunk.length < COLS) chunk.push(null);

      const cells = chunk.map(item => {
        const cellChildren: Paragraph[] = [];
        if (item) {
          const aspect = item.img.h / item.img.w;
          const thumbW = THUMB_W_PX;
          const thumbH = Math.round(thumbW * aspect);
          cellChildren.push(new Paragraph({
            children: [
              new ImageRun({
                type: 'jpg',
                data: item.img.buffer,
                transformation: { width: thumbW, height: thumbH },
              }),
            ],
          }));
          if (item.caption) {
            cellChildren.push(new Paragraph({
              children: [new TextRun({ text: item.caption, italics: true, size: 16, color: '6B7280' })],
            }));
          }
        } else {
          cellChildren.push(new Paragraph({ children: [] }));
        }
        return new TableCell({
          children: cellChildren,
          borders: NO_BORDER,
          width: { size: 33, type: WidthType.PERCENTAGE },
        });
      });

      photoSectionChildren.push(new Table({
        rows: [new TableRow({ children: cells })],
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: {
          top: { style: BorderStyle.NONE, size: 0 },
          bottom: { style: BorderStyle.NONE, size: 0 },
          left: { style: BorderStyle.NONE, size: 0 },
          right: { style: BorderStyle.NONE, size: 0 },
          insideHorizontal: { style: BorderStyle.NONE, size: 0 },
          insideVertical: { style: BorderStyle.NONE, size: 0 },
        },
      }));
      // Spacing between rows
      photoSectionChildren.push(new Paragraph({ children: [], spacing: { after: 120 } }));
    }
  }

  // ── Assemble document ─────────────────────────────────────────────────────
  const doc = new Document({
    sections: [{
      properties: {},
      children: [
        // Agency header
        ...agencyParagraphs,

        // Separator (bottom border on empty paragraph)
        new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: '2563EB' } },
          spacing: { before: 160, after: 280 },
          children: [],
        }),

        // Meeting title
        new Paragraph({
          spacing: { after: 80 },
          children: [new TextRun({ text: meeting.title, bold: true, size: 40, color: '111827' })],
        }),

        // Type · project · date
        new Paragraph({
          spacing: { after: 360 },
          children: [
            new TextRun({ text: `${typeLabel}  ·  ${projectName}  ·  ${formatDate(meeting.date)}`, size: 18, color: '6B7280' }),
          ],
        }),

        // Intervenants
        ...(attendees.length > 0 ? [
          new Paragraph({
            spacing: { before: 200, after: 160 },
            children: [new TextRun({ text: 'Intervenants', bold: true, size: 24 })],
          }),
          new Table({
            rows: attendeeRows,
            width: { size: 100, type: WidthType.PERCENTAGE },
          }),
          new Paragraph({ children: [], spacing: { after: 320 } }),
        ] : []),

        // Notes
        ...(meeting.notes?.trim() ? [
          new Paragraph({
            spacing: { before: 200, after: 160 },
            children: [new TextRun({ text: 'Notes de réunion', bold: true, size: 24 })],
          }),
          ...meeting.notes.split('\n').map(line =>
            new Paragraph({
              children: [new TextRun({ text: line, size: 20 })],
              spacing: { after: 80 },
            }),
          ),
          new Paragraph({ children: [], spacing: { after: 280 } }),
        ] : []),

        // Photos
        ...photoSectionChildren,
      ],
    }],
  });

  const blob = await Packer.toBlob(doc);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `reunion_${sanitizeFilename(meeting.title)}_${meeting.date}.docx`;
  a.click();
  URL.revokeObjectURL(a.href);
}
