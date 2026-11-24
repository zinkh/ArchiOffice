// Position d'une réserve sur le plan, pour un confrère qui a le détail de l'atelier (issue #687). Le plan se lit par une route
// du partage (qui revérifie le partage, le détail et le rattachement à l'affaire) ; jamais par l'adresse du fichier. Poser ou
// déplacer le repère exige en plus le droit d'écriture ; le serveur le revérifie. Les coordonnées sont en pourcentage du plan.
import { Suspense, lazy, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../lib/api';

// Le lecteur de plans (pdf.js) est lourd : il ne se charge que pour une réserve dont on ouvre la position.
const PlanAnnotator = lazy(() => import('../PlanAnnotator').then(m => ({ default: m.PlanAnnotator })));

export interface SharedPlan { id: string; name: string; pdf: boolean }
export interface PlanPosition { plan_id: string | null; x: number | null; y: number | null }

const resolveShareLink = async (route: string) => (await apiFetch<{ url: string }>(route)).url;

export default function SharedReservePlan({ path, reserve, canWrite, onSave }: {
  /** Racine des routes du partage pour ce jeu de réserves (`…/reserves` ou `…/gpa-reserves`). */
  path: string;
  reserve: { id: string; number: number | null; title: string; plan_id?: string | null; x?: number | string | null; y?: number | string | null };
  canWrite: boolean;
  onSave: (position: PlanPosition) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [plans, setPlans] = useState<SharedPlan[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [planId, setPlanId] = useState<string | null>(reserve.plan_id ?? null);
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState<{ x: number; y: number } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch<SharedPlan[]>(`${path}/plans`)
      .then(list => { if (!cancelled) setPlans(list); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [path]);

  if (failed) return <p role="alert" className="text-xs text-red-600">{t('shared_plan_error')}</p>;
  if (!plans) return <p className="text-xs text-[var(--tblr-muted)]">{t('shared_plan_loading')}</p>;
  if (plans.length === 0) return <p className="text-xs text-[var(--tblr-muted)]">{t('shared_plan_none')}</p>;

  const current = plans.find(p => p.id === planId) ?? plans.find(p => p.id === reserve.plan_id) ?? plans[0];
  const x = reserve.x == null ? NaN : Number(reserve.x);
  const y = reserve.y == null ? NaN : Number(reserve.y);
  const hasMarker = !!reserve.plan_id && Number.isFinite(x) && Number.isFinite(y);
  const placedHere = hasMarker && reserve.plan_id === current.id;

  const save = async (position: PlanPosition) => {
    setSaving(true);
    try {
      await onSave(position);
      setPending(null); setAdding(false);
    } finally { setSaving(false); }
  };
  const button = 'px-3 py-1 rounded-lg text-xs font-semibold border border-[var(--tblr-border)] hover:bg-[var(--tblr-surface-2)] disabled:opacity-50';

  return (
    <section className="space-y-2" aria-label={t('shared_plan_title')}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-xs font-bold text-[var(--tblr-text)]">{t('shared_plan_title')}</h3>
        {plans.length > 1 && (
          <select value={current.id} aria-label={t('shared_plan_choose')} onChange={e => { setPlanId(e.target.value); setPending(null); }}
            className="px-2 py-1 text-xs border border-[var(--tblr-border)] rounded-lg bg-white dark:bg-zinc-800">
            {plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        {plans.length === 1 && <span className="text-xs text-[var(--tblr-muted)]">{current.name}</span>}
        {!hasMarker && <span className="text-xs text-[var(--tblr-muted)]">{t('shared_plan_unplaced')}</span>}
        {canWrite && (
          <span className="ml-auto flex flex-wrap items-center gap-2">
            {!adding && <button type="button" className={button} onClick={() => setAdding(true)}>{t(hasMarker ? 'shared_plan_move' : 'shared_plan_place')}</button>}
            {adding && <button type="button" className={button} onClick={() => { setAdding(false); setPending(null); }}>{t('shared_plan_cancel')}</button>}
            {adding && pending && <button type="button" disabled={saving} className={button} onClick={() => save({ plan_id: current.id, x: pending.x, y: pending.y })}>{t('shared_plan_save')}</button>}
            {hasMarker && !adding && <button type="button" disabled={saving} className={button} onClick={() => save({ plan_id: null, x: null, y: null })}>{t('shared_plan_remove')}</button>}
          </span>
        )}
      </div>
      {adding && <p className="text-xs text-[var(--tblr-muted)]">{t('shared_plan_hint')}</p>}
      <div style={{ height: 420 }}>
        <Suspense fallback={<p className="text-xs text-[var(--tblr-muted)]">{t('shared_plan_loading')}</p>}>
          <PlanAnnotator
            key={current.id}
            fileUrl={`${path}/plans/${current.id}/file`}
            resolveUrl={resolveShareLink}
            isPdf={current.pdf}
            markers={placedHere ? [{ id: reserve.id, x, y, number: reserve.number ?? undefined, title: reserve.title }] : []}
            pendingMarker={adding ? pending : null}
            selectedMarkerId={placedHere ? reserve.id : null}
            isAddingMode={adding}
            onAddMarker={(px, py) => setPending({ x: Math.round(px * 100) / 100, y: Math.round(py * 100) / 100 })}
            fitWidth
            compact
          />
        </Suspense>
      </div>
    </section>
  );
}
