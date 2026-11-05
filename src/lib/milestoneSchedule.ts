// Planification des jalons datés (fiches affaires, appels d'offres).
//
// Un jalon commence à sa date (`due_date`) ; s'il dépend d'un autre jalon (`dependencies[0]`), il
// commence à la fin de celui-ci, au plus tôt à sa propre date. Sa durée est `duration_days` (1 jour
// à défaut : un jalon est d'abord un repère). Les cycles sont rompus sans lever d'erreur.
import type { Milestone } from '../types';

export const DAY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_MILESTONE_DAYS = 1;

export interface ScheduledMilestone extends Milestone {
  start: Date;
  end: Date;
  durationDays: number;
}

/** Date locale à minuit d'une chaîne ISO (« 2026-03-04 » ou « 2026-03-04T10:00:00Z »). */
export function parseMilestoneDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
  return d;
}

export function daysBetween(a: Date, b: Date): number {
  return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / DAY_MS);
}

/** « 2026-03-04 », au format local (pas d'UTC : le jour ne doit jamais glisser). */
export function toDateString(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Nouvelle date pour un jalon en conservant l'heure éventuelle (« 2026-03-04T10:00 » reste un datetime). */
export function withMilestoneDate(original: string | null | undefined, d: Date): string {
  const time = /T.*$/.exec(original ?? '')?.[0] ?? '';
  return toDateString(d) + time;
}

export function scheduleMilestones(milestones: Milestone[], fallbackStart: Date = new Date()): ScheduledMilestone[] {
  const byId = new Map(milestones.map(m => [m.id, m]));
  const done = new Map<string, ScheduledMilestone>();

  const resolve = (m: Milestone, path: Set<string>): ScheduledMilestone => {
    const known = done.get(m.id);
    if (known) return known;
    const own = parseMilestoneDate(m.due_date) ?? fallbackStart;
    let start = own;
    const depId = m.dependencies?.[0];
    const dep = depId && !path.has(depId) ? byId.get(depId) : undefined;
    if (dep && dep.id !== m.id) {
      const d = resolve(dep, new Set(path).add(m.id));
      if (d.end.getTime() > start.getTime()) start = d.end;
    }
    const durationDays = m.duration_days && m.duration_days > 0 ? Math.round(m.duration_days) : DEFAULT_MILESTONE_DAYS;
    const item: ScheduledMilestone = { ...m, start, end: addDays(start, durationDays), durationDays };
    done.set(m.id, item);
    return item;
  };

  return milestones.map(m => resolve(m, new Set([m.id])));
}

/** Les jalons dont la date, la durée ou la dépendance diffère : seuls ceux-là sont réenregistrés. */
export function changedMilestones(before: Milestone[], after: Milestone[]): Milestone[] {
  const prev = new Map(before.map(m => [m.id, m]));
  return after.filter(m => {
    const o = prev.get(m.id);
    return !!o && (o.due_date !== m.due_date || o.duration_days !== m.duration_days || JSON.stringify(o.dependencies ?? []) !== JSON.stringify(m.dependencies ?? []));
  });
}

/** Enregistre les jalons modifiés (PUT), un par un ; les échecs sont rendus pour que l'écran les signale. */
export async function persistMilestones(changed: Milestone[]): Promise<Milestone[]> {
  const failed: Milestone[] = [];
  await Promise.all(changed.map(async m => {
    try {
      const res = await fetch(`/api/milestones/${m.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(m) });
      if (!res.ok) failed.push(m);
    } catch { failed.push(m); }
  }));
  return failed;
}
