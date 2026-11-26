// Markdown vers blocs de l'éditeur (document Tiptap, JSON) : le corps des pages d'un export Notion.
// Écrit à la main, sans dépendance : titres, paragraphes, listes imbriquées, cases à cocher, citations, blocs de
// code, séparateurs, tableaux, blocs repliables (<details>) et encadrés (<aside>) de Notion, gras, italique,
// barré, code, liens. Les images ne sont pas reprises (leur fichier n'est pas dans le CSV) : un repère
// « [Image : nom] » garde la trace de leur place. Logique pure, testée.

export interface TiptapMark { type: string; attrs?: Record<string, unknown> }
export interface TiptapNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  text?: string;
  marks?: TiptapMark[];
}
export interface TiptapDoc { type: 'doc'; content: TiptapNode[] }

const MAX_DEPTH = 8;

const textNode = (text: string, marks: TiptapMark[]): TiptapNode => (marks.length ? { type: 'text', text, marks } : { type: 'text', text });

/** Seuls http(s), mailto et tel deviennent des liens : jamais javascript: ni data:. */
export function safeLink(href: string): string | null {
  const h = href.trim();
  return /^(https?:\/\/|mailto:|tel:)/i.test(h) ? h : null;
}

const ESCAPABLE = /[\\`*_{}[\]()#+\-.!~|>]/;

function findItalicEnd(text: string, from: number, delimiter: string): number {
  for (let j = from; j < text.length; j += 1) {
    if (text[j] === '\\') { j += 1; continue; }
    if (text[j] !== delimiter) continue;
    if (text[j + 1] === delimiter) { j += 1; continue; }
    if (/\s/.test(text[j - 1] ?? ' ')) continue;
    if (delimiter === '_' && j + 1 < text.length && /\w/.test(text[j + 1])) continue;
    return j;
  }
  return -1;
}

function decodeURIComponentSafe(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}

/** Texte en ligne : gras, italique, barré, code, liens. Les marques se cumulent (`**gras _et italique_**`). */
export function parseInline(text: string, marks: TiptapMark[] = [], depth = 0): TiptapNode[] {
  const out: TiptapNode[] = [];
  let buffer = '';
  const flush = () => { if (buffer) { out.push(textNode(buffer, marks)); buffer = ''; } };
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\' && i + 1 < text.length && ESCAPABLE.test(text[i + 1])) { buffer += text[i + 1]; i += 2; continue; }

    if (ch === '`') {
      const end = text.indexOf('`', i + 1);
      if (end > i + 1) { flush(); out.push(textNode(text.slice(i + 1, end), [...marks, { type: 'code' }])); i = end + 1; continue; }
    }
    if (ch === '!' && text[i + 1] === '[') {
      const m = /^!\[([^\]]*)\]\(([^)]*)\)/.exec(text.slice(i));
      if (m) { flush(); out.push(textNode(`[Image : ${m[1].trim() || 'sans titre'}]`, marks)); i += m[0].length; continue; }
    }
    if (ch === '[' && depth < MAX_DEPTH) {
      const m = /^\[([^\]]*)\]\(([^)\s]*)(?:\s+"[^"]*")?\)/.exec(text.slice(i));
      if (m) {
        flush();
        const href = safeLink(decodeURIComponentSafe(m[2]));
        const inner = parseInline(m[1], href ? [...marks, { type: 'link', attrs: { href } }] : marks, depth + 1);
        out.push(...inner);
        i += m[0].length;
        continue;
      }
    }
    let matched = false;
    if (depth < MAX_DEPTH) {
      for (const [delimiter, markType] of [['**', 'bold'], ['__', 'bold'], ['~~', 'strike']] as const) {
        if (!text.startsWith(delimiter, i)) continue;
        const end = text.indexOf(delimiter, i + delimiter.length);
        if (end > i + delimiter.length) {
          flush();
          out.push(...parseInline(text.slice(i + delimiter.length, end), [...marks, { type: markType }], depth + 1));
          i = end + delimiter.length;
          matched = true;
          break;
        }
      }
      if (!matched && (ch === '*' || ch === '_') && text[i + 1] && !/\s/.test(text[i + 1]) && text[i + 1] !== ch
        && (ch === '*' || i === 0 || !/\w/.test(text[i - 1]))) {
        const end = findItalicEnd(text, i + 1, ch);
        if (end > i + 1) {
          flush();
          out.push(...parseInline(text.slice(i + 1, end), [...marks, { type: 'italic' }], depth + 1));
          i = end + 1;
          matched = true;
        }
      }
    }
    if (matched) continue;
    buffer += ch;
    i += 1;
  }
  flush();
  return out;
}

const paragraph = (text: string): TiptapNode => {
  const content = parseInline(text);
  return content.length ? { type: 'paragraph', content } : { type: 'paragraph' };
};

const FENCE = /^\s{0,3}(```|~~~)\s*([\w+-]*)\s*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const HTML_ONLY = /^\s*<\/?[a-z][^>]*>\s*$/i;

interface ListEntry { indent: number; ordered: boolean; start: number; task: boolean | null; text: string }

function splitTableRow(line: string): string[] {
  let row = line.trim();
  if (row.startsWith('|')) row = row.slice(1);
  if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1);
  const cells: string[] = [];
  let cell = '';
  for (let i = 0; i < row.length; i += 1) {
    if (row[i] === '\\' && row[i + 1] === '|') { cell += '|'; i += 1; } else if (row[i] === '|') { cells.push(cell.trim()); cell = ''; } else cell += row[i];
  }
  cells.push(cell.trim());
  return cells;
}

function buildList(entries: ListEntry[], from: number, indent: number, depth: number): { node: TiptapNode; next: number } {
  const first = entries[from];
  const kind: 'task' | 'ordered' | 'bullet' = first.task !== null ? 'task' : first.ordered ? 'ordered' : 'bullet';
  const items: TiptapNode[] = [];
  let i = from;
  while (i < entries.length && entries[i].indent >= indent) {
    const entry = entries[i];
    if (entry.indent > indent) break;
    const entryKind = entry.task !== null ? 'task' : entry.ordered ? 'ordered' : 'bullet';
    if (entryKind !== kind) break;
    const content: TiptapNode[] = [paragraph(entry.text)];
    i += 1;
    // Éléments plus retirés : sous-listes de cet élément (au-delà de la profondeur permise, ils sont mis à plat).
    while (i < entries.length && entries[i].indent > indent && depth < MAX_DEPTH) {
      const nested = buildList(entries, i, entries[i].indent, depth + 1);
      content.push(nested.node);
      i = nested.next;
    }
    while (i < entries.length && entries[i].indent > indent && depth >= MAX_DEPTH) {
      content[0] = paragraph(`${entry.text} ${entries[i].text}`);
      i += 1;
    }
    items.push(kind === 'task'
      ? { type: 'taskItem', attrs: { checked: entry.task === true }, content }
      : { type: 'listItem', content });
  }
  const type = kind === 'task' ? 'taskList' : kind === 'ordered' ? 'orderedList' : 'bulletList';
  const node: TiptapNode = { type, content: items };
  if (kind === 'ordered' && first.start !== 1) node.attrs = { start: first.start };
  return { node, next: i };
}

function startsBlock(line: string, next?: string): boolean {
  return FENCE.test(line) || HEADING.test(line) || HR.test(line) || LIST_ITEM.test(line) || QUOTE.test(line)
    || /^\s*<(details|aside)\b/i.test(line)
    || (line.trim().startsWith('|') && next !== undefined && TABLE_SEPARATOR.test(next));
}

/** Contenu d'un bloc HTML de Notion (`<details>`, `<aside>`) jusqu'à sa balise fermante, imbrications comprises. */
function collectHtmlBlock(lines: string[], start: number, tag: string): { inner: string[]; next: number } {
  const open = new RegExp(`<${tag}\\b`, 'gi');
  const close = new RegExp(`</${tag}>`, 'gi');
  let depth = 0;
  const inner: string[] = [];
  let i = start;
  for (; i < lines.length; i += 1) {
    const line = lines[i];
    const opens = (line.match(open) || []).length;
    const closes = (line.match(close) || []).length;
    if (i === start) {
      depth += opens - closes;
      const after = line.replace(new RegExp(`^\\s*<${tag}\\b[^>]*>`, 'i'), '').replace(new RegExp(`</${tag}>\\s*$`, 'i'), '');
      if (after.trim()) inner.push(after);
      if (depth <= 0) return { inner, next: i + 1 };
      continue;
    }
    depth += opens - closes;
    if (depth <= 0) {
      const before = line.replace(new RegExp(`</${tag}>\\s*$`, 'i'), '');
      if (before.trim()) inner.push(before);
      return { inner, next: i + 1 };
    }
    inner.push(line);
  }
  return { inner, next: i };
}

function parseBlocks(lines: string[], depth: number): TiptapNode[] {
  const blocks: TiptapNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') { i += 1; continue; }

    const fence = FENCE.exec(line);
    if (fence) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !new RegExp(`^\\s{0,3}${fence[1]}\\s*$`).test(lines[i])) { body.push(lines[i]); i += 1; }
      i += 1;
      const code = body.join('\n');
      blocks.push({ type: 'codeBlock', attrs: { language: fence[2] || null }, ...(code ? { content: [{ type: 'text', text: code }] } : {}) });
      continue;
    }

    if (/^\s*<details\b/i.test(line) && depth < MAX_DEPTH) {
      const { inner, next } = collectHtmlBlock(lines, i, 'details');
      i = next;
      let summary = 'Détails';
      const body: string[] = [];
      const joined = inner.join('\n');
      const m = /<summary[^>]*>([\s\S]*?)<\/summary>/i.exec(joined);
      if (m) {
        summary = m[1].replace(/<[^>]+>/g, '').trim() || summary;
        body.push(...joined.replace(m[0], '').split('\n'));
      } else body.push(...inner);
      const bodyBlocks = parseBlocks(body, depth + 1);
      blocks.push({
        type: 'details',
        content: [
          { type: 'detailsSummary', content: parseInline(summary) },
          { type: 'detailsContent', content: bodyBlocks.length ? bodyBlocks : [{ type: 'paragraph' }] },
        ],
      });
      continue;
    }
    if (/^\s*<aside\b/i.test(line) && depth < MAX_DEPTH) {
      const { inner, next } = collectHtmlBlock(lines, i, 'aside');
      i = next;
      const inside = parseBlocks(inner, depth + 1);
      blocks.push({ type: 'blockquote', content: inside.length ? inside : [{ type: 'paragraph' }] });
      continue;
    }
    if (HTML_ONLY.test(line)) { i += 1; continue; }

    const heading = HEADING.exec(line);
    if (heading) {
      const content = parseInline(heading[2]);
      blocks.push({ type: 'heading', attrs: { level: Math.min(heading[1].length, 3) }, ...(content.length ? { content } : {}) });
      i += 1;
      continue;
    }
    if (HR.test(line) && !LIST_ITEM.test(line)) { blocks.push({ type: 'horizontalRule' }); i += 1; continue; }

    if (line.trim().startsWith('|') && i + 1 < lines.length && TABLE_SEPARATOR.test(lines[i + 1])) {
      const header = splitTableRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith('|')) { rows.push(splitTableRow(lines[i])); i += 1; }
      const width = header.length;
      const cell = (type: 'tableHeader' | 'tableCell', text: string): TiptapNode => ({ type, content: [paragraph(text)] });
      blocks.push({
        type: 'table',
        content: [
          { type: 'tableRow', content: header.map(text => cell('tableHeader', text)) },
          ...rows.map(row => ({ type: 'tableRow', content: Array.from({ length: width }, (_, c) => cell('tableCell', row[c] ?? '')) })),
        ],
      });
      continue;
    }

    if (QUOTE.test(line) && depth < MAX_DEPTH) {
      const inner: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) { inner.push(QUOTE.exec(lines[i])![1]); i += 1; }
      const inside = parseBlocks(inner, depth + 1);
      blocks.push({ type: 'blockquote', content: inside.length ? inside : [{ type: 'paragraph' }] });
      continue;
    }

    if (LIST_ITEM.test(line)) {
      const entries: ListEntry[] = [];
      while (i < lines.length) {
        const m = LIST_ITEM.exec(lines[i]);
        if (m && !HR.test(lines[i])) {
          const marker = m[2];
          const task = /^\[( |x|X)\]\s+(.*)$/.exec(m[3]);
          entries.push({
            indent: m[1].replace(/\t/g, '    ').length,
            ordered: /\d/.test(marker),
            start: /\d/.test(marker) ? parseInt(marker, 10) : 1,
            task: task ? task[1].toLowerCase() === 'x' : null,
            text: task ? task[2] : m[3],
          });
          i += 1;
          continue;
        }
        // Une ligne vide ne coupe la liste que si l'élément suivant n'en est pas un.
        if (lines[i].trim() === '' && i + 1 < lines.length && LIST_ITEM.test(lines[i + 1]) && !HR.test(lines[i + 1])) { i += 1; continue; }
        // Suite d'un élément (retrait) : ajoutée à son texte.
        if (/^\s{2,}\S/.test(lines[i]) && entries.length && !startsBlock(lines[i])) { entries[entries.length - 1].text += ` ${lines[i].trim()}`; i += 1; continue; }
        break;
      }
      if (entries.length === 0) { i += 1; continue; }
      let at = 0;
      while (at < entries.length) {
        const { node, next } = buildList(entries, at, entries[at].indent, 0);
        blocks.push(node);
        at = next > at ? next : at + 1;
      }
      continue;
    }

    // Paragraphe : lignes jusqu'à une ligne vide ou le début d'un autre bloc ; un saut de ligne devient un retour.
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() !== '' && (para.length === 0 || !startsBlock(lines[i], lines[i + 1])) && !HTML_ONLY.test(lines[i])) {
      para.push(lines[i].replace(/\s+$/, ''));
      i += 1;
    }
    if (para.length === 0) { i += 1; continue; }
    const content: TiptapNode[] = [];
    para.forEach((text, index) => {
      if (index > 0) content.push({ type: 'hardBreak' });
      content.push(...parseInline(text.trim()));
    });
    blocks.push(content.length ? { type: 'paragraph', content } : { type: 'paragraph' });
  }
  return blocks;
}

/** Document Tiptap d'une page Markdown. Toujours au moins un paragraphe (un document vide n'est pas valide). */
export function markdownToTiptap(markdown: string): TiptapDoc {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const content = parseBlocks(lines, 0);
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] };
}
