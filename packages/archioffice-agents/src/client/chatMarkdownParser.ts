// Markdown des réponses d'agent : analyse pure (sans React), pour pouvoir la tester.
//
// Les modèles répondent en Markdown (titres, gras, listes, tableaux, liens) et le chat
// l'affichait en texte brut : « #### **Écologue** », « **[BIOTOPE](https://…)** ». Le rendu
// (ChatMarkdown.tsx) ne passe JAMAIS par du HTML brut : l'analyse produit des nœuds typés que
// React rend en éléments, donc aucun script ni attribut venu du modèle ne peut s'injecter.
// Seuls les liens http(s), mailto, tel et les chemins relatifs sont conservés.

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'code'; v: string }
  | { t: 'bold' | 'italic' | 'del'; c: Inline[] }
  | { t: 'link'; href: string; c: Inline[] }
  | { t: 'br' };

export type Block =
  | { t: 'heading'; level: number; c: Inline[] }
  | { t: 'para'; c: Inline[] }
  | { t: 'hr' }
  | { t: 'code'; lang: string; v: string }
  | { t: 'quote'; c: Block[] }
  | { t: 'list'; ordered: boolean; start: number; items: { c: Inline[]; sub: Block[] }[] }
  | { t: 'table'; head: Inline[][]; rows: Inline[][][]; align: ('left' | 'center' | 'right' | null)[] };

const SAFE_HREF = /^(https?:\/\/|mailto:|tel:|\/(?!\/))/i;

/** Un lien n'est gardé que s'il a un schéma sûr : javascript:, data: et consorts sont écartés. */
export function safeHref(href: string): string | null {
  const h = href.trim();
  return SAFE_HREF.test(h) ? h : null;
}

const isAlnum = (ch: string | undefined) => !!ch && /[\p{L}\p{N}]/u.test(ch);

/** Cherche la fermeture `marker` à partir de `from`, hors d'un lien ou d'un code en ligne. */
function findClose(s: string, marker: string, from: number): number {
  let i = from;
  while (i < s.length) {
    if (s[i] === '\\') { i += 2; continue; }
    if (s[i] === '`') {
      const end = s.indexOf('`', i + 1);
      if (end === -1) { i++; continue; }
      i = end + 1;
      continue;
    }
    if (s[i] === '[') {
      const m = /^\[[^\]]*\]\([^)\s]*(?:\([^)\s]*\)[^)\s]*)*\)/.exec(s.slice(i));
      if (m) { i += m[0].length; continue; }
    }
    if (s.startsWith(marker, i)) {
      // `**` ne doit pas fermer sur `***` mal formé ; un `*` simple ne ferme pas sur `**`.
      if (marker.length === 1 && s[i + 1] === marker) { i += 2; continue; }
      return i;
    }
    i++;
  }
  return -1;
}

const LINK_RE = /^\[([^\]]*)\]\(\s*<?([^)\s>]*(?:\([^)\s]*\)[^)\s]*)*)>?(?:\s+"[^"]*")?\s*\)/;
const BARE_URL_RE = /^https?:\/\/[^\s<>]+/i;

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let buf = '';
  const flush = () => { if (buf) { out.push({ t: 'text', v: buf }); buf = ''; } };
  let i = 0;
  while (i < src.length) {
    const ch = src[i];

    if (ch === '\\' && i + 1 < src.length && /[\\`*_{}[\]()#+\-.!~|>]/.test(src[i + 1])) {
      buf += src[i + 1]; i += 2; continue;
    }

    if (ch === '`') {
      const end = src.indexOf('`', i + 1);
      if (end > i + 1) { flush(); out.push({ t: 'code', v: src.slice(i + 1, end) }); i = end + 1; continue; }
    }

    if (ch === '[') {
      const m = LINK_RE.exec(src.slice(i));
      if (m) {
        flush();
        const href = safeHref(m[2]);
        const children = parseInline(m[1] || m[2]);
        if (href) out.push({ t: 'link', href, c: children }); else out.push(...children);
        i += m[0].length;
        continue;
      }
    }

    if (ch === 'h' && (src.startsWith('http://', i) || src.startsWith('https://', i)) && !isAlnum(src[i - 1])) {
      const m = BARE_URL_RE.exec(src.slice(i));
      if (m) {
        // La ponctuation qui suit une adresse n'en fait pas partie.
        let url = m[0].replace(/[.,;:!?'"»)\]]+$/, '');
        if (!url.includes('(')) url = url.replace(/\)+$/, '');
        flush();
        out.push({ t: 'link', href: url, c: [{ t: 'text', v: url }] });
        i += url.length;
        continue;
      }
    }

    if (src.startsWith('**', i) || src.startsWith('__', i) || src.startsWith('~~', i)) {
      const marker = src.slice(i, i + 2);
      const end = findClose(src, marker, i + 2);
      if (end > i + 2 && !/^\s/.test(src[i + 2]) && !/\s$/.test(src.slice(i + 2, end))) {
        flush();
        out.push({ t: marker === '~~' ? 'del' : 'bold', c: parseInline(src.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }

    if ((ch === '*' || ch === '_') && src[i + 1] !== ch) {
      // `_` n'ouvre pas un mot (snake_case) ; `*` suivi d'une espace est une puce ou un produit.
      const wordBefore = ch === '_' && isAlnum(src[i - 1]);
      if (!wordBefore && src[i + 1] && !/\s/.test(src[i + 1])) {
        const end = findClose(src, ch, i + 1);
        if (end > i + 1 && !/\s/.test(src[end - 1]) && !(ch === '_' && isAlnum(src[end + 1]))) {
          flush();
          out.push({ t: 'italic', c: parseInline(src.slice(i + 1, end)) });
          i = end + 1;
          continue;
        }
      }
    }

    buf += ch; i++;
  }
  flush();
  return out;
}

/** Une ligne de paragraphe devient du texte inline ; les retours à la ligne sont conservés. */
function inlineWithBreaks(lines: string[]): Inline[] {
  const out: Inline[] = [];
  lines.forEach((line, idx) => {
    if (idx > 0) out.push({ t: 'br' });
    out.push(...parseInline(line.trim()));
  });
  return out;
}

const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR_RE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const FENCE_RE = /^\s{0,3}(```|~~~)\s*([\w+-]*)\s*$/;
const ULIST_RE = /^(\s*)[-*+]\s+(.*)$/;
const OLIST_RE = /^(\s*)(\d{1,9})[.)]\s+(.*)$/;
const QUOTE_RE = /^\s{0,3}>\s?(.*)$/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

function splitRow(line: string): string[] {
  let l = line.trim();
  if (l.startsWith('|')) l = l.slice(1);
  if (l.endsWith('|') && !l.endsWith('\\|')) l = l.slice(0, -1);
  return l.split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'));
}

const indentOf = (s: string) => s.replace(/\t/g, '    ').length - s.replace(/\t/g, '    ').trimStart().length;

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  return parseBlocks(lines);
}

function parseBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    const fence = FENCE_RE.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      i++;
      blocks.push({ t: 'code', lang: fence[2], v: body.join('\n') });
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) { blocks.push({ t: 'heading', level: heading[1].length, c: parseInline(heading[2]) }); i++; continue; }

    if (HR_RE.test(line)) { blocks.push({ t: 'hr' }); i++; continue; }

    if (QUOTE_RE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && QUOTE_RE.test(lines[i])) body.push(QUOTE_RE.exec(lines[i++])![1]);
      blocks.push({ t: 'quote', c: parseBlocks(body) });
      continue;
    }

    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const head = splitRow(line);
      const align = splitRow(lines[i + 1]).map(c => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : null)) as ('left' | 'center' | 'right' | null)[];
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
        const cells = splitRow(lines[i++]);
        rows.push(head.map((_, idx) => parseInline(cells[idx] ?? '')));
      }
      blocks.push({ t: 'table', head: head.map(parseInline), rows, align });
      continue;
    }

    const ul = ULIST_RE.exec(line);
    const ol = OLIST_RE.exec(line);
    if (ul || ol) {
      const ordered = !!ol && !ul;
      const baseIndent = indentOf(line);
      const items: { c: Inline[]; sub: Block[] }[] = [];
      const start = ordered ? Number(ol![2]) : 1;
      while (i < lines.length) {
        const cur = lines[i];
        const m = ordered ? OLIST_RE.exec(cur) : ULIST_RE.exec(cur);
        if (!m || indentOf(cur) !== baseIndent) break;
        const text = ordered ? m[3] : m[2];
        i++;
        const sub: string[] = [];
        const cont: string[] = [text];
        // Sous-liste ou suite d'item : lignes plus indentées, ou ligne vide suivie d'une ligne indentée.
        while (i < lines.length) {
          const next = lines[i];
          if (!next.trim()) {
            if (i + 1 < lines.length && indentOf(lines[i + 1]) > baseIndent && lines[i + 1].trim()) { sub.push(next); i++; continue; }
            break;
          }
          if (indentOf(next) > baseIndent) {
            if (ULIST_RE.test(next) || OLIST_RE.test(next) || sub.length) sub.push(next); else cont.push(next.trim());
            i++;
            continue;
          }
          break;
        }
        items.push({ c: inlineWithBreaks(cont), sub: sub.length ? parseBlocks(sub) : [] });
        // Une ligne vide entre deux puces ne ferme pas la liste.
        if (i < lines.length && !lines[i].trim()) {
          let j = i;
          while (j < lines.length && !lines[j].trim()) j++;
          const after = lines[j];
          if (after !== undefined && (ordered ? OLIST_RE : ULIST_RE).test(after) && indentOf(after) === baseIndent) i = j;
        }
      }
      blocks.push({ t: 'list', ordered, start, items });
      continue;
    }

    const para: string[] = [];
    while (i < lines.length && lines[i].trim()
      && !HEADING_RE.test(lines[i]) && !FENCE_RE.test(lines[i]) && !HR_RE.test(lines[i])
      && !QUOTE_RE.test(lines[i]) && !ULIST_RE.test(lines[i]) && !OLIST_RE.test(lines[i])) {
      if (para.length && lines[i].includes('|') && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1]) && lines[i + 1].includes('-')) break;
      para.push(lines[i++]);
    }
    if (para.length) blocks.push({ t: 'para', c: inlineWithBreaks(para) });
    else i++;
  }
  return blocks;
}

// ── Texte brut (lecture à voix haute) ─────────────────────────────────────────

function inlineText(nodes: Inline[]): string {
  return nodes.map(n => {
    switch (n.t) {
      case 'text': case 'code': return n.v;
      case 'br': return ' ';
      case 'link': return inlineText(n.c);
      default: return inlineText(n.c);
    }
  }).join('');
}

function blockText(b: Block): string {
  switch (b.t) {
    case 'heading': case 'para': return inlineText(b.c);
    case 'hr': return '';
    case 'code': return b.v;
    case 'quote': return b.c.map(blockText).join('. ');
    case 'list': return b.items.map(it => [inlineText(it.c), ...it.sub.map(blockText)].filter(Boolean).join('. ')).join('. ');
    case 'table': return [b.head, ...b.rows].map(r => r.map(inlineText).join(', ')).join('. ');
  }
}

/** Le Markdown lu à voix haute dit « dièse dièse » et épelle les adresses : on lit le texte seul. */
export function markdownToPlainText(src: string): string {
  return parseMarkdown(src).map(blockText).filter(Boolean).join('\n\n');
}
