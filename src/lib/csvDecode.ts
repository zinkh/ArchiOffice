// Lecture d'un fichier CSV : encodage (UTF-8, Windows-1252, UTF-16), séparateur (« ; » des tableurs français,
// « , » de Notion, tabulation) et découpage en lignes selon la RFC 4180 (guillemets, guillemets doublés,
// retours à la ligne dans une cellule). Logique pure, sans DOM, utilisée par l'import de la « Base de données ».

export type CsvEncoding = 'utf-8' | 'windows-1252' | 'utf-16le';
export interface DecodedCsv { text: string; encoding: CsvEncoding; hadBom: boolean }

/**
 * Décode les octets d'un CSV. UTF-8 strict d'abord (un fichier Windows-1252 avec des accents n'est jamais de
 * l'UTF-8 valide), puis Windows-1252, l'encodage d'un Excel français. La marque d'ordre des octets est retirée.
 */
export function decodeCsvBuffer(input: ArrayBuffer | Uint8Array): DecodedCsv {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf-16le', hadBom: true };
  }
  const hadBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const body = hadBom ? bytes.subarray(3) : bytes;
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(body), encoding: 'utf-8', hadBom };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(body), encoding: 'windows-1252', hadBom };
  }
}

export type CsvDelimiter = ',' | ';' | '\t';
const DELIMITERS: readonly CsvDelimiter[] = [';', ',', '\t'];

/** Nombre de séparateurs de chaque sorte par ligne, hors guillemets, sur les premières lignes. */
function countsByLine(text: string, sampleLines: number): Array<Record<CsvDelimiter, number>> {
  const lines: Array<Record<CsvDelimiter, number>> = [];
  let current: Record<CsvDelimiter, number> = { ',': 0, ';': 0, '\t': 0 };
  let inQuotes = false;
  let hasContent = false;
  for (let i = 0; i < text.length && lines.length < sampleLines; i += 1) {
    const ch = text[i];
    if (ch === '"') { inQuotes = !inQuotes; hasContent = true; continue; }
    if (!inQuotes && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      if (hasContent) lines.push(current);
      current = { ',': 0, ';': 0, '\t': 0 };
      hasContent = false;
      continue;
    }
    if (!inQuotes && (ch === ',' || ch === ';' || ch === '\t')) current[ch] += 1;
    hasContent = true;
  }
  if (hasContent && lines.length < sampleLines) lines.push(current);
  return lines;
}

/** Séparateur le plus probable : celui qui revient le même nombre de fois à chaque ligne, sinon le plus fréquent. */
export function detectDelimiter(text: string): CsvDelimiter {
  const lines = countsByLine(text, 10);
  if (lines.length === 0) return ',';
  let best: CsvDelimiter = ',';
  let bestScore = -1;
  for (const delimiter of DELIMITERS) {
    const counts = lines.map(l => l[delimiter]);
    const total = counts.reduce((a, b) => a + b, 0);
    if (total === 0) continue;
    const consistent = counts.every(c => c === counts[0]) && counts[0] > 0;
    const score = (consistent ? 1_000_000 : 0) + total;
    if (score > bestScore) { bestScore = score; best = delimiter; }
  }
  return best;
}

/** Découpe un CSV en lignes de cellules. Les lignes entièrement vides sont ignorées. */
export function parseCsv(text: string, delimiter: CsvDelimiter = detectDelimiter(text)): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  const endCell = () => { row.push(cell); cell = ''; };
  const endRow = () => {
    endCell();
    if (row.some(c => c.trim() !== '')) rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 1; } else inQuotes = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === '') inQuotes = true;
    else if (ch === delimiter) endCell();
    else if (ch === '\n') endRow();
    else if (ch === '\r') { if (text[i + 1] === '\n') i += 1; endRow(); }
    else cell += ch;
  }
  if (cell !== '' || row.length > 0) endRow();
  return rows;
}
