// Logique pure de la vue GED générale (/documents) : navigation, filtres, recherche, tri.
// Aucune dépendance à React : la page ne fait que l'afficher.

export interface GedDoc {
  id: string;
  name: string;
  project_id?: string | null;
  phase?: string | null;
  doc_type?: string | null;
  doc_statut?: string | null;
  indice?: string | null;
  version?: number;
  uploaded_at?: string;
  description?: string | null;
  emetteur?: string | null;
}

export type GedNavKind = 'all' | 'recent' | 'fav' | 'toclass' | 'project' | 'phase' | 'type' | 'statut';

/** Sélection de la navigation de gauche. `project` vaut un identifiant d'affaire ; `value` un code de phase, un type ou un statut. */
export interface GedNav { kind: GedNavKind; project?: string; value?: string }

export const GED_ALL: GedNav = { kind: 'all' };
export const RECENT_COUNT = 20;
export const NO_PROJECT = '__none__';

export interface GedFilters {
  search: string;
  phase: string;
  type: string;
  statut: string;
  extensions: ReadonlySet<string>;
}

export const NO_FILTERS: GedFilters = { search: '', phase: '', type: '', statut: '', extensions: new Set() };

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : '';
}

const timeOf = (d: GedDoc): number => {
  const t = d.uploaded_at ? Date.parse(d.uploaded_at) : NaN;
  return Number.isNaN(t) ? 0 : t;
};

/** Les `count` documents les plus récemment déposés. */
export function recentIds(docs: readonly GedDoc[], count = RECENT_COUNT): Set<string> {
  return new Set([...docs].sort((a, b) => timeOf(b) - timeOf(a)).slice(0, count).map(d => d.id));
}

export function statutOf(d: GedDoc): string { return d.doc_statut || 'en_cours'; }
export function phaseOf(d: GedDoc): string { return d.phase || 'Général'; }

export function matchesNav(d: GedDoc, nav: GedNav, favs: ReadonlySet<string>, recent: ReadonlySet<string>): boolean {
  switch (nav.kind) {
    case 'all': return true;
    case 'recent': return recent.has(d.id);
    case 'fav': return favs.has(d.id);
    case 'toclass': return !d.project_id;
    case 'project':
      if (nav.project === NO_PROJECT) return !d.project_id && (!nav.value || phaseOf(d) === nav.value);
      return d.project_id === nav.project && (!nav.value || phaseOf(d) === nav.value);
    case 'phase': return phaseOf(d) === nav.value;
    case 'type': return (d.doc_type || '') === (nav.value || '');
    case 'statut': return statutOf(d) === nav.value;
  }
}

const fold = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Texte interrogé par la recherche : nom, projet, type, phase, émetteur, description. Accents et casse ignorés. */
export function searchHaystack(d: GedDoc, projectName: string): string {
  return fold([d.name, projectName, d.doc_type, phaseOf(d), d.emetteur, d.description].filter(Boolean).join(' '));
}

export function filterDocs(
  docs: readonly GedDoc[], nav: GedNav, f: GedFilters,
  ctx: { favs: ReadonlySet<string>; recent: ReadonlySet<string>; projectName: (id?: string | null) => string },
): GedDoc[] {
  const q = fold(f.search.trim());
  return docs.filter(d =>
    matchesNav(d, nav, ctx.favs, ctx.recent)
    && (!f.phase || phaseOf(d) === f.phase)
    && (!f.type || (d.doc_type || '') === f.type)
    && (!f.statut || statutOf(d) === f.statut)
    && (f.extensions.size === 0 || f.extensions.has(extensionOf(d.name)))
    && (!q || searchHaystack(d, ctx.projectName(d.project_id)).includes(q)));
}

export type GedSortKey = 'name' | 'project' | 'phase' | 'type' | 'indice' | 'date';
export interface GedSort { key: GedSortKey; dir: 'asc' | 'desc' }

export function sortDocs(docs: readonly GedDoc[], sort: GedSort, projectName: (id?: string | null) => string): GedDoc[] {
  const value = (d: GedDoc): string | number => {
    switch (sort.key) {
      case 'name': return fold(d.name);
      case 'project': return fold(projectName(d.project_id));
      case 'phase': return phaseOf(d);
      case 'type': return fold(d.doc_type || '');
      case 'indice': return d.indice || '';
      case 'date': return timeOf(d);
    }
  };
  const sign = sort.dir === 'asc' ? 1 : -1;
  return [...docs].sort((a, b) => {
    const x = value(a), y = value(b);
    const c = typeof x === 'number' && typeof y === 'number'
      ? x - y
      : String(x).localeCompare(String(y), 'fr', { numeric: true });
    return c * sign || a.name.localeCompare(b.name, 'fr', { numeric: true });
  });
}

/** Découpe un texte autour des occurrences de `query` (accents et casse ignorés), sans HTML : la page rend les segments. */
export function highlightParts(text: string, query: string): { text: string; hit: boolean }[] {
  const q = fold(query.trim());
  if (!q) return [{ text, hit: false }];
  // fold() peut changer la longueur d'un caractère décomposé : on replie caractère par caractère pour garder les indices.
  const chars = Array.from(text);
  const folded = chars.map(c => fold(c));
  const flat = folded.join('');
  const owner: number[] = [];
  folded.forEach((f, i) => { for (let k = 0; k < f.length; k++) owner.push(i); });
  const hit = new Array<boolean>(chars.length).fill(false);
  let from = 0;
  for (;;) {
    const at = flat.indexOf(q, from);
    if (at < 0) break;
    for (let k = at; k < at + q.length; k++) hit[owner[k]] = true;
    from = at + q.length;
  }
  const parts: { text: string; hit: boolean }[] = [];
  chars.forEach((c, i) => {
    const last = parts[parts.length - 1];
    if (last && last.hit === hit[i]) last.text += c;
    else parts.push({ text: c, hit: hit[i] });
  });
  return parts;
}

/** Nombre de documents par clé (phase, type...) pour les compteurs de la navigation. */
export function countBy(docs: readonly GedDoc[], key: (d: GedDoc) => string): Map<string, number> {
  const m = new Map<string, number>();
  for (const d of docs) { const k = key(d); m.set(k, (m.get(k) || 0) + 1); }
  return m;
}
