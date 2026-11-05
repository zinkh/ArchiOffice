import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DUREE_MISSION_PAR_DEFAUT_JOURS, planifierCalendrier } from '../lib/proposalExport';
import { parsePlanning, serializePlanning, withOverride, type ProposalPlanning } from '../lib/proposalPlanning';

interface Mission { id: string; name: string; category?: string }

interface ProposalGanttProps {
  missions: Mission[];
  /** JSON enregistré dans `proposals.planning`. */
  planning: string | null | undefined;
  onChange: (planning: string | null) => void;
}

const ROW_H = 36;
const DAYS_PER_MONTH = 30;

/**
 * Planning prévisionnel d'une proposition : le même calcul que l'export PDF
 * (`planifierCalendrier`), avec des réglages manuels (durée, jour de début) enregistrés
 * dans la proposition. Les barres se déplacent (début) et s'étirent (durée) à la souris.
 */
export default function ProposalGantt({ missions, planning, onChange }: ProposalGanttProps) {
  const { t } = useTranslation();
  const settings = useMemo(() => parsePlanning(planning), [planning]);
  const items = useMemo(
    () => planifierCalendrier(missions.map(m => ({ id: m.id, designation: m.name })), DUREE_MISSION_PAR_DEFAUT_JOURS, settings.items),
    [missions, settings.items],
  );
  const chartRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [drag, setDrag] = useState<null | { id: string; kind: 'move' | 'resize'; startX: number; debut: number; duree: number }>(null);

  useLayoutEffect(() => {
    const el = chartRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const totalDays = Math.max(DAYS_PER_MONTH, ...items.map(i => i.debutJours + i.dureeJours));
  const months = Math.min(36, Math.ceil(totalDays / DAYS_PER_MONTH) + 1);
  const axisDays = months * DAYS_PER_MONTH;
  const px = (days: number) => (width > 0 ? (days / axisDays) * width : 0);
  const idOf = (itemId: string) => itemId.replace(/^c_/, '');

  const update = (next: ProposalPlanning) => onChange(serializePlanning(next));
  const setDuree = (missionId: string, value: number) =>
    update(withOverride(settings, missionId, { duree: Number.isFinite(value) && value > 0 ? Math.round(value) : undefined }));
  const setDebut = (missionId: string, value: number | undefined) =>
    update(withOverride(settings, missionId, { debut: value === undefined || !Number.isFinite(value) || value < 0 ? undefined : Math.round(value) }));

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag || width <= 0) return;
    const deltaDays = Math.round(((e.clientX - drag.startX) / width) * axisDays);
    if (drag.kind === 'move') setDebut(drag.id, Math.max(0, drag.debut + deltaDays));
    else setDuree(drag.id, Math.max(1, drag.duree + deltaDays));
  };
  const endDrag = () => setDrag(null);

  const rowOf = new Map(items.map((i, idx) => [i.id, idx]));
  const arrows = settings.showDependencies
    ? items.flatMap(i => {
        const from = i.apres ? items[rowOf.get(i.apres) ?? -1] : undefined;
        if (!from) return [];
        const y1 = (rowOf.get(from.id)! + 0.5) * ROW_H;
        const y2 = (rowOf.get(i.id)! + 0.5) * ROW_H;
        const x1 = px(from.debutJours + from.dureeJours);
        const x2 = px(i.debutJours);
        const mid = Math.max(x1 + 6, Math.min(x2 - 6, (x1 + x2) / 2));
        return [{ key: i.id, d: `M${x1},${y1} H${mid} V${y2} H${x2}`, x2, y2 }];
      })
    : [];

  if (missions.length === 0) {
    return <p className="text-xs text-[var(--tblr-muted)]">{t('proposals_gantt_empty')}</p>;
  }

  return (
    <div className="rounded-lg border border-[var(--tblr-border)] bg-[var(--tblr-surface)] p-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-xs text-[var(--tblr-text)]">
          <input
            type="checkbox"
            checked={settings.showDependencies}
            onChange={e => update({ ...settings, showDependencies: e.target.checked })}
          />
          {t('proposals_gantt_arrows')}
        </label>
        <div className="flex items-center gap-3">
          <span className="text-[0.6875rem] text-[var(--tblr-muted)]">{t('proposals_gantt_hint')}</span>
          <button
            type="button"
            disabled={Object.keys(settings.items).length === 0}
            onClick={() => update({ ...settings, items: {} })}
            className="text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--tblr-primary)] disabled:opacity-40"
          >
            {t('proposals_gantt_reset')}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4">
        <div>
          <div className="grid grid-cols-[1fr_64px_64px] gap-2 text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--tblr-muted)] pb-1" style={{ height: 24 }}>
            <span>{t('proposals_gantt_mission')}</span><span>{t('proposals_gantt_duration')}</span><span>{t('proposals_gantt_start')}</span>
          </div>
          {items.map(i => {
            const mid = idOf(i.id);
            const manualStart = settings.items[mid]?.debut !== undefined;
            return (
              <div key={i.id} className="grid grid-cols-[1fr_64px_64px] gap-2 items-center" style={{ height: ROW_H }}>
                <span className="truncate text-xs text-[var(--tblr-text)]" title={i.mission}>{i.mission}</span>
                <input
                  type="number" min={1} aria-label={`${t('proposals_gantt_duration')} ${i.mission}`}
                  className="w-full px-1.5 py-1 rounded border border-[var(--tblr-border)] bg-[var(--tblr-surface)] text-xs"
                  value={i.dureeJours}
                  onChange={e => setDuree(mid, Number(e.target.value))}
                />
                <input
                  type="number" min={0} aria-label={`${t('proposals_gantt_start')} ${i.mission}`}
                  title={manualStart ? t('proposals_gantt_start_manual') : t('proposals_gantt_start_auto')}
                  className={`w-full px-1.5 py-1 rounded border bg-[var(--tblr-surface)] text-xs ${manualStart ? 'border-[var(--tblr-primary)]' : 'border-[var(--tblr-border)]'}`}
                  value={i.debutJours}
                  onChange={e => setDebut(mid, e.target.value === '' ? undefined : Number(e.target.value))}
                />
              </div>
            );
          })}
        </div>

        <div className="overflow-x-auto">
          <div ref={chartRef} className="relative min-w-[420px]" onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerLeave={endDrag}>
            <div className="relative border-b border-[var(--tblr-border)]" style={{ height: 24 }}>
              {Array.from({ length: months }, (_, m) => (
                <span key={m} className="absolute text-[0.6875rem] text-[var(--tblr-muted)]" style={{ left: px(m * DAYS_PER_MONTH) + 2 }}>
                  {t('proposals_gantt_month', { n: m + 1 })}
                </span>
              ))}
            </div>
            <div className="relative" style={{ height: items.length * ROW_H }}>
              {Array.from({ length: months + 1 }, (_, m) => (
                <div key={m} className="absolute top-0 bottom-0 border-l border-[var(--tblr-border)] opacity-60" style={{ left: px(m * DAYS_PER_MONTH) }} />
              ))}
              {items.map((i, idx) => {
                const mid = idOf(i.id);
                return (
                  <div
                    key={i.id}
                    role="img"
                    aria-label={t('proposals_gantt_bar_label', { mission: i.mission, start: i.debutJours, days: i.dureeJours })}
                    className="absolute rounded bg-[var(--tblr-primary)] text-white text-[0.6875rem] font-bold flex items-center overflow-hidden select-none touch-none"
                    style={{ left: px(i.debutJours), width: Math.max(px(i.dureeJours), 6), top: idx * ROW_H + 6, height: ROW_H - 12, cursor: drag?.id === mid ? 'grabbing' : 'grab' }}
                    onPointerDown={e => { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); setDrag({ id: mid, kind: 'move', startX: e.clientX, debut: i.debutJours, duree: i.dureeJours }); }}
                  >
                    <span className="truncate px-1.5 pointer-events-none">{i.mission}</span>
                    <span
                      className="absolute right-0 top-0 bottom-0 w-2 bg-black/20"
                      style={{ cursor: 'ew-resize' }}
                      onPointerDown={e => { e.stopPropagation(); (e.target as HTMLElement).setPointerCapture?.(e.pointerId); setDrag({ id: mid, kind: 'resize', startX: e.clientX, debut: i.debutJours, duree: i.dureeJours }); }}
                    />
                  </div>
                );
              })}
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
