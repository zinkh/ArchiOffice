// Ce que la liste des réserves (ReserveTracker) et la fiche d'une réserve
// (ReserveDetail) partagent : le vocabulaire des statuts, la pastille de
// statut, le calcul du retard et l'extrait de plan autour du repère.
import { useEffect, useState } from 'react';
import { cn } from '../../lib/utils';
import { renderPlanExcerpt } from '../../lib/planRender';
import type { Reserve, GpaReserve } from '../../types';

export type ReserveLike = Reserve | GpaReserve;
export type ReserveStatus = ReserveLike['status'];

export const RESERVE_STATUSES: ReserveStatus[] = [
  'A faire', 'En cours', 'Levée', "Refusée par l'entreprise", 'Quitus Transmis', 'Levée refusée par le MOE',
];

export const isReserveClosed = (r: Pick<ReserveLike, 'status'>) => r.status === 'Levée' || r.status === 'Quitus Transmis';

/** Jours de retard (0 si à l'heure ou levée). */
export function reserveOverdueDays(r: Pick<ReserveLike, 'status' | 'due_date'>): number {
  if (isReserveClosed(r) || !r.due_date) return 0;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(r.due_date); due.setHours(0, 0, 0, 0);
  if (isNaN(due.getTime()) || due >= today) return 0;
  return Math.floor((today.getTime() - due.getTime()) / 86400000);
}

export function statusPillClass(status: ReserveStatus): string {
  return cn(
    'border-none rounded-full text-[0.6875rem] font-bold uppercase tracking-wider px-2 py-1 outline-none cursor-pointer',
    status === 'Levée' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
    status === 'Quitus Transmis' ? 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400' :
    status === 'En cours' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' :
    status === "Refusée par l'entreprise" ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
    status === 'Levée refusée par le MOE' ? 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400' :
    'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  );
}

export function parseJsonList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [String(parsed)];
  } catch {
    return value.split(',').map(s => s.trim()).filter(Boolean);
  }
}

/** Sélecteur de statut en pastille colorée — le même dans la liste et la fiche. */
export function StatusSelect({ value, onChange, className }: { value: ReserveStatus; onChange: (s: ReserveStatus) => void; className?: string }) {
  return (
    <select
      className={cn(statusPillClass(value), className)}
      value={value}
      onClick={e => e.stopPropagation()}
      onChange={e => onChange(e.target.value as ReserveStatus)}
    >
      {RESERVE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
    </select>
  );
}

/**
 * L'extrait du plan autour du repère d'une réserve (rendu par
 * lib/planRender.ts, mis en cache par plan). Rien n'est affiché tant que le
 * rendu n'est pas prêt, et rien du tout si le plan est illisible.
 */
export function PlanExcerpt({ fileUrl, x, y, label, className }: { fileUrl: string; x: number; y: number; label: string; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setSrc(null); setFailed(false);
    renderPlanExcerpt(fileUrl, x, y, label)
      .then(url => { if (!cancelled) setSrc(url); })
      .catch(err => { console.error('[PlanExcerpt]', err); if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [fileUrl, x, y, label]);
  if (failed) return null;
  if (!src) {
    return <div className={cn('animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800', className)} aria-label="Extrait de plan en cours de rendu" />;
  }
  return <img src={src} alt={`Extrait de plan, repère ${label}`} className={cn('rounded-lg border border-[var(--tblr-border)] bg-white', className)} />;
}
