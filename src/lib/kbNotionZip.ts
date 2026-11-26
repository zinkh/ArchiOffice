// Archive d'export Notion (« Exporter > Markdown et CSV ») : le CSV d'une base et les pages Markdown de ses
// fiches. Tout se lit en mémoire dans le navigateur, avec la même protection que src/lib/offresRecues.ts
// contre les archives piégées (taille décompressée), et rien n'est jamais écrit sur disque. Seuls les
// fichiers .csv et .md sont lus ; images et pièces jointes de l'export sont ignorées.
//
// Structure habituelle (non vérifiée sur tous les exports) : `Base 0123…abcd.csv`, parfois sa version
// `…_all.csv` qui porte toutes les colonnes, et un dossier de pages `Base/Titre 4567…ef01.md`. Le suffixe de
// 32 caractères hexadécimaux est l'identifiant Notion : retiré pour retrouver le titre de la fiche.
import JSZip from 'jszip';
import { decodeCsvBuffer } from './csvDecode';
import { foldText } from './slashMenu';
import { markdownToTiptap } from './kbMarkdown';
import type { KbImportRow } from './kbImport';

export const NOTION_MAX_ENTRY_BYTES = 8 * 1024 * 1024;
export const NOTION_MAX_TOTAL_BYTES = 100 * 1024 * 1024;
export const NOTION_MAX_ENTRIES = 5_000;

export interface NotionCsv { name: string; text: string; bytes: number }
export interface NotionPage { title: string; path: string; markdown: string }
export interface NotionIgnored { name: string; reason: string }
export interface NotionArchive {
  /** Les CSV de l'archive, le plus complet d'abord (`_all.csv`, puis le plus volumineux). */
  csvs: NotionCsv[];
  pages: NotionPage[];
  ignored: NotionIgnored[];
}

/** « La Rochère 1a2b…(32 caractères) » donne « La Rochère » ; le nom sans identifiant reste inchangé. */
export function stripNotionId(name: string): string {
  return name.replace(/\s+[0-9a-f]{32}$/i, '').trim();
}

const baseName = (path: string) => (path.split('/').pop() ?? path);
const withoutExtension = (name: string) => name.replace(/\.[^.]+$/, '');

/** Chemin sûr : ni absolu, ni remontée (`..`), ni caractère de contrôle. */
const isSafePath = (path: string) => !path.startsWith('/') && !/(^|\/)\.\.(\/|$)/.test(path) && !/[\u0000-\u001f]/.test(path);

export async function readNotionArchive(data: ArrayBuffer | Uint8Array | Blob): Promise<NotionArchive> {
  const ignored: NotionIgnored[] = [];
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(data); } catch { throw new Error('ARCHIVE_UNREADABLE'); }

  const entries = Object.values(zip.files).filter(entry => !entry.dir);
  if (entries.length > NOTION_MAX_ENTRIES + 2_000) throw new Error('ARCHIVE_TOO_MANY_FILES');

  const csvs: NotionCsv[] = [];
  const pages: NotionPage[] = [];
  let total = 0;

  for (const entry of entries) {
    const path = entry.name;
    const lower = path.toLowerCase();
    if (path.includes('__MACOSX/') || baseName(path).startsWith('.')) continue;
    const isCsv = lower.endsWith('.csv');
    const isMarkdown = lower.endsWith('.md') || lower.endsWith('.markdown');
    if (!isCsv && !isMarkdown) continue;
    if (!isSafePath(path)) { ignored.push({ name: path, reason: 'unsafe_path' }); continue; }
    if (pages.length + csvs.length >= NOTION_MAX_ENTRIES) { ignored.push({ name: path, reason: 'too_many_files' }); continue; }

    // Taille annoncée par l'archive quand elle est connue : un fichier démesuré n'est même pas décompressé.
    const declared = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
    if (typeof declared === 'number' && declared > NOTION_MAX_ENTRY_BYTES) { ignored.push({ name: path, reason: 'too_large' }); continue; }
    if (total + (declared ?? 0) > NOTION_MAX_TOTAL_BYTES) { ignored.push({ name: path, reason: 'archive_too_large' }); break; }

    const bytes = await entry.async('uint8array');
    total += bytes.byteLength;
    if (total > NOTION_MAX_TOTAL_BYTES) { ignored.push({ name: path, reason: 'archive_too_large' }); break; }
    if (bytes.byteLength > NOTION_MAX_ENTRY_BYTES) { ignored.push({ name: path, reason: 'too_large' }); continue; }

    const { text } = decodeCsvBuffer(bytes);
    if (isCsv) csvs.push({ name: path, text, bytes: bytes.byteLength });
    else pages.push({ title: stripNotionId(withoutExtension(baseName(path))), path, markdown: text });
  }

  csvs.sort((a, b) => {
    const aAll = /_all\.csv$/i.test(a.name) ? 1 : 0;
    const bAll = /_all\.csv$/i.test(b.name) ? 1 : 0;
    return (bAll - aAll) || (b.bytes - a.bytes) || a.name.localeCompare(b.name);
  });
  return { csvs, pages, ignored };
}

/** Nom lisible d'un CSV de l'archive : sans dossier, sans extension ni identifiant Notion (« Fabricants »). */
export function notionCsvLabel(name: string): string {
  return stripNotionId(withoutExtension(baseName(name)).replace(/_all$/i, ''));
}

/**
 * Corps d'une page Notion sans ce que le CSV porte déjà : le titre (`# Titre`) et le bloc de propriétés
 * (« Produits: A, B ») qui le suit. Le reste est le contenu de la fiche.
 */
export function stripNotionPageHeader(markdown: string, title: string, headers: string[]): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  const skipBlank = () => { while (i < lines.length && lines[i].trim() === '') i += 1; };
  skipBlank();
  const h1 = /^#\s+(.*?)\s*#*\s*$/.exec(lines[i] ?? '');
  if (h1 && foldText(h1[1]) === foldText(title)) i += 1;
  skipBlank();
  const known = new Set(headers.map(foldText));
  const start = i;
  while (i < lines.length) {
    const m = /^([^:\n]{1,80}):\s?(.*)$/.exec(lines[i]);
    if (!m || !known.has(foldText(m[1]))) break;
    i += 1;
  }
  // Un bloc de propriétés n'est retiré que s'il est suivi d'une ligne vide ou de la fin : pas une phrase du corps.
  if (i > start && !(i >= lines.length || lines[i].trim() === '')) i = start;
  return lines.slice(i).join('\n').trim();
}

export interface AttachResult {
  rows: KbImportRow[];
  /** Fiches pour lesquelles une page a été trouvée et avait un corps. */
  matched: number;
  /** Titres de pages sans fiche dans le CSV (pages libres de l'export : non importées). */
  unmatchedPages: string[];
}

/** Rattache le corps des pages Markdown aux fiches du CSV, par titre (casse et accents ignorés). */
export function attachNotionPages(rows: KbImportRow[], pages: NotionPage[], headers: string[]): AttachResult {
  const byTitle = new Map<string, NotionPage>();
  for (const page of pages) {
    const key = foldText(page.title);
    if (!byTitle.has(key)) byTitle.set(key, page);
  }
  const used = new Set<string>();
  let matched = 0;
  const out = rows.map(row => {
    const key = foldText(row.title);
    const page = byTitle.get(key);
    if (!page) return row;
    used.add(key);
    const body = stripNotionPageHeader(page.markdown, row.title, headers);
    if (!body) return row;
    matched += 1;
    return { ...row, content: markdownToTiptap(body) };
  });
  const unmatchedPages = [...byTitle.entries()].filter(([key]) => !used.has(key)).map(([, page]) => page.title);
  return { rows: out, matched, unmatchedPages };
}
