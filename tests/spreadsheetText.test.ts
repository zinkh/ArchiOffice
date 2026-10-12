import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { spreadsheetToText, isSpreadsheetName } from '../packages/archioffice-agents/src/server/spreadsheetText.js';
import { extractDocumentText } from '../packages/archioffice-agents/src/server/documentTextExtraction.js';

function workbook(bookType: 'xls' | 'xlsx'): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Lots', 'Désignation', 'Numéro'],
    [],
    ['Serrurerie', 'Garde-corps à poser', 'AACZ 02.4'],
  ]), 'Réserves 30-06-26');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Lots', 'Plans']]), 'Liste Plans');
  return XLSX.write(wb, { type: 'buffer', bookType }) as Buffer;
}

describe('lecture des tableurs joints', () => {
  it('reconnaît les extensions de classeurs', () => {
    expect(isSpreadsheetName('Suivi.XLS')).toBe(true);
    expect(isSpreadsheetName('plan.pdf')).toBe(false);
  });

  it.each(['xls', 'xlsx'] as const)('liste les onglets réels et leurs lignes (%s)', (type) => {
    const text = spreadsheetToText(workbook(type), 10_000);
    expect(text).toContain('"Réserves 30-06-26"');
    expect(text).toContain('"Liste Plans"');
    expect(text).toContain('Serrurerie | Garde-corps à poser | AACZ 02.4');
    expect(text).not.toMatch(/AOR/);
  });

  it('annonce une troncature au lieu de couper en silence', () => {
    expect(spreadsheetToText(workbook('xlsx'), 40)).toContain('classeur tronqué');
  });

  it('extractDocumentText lit un .xls', async () => {
    const r = await extractDocumentText('suivi.xls', 'application/vnd.ms-excel', workbook('xls'));
    expect(r.text).toContain('AACZ 02.4');
  });
});
