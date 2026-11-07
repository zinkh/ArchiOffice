import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../lib/utils';
import type { Milestone } from '../types';
import { addDays, daysBetween, parseMilestoneDate, scheduleMilestones, toDateString, withMilestoneDate } from '../lib/milestoneSchedule';

interface MilestoneGanttProps {
  milestones: Milestone[];
  /** Conservés pour les appelants existants : l'échelle se déduit désormais des jalons eux-mêmes. */
  startDate?: Date;
  endDate?: Date;
  /** Absent : diagramme en lecture seule. */
  onUpdate?: (milestones: Milestone[]) => void;
}

const ROW_H = 36;
const ARROWS_KEY = 'ganttShowDependencies';

function readArrowsPreference(): boolean {
  try { return localStorage.getItem(ARROWS_KEY) !== 'off'; } catch { return true; }
}

type Drag = { id: string; kind: 'move' | 'resize'; startX: number; due: Date; duration: number };

/**
 * Diagramme des jalons datés (fiche affaire, appel d'offres) : chaque jalon part de sa date, ou de la
 * fin du jalon dont il dépend. Les barres se déplacent (date) et s'étirent (durée) à la souris ; les
 * flèches de dépendance s'affichent ou se masquent (préférence gardée dans ce navigateur).
 */
export default function MilestoneGantt({ milestones, onUpdate }: MilestoneGanttProps) {
  const { t } = useTranslation();
  const editable = !!onUpdate;
  const [showArrows, setShowArrows] = useState(readArrowsPreference);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [width, setWidth] = useState(0);
  const chartRef = useRef<HTMLDivElement>(null);

  const items = useMemo(() => scheduleMilestones(milestones), [milestones]);

  useLayoutEffect(() => {
    const el = chartRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const origin = useMemo(() => {
    if (items.length === 0) return new Date();
    return addDays(new Date(Math.min(...items.map(i => i.start.getTime()))), -3);
  }, [items]);
  const spanDays = useMemo(() => {
    const last = items.length ? Math.max(...items.map(i => daysBetween(origin, i.end))) : 0;
    return Math.max(30, last + 7);
  }, [items, origin]);
  const px = (days: number) => (width > 0 ? (days / spanDays) * width : 0);

  const patch = (id: string, change: Partial<Milestone>) => {
    if (!onUpdate) return;
    onUpdate(milestones.map(m => (m.id === id ? { ...m, ...change } : m)));
  };
  const setDuration = (id: string, days: number) => patch(id, { duration_days: Number.isFinite(days) && days > 0 ? Math.round(days) : undefined });
  // Déplacer un jalon le détache du jalon dont il dépendait : sa date redevient la sienne.
  const setDate = (id: string, date: Date) => patch(id, { due_date: withMilestoneDate(milestones.find(m => m.id === id)?.due_date, date), dependencies: [] });

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag || width <= 0) return;
    const delta = Math.round(((e.clientX - drag.startX) / width) * spanDays);
    if (drag.kind === 'move') setDate(drag.id, addDays(drag.due, delta));
    else setDuration(drag.id, Math.max(1, drag.duration + delta));
  };

  const rowOf = new Map(items.map((i, idx) => [i.id, idx]));
  const arrows = showArrows
    ? items.flatMap(i => {
        const from = i.dependencies?.[0] ? items[rowOf.get(i.dependencies[0]) ?? -1] : undefined;
        if (!from) return [];
        const y1 = (rowOf.get(from.id)! + 0.5) * ROW_H;
        const y2 = (rowOf.get(i.id)! + 0.5) * ROW_H;
        const x1 = px(daysBetween(origin, from.end));
        const x2 = px(daysBetween(origin, i.start));
        const mid = Math.max(x1 + 6, Math.min(x2 - 6, (x1 + x2) / 2));
        return [{ key: i.id, d: `M${x1},${y1} H${mid} V${y2} H${x2}`, x2, y2 }];
      })
    : [];

  const monthTicks = useMemo(() => {
    const ticks: { label: string; days: number }[] = [];
    const end = addDays(origin, spanDays);
    for (let d = new Date(origin.getFullYear(), origin.getMonth(), 1); d <= end; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
      ticks.push({ label: d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' }), days: daysBetween(origin, d) });
    }
    return ticks;
  }, [origin, spanDays]);

  if (milestones.length === 0) return null;

  return (
    <div className="rounded-xl border border-[var(--tblr-border)] bg-[var(--tblr-surface)] p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-[var(--tblr-text)]">{t('milestones')}</h3>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-xs text-[var(--tblr-text)]">
            <input
              type="checkbox"
              checked={showArrows}
              onChange={e => {
                setShowArrows(e.target.checked);
                try { localStorage.setItem(ARROWS_KEY, e.target.checked ? 'on' : 'off'); } catch { /* préférence facultative */ }
              }}
            />
            {t('proposals_gantt_arrows')}
          </label>
          {editable && <span className="text-[0.6875rem] text-[var(--tblr-muted)]">{t('gantt_milestones_hint')}</span>}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-4">
        <div>
          <div className="grid grid-cols-[1fr_120px_56px] gap-2 text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--tblr-muted)]" style={{ height: 24 }}>
            <span>{t('gantt_milestone_col')}</span><span>{t('gantt_date_col')}</span><span>{t('proposals_gantt_duration')}</span>
          </div>
          {milestones.map(m => {
            const d = parseMilestoneDate(m.due_date);
            const dependent = !!m.dependencies?.length;
            return (
              <div key={m.id} className="grid grid-cols-[1fr_120px_56px] gap-2 items-center" style={{ height: ROW_H }}>
                <div className="min-w-0">
                  <div className="truncate text-xs font-bold text-[var(--tblr-text)]" title={m.title}>{m.title}</div>
                  {editable && milestones.length > 1 && (
                    <select
                      aria-label={`${t('gantt_after_col')} ${m.title}`}
                      className="w-full px-1 py-0.5 rounded border border-[var(--tblr-border)] bg-[var(--tblr-surface)] text-[0.6875rem]"
                      value={m.dependencies?.[0] || ''}
                      onChange={e => patch(m.id, { dependencies: e.target.value ? [e.target.value] : [] })}
                    >
                      <option value="">{t('gantt_after_none')}</option>
                      {milestones.filter(o => o.id !== m.id).map(o => <option key={o.id} value={o.id}>{o.title}</option>)}
                    </select>
                  )}
                </div>
                <input
                  type="date"
                  disabled={!editable || dependent}
                  title={dependent ? t('gantt_date_from_dependency') : undefined}
                  aria-label={`${t('gantt_date_col')} ${m.title}`}
                  className="w-full px-1.5 py-1 rounded border border-[var(--tblr-border)] bg-[var(--tblr-surface)] text-xs disabled:opacity-60"
                  value={d ? toDateString(d) : ''}
                  onChange={e => { const nd = parseMilestoneDate(e.target.value); if (nd) patch(m.id, { due_date: withMilestoneDate(m.due_date, nd) }); }}
                />
                <input
                  type="number" min={1} disabled={!editable}
                  aria-label={`${t('proposals_gantt_duration')} ${m.title}`}
                  className="w-full px-1.5 py-1 rounded border border-[var(--tblr-border)] bg-[var(--tblr-surface)] text-xs disabled:opacity-60"
                  value={m.duration_days || ''}
                  placeholder="1"
                  onChange={e => setDuration(m.id, Number(e.target.value))}
                />
              </div>
            );
          })}
        </div>

        <div className="overflow-x-auto">
          <div ref={chartRef} className="relative min-w-[420px]" onPointerMove={onPointerMove} onPointerUp={() => setDrag(null)} onPointerLeave={() => setDrag(null)}>
            <div className="relative border-b border-[var(--tblr-border)]" style={{ height: 24 }}>
              {monthTicks.map(tk => (
                <span key={tk.days} className="absolute text-[0.6875rem] text-[var(--tblr-muted)]" style={{ left: px(tk.days) + 2 }}>{tk.label}</span>
              ))}
            </div>
            <div className="relative" style={{ height: items.length * ROW_H }}>
              {monthTicks.map(tk => (
                <div key={tk.days} className="absolute top-0 bottom-0 border-l border-[var(--tblr-border)] opacity-60" style={{ left: px(tk.days) }} />
              ))}
              {items.map((i, idx) => (
                <div
                  key={i.id}
                  role="img"
                  aria-label={t('gantt_bar_label', { title: i.title, date: toDateString(i.start), days: i.durationDays })}
                  className={cn(
                    'absolute rounded text-white text-[0.6875rem] font-bold flex items-center overflow-hidden select-none touch-none',
                    i.completed ? 'bg-green-600' : 'bg-[var(--tblr-primary)]',
                  )}
                  style={{ left: px(daysBetween(origin, i.start)), width: Math.max(px(i.durationDays), 8), top: idx * ROW_H + 6, height: ROW_H - 12, cursor: editable ? (drag?.id === i.id ? 'grabbing' : 'grab') : 'default' }}
                  onPointerDown={editable ? e => {
                    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                    setDrag({ id: i.id, kind: 'move', startX: e.clientX, due: i.start, duration: i.durationDays });
                  } : undefined}
                >
                  <span className="truncate px-1.5 pointer-events-none">{i.title}</span>
                  {editable && (
                    <span
                      className="absolute right-0 top-0 bottom-0 w-2 bg-black/20"
                      style={{ cursor: 'ew-resize' }}
                      onPointerDown={e => {
                        e.stopPropagation();
                        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                        setDrag({ id: i.id, kind: 'resize', startX: e.clientX, due: i.start, duration: i.durationDays });
                      }}
                    />
                  )}
                </div>
              ))}
              {arrows.length > 0 && width > 0 && (
                <svg className="absolute inset-0 pointer-events-none" width={width} height={items.length * ROW_H} aria-hidden="true">
                  {arrows.map(a => (
                    <g key={a.key} stroke="var(--tblr-text)" fill="none" strokeWidth={1.2}>
                      <path d={a.d} />
                      <path d={`M${a.x2 - 5},${a.y2 - 3.5} L${a.x2},${a.y2} L${a.x2 - 5},${a.y2 + 3.5} Z`} fill="var(--tblr-text)" />
                    </g>
                  ))}
                </svg>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
