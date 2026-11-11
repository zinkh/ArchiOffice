// Menu « / » de l'éditeur de texte riche : détection de la saisie et filtrage
// des commandes, sans dépendance à l'éditeur (testable seul).

export type AiMode = 'write' | 'continue' | 'rewrite' | 'shorten' | 'expand' | 'fix';

export type SlashAction =
  | { type: 'ai'; mode: AiMode }
  | { type: 'block'; block: 'h2' | 'h3' | 'bullet' | 'ordered' | 'quote' | 'divider' };

export interface SlashItem {
  id: string;
  /** Clé i18next du libellé. */
  labelKey: string;
  /** Mots-clés supplémentaires pour la recherche (français, sans accent). */
  keywords: string[];
  action: SlashAction;
}

export const SLASH_ITEMS: readonly SlashItem[] = [
  { id: 'ai_write', labelKey: 'richtext_slash_ai_write', keywords: ['ia', 'ai', 'ecrire', 'rediger', 'paragraphe', 'generer'], action: { type: 'ai', mode: 'write' } },
  { id: 'ai_continue', labelKey: 'richtext_slash_ai_continue', keywords: ['ia', 'ai', 'continuer', 'suite', 'poursuivre'], action: { type: 'ai', mode: 'continue' } },
  { id: 'ai_rewrite', labelKey: 'richtext_slash_ai_rewrite', keywords: ['ia', 'ai', 'reformuler', 'reecrire', 'ameliorer'], action: { type: 'ai', mode: 'rewrite' } },
  { id: 'ai_shorten', labelKey: 'richtext_slash_ai_shorten', keywords: ['ia', 'ai', 'raccourcir', 'resumer', 'synthetiser'], action: { type: 'ai', mode: 'shorten' } },
  { id: 'ai_expand', labelKey: 'richtext_slash_ai_expand', keywords: ['ia', 'ai', 'developper', 'detailler', 'etoffer'], action: { type: 'ai', mode: 'expand' } },
  { id: 'ai_fix', labelKey: 'richtext_slash_ai_fix', keywords: ['ia', 'ai', 'corriger', 'orthographe', 'grammaire'], action: { type: 'ai', mode: 'fix' } },
  { id: 'h2', labelKey: 'richtext_slash_h2', keywords: ['titre', 'chapitre', 'h2'], action: { type: 'block', block: 'h2' } },
  { id: 'h3', labelKey: 'richtext_slash_h3', keywords: ['sous-titre', 'titre', 'h3'], action: { type: 'block', block: 'h3' } },
  { id: 'bullet', labelKey: 'richtext_slash_bullet', keywords: ['liste', 'puces', 'tirets'], action: { type: 'block', block: 'bullet' } },
  { id: 'ordered', labelKey: 'richtext_slash_ordered', keywords: ['liste', 'numerotee', 'numeros'], action: { type: 'block', block: 'ordered' } },
  { id: 'quote', labelKey: 'richtext_slash_quote', keywords: ['citation', 'encadre', 'remarque'], action: { type: 'block', block: 'quote' } },
  { id: 'divider', labelKey: 'richtext_slash_divider', keywords: ['separateur', 'ligne', 'trait'], action: { type: 'block', block: 'divider' } },
];

/** Minuscules sans accents : « Écrire » et « ecrire » se valent. */
export const foldText = (v: string): string =>
  v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Le texte qui précède le curseur dans le paragraphe se termine-t-il par une
 * commande « /mot » ? Le « / » doit ouvrir le paragraphe ou suivre une espace
 * (« 3/4 » n'ouvre rien). `from` est l'offset du « / » dans ce texte.
 */
export function matchSlash(textBefore: string): { query: string; from: number } | null {
  const m = /(^|\s)\/([^\s/]{0,24})$/.exec(textBefore);
  if (!m) return null;
  return { query: m[2], from: textBefore.length - m[2].length - 1 };
}

/**
 * `label` : le libellé déjà traduit de chaque commande, pour qu'on retrouve
 * « Écrire avec l'IA » en tapant « /ecr » ou « /ia ».
 */
export function filterSlashItems(
  items: readonly SlashItem[], query: string, label: (item: SlashItem) => string, aiEnabled: boolean,
): SlashItem[] {
  const q = foldText(query.trim());
  return items
    .filter(item => aiEnabled || item.action.type !== 'ai')
    .filter(item => !q || foldText(label(item)).includes(q) || item.keywords.some(k => foldText(k).startsWith(q)));
}
