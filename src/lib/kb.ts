// « Base de données » du cabinet (mini-Notion) : types et logique pure partagés entre le serveur
// (server/routes/knowledgeBase.ts) et l'interface (src/components/kb). Voir supabase/migrate_kb_pages.sql.

export const KB_PROPERTY_TYPES = ['title', 'text', 'number', 'select', 'multi_select', 'date', 'checkbox', 'url', 'relation'] as const;
export type KbPropertyType = (typeof KB_PROPERTY_TYPES)[number];

/** Couleurs de DONNÉES des tags (distinctes des couleurs d'état : vert, orange et rouge restent réservés au statut). */
export const KB_TAG_COLORS = ['gris', 'bleu', 'ciel', 'sarcelle', 'olive', 'ocre', 'brique', 'rose', 'violet', 'brun'] as const;
export type KbTagColor = (typeof KB_TAG_COLORS)[number];

export interface KbOption { id: string; label: string; color: KbTagColor }

export interface KbPage {
  id: string;
  parent_id: string | null;
  kind: 'page' | 'database';
  title: string;
  icon: string | null;
  content?: unknown;
  properties?: Record<string, unknown>;
  position: number;
  is_favorite: boolean;
  project_id?: string | null;
  updated_at?: string;
  trashed_at?: string | null;
}

export interface KbProperty {
  id: string;
  database_id: string;
  name: string;
  type: KbPropertyType;
  options: KbOption[];
  position: number;
  width?: number | null;
}

export type KbFilterOp = 'contains' | 'equals' | 'not_equals' | 'is_empty' | 'is_not_empty' | 'has' | 'has_not' | 'checked' | 'unchecked';
export interface KbFilter { property_id: string; op: KbFilterOp; value?: string }
export interface KbSort { property_id: string; direction: 'asc' | 'desc' }
export interface KbViewConfig { filters?: KbFilter[]; sorts?: KbSort[]; hidden?: string[]; order?: string[] }

/** Opérateurs de filtre proposés pour un type de colonne, le premier étant l'opérateur par défaut. */
export function kbFilterOps(type: KbPropertyType): KbFilterOp[] {
  switch (type) {
    case 'select':
    case 'multi_select': return ['has', 'has_not', 'is_empty', 'is_not_empty'];
    case 'checkbox': return ['checked', 'unchecked'];
    case 'relation': return ['is_empty', 'is_not_empty'];
    default: return ['contains', 'equals', 'not_equals', 'is_empty', 'is_not_empty'];
  }
}

/** Vrai si l'opérateur compare à une valeur saisie (les autres, « est vide » ou « coché », n'en ont pas). */
export function kbOpNeedsValue(op: KbFilterOp): boolean {
  return op === 'contains' || op === 'equals' || op === 'not_equals' || op === 'has' || op === 'has_not';
}

export const KB_MAX_DEPTH = 12;
export const KB_MAX_OPTIONS = 100;

export const isKbPropertyType = (value: unknown): value is KbPropertyType =>
  typeof value === 'string' && (KB_PROPERTY_TYPES as readonly string[]).includes(value);

export const isKbTagColor = (value: unknown): value is KbTagColor =>
  typeof value === 'string' && (KB_TAG_COLORS as readonly string[]).includes(value);

/** Normalise une liste d'options (tags) reçue du client : ids stables, libellés non vides, couleurs connues. */
export function sanitizeKbOptions(raw: unknown, makeId: () => string): KbOption[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: KbOption[] = [];
  for (const item of raw.slice(0, KB_MAX_OPTIONS)) {
    const label = typeof item?.label === 'string' ? item.label.trim().slice(0, 80) : '';
    if (!label || seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    const id = typeof item?.id === 'string' && item.id ? item.id.slice(0, 64) : makeId();
    out.push({ id, label, color: isKbTagColor(item?.color) ? item.color : 'gris' });
  }
  return out;
}

/**
 * Valide la valeur d'une cellule selon le type de sa propriété. Rend la valeur nettoyée, ou un message
 * d'erreur. `null` efface la valeur.
 */
export function sanitizeKbValue(property: Pick<KbProperty, 'type' | 'options'>, value: unknown): { value?: unknown; error?: string } {
  if (value === null || value === undefined) return { value: null };
  switch (property.type) {
    case 'title':
    case 'text':
      return typeof value === 'string' ? { value: value.slice(0, 20_000) } : { error: 'Texte attendu.' };
    case 'url':
      return typeof value === 'string' ? { value: value.trim().slice(0, 2_000) } : { error: 'Lien attendu.' };
    case 'number': {
      const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value.replace(',', '.')) : NaN;
      return Number.isFinite(n) ? { value: n } : { error: 'Nombre attendu.' };
    }
    case 'checkbox':
      return typeof value === 'boolean' ? { value } : { error: 'Case à cocher attendue.' };
    case 'date':
      return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) && !Number.isNaN(Date.parse(value))
        ? { value: value.slice(0, 10) } : { error: 'Date attendue (AAAA-MM-JJ).' };
    case 'select': {
      if (typeof value !== 'string') return { error: 'Option attendue.' };
      return property.options.some(o => o.id === value) ? { value } : { error: 'Option inconnue.' };
    }
    case 'multi_select': {
      if (!Array.isArray(value) || value.some(v => typeof v !== 'string')) return { error: 'Liste d\'options attendue.' };
      const known = new Set(property.options.map(o => o.id));
      if (value.some(v => !known.has(v))) return { error: 'Option inconnue.' };
      return { value: Array.from(new Set(value as string[])) };
    }
    case 'relation':
      return Array.isArray(value) && value.every(v => typeof v === 'string') ? { value: Array.from(new Set(value as string[])).slice(0, 200) } : { error: 'Liste de pages attendue.' };
    default:
      return { error: 'Type de propriété inconnu.' };
  }
}

/** Texte brut d'un document Tiptap (JSON), pour la recherche et les agents. */
export function kbContentToText(node: unknown, limit = 200_000): string {
  const parts: string[] = [];
  let size = 0;
  const walk = (n: any) => {
    if (!n || size >= limit) return;
    if (typeof n.text === 'string') { parts.push(n.text); size += n.text.length; }
    if (Array.isArray(n.content)) {
      for (const child of n.content) walk(child);
      if (n.type && n.type !== 'text') parts.push('\n');
    }
  };
  walk(node);
  return parts.join('').replace(/\n{3,}/g, '\n\n').trim().slice(0, limit);
}

/** Profondeur d'une page dans l'arbre (0 = racine), ou null si la chaîne boucle ou est coupée. */
export function kbDepth(id: string | null, pages: Array<Pick<KbPage, 'id' | 'parent_id'>>): number | null {
  const byId = new Map(pages.map(p => [p.id, p]));
  let depth = 0;
  let cursor = id;
  const seen = new Set<string>();
  while (cursor) {
    if (seen.has(cursor)) return null;
    seen.add(cursor);
    const page = byId.get(cursor);
    if (!page) return null;
    cursor = page.parent_id;
    if (cursor) depth += 1;
    if (depth > KB_MAX_DEPTH * 2) return null;
  }
  return depth;
}

/** Vrai si déplacer `id` sous `newParentId` ferait de la page son propre ancêtre. */
export function kbWouldCycle(id: string, newParentId: string | null, pages: Array<Pick<KbPage, 'id' | 'parent_id'>>): boolean {
  const byId = new Map(pages.map(p => [p.id, p]));
  let cursor = newParentId;
  const seen = new Set<string>();
  while (cursor) {
    if (cursor === id || seen.has(cursor)) return true;
    seen.add(cursor);
    cursor = byId.get(cursor)?.parent_id ?? null;
  }
  return false;
}

const isEmptyValue = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

function cellText(property: KbProperty, value: unknown): string {
  if (isEmptyValue(value)) return '';
  if (property.type === 'select') return property.options.find(o => o.id === value)?.label ?? '';
  if (property.type === 'multi_select' && Array.isArray(value)) {
    return value.map(v => property.options.find(o => o.id === v)?.label ?? '').filter(Boolean).join(', ');
  }
  if (property.type === 'checkbox') return value ? 'oui' : 'non';
  return String(value);
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function matchesFilter(row: KbPage, properties: KbProperty[], filter: KbFilter): boolean {
  const property = properties.find(p => p.id === filter.property_id);
  if (!property) return true;
  const raw = property.type === 'title' ? row.title : row.properties?.[property.id];
  const wanted = filter.value ?? '';
  switch (filter.op) {
    case 'is_empty': return isEmptyValue(raw);
    case 'is_not_empty': return !isEmptyValue(raw);
    case 'checked': return raw === true;
    case 'unchecked': return raw !== true;
    case 'has': return Array.isArray(raw) ? raw.includes(wanted) : raw === wanted;
    case 'has_not': return Array.isArray(raw) ? !raw.includes(wanted) : raw !== wanted;
    case 'equals': return norm(cellText(property, raw)) === norm(wanted);
    case 'not_equals': return norm(cellText(property, raw)) !== norm(wanted);
    case 'contains':
    default: return norm(cellText(property, raw)).includes(norm(wanted));
  }
}

/** Applique recherche, filtres et tris d'une vue aux lignes d'une base. Ne modifie pas le tableau reçu. */
export function applyKbView(rows: KbPage[], properties: KbProperty[], config: KbViewConfig, search = ''): KbPage[] {
  const q = norm(search.trim());
  let out = rows.filter(row => {
    if (q) {
      const haystack = properties.map(p => cellText(p, p.type === 'title' ? row.title : row.properties?.[p.id])).join(' ');
      if (!norm(haystack).includes(q)) return false;
    }
    return (config.filters || []).every(f => matchesFilter(row, properties, f));
  });
  const sorts = config.sorts || [];
  if (sorts.length) {
    out = [...out].sort((a, b) => {
      for (const sort of sorts) {
        const property = properties.find(p => p.id === sort.property_id);
        if (!property) continue;
        const av = property.type === 'title' ? a.title : a.properties?.[property.id];
        const bv = property.type === 'title' ? b.title : b.properties?.[property.id];
        let cmp: number;
        if (property.type === 'number') cmp = (Number(av) || 0) - (Number(bv) || 0);
        else cmp = cellText(property, av).localeCompare(cellText(property, bv), 'fr', { sensitivity: 'base', numeric: true });
        if (cmp !== 0) return sort.direction === 'desc' ? -cmp : cmp;
      }
      return 0;
    });
  } else {
    out = [...out].sort((a, b) => a.position - b.position);
  }
  return out;
}
