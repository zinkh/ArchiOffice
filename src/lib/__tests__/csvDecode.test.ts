// Lecture des CSV : src/lib/csvDecode.ts (encodage, séparateur, découpage).
import iconv from 'iconv-lite';
import { describe, expect, it } from 'vitest';
import { decodeCsvBuffer, detectDelimiter, parseCsv } from '../csvDecode';

const utf8 = (text: string, bom = false) => new Uint8Array([...(bom ? [0xef, 0xbb, 0xbf] : []), ...new TextEncoder().encode(text)]);

describe('decodeCsvBuffer', () => {
  it('lit de l\'UTF-8 et retire la marque d\'ordre des octets', () => {
    const decoded = decodeCsvBuffer(utf8('Nom;Pavés\nÉlan;ç', true));
    expect(decoded).toMatchObject({ encoding: 'utf-8', hadBom: true });
    expect(decoded.text.startsWith('Nom')).toBe(true);
    expect(decoded.text).toContain('Pavés');
  });

  it('retombe sur Windows-1252 pour un fichier Excel français', () => {
    const bytes = iconv.encode('Nom;Produits\nVerrière;Pavés de verre, Menuiseries extérieures', 'win1252');
    const decoded = decodeCsvBuffer(new Uint8Array(bytes));
    expect(decoded.encoding).toBe('windows-1252');
    expect(decoded.text).toContain('Verrière');
    expect(decoded.text).toContain('extérieures');
  });

  it('lit de l\'UTF-16 avec marque d\'ordre (export « Texte Unicode »)', () => {
    const bytes = new Uint8Array([0xff, 0xfe, ...iconv.encode('Nom\tTexte\nA\tB', 'utf16le')]);
    const decoded = decodeCsvBuffer(bytes);
    expect(decoded.encoding).toBe('utf-16le');
    expect(decoded.text).toBe('Nom\tTexte\nA\tB');
  });
});

describe('detectDelimiter', () => {
  it('reconnaît le point-virgule, la virgule et la tabulation', () => {
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',');
    expect(detectDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t');
  });

  it('préfère le séparateur régulier : des virgules décimales n\'emportent pas le point-virgule', () => {
    expect(detectDelimiter('Prix;Qté\n12,5;3\n8,75;2')).toBe(';');
  });

  it('ignore les séparateurs entre guillemets', () => {
    expect(detectDelimiter('Nom,Texte\n"A; B; C; D",x\n"E; F",y')).toBe(',');
  });

  it('prend la virgule par défaut', () => {
    expect(detectDelimiter('')).toBe(',');
    expect(detectDelimiter('un seul mot')).toBe(',');
  });
});

describe('parseCsv', () => {
  it('lit guillemets, guillemets doublés et retours à la ligne dans une cellule', () => {
    const csv = 'Nom,Texte\r\nLa Rochère,"Localisation: 123 Rue\nVille, ""Code"" Postal"\r\nSOTTAS,Suisse\r\n';
    expect(parseCsv(csv)).toEqual([
      ['Nom', 'Texte'],
      ['La Rochère', 'Localisation: 123 Rue\nVille, "Code" Postal'],
      ['SOTTAS', 'Suisse'],
    ]);
  });

  it('garde les cellules vides et ignore les lignes entièrement vides', () => {
    expect(parseCsv('a;b;c\n1;;3\n\n;;\n4;5;6', ';')).toEqual([['a', 'b', 'c'], ['1', '', '3'], ['4', '5', '6']]);
  });

  it('lit la dernière ligne sans retour final et un guillemet au milieu d\'une cellule', () => {
    expect(parseCsv('a,b\n12" tuyau,x')).toEqual([['a', 'b'], ['12" tuyau', 'x']]);
  });

  it('lit un export Notion complet : BOM retiré, multi-sélection entre guillemets', () => {
    const decoded = decodeCsvBuffer(utf8('Nom,Produits,Texte\n"La Rochère","Construction vitrée, Pavés de verre","123 Rue de La Rochère"\n', true));
    expect(parseCsv(decoded.text)).toEqual([
      ['Nom', 'Produits', 'Texte'],
      ['La Rochère', 'Construction vitrée, Pavés de verre', '123 Rue de La Rochère'],
    ]);
  });
});
