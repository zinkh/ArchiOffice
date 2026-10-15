// Mise en forme du dossier de références. Fonctions pures, testées
// (tests/referencesDossier.test.ts).

const NBSP = ' ';

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Filtre « | NC » du gabarit : une valeur vide s'affiche « NC » (non communiqué). */
export function nc(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return 'NC';
  const text = String(value).trim();
  return text === '' ? 'NC' : text;
}

/** Texte saisi vide ou fait d'espaces : null. */
export function cleanText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text === '' ? null : text;
}

/** Nombre saisi en texte (« 8 120 », « 1 200,5 »). Zéro ou illisible : null (donnée non renseignée). */
export function parseAmount(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
  const normalized = String(value).replace(/[\s  €]/g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const n = Number(normalized);
  return n > 0 ? n : null;
}

function groupThousands(n: number): string {
  const rounded = Math.round(n);
  return String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

export function formatSurface(n: number | null): string | null {
  return n === null ? null : `${groupThousands(n)}${NBSP}m²`;
}

export function formatAmountHt(n: number | null): string | null {
  return n === null ? null : `${groupThousands(n)}${NBSP}€${NBSP}HT`;
}

/** Ligne « Surface / Budget » : seules les parties connues sont imprimées, « NC » sinon. */
export function surfaceBudgetLine(r: Pick<ReferenceLike, 'surface' | 'amount' | 'amountText'>): string {
  const surface = formatSurface(r.surface);
  const budget = cleanText(r.amountText) ?? (r.amount !== null ? `${formatAmountHt(r.amount)} travaux` : null);
  return `${nc(surface)} — ${nc(budget)}`;
}

interface ReferenceLike {
  surface: number | null;
  amount: number | null;
  amountText: string | null;
}

/**
 * Ville et département tirés d'une adresse libre (« 54000 Nancy »,
 * « 3 rue X, 54500 Vandœuvre-lès-Nancy »). Rien n'est deviné : sans code
 * postal à 5 chiffres, on rend null. Corse (20xxx) ignorée : 2A/2B ne se
 * déduit pas du code postal.
 */
export function deriveCityDept(text: string | null | undefined): { city: string | null; department: string | null } {
  if (!text) return { city: null, department: null };
  const m = /\b(\d{5})\s+([A-Za-zÀ-ÿŒœ][A-Za-zÀ-ÿŒœ'’\- ]*?)\s*(?:,|\(|$)/.exec(text.trim());
  if (!m) return { city: null, department: null };
  const cp = m[1];
  const city = cleanText(m[2]);
  let department: string | null = null;
  if (/^9[78]/.test(cp)) department = cp.slice(0, 3);
  else if (!cp.startsWith('20')) department = cp.slice(0, 2);
  return { city, department };
}

/** « Atelier d'Architecture Zomeno Sektaoui » -> « AAZS » ; un nom déjà court (« AAZS ») reste tel quel. */
export function agencyAcronym(name: string | null | undefined): string {
  const clean = cleanText(name);
  if (!clean) return '';
  if (!/\s/.test(clean) && clean.length <= 6) return clean.toUpperCase();
  const initials = clean
    .split(/[\s'’]+/)
    .filter(w => /^[A-ZÀ-ÖØ-Þ]/.test(w))
    .map(w => w[0])
    .join('');
  return initials.length >= 2 ? initials : clean.slice(0, 4).toUpperCase();
}

/** « NATURE — Ville (Dépt) », en majuscules ; les éléments inconnus sont simplement omis. */
export function sheetTitle(r: { name: string; nature: string | null; city: string | null; department: string | null }): string {
  const head = r.nature ?? r.name;
  const place = r.city ? (r.department ? `${r.city} (${r.department})` : r.city) : null;
  return (place ? `${head} — ${place}` : head).toLocaleUpperCase('fr-FR');
}

/** Classe CSS du gabarit selon le nombre d'images : n1, n2, n3, n4, n5, n6, ou vide sans image. */
export function classeNbImages(count: number): string {
  if (count <= 0) return '';
  return `n${Math.min(count, 6)}`;
}

/** « 01 / 12 » */
export function pageLabel(page: number, total: number): string {
  const w = Math.max(2, String(total).length);
  return `${String(page).padStart(w, '0')} / ${String(total).padStart(w, '0')}`;
}
