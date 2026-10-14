import { describe, it, expect } from 'vitest';
import { Packer, Document, Paragraph, TextRun } from 'docx';
import { docxSectionChrome } from '../docxRunningHeader';

describe('docxSectionChrome', () => {
  it('sépare la première page des suivantes : deux en-têtes, un pied commun', async () => {
    const chrome = await docxSectionChrome({
      agencyName: 'AAZS', documentTitle: 'CCTP Villa Martin',
      firstHeader: [new Paragraph({ children: [new TextRun('LOGO ET COORDONNEES')] })],
      footer: [new Paragraph({ children: [new TextRun('PIED')] })],
    });
    expect(chrome.properties.titlePage).toBe(true);
    expect(chrome.headers.first).toBeDefined();
    expect(chrome.headers.default).toBeDefined();
    expect(chrome.footers?.first).toBeDefined();

    const blob = await Packer.toBuffer(new Document({ sections: [{ ...chrome, children: [new Paragraph('corps')] }] }));
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(blob);
    const xmls = await Promise.all(Object.keys(zip.files).filter(f => /word\/header\d+\.xml$/.test(f)).map(f => zip.files[f].async('string')));
    const premier = xmls.find(x => x.includes('LOGO ET COORDONNEES'))!;
    const suivant = xmls.find(x => x.includes('CCTP Villa Martin'))!;
    expect(premier).toBeDefined();
    expect(suivant).toContain('AAZS');
    expect(suivant).not.toContain('LOGO ET COORDONNEES');
  });

  it('laisse la première page sans en-tête quand le corps porte déjà le sien', async () => {
    const chrome = await docxSectionChrome({ agencyName: 'AAZS', documentTitle: 'Réunion' });
    expect(chrome.footers).toBeUndefined();
    expect(chrome.headers.first).toBeDefined();
  });
});
