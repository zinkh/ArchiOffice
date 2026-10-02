// Calculs du tableau de bord administrateur (src/pages/Dashboard.tsx), sortis
// de la page pour être testables sans rendu React.
//
// Deux incohérences à l'origine de ce module, à ne pas réintroduire :
// 1. Le graphique « Principales catégories » regroupait les projets par
//    `client`, pas par catégorie : chaque client n'ayant qu'une affaire, toutes
//    les barres avaient la même longueur et le graphique ne disait rien.
// 2. Le donut et la carte « Projets actifs » ne reconnaissaient que les
//    statuts anglais du formulaire (`In Progress`...). Un statut saisi en
//    français ou importé (« étude », « En cours (Études) ») disparaissait du
//    donut, dont le total ne correspondait plus au nombre de projets.

export type ProjectStatusGroup = 'active' | 'planning' | 'on_hold' | 'completed' | 'other';

const strip = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export function normalizeProjectStatus(raw: string | null | undefined): ProjectStatusGroup {
  const s = strip(raw ?? '');
  if (!s) return 'planning';
  if (s === 'completed' || /^(termine|livre|clos|achev|archiv)/.test(s)) return 'completed';
  if (s === 'on hold' || /^(en attente|suspendu|en pause|stand)/.test(s)) return 'on_hold';
  if (s === 'planning' || /^(planif|prospect|a demarrer|avant-projet)/.test(s)) return 'planning';
  if (s === 'in progress' || /^(en cours|etude|chantier|conception|travaux|actif)/.test(s)) return 'active';
  return 'other';
}

export const STATUS_GROUP_ORDER: ProjectStatusGroup[] = ['active', 'planning', 'on_hold', 'completed', 'other'];

export function statusBreakdown(projects: { status?: string | null }[]) {
  const counts: Record<ProjectStatusGroup, number> = { active: 0, planning: 0, on_hold: 0, completed: 0, other: 0 };
  projects.forEach(p => { counts[normalizeProjectStatus(p.status)] += 1; });
  return STATUS_GROUP_ORDER.map(group => ({ group, value: counts[group] })).filter(d => d.value > 0);
}

export const UNCATEGORIZED = 'Non renseignée';
export const OTHER_CATEGORIES = 'Autres';

/**
 * Affaires par catégorie réelle (`projects.category`), les plus fréquentes en
 * tête, « Non renseignée » toujours en dernier : c'est une donnée à compléter,
 * pas la première qu'on veut lire. Au-delà de `limit` catégories, le reste est
 * regroupé sous « Autres » pour que la somme des lignes reste le total.
 */
export function categoryBreakdown(projects: { category?: string | null }[], limit = 5) {
  const buckets = new Map<string, { name: string; count: number }>();
  let uncategorized = 0;
  projects.forEach(p => {
    const name = (p.category ?? '').trim();
    if (!name) { uncategorized += 1; return; }
    const key = strip(name);
    const b = buckets.get(key);
    if (b) b.count += 1; else buckets.set(key, { name, count: 1 });
  });
  const sorted = [...buckets.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'fr'));
  const rows = sorted.slice(0, limit);
  const rest = sorted.slice(limit).reduce((s, b) => s + b.count, 0);
  if (rest > 0) rows.push({ name: OTHER_CATEGORIES, count: rest });
  if (uncategorized > 0) rows.push({ name: UNCATEGORIZED, count: uncategorized });
  const total = projects.length || 1;
  return rows.map(r => ({ ...r, pct: Math.round((r.count / total) * 100) }));
}

export interface InvoiceLike {
  status?: string | null;
  total_amount?: number | null;
  amount?: number | null;
  issue_date?: string | null;
  created_at?: string | null;
  project_id?: string | null;
}

export const invoiceTotal = (inv: InvoiceLike) => Number(inv.total_amount || inv.amount || 0);
export const isPaid = (inv: InvoiceLike) => strip(inv.status ?? '') === 'paid';
/** Émise = tout sauf un brouillon (envoyée, payée, en retard). */
export const isIssued = (inv: InvoiceLike) => !!inv.status && strip(inv.status) !== 'draft';
export const isOverdue = (inv: InvoiceLike) => strip(inv.status ?? '') === 'overdue';

/**
 * Facturé (émis) et encaissé par mois sur les `months` derniers mois, mois
 * courant compris, datés par `issue_date` (repli sur `created_at`).
 */
export function monthlyRevenue(invoices: InvoiceLike[], now = new Date(), months = 12) {
  const series: { key: string; label: string; invoiced: number; paid: number }[] = [];
  const index = new Map<string, number>();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '');
    index.set(key, series.length);
    series.push({ key, label, invoiced: 0, paid: 0 });
  }
  invoices.forEach(inv => {
    if (!isIssued(inv)) return;
    const date = (inv.issue_date || inv.created_at || '').slice(0, 7);
    const i = index.get(date);
    if (i === undefined) return;
    series[i].invoiced += invoiceTotal(inv);
    if (isPaid(inv)) series[i].paid += invoiceTotal(inv);
  });
  return series;
}

/**
 * Avancement de la facturation par affaire, rapporté aux honoraires
 * (`remuneration`) et jamais au `budget` : ce dernier porte le plus souvent le
 * coût des travaux, et comparer des honoraires encaissés à un coût travaux
 * donnait un taux d'avancement sans signification.
 */
export function feesProgressByProject(
  projects: { id: string; name: string; remuneration?: number | null }[],
  invoices: InvoiceLike[],
  limit = 6,
) {
  const byProject = new Map<string, { invoiced: number; paid: number }>();
  invoices.forEach(inv => {
    if (!inv.project_id || !isIssued(inv)) return;
    const row = byProject.get(inv.project_id) ?? { invoiced: 0, paid: 0 };
    row.invoiced += invoiceTotal(inv);
    if (isPaid(inv)) row.paid += invoiceTotal(inv);
    byProject.set(inv.project_id, row);
  });
  return projects
    .map(p => {
      const r = byProject.get(p.id) ?? { invoiced: 0, paid: 0 };
      const fees = Number(p.remuneration || 0);
      return { id: p.id, name: p.name, fees, ...r, pct: fees > 0 ? Math.min(100, Math.round((r.invoiced / fees) * 100)) : null };
    })
    .filter(r => r.fees > 0 || r.invoiced > 0)
    .sort((a, b) => b.invoiced - a.invoiced || b.fees - a.fees)
    .slice(0, limit);
}

/** Affaires terminées dont la date de fin (réelle, sinon prévue) tombe dans le mois courant. */
export function deliveredThisMonth(
  projects: { status?: string | null; date_fin_reelle?: string | null; end_date?: string | null }[],
  now = new Date(),
) {
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return projects.filter(p =>
    normalizeProjectStatus(p.status) === 'completed' && (p.date_fin_reelle || p.end_date || '').slice(0, 7) === month,
  ).length;
}
