// Texte riche des éditeurs (Tiptap) : conversions sans DOM, utilisables côté
// client comme côté serveur.
//
//   - `htmlToPlainText` : donne à l'IA le contenu déjà rédigé, sans balises ;
//   - `aiTextToHtml`    : transforme la réponse de l'IA (paragraphes, titres,
//     listes, gras) en HTML à insérer dans l'éditeur. Tout est échappé : la
//     réponse d'un modèle n'est jamais injectée telle quelle.

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };

export const escapeHtml = (v: string): string =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function htmlToPlainText(html: string | null | undefined): string {
  if (!html) return '';
  return html
    .replace(/<\s*li[^>]*>/gi, '- ')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(p|h[1-6]|li|blockquote|div|ul|ol)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, m => ENTITIES[m] ?? m)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Gras (**x**) et italique (*x*) d'une ligne, après échappement. */
function inline(line: string): string {
  return escapeHtml(line)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*(?!\*)/g, '$1<em>$2</em>');
}

export function aiTextToHtml(text: string): string {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let list: { tag: 'ul' | 'ol'; items: string[] } | null = null;
  let para: string[] = [];

  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) out.push(`<${list.tag}>${list.items.map(i => `<li><p>${inline(i)}</p></li>`).join('')}</${list.tag}>`);
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trim();
    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    const bullet = /^[-*•]\s+(.+)$/.exec(line);
    const numbered = /^\d+[.)]\s+(.+)$/.exec(line);
    if (!line) { flushPara(); flushList(); continue; }
    if (heading) {
      flushPara(); flushList();
      out.push(`<h${heading[1].length >= 3 ? 3 : 2}>${inline(heading[2])}</h${heading[1].length >= 3 ? 3 : 2}>`);
    } else if (bullet || numbered) {
      flushPara();
      const tag = bullet ? 'ul' : 'ol';
      if (list && list.tag !== tag) flushList();
      if (!list) list = { tag, items: [] };
      list.items.push((bullet || numbered)![1]);
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara(); flushList();
  return out.join('');
}
