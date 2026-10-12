import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { appendAttachments, attachmentKind, checkAttachment, fitImage, MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES } from '../pdfAttachments';

async function pdfWithPages(n: number): Promise<Blob> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < n; i++) doc.addPage([595, 842]);
  return new Blob([await doc.save()], { type: 'application/pdf' });
}

const file = (bytes: BlobPart, name: string, type: string) => new File([bytes], name, { type });

describe('attachmentKind', () => {
  it('reconnaît les PDF et images par type ou par extension', () => {
    expect(attachmentKind({ name: 'a.PDF' })).toBe('pdf');
    expect(attachmentKind({ name: 'x', type: 'image/jpeg' })).toBe('jpeg');
    expect(attachmentKind({ name: 'x.png' })).toBe('png');
    expect(attachmentKind({ name: 'x.docx' })).toBeNull();
  });
});

describe('checkAttachment', () => {
  it('accepte un PDF raisonnable', () => {
    expect(checkAttachment({ name: 'opc.pdf', size: 1000 }, 0)).toEqual({ ok: true, kind: 'pdf' });
  });
  it('refuse un format inconnu, un fichier vide, trop gros ou au-delà du nombre maximal', () => {
    expect(checkAttachment({ name: 'a.docx', size: 10 }, 0).ok).toBe(false);
    expect(checkAttachment({ name: 'a.pdf', size: 0 }, 0).ok).toBe(false);
    expect(checkAttachment({ name: 'a.pdf', size: MAX_ATTACHMENT_BYTES + 1 }, 0).ok).toBe(false);
    expect(checkAttachment({ name: 'a.pdf', size: 10 }, MAX_ATTACHMENTS).ok).toBe(false);
  });
});

describe('fitImage', () => {
  it("n'agrandit pas une petite image et la centre", () => {
    const r = fitImage(100, 50, 600, 800);
    expect(r.w).toBe(100);
    expect(r.x).toBe(250);
  });
  it('réduit une grande image dans la zone utile', () => {
    const r = fitImage(3000, 2000, 842, 595);
    expect(r.w).toBeLessThanOrEqual(842 - 56);
    expect(r.h).toBeLessThanOrEqual(595 - 56);
  });
});

describe('appendAttachments', () => {
  it('rend le PDF tel quel sans pièce jointe', async () => {
    const base = await pdfWithPages(2);
    expect(await appendAttachments(base, [])).toBe(base);
  });

  it('ajoute les pages des PDF joints après celles du compte-rendu', async () => {
    const base = await pdfWithPages(2);
    const opc = await pdfWithPages(3);
    const merged = await appendAttachments(base, [file(await opc.arrayBuffer(), 'opc.pdf', 'application/pdf')]);
    const doc = await PDFDocument.load(await merged.arrayBuffer());
    expect(doc.getPageCount()).toBe(5);
  });

  it('pose une image sur une page A4 dédiée', async () => {
    const base = await pdfWithPages(1);
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));
    const merged = await appendAttachments(base, [file(png, 'photo.png', 'image/png')]);
    const doc = await PDFDocument.load(await merged.arrayBuffer());
    expect(doc.getPageCount()).toBe(2);
  });

  it('nomme le fichier illisible', async () => {
    const base = await pdfWithPages(1);
    await expect(appendAttachments(base, [file('pas un pdf', 'casse.pdf', 'application/pdf')]))
      .rejects.toThrow(/casse\.pdf/);
  });
});
