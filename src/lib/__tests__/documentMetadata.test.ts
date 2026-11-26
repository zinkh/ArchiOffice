import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { readDocumentMetadata, emetteurCandidates, isGenericName, EMPTY_METADATA } from '../documentMetadata';

async function docx(core: string, app = ''): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('docProps/core.xml', core);
  if (app) zip.file('docProps/app.xml', app);
  return zip.generateAsync({ type: 'uint8array' });
}

describe('readDocumentMetadata', () => {
  it('lit auteur, titre et logiciel d\'un PDF', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    pdf.setAuthor('Bureau Veritas');
    pdf.setTitle('Rapport initial');
    const meta = await readDocumentMetadata(await pdf.save(), 'rapport.pdf');
    expect(meta?.author).toBe('Bureau Veritas');
    expect(meta?.title).toBe('Rapport initial');
  });

  it('lit société et auteurs d\'un fichier Word, entités XML décodées', async () => {
    const bytes = await docx(
      '<cp:coreProperties><dc:creator>Dupont &amp; Fils</dc:creator><cp:lastModifiedBy>Marie Curie</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">2026-01-02T10:00:00Z</dcterms:created></cp:coreProperties>',
      '<Properties><Company>COPAS Systèmes</Company><Application>Microsoft Office Word</Application></Properties>',
    );
    const meta = await readDocumentMetadata(bytes, 'note.docx');
    expect(meta).toMatchObject({ author: 'Dupont & Fils', lastModifiedBy: 'Marie Curie', organization: 'COPAS Systèmes', createdAt: '2026-01-02T10:00:00Z' });
  });

  it('rend null pour un type non pris en charge, un fichier vide ou corrompu', async () => {
    expect(await readDocumentMetadata(new Uint8Array([1, 2, 3]), 'plan.dwg')).toBeNull();
    expect(await readDocumentMetadata(new Uint8Array(), 'a.pdf')).toBeNull();
    expect(await readDocumentMetadata(new Uint8Array([1, 2, 3, 4]), 'a.pdf')).toBeNull();
    expect(await readDocumentMetadata(new Uint8Array([1, 2, 3, 4]), 'a.docx')).toBeNull();
  });
});

describe('emetteurCandidates', () => {
  it('classe société, auteur, dernier auteur sans doublon ni valeur générique', () => {
    expect(emetteurCandidates({ ...EMPTY_METADATA, organization: 'COPAS', author: 'copas', lastModifiedBy: 'Marie Curie' }))
      .toEqual(['COPAS', 'Marie Curie']);
    expect(emetteurCandidates({ ...EMPTY_METADATA, author: 'admin', lastModifiedBy: 'Microsoft Office User' })).toEqual([]);
    expect(emetteurCandidates(null)).toEqual([]);
  });
  it('reconnaît les noms génériques', () => {
    expect(isGenericName('Utilisateur')).toBe(true);
    expect(isGenericName('Adobe Acrobat 9')).toBe(true);
    expect(isGenericName('Cabinet Martin')).toBe(false);
  });
});
