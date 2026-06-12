import * as XLSX from 'xlsx';
import type { AgentArtifact } from '../types.js';

export interface ArtifactSpec {
  type: 'excel' | 'csv' | 'docx';
  filename: string;
  sheets?: { name: string; rows: any[][] }[];
  rows?: any[][];
  content?: string;
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

export function generateArtifact(spec: ArtifactSpec): AgentArtifact {
  if (spec.type === 'excel') {
    const wb = XLSX.utils.book_new();
    const sheets = spec.sheets ?? [{ name: 'Données', rows: spec.rows ?? [] }];
    for (const sheet of sheets) {
      const ws = XLSX.utils.aoa_to_sheet(sheet.rows);
      // Bold header row
      const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1');
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r: 0, c })];
        if (cell) cell.s = { font: { bold: true } };
      }
      XLSX.utils.book_append_sheet(wb, ws, sheet.name);
    }
    const data = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' }) as string;
    return {
      type: 'excel',
      filename: spec.filename.endsWith('.xlsx') ? spec.filename : spec.filename + '.xlsx',
      data,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  if (spec.type === 'csv') {
    const rows = spec.rows ?? (spec.sheets?.[0]?.rows ?? []);
    const csv = rows.map(r => r.map((c: any) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const data = Buffer.from(csv, 'utf-8').toString('base64');
    return {
      type: 'csv',
      filename: spec.filename.endsWith('.csv') ? spec.filename : spec.filename + '.csv',
      data,
      mimeType: 'text/csv',
    };
  }

  // docx — plain text wrapped in minimal Word XML
  const content = spec.content ?? '';
  const paragraphs = content.split('\n').map(line => {
    const isHeading = line.startsWith('# ');
    const text = line.replace(/^#+\s*/, '').replace(/\*\*(.*?)\*\*/g, '$1');
    const style = isHeading ? 'Heading1' : 'Normal';
    return `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
  }).join('');

  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${paragraphs}<w:sectPr/></w:body>
</w:document>`;

  const data = Buffer.from(xml, 'utf-8').toString('base64');
  return {
    type: 'docx',
    filename: spec.filename.endsWith('.docx') ? spec.filename : spec.filename + '.docx',
    data,
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
}

function escapeXml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
