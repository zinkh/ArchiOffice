// Archive d'export Notion : src/lib/kbNotionZip.ts (CSV et pages Markdown d'une base « Fabricants »).
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { kbContentToText } from '../kb';
import { buildImportRows, proposeImportColumns } from '../kbImport';
import { parseCsv } from '../csvDecode';
import { attachNotionPages, notionCsvLabel, readNotionArchive, stripNotionId, stripNotionPageHeader } from '../kbNotionZip';

const ID_A = '0123456789abcdef0123456789abcdef';
const ID_B = 'fedcba9876543210fedcba9876543210';
const ID_C = '11111111222222223333333344444444';

const CSV = 'Nom,Produits,Texte\n"La Rochère","Construction vitrée, Pavés de verre","123 Rue de La Rochère"\nSOTTAS,"Construction vitrée, Structure métallique","Rue de la Gare 12"\nFPEE,Menuiseries Extérieures Al,"2 rue Henri Vallée"\n';

async function notionZip(extra: Record<string, string | Uint8Array> = {}): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(`Export/Fabricants ${ID_A}.csv`, new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(CSV)]));
  zip.file(`Export/Fabricants/La Rochère ${ID_B}.md`, '# La Rochère\n\nProduits: Construction vitrée, Pavés de verre\nTexte: 123 Rue de La Rochère\n\n## Contact\n\n- Tél : **03 83 00 00 00**\n- [Site](https://exemple.fr)\n');
  zip.file(`Export/Fabricants/SOTTAS ${ID_C}.md`, '# SOTTAS\n\nProduits: Construction vitrée, Structure métallique\n');
  zip.file('Export/Fabricants/image 1.png', new Uint8Array([1, 2, 3]));
  zip.file('Export/Page libre 99999999999999999999999999999999.md', '# Page libre\n\nTexte.');
  for (const [name, content] of Object.entries(extra)) zip.file(name, content);
  return zip.generateAsync({ type: 'uint8array' });
}

describe('stripNotionId et notionCsvLabel', () => {
  it('retire l\'identifiant de 32 caractères hexadécimaux, et seulement lui', () => {
    expect(stripNotionId(`La Rochère ${ID_A}`)).toBe('La Rochère');
    expect(stripNotionId('La Rochère')).toBe('La Rochère');
    expect(stripNotionId('Lot 12 abc')).toBe('Lot 12 abc');
    expect(notionCsvLabel(`Export/Fabricants ${ID_A}_all.csv`)).toBe('Fabricants');
  });
});

describe('readNotionArchive', () => {
  it('lit le CSV (BOM retiré) et les pages Markdown, ignore images et dossiers', async () => {
    const archive = await readNotionArchive(await notionZip());
    expect(archive.csvs).toHaveLength(1);
    expect(archive.csvs[0].text.startsWith('Nom,Produits')).toBe(true);
    expect(archive.pages.map(p => p.title).sort()).toEqual(['La Rochère', 'Page libre', 'SOTTAS']);
    expect(archive.ignored).toEqual([]);
  });

  it('met le CSV « _all » avant les autres, puis le plus volumineux', async () => {
    const archive = await readNotionArchive(await notionZip({
      [`Export/Fabricants ${ID_A}_all.csv`]: 'Nom,Produits\nA,B\n',
      'Export/Autre.csv': `Nom\n${'x\n'.repeat(500)}`,
    }));
    expect(archive.csvs.map(c => c.name)).toEqual([
      `Export/Fabricants ${ID_A}_all.csv`, 'Export/Autre.csv', `Export/Fabricants ${ID_A}.csv`,
    ]);
  });

  it('refuse un fichier qui n\'est pas une archive', async () => {
    await expect(readNotionArchive(new TextEncoder().encode('pas un zip'))).rejects.toThrow('ARCHIVE_UNREADABLE');
  });

  it('écarte un fichier démesuré', async () => {
    const huge = 'x'.repeat(9 * 1024 * 1024);
    const archive = await readNotionArchive(await notionZip({ 'Export/Gros.md': huge }));
    expect(archive.ignored.map(i => i.reason)).toContain('too_large');
    expect(archive.pages.some(p => p.title === 'Gros')).toBe(false);
  });
});

describe('stripNotionPageHeader', () => {
  const headers = ['Nom', 'Produits', 'Texte'];
  it('retire le titre et le bloc de propriétés, garde le corps', () => {
    const md = '# La Rochère\n\nProduits: A, B\nTexte: x\n\n## Contact\n\ncorps';
    expect(stripNotionPageHeader(md, 'La Rochère', headers)).toBe('## Contact\n\ncorps');
  });
  it('garde un corps qui ressemble à une propriété mais n\'en est pas une', () => {
    expect(stripNotionPageHeader('# SOTTAS\n\nAutre: valeur\n\ncorps', 'SOTTAS', headers)).toBe('Autre: valeur\n\ncorps');
  });
  it('ne retire pas un titre différent de celui de la fiche', () => {
    expect(stripNotionPageHeader('# Autre titre\n\ncorps', 'SOTTAS', headers)).toBe('# Autre titre\n\ncorps');
  });
  it('rend une chaîne vide pour une page sans corps', () => {
    expect(stripNotionPageHeader('# SOTTAS\n\nProduits: A\n', 'SOTTAS', headers)).toBe('');
  });
});

describe('attachNotionPages : de l\'export Notion aux fiches', () => {
  it('rattache le corps des pages aux fiches du CSV par titre et signale les pages libres', async () => {
    const archive = await readNotionArchive(await notionZip());
    const table = parseCsv(archive.csvs[0].text);
    const columns = proposeImportColumns(table);
    expect(columns.map(c => [c.name, c.type])).toEqual([['Nom', 'title'], ['Produits', 'multi_select'], ['Texte', 'text']]);

    const rows = buildImportRows(table, columns);
    const { rows: withContent, matched, unmatchedPages } = attachNotionPages(rows, archive.pages, table[0]);
    expect(matched).toBe(1);
    expect(unmatchedPages).toEqual(['Page libre']);
    expect(withContent.map(r => r.title)).toEqual(['La Rochère', 'SOTTAS', 'FPEE']);
    expect(withContent[0].cells.Produits).toEqual(['Construction vitrée', 'Pavés de verre']);
    expect(withContent[0].content).toBeTruthy();
    const text = kbContentToText(withContent[0].content);
    expect(text).toContain('Contact');
    expect(text).toContain('03 83 00 00 00');
    expect(text).not.toContain('Produits:');
    // SOTTAS n'a qu'un bloc de propriétés, FPEE n'a pas de page : pas de contenu inventé.
    expect(withContent[1].content).toBeUndefined();
    expect(withContent[2].content).toBeUndefined();
  });
});
