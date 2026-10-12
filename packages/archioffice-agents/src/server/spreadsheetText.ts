// ── Lecture des tableurs (.xls, .xlsx, .xlsm, .ods) ─────────────────────────
// Un tableur joint à un message n'avait aucun extracteur : context.ts le
// laissait tomber sans rien dire, le modèle voyait seulement « un fichier est
// joint » et en décrivait le contenu de tête (incident du 12 octobre 2026 :
// un suivi de réserves de Stenay est devenu cinq « réserves AOR » inventées
// d'un autre projet, puis des tâches créées dessus). Une feuille est rendue
// ligne à ligne, cellules séparées par « | », avec le nom de chaque onglet :
// c'est le seul moyen pour le modèle de dire quels onglets existent vraiment.
import * as XLSX from 'xlsx';

export const SPREADSHEET_EXTENSIONS = ['.xls', '.xlsx', '.xlsm', '.ods'];

export function isSpreadsheetName(filename: string): boolean {
  const lower = String(filename || '').toLowerCase();
  return SPREADSHEET_EXTENSIONS.some(ext => lower.endsWith(ext));
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).replace(/\s+/g, ' ').trim();
}

/**
 * Texte d'un classeur : un bloc « ## Onglet "nom" (n lignes) » par feuille,
 * les lignes vides ignorées. Lève si le fichier n'est pas un classeur lisible.
 * `maxChars` borne le résultat ; une troncature est annoncée, jamais muette.
 */
export function spreadsheetToText(buffer: Buffer, maxChars: number): string {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const blocks: string[] = [];
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, blankrows: false, raw: true });
    const lines = rows
      .map(row => row.map(cellText).join(' | ').replace(/(\s*\|\s*)+$/, '').trim())
      .filter(line => line.length > 0);
    blocks.push(`## Onglet "${name}" (${lines.length} ligne(s) non vide(s))\n${lines.join('\n')}`);
  }
  const header = `[Classeur : ${wb.SheetNames.length} onglet(s) : ${wb.SheetNames.map(n => `"${n}"`).join(', ')}]`;
  const full = `${header}\n\n${blocks.join('\n\n')}`;
  if (full.length <= maxChars) return full;
  return `${full.slice(0, maxChars)}\n\n[... classeur tronqué : la suite n'est pas disponible dans ce message.]`;
}
