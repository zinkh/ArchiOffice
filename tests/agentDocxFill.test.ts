import { describe, it, expect, vi, afterEach } from 'vitest';
import JSZip from 'jszip';
import { applyDocxEdits, listDocxParagraphs, executeDocxFillTool } from '../packages/archioffice-agents/src/server/docxFillTool';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

// Modèle fictif : un titre, un champ coupé en trois runs, une cellule de tableau, une case, un pied de page.
async function buildTemplate(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types/>');
  zip.file('word/document.xml',
    `<w:document ${W}><w:body>` +
    `<w:p><w:pPr/><w:r><w:rPr><w:b/></w:rPr><w:t>MANDAT</w:t></w:r></w:p>` +
    `<w:p><w:r><w:t xml:space="preserve">Nom du client : </w:t></w:r><w:r><w:t>[CLI</w:t></w:r><w:r><w:t>ENT]</w:t></w:r></w:p>` +
    `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Adresse : ........</w:t></w:r></w:p></w:tc></w:tr></w:tbl>` +
    `<w:p><w:r><w:t>☐ Habitation &amp; bureaux</w:t></w:r></w:p>` +
    `<w:p w14:paraId="0A1B2C3D"/>` +
    `</w:body></w:document>`);
  zip.file('word/footer1.xml', `<w:ftr ${W}><w:p><w:r><w:t>Pied de page</w:t></w:r></w:p></w:ftr>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function readPart(buffer: Buffer, part: string): Promise<string> {
  return (await JSZip.loadAsync(buffer)).file(part)!.async('string');
}

describe('listDocxParagraphs', () => {
  it('rend les paragraphes numérotés du corps, des tableaux et des pieds, sans les vides', async () => {
    const paragraphs = await listDocxParagraphs(await buildTemplate());
    expect(paragraphs.map(p => p.text)).toEqual([
      'MANDAT',
      'Nom du client : [CLIENT]',
      'Adresse : ........',
      '☐ Habitation & bureaux',
      'Pied de page',
    ]);
    // Un paragraphe vide auto-fermé n'avale pas le suivant et ne décale pas la numérotation.
    expect(paragraphs.map(p => p.index)).toEqual([1, 2, 3, 4, 5]);
  });

  it('refuse un fichier qui n’est pas un .docx', async () => {
    await expect(listDocxParagraphs(Buffer.from('pas un zip'))).rejects.toThrow();
  });
});

describe('applyDocxEdits', () => {
  it('remplace un texte coupé en plusieurs runs sans toucher aux autres paragraphes', async () => {
    const template = await buildTemplate();
    const result = await applyDocxEdits(template, [{ paragraph: 2, find: '[CLIENT]', replace: 'SCI Les Tilleuls & Fils' }]);
    expect(result.applied).toBe(1);
    expect(result.notApplied).toEqual([]);
    const xml = await readPart(result.buffer, 'word/document.xml');
    expect(xml).toContain('Nom du client : SCI Les Tilleuls &amp; Fils');
    // Paragraphes non ciblés : identiques à l'origine, mise en forme du titre comprise.
    expect(xml).toContain('<w:r><w:rPr><w:b/></w:rPr><w:t>MANDAT</w:t></w:r>');
    expect(xml).toContain('Adresse : ........');
  });

  it('remplace tout un paragraphe, y compris dans un tableau, et un texte sans numéro de paragraphe', async () => {
    const result = await applyDocxEdits(await buildTemplate(), [
      { paragraph: 3, replace: 'Adresse : 12 rue des Lilas, 54000 Nancy' },
      { find: '☐ Habitation', replace: '☒ Habitation' },
      { find: 'Pied de page', replace: 'AAZS' },
    ]);
    expect(result.applied).toBe(3);
    expect(await readPart(result.buffer, 'word/document.xml')).toContain('Adresse : 12 rue des Lilas, 54000 Nancy');
    expect(await readPart(result.buffer, 'word/document.xml')).toContain('☒ Habitation &amp; bureaux');
    expect(await readPart(result.buffer, 'word/footer1.xml')).toContain('AAZS');
  });

  it('rapporte ce qui ne correspond à rien au lieu de le passer sous silence', async () => {
    const result = await applyDocxEdits(await buildTemplate(), [
      { paragraph: 2, find: '[ABSENT]', replace: 'x' },
      { paragraph: 99, replace: 'x' },
      { find: 'introuvable', replace: 'x' },
      { paragraph: 1, replace: 'MANDAT DE MAÎTRISE D’ŒUVRE' },
    ]);
    expect(result.applied).toBe(1);
    expect(result.notApplied).toHaveLength(3);
    expect(result.notApplied.map(n => n.reason).join(' ')).toMatch(/introuvable dans le paragraphe 2/);
    expect(result.notApplied.map(n => n.reason).join(' ')).toMatch(/Paragraphe 99 inexistant/);
  });

  it('produit un .docx qui se relit', async () => {
    const result = await applyDocxEdits(await buildTemplate(), [{ paragraph: 1, replace: 'TITRE' }]);
    const paragraphs = await listDocxParagraphs(result.buffer);
    expect(paragraphs[0].text).toBe('TITRE');
  });
});

describe('executeDocxFillTool', () => {
  afterEach(() => vi.unstubAllGlobals());

  const auth = { token: 'jeton-fictif' } as any;

  function mockServer(template: Buffer, deposits: { name?: string; project?: string; bytes?: number }[]) {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
      const u = String(url);
      if (u.includes('/api/documents?id=')) {
        return new Response(JSON.stringify([{ id: 'doc-1', name: 'Modèle Mandat.docx', file_url: 'ref://x', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size_bytes: template.length, project_id: 'proj-2608' }]), { status: 200 });
      }
      if (u.includes('/api/storage/signed-url')) return new Response(JSON.stringify({ url: 'https://fichiers.example/modele.docx' }), { status: 200 });
      if (u === 'https://fichiers.example/modele.docx') return new Response(new Uint8Array(template), { status: 200 });
      if (u.endsWith('/api/documents') && init?.method === 'POST') {
        const form = init.body as FormData;
        deposits.push({ name: String(form.get('name')), project: String(form.get('resource_id')), bytes: (form.get('file') as Blob).size });
        return new Response(JSON.stringify({ id: 'nouveau-1', size_bytes: 1234, uploaded_at: '2026-11-26T10:00:00Z' }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }));
  }

  it('inspect rend les paragraphes, fill range un nouveau document sur l’affaire', async () => {
    const template = await buildTemplate();
    const deposits: { name?: string; project?: string; bytes?: number }[] = [];
    mockServer(template, deposits);

    const inspect = await executeDocxFillTool('http://local', auth, ['projects'], { action: 'inspect', document_id: 'doc-1' });
    expect((inspect.response as any).nb_paragraphes).toBe(5);

    const fill = await executeDocxFillTool('http://local', auth, ['projects'], {
      action: 'fill', document_id: 'doc-1', project_id: 'proj-2608',
      edits: [{ paragraph: 2, find: '[CLIENT]', replace: 'SCI Les Tilleuls' }],
    });
    expect((fill.response as any).modifications_appliquees).toBe(1);
    expect(deposits).toHaveLength(1);
    expect(deposits[0].name).toBe('Modèle Mandat - rempli.docx');
    expect(deposits[0].project).toBe('proj-2608');
  });

  it('refuse d’écrire sans le droit sur les opérations, et ne dépose rien', async () => {
    const template = await buildTemplate();
    const deposits: { name?: string }[] = [];
    mockServer(template, deposits);
    const result = await executeDocxFillTool('http://local', auth, [], {
      action: 'fill', document_id: 'doc-1', project_id: 'proj-2608', edits: [{ paragraph: 1, replace: 'x' }],
    });
    expect((result.response as any).error).toMatch(/pas activé/);
    expect(deposits).toHaveLength(0);
  });

  it('refuse un fichier qui n’est pas un .docx', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([{ id: 'doc-2', name: 'plan.pdf', mime_type: 'application/pdf' }]), { status: 200 })));
    const result = await executeDocxFillTool('http://local', auth, ['projects'], { action: 'inspect', document_id: 'doc-2' });
    expect((result.response as any).error).toMatch(/Seuls les modèles Word/);
  });
});
