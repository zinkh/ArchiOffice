// Archivage des affaires : logique pure partagée serveur / écran.
// Voir server/routes/projectArchive.ts et CLAUDE.md, « Archivage des affaires ».

/** Durée de conservation par défaut (années), réglable par cabinet. */
export const DEFAULT_RETENTION_YEARS = 10;
export const MIN_RETENTION_YEARS = 1;
export const MAX_RETENTION_YEARS = 50;
export const ARCHIVE_REASON_MAX_CHARS = 1000;

export type ArchiveCheckState = 'ok' | 'warning' | 'unknown';

export interface ArchiveCheckItem {
  id: string;
  label: string;
  state: ArchiveCheckState;
  detail?: string;
}

export interface ArchiveCheckInput {
  projectStatus?: string | null;
  invoices: Array<{ status?: string | null }>;
  reserves: Array<{ status?: string | null }>;
  tasks: Array<{ status?: string | null }>;
  /** null : lecture impossible (table absente), jamais « non visé ». */
  doeVisaCount: number | null;
}

/** Années saisies -> entier borné ; une valeur absente ou illisible vaut la valeur par défaut. */
export function normalizeRetentionYears(value: unknown): number {
  if (value === null || value === undefined || value === '') return DEFAULT_RETENTION_YEARS;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_RETENTION_YEARS;
  return Math.min(Math.max(Math.round(n), MIN_RETENTION_YEARS), MAX_RETENTION_YEARS);
}

/** Date de fin de conservation (AAAA-MM-JJ) : date d'archivage + N années, en UTC. */
export function retentionUntil(archivedAt: string | Date, years: number): string {
  const d = new Date(archivedAt);
  const target = new Date(Date.UTC(d.getUTCFullYear() + normalizeRetentionYears(years), d.getUTCMonth(), d.getUTCDate()));
  // 29 février + N années non bissextiles : le 1er mars déborde, on revient au 28 février.
  if (target.getUTCMonth() !== d.getUTCMonth()) target.setUTCDate(0);
  return target.toISOString().slice(0, 10);
}

const RESERVE_CLOSED = new Set(['Levée', 'Quitus Transmis']);

/**
 * Contrôles de clôture. Indicatifs : un « warning » n'empêche jamais
 * l'archivage, il demande seulement un motif de passage outre.
 */
export function buildArchiveChecklist(input: ArchiveCheckInput): ArchiveCheckItem[] {
  const items: ArchiveCheckItem[] = [];

  items.push(input.projectStatus === 'Completed'
    ? { id: 'status', label: 'Affaire au statut terminé', state: 'ok' }
    : { id: 'status', label: 'Affaire au statut terminé', state: 'warning', detail: 'L’affaire n’est pas marquée comme terminée.' });

  const unpaid = input.invoices.filter(i => i.status !== 'Paid');
  items.push(unpaid.length === 0
    ? { id: 'invoices', label: 'Factures soldées', state: 'ok' }
    : { id: 'invoices', label: 'Factures soldées', state: 'warning', detail: `${unpaid.length} facture(s) non soldée(s).` });

  const openReserves = input.reserves.filter(r => !RESERVE_CLOSED.has(String(r.status ?? '')));
  items.push(openReserves.length === 0
    ? { id: 'reserves', label: 'Réserves levées', state: 'ok' }
    : { id: 'reserves', label: 'Réserves levées', state: 'warning', detail: `${openReserves.length} réserve(s) non levée(s).` });

  const openTasks = input.tasks.filter(t => t.status !== 'done');
  items.push(openTasks.length === 0
    ? { id: 'tasks', label: 'Tâches terminées', state: 'ok' }
    : { id: 'tasks', label: 'Tâches terminées', state: 'warning', detail: `${openTasks.length} tâche(s) en cours.` });

  if (input.doeVisaCount === null) {
    items.push({ id: 'doe', label: 'DOE visé', state: 'unknown', detail: 'Atelier DOE indisponible sur cette instance.' });
  } else {
    items.push(input.doeVisaCount > 0
      ? { id: 'doe', label: 'DOE visé', state: 'ok' }
      : { id: 'doe', label: 'DOE visé', state: 'warning', detail: 'Aucun visa de DOE enregistré.' });
  }

  return items;
}

export function checklistWarnings(items: ArchiveCheckItem[]): ArchiveCheckItem[] {
  return items.filter(i => i.state === 'warning');
}
