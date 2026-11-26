import { describe, it, expect } from 'vitest';
import { scheduleMilestones, changedMilestones, parseMilestoneDate, toDateString, daysBetween } from '../milestoneSchedule';
import type { Milestone } from '../../types';

const ms = (id: string, due: string, extra: Partial<Milestone> = {}): Milestone => ({ id, title: id, due_date: due, completed: false, ...extra });

describe('scheduleMilestones', () => {
  it('place chaque jalon à sa date, pas tous au même jour', () => {
    const r = scheduleMilestones([ms('a', '2026-03-01', { duration_days: 10 }), ms('b', '2026-04-01', { duration_days: 5 })]);
    expect(toDateString(r[0].start)).toBe('2026-03-01');
    expect(toDateString(r[1].start)).toBe('2026-04-01');
    expect(toDateString(r[0].end)).toBe('2026-03-11');
  });
  it('un jalon dépendant commence à la fin du précédent, au plus tôt à sa date', () => {
    const r = scheduleMilestones([ms('a', '2026-03-01', { duration_days: 10 }), ms('b', '2026-03-02', { dependencies: ['a'], duration_days: 2 })]);
    expect(toDateString(r[1].start)).toBe('2026-03-11');
    const later = scheduleMilestones([ms('a', '2026-03-01', { duration_days: 10 }), ms('b', '2026-05-01', { dependencies: ['a'] })]);
    expect(toDateString(later[1].start)).toBe('2026-05-01');
  });
  it('rompt un cycle sans boucler', () => {
    const r = scheduleMilestones([ms('a', '2026-03-01', { dependencies: ['b'] }), ms('b', '2026-03-05', { dependencies: ['a'] })]);
    expect(r).toHaveLength(2);
  });
  it('un jalon sans durée dure un jour', () => {
    expect(scheduleMilestones([ms('a', '2026-03-01')])[0].durationDays).toBe(1);
  });
  it('lit une date ISO complète sans glisser d’un jour', () => {
    expect(toDateString(parseMilestoneDate('2026-03-04T23:30:00Z')!)).toBe('2026-03-04');
    expect(daysBetween(parseMilestoneDate('2026-03-01')!, parseMilestoneDate('2026-03-31')!)).toBe(30);
  });
});

describe('changedMilestones', () => {
  it('ne rend que les jalons modifiés', () => {
    const before = [ms('a', '2026-03-01'), ms('b', '2026-03-02')];
    const after = [ms('a', '2026-03-01'), ms('b', '2026-03-09')];
    expect(changedMilestones(before, after).map(m => m.id)).toEqual(['b']);
  });
});
