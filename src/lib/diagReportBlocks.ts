// HTML de l'éditeur de texte riche -> blocs simples (titres, paragraphes, puces,
// citations, filets) pour les exports PDF et Word. Sans DOM : l'éditeur n'écrit
// que quelques balises (voir server/richHtml.ts), un petit lecteur suffit et se
// teste hors navigateur.

export interface Run { text: string; bold?: boolean; italic?: boolean }
export type Block =
  | { type: 'h2' | 'h3' | 'p' | 'quote'; runs: Run[] }
  | { type: 'li'; runs: Run[]; ordered: boolean; index: number }
  | { type: 'hr' };

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };
const decode = (s: string): string => s.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, m => ENTITIES[m] ?? m);

export function htmlToBlocks(html: string | null | undefined): Block[] {
  const blocks: Block[] = [];
  if (!html) return blocks;

  const lists: { ordered: boolean; count: number }[] = [];
  let bold = 0;
  let italic = 0;
  let quote = 0;
  let current: Block | null = null;
  let inLi = false;

  const flush = () => {
    if (!current || current.type === 'hr') { current = null; return; }
    const runs = current.runs;
    if (runs.length) {
      runs[0] = { ...runs[0], text: runs[0].text.replace(/^\s+/, '') };
      runs[runs.length - 1] = { ...runs[runs.length - 1], text: runs[runs.length - 1].text.replace(/\s+$/, '') };
    }
    if (runs.some(r => r.text.trim())) blocks.push(current);
    current = null;
  };
  const open = (block: Block) => { flush(); current = block; };
  const ensure = () => { if (!current) current = { type: quote ? 'quote' : 'p', runs: [] }; };

  const re = /<(\/?)([a-z0-9]+)[^>]*>|([^<]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[3] !== undefined) {
      const text = decode(m[3]).replace(/[ \t\r\n]+/g, ' ');
      if (!text.trim() && !current) continue;
      ensure();
      (current as any).runs.push({ text, ...(bold ? { bold: true } : {}), ...(italic ? { italic: true } : {}) });
      continue;
    }
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    switch (tag) {
      case 'strong': case 'b': bold = Math.max(0, bold + (closing ? -1 : 1)); break;
      case 'em': case 'i': italic = Math.max(0, italic + (closing ? -1 : 1)); break;
      case 'blockquote': quote = Math.max(0, quote + (closing ? -1 : 1)); if (closing) flush(); break;
      case 'ul': case 'ol':
        if (closing) { flush(); lists.pop(); } else { flush(); lists.push({ ordered: tag === 'ol', count: 0 }); }
        break;
      case 'li':
        if (closing) { flush(); inLi = false; }
        else {
          const list = lists[lists.length - 1] ?? { ordered: false, count: 0 };
          list.count += 1;
          open({ type: 'li', runs: [], ordered: list.ordered, index: list.count });
          inLi = true;
        }
        break;
      case 'p':
        if (inLi) break; // le paragraphe d'une puce appartient à la puce
        if (closing) flush(); else open({ type: quote ? 'quote' : 'p', runs: [] });
        break;
      case 'h1': case 'h2': case 'h3':
        if (closing) flush(); else open({ type: tag === 'h3' ? 'h3' : 'h2', runs: [] });
        break;
      case 'br': ensure(); (current as any).runs.push({ text: '\n' }); break;
      case 'hr': flush(); blocks.push({ type: 'hr' }); break;
      default: break;
    }
  }
  flush();
  return blocks;
}
