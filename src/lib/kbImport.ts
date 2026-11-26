// Import d'un tableau (CSV, classeur, export Notion) dans une base de données du cabinet : proposition des
// colonnes et de leur type, conversion des cellules, découpage en lots. Logique pure, testée ; la validation
// qui fait foi est celle du serveur (POST /api/kb/databases/:id/import, sanitizeKbValue).
import { foldText } from './slashMenu';
import type { KbProperty, KbPropertyType } from './kb';

export const KB_IMPORT_MAX_ROWS_PER_REQUEST = 500;
export const KB_IMPORT_MAX_ROWS = 5_000;
export const KB_IMPORT_MAX_COLUMNS = 30;

/** Types qu'une colonne importée peut prendre (la relation entre bases n'existe pas encore). */
export type KbImportType = Exclude<KbPropertyType, 'relation'>;
export const KB_IMPORT_TYPES: readonly KbImportType[] = ['title', 'text', 'number', 'select', 'multi_select', 'date', 'checkbox', 'url'];

export interface KbImportColumn {
  /** Position de la colonne dans le fichier. */
  index: number;
  /** En-tête lu dans le fichier. */
  header: string;
  /** Nom de la colonne dans la base (modifiable). */
  name: string;
  type: KbImportType;
  /** Colonne de la base déjà existante avec ce nom : ses valeurs s'ajoutent, rien n'est recréé. */
  existingId: string | null;
  include: boolean;
}

export type KbImportCell = string | number | boolean | string[] | null;
export interface KbImportRow {
  title: string;
  cells: Record<string, KbImportCell>;
  /** Contenu de la page (document Tiptap), repris d'une page Markdown d'un export Notion. */
  content?: unknown;
}
export interface KbImportRequest {
  columns: Array<{ name: string; type: Exclude<KbImportType, 'title'> }>;
  rows: KbImportRow[];
}

const MONTHS: Record<string, number> = {
  janvier: 1, janv: 1, january: 1, jan: 1, fevrier: 2, fev: 2, february: 2, feb: 2, mars: 3, march: 3, mar: 3,
  avril: 4, avr: 4, april: 4, apr: 4, mai: 5, may: 5, juin: 6, june: 6, jun: 6, juillet: 7, juil: 7, july: 7, jul: 7,
  aout: 8, august: 8, aug: 8, septembre: 9, sept: 9, september: 9, sep: 9, octobre: 10, oct: 10, october: 10,
  novembre: 11, nov: 11, november: 11, decembre: 12, dec: 12, december: 12,
};

const pad = (n: number) => String(n).padStart(2, '0');
function isoDate(year: number, month: number, day: number): string | null {
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Date lue dans une cellule, au format AAAA-MM-JJ : ISO, JJ/MM/AAAA, JJ-MM-AAAA, JJ.MM.AAAA, « 26 novembre 2026 », « November 26, 2026 ». */
export function parseDateCell(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/.exec(v);
  if (m) return isoDate(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:\s.*)?$/.exec(v);
  if (m) return isoDate(+m[3], +m[2], +m[1]);
  m = /^(\d{1,2})(?:er)?\s+([a-zéûôèà.]+)\s+(\d{4})$/i.exec(v);
  if (m) { const month = MONTHS[foldText(m[2]).replace('.', '')]; return month ? isoDate(+m[3], month, +m[1]) : null; }
  m = /^([a-zéûôèà.]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i.exec(v);
  if (m) { const month = MONTHS[foldText(m[1]).replace('.', '')]; return month ? isoDate(+m[3], month, +m[2]) : null; }
  return null;
}

/** Nombre lu dans une cellule : « 1 234,56 », « 1.234,56 », « 1,234.56 », « -12 ». Un code à zéro initial (« 0684… ») reste du texte. */
export function parseNumberCell(value: string): number | null {
  const v = value.trim().replace(/[\s  ]/g, '');
  if (!v || !/^[-+]?\d[\d.,]*$/.test(v)) return null;
  if (/^[-+]?0\d/.test(v)) return null;
  const lastComma = v.lastIndexOf(',');
  const lastDot = v.lastIndexOf('.');
  let normalized = v;
  if (lastComma >= 0 && lastDot >= 0) {
    normalized = lastComma > lastDot ? v.replace(/\./g, '').replace(',', '.') : v.replace(/,/g, '');
  } else if (lastComma >= 0) {
    normalized = (v.match(/,/g) || []).length === 1 ? v.replace(',', '.') : v.replace(/,/g, '');
  } else if ((v.match(/\./g) || []).length > 1) {
    normalized = v.replace(/\./g, '');
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

const TRUE_WORDS = new Set(['oui', 'yes', 'true', 'vrai', 'x', '✓', '✔', '1', 'checked', 'coche']);
const FALSE_WORDS = new Set(['non', 'no', 'false', 'faux', '0', 'unchecked', 'decoche', '']);
export function parseCheckboxCell(value: string): boolean | null {
  const v = foldText(value.trim());
  if (TRUE_WORDS.has(v)) return true;
  if (FALSE_WORDS.has(v)) return false;
  return null;
}

const isUrl = (value: string) => /^(https?:\/\/|www\.)\S+$/i.test(value.trim());

/** Étiquettes d'une cellule à choix multiple (« A, B » de Notion, « A ; B » d'un tableur). */
export function splitLabels(value: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of value.split(/[,;\n]/)) {
    const label = part.trim();
    const key = foldText(label);
    if (!label || seen.has(key)) continue;
    seen.add(key);
    out.push(label.slice(0, 80));
  }
  return out;
}

/** Une étiquette plausible : courte, sans phrase (« : », « . ») ni chiffre de rue. */
const looksLikeLabel = (label: string) => label.length <= 40 && label.split(/\s+/).length <= 5 && !/[:.]/.test(label);

/** Type proposé pour une colonne d'après ses valeurs non vides. Un doute se règle en texte : l'utilisateur peut changer. */
export function inferImportType(values: string[]): Exclude<KbImportType, 'title'> {
  const filled = values.map(v => v.trim()).filter(Boolean);
  if (filled.length === 0) return 'text';
  if (filled.every(v => /^(oui|non|yes|no|true|false|vrai|faux|x|✓|✔|checked|unchecked)$/i.test(foldText(v)))) return 'checkbox';
  if (filled.every(v => parseNumberCell(v) !== null)) return 'number';
  if (filled.every(v => parseDateCell(v) !== null)) return 'date';
  if (filled.every(isUrl)) return 'url';

  const labelsByCell = filled.map(splitLabels);
  const allLabels = labelsByCell.flat();
  const distinct = new Set(allLabels.map(foldText));
  const shortLabels = allLabels.length > 0 && allLabels.every(looksLikeLabel);
  const someMulti = labelsByCell.some(labels => labels.length >= 2);
  if (shortLabels && someMulti && distinct.size <= 60) return 'multi_select';
  if (shortLabels && filled.length >= 4 && distinct.size <= 12 && allLabels.length / distinct.size >= 2 && labelsByCell.every(l => l.length === 1)) return 'select';
  return 'text';
}

/** Valeur d'une cellule selon le type choisi ; `null` pour une cellule vide ou illisible dans ce type. */
export function convertImportCell(value: string, type: KbImportType): KbImportCell {
  const v = value.trim();
  if (!v) return null;
  switch (type) {
    case 'number': return parseNumberCell(v);
    case 'date': return parseDateCell(v);
    case 'checkbox': return parseCheckboxCell(v);
    case 'select': return splitLabels(v)[0] ?? null;
    case 'multi_select': { const labels = splitLabels(v); return labels.length ? labels : null; }
    case 'url': return v.slice(0, 2000);
    default: return v;
  }
}

const cleanHeader = (header: string) => header.replace(/\s+/g, ' ').trim().slice(0, 80);
const TITLE_HEADER = /^(nom|name|titre|title)$/;

/**
 * Colonnes proposées pour un tableau (première ligne = en-têtes). La colonne « Nom » (ou « Titre », ou la
 * première) devient le titre des fiches ; une colonne qui porte le nom d'une colonne existante la complète.
 */
export function proposeImportColumns(table: string[][], existing: KbProperty[] = []): KbImportColumn[] {
  const headerRow = table[0] ?? [];
  const dataRows = table.slice(1);
  const used = new Map<string, number>();
  const names = headerRow.map((raw, index) => {
    const base = cleanHeader(raw) || `Colonne ${index + 1}`;
    const key = foldText(base);
    const count = (used.get(key) ?? 0) + 1;
    used.set(key, count);
    return count === 1 ? base : `${base} (${count})`;
  });
  let titleIndex = names.findIndex(name => TITLE_HEADER.test(foldText(name)));
  if (titleIndex < 0) titleIndex = 0;

  return names.map((name, index) => {
    const match = existing.find(p => foldText(p.name) === foldText(name) && (index === titleIndex ? p.type === 'title' : p.type !== 'title'));
    const isTitle = index === titleIndex;
    const type: KbImportType = isTitle
      ? 'title'
      : match ? (match.type as KbImportType) : inferImportType(dataRows.map(row => row[index] ?? ''));
    return {
      index,
      header: headerRow[index] ?? name,
      name: isTitle && match ? match.name : name,
      type,
      existingId: match?.id ?? null,
      include: true,
    };
  });
}

/** Lignes à envoyer, d'après les colonnes (types et inclusions éventuellement modifiés par la personne). */
export function buildImportRows(table: string[][], columns: KbImportColumn[]): KbImportRow[] {
  const title = columns.find(c => c.type === 'title' && c.include) ?? columns.find(c => c.type === 'title');
  const others = columns.filter(c => c.include && c.type !== 'title');
  return table.slice(1)
    .filter(row => row.some(cell => (cell ?? '').trim() !== ''))
    .map(row => {
      const cells: Record<string, KbImportCell> = {};
      for (const column of others) {
        const value = convertImportCell(row[column.index] ?? '', column.type);
        if (value !== null) cells[column.name] = value;
      }
      return { title: ((title ? row[title.index] : '') ?? '').trim().slice(0, 200), cells };
    });
}

/** Erreurs qui empêchent l'import, avant tout envoi. */
export function validateImportColumns(columns: KbImportColumn[]): string | null {
  const included = columns.filter(c => c.include);
  const titles = included.filter(c => c.type === 'title');
  if (titles.length !== 1) return 'title';
  if (included.filter(c => c.type !== 'title').length > KB_IMPORT_MAX_COLUMNS) return 'too_many_columns';
  const names = included.map(c => foldText(c.name.trim()));
  if (names.some(n => !n)) return 'empty_name';
  if (new Set(names).size !== names.length) return 'duplicate_name';
  return null;
}

/** Lots de 500 lignes au plus, chacun avec la liste des colonnes (le serveur rapproche par nom, rejouer est sans risque). */
export function toImportRequests(columns: KbImportColumn[], rows: KbImportRow[], chunkSize = KB_IMPORT_MAX_ROWS_PER_REQUEST): KbImportRequest[] {
  const sent = columns
    .filter(c => c.include && c.type !== 'title')
    .map(c => ({ name: c.name.trim(), type: c.type as Exclude<KbImportType, 'title'> }));
  const requests: KbImportRequest[] = [];
  for (let i = 0; i < rows.length; i += chunkSize) requests.push({ columns: sent, rows: rows.slice(i, i + chunkSize) });
  return requests;
}
