// Nettoyage du HTML produit par l'éditeur de texte riche avant enregistrement :
// seules les balises que l'éditeur sait écrire sont conservées. Rien d'autre
// (script, style, attributs d'événement, liens `javascript:`) ne survit à une
// requête forgée à la main.
import sanitizeHtml from 'sanitize-html';

export const MAX_RICH_HTML = 200_000;

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ['p', 'br', 'h2', 'h3', 'strong', 'em', 'u', 's', 'ul', 'ol', 'li', 'blockquote', 'hr'],
  allowedAttributes: {},
  disallowedTagsMode: 'discard',
};

export function sanitizeRichHtml(value: unknown): string {
  const raw = typeof value === 'string' ? value.slice(0, MAX_RICH_HTML) : '';
  return sanitizeHtml(raw, OPTIONS);
}
