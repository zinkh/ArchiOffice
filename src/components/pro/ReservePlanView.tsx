import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { IconMapPin, IconArrowUpRight } from '@tabler/icons-react';
import { cn } from '../../lib/utils';
import { PlanAnnotator } from '../PlanAnnotator';
import type { Plan } from '../../types';
import { type ReserveLike, type ReserveStatus, StatusSelect, parseJsonList, reserveOverdueDays } from './reserveShared';
import { couleurDe } from '../../lib/reserveCouleurs';
import { libelleGroupe } from '../../lib/reserveTri';

export interface PlanMarker { id: string; x: number; y: number; number?: number; title?: string; couleur?: string }

interface ReservePlanViewProps {
  plans: Plan[];
  /** Plan affiché. */
  planId: string;
  onPlanChange: (planId: string) => void;
  /** Réserves repérées sur ce plan, filtres appliqués, classées par numéro de lot (c'est l'ordre du volet). */
  rows: ReserveLike[];
  /** Repères de ces mêmes réserves. */
  markers: PlanMarker[];
  /** Nombre de réserves repérées (filtres appliqués) sur chaque plan, pour le sélecteur. */
  countsByPlan: Map<string, number>;
  /** Réserves filtrées qui ne sont repérées sur aucun plan : elles n'apparaissent ni sur le plan ni dans le volet. */
  unplacedCount: number;
  couleurs: Map<string, string>;
  numeros: Map<string, string>;
  selectedId: string | null;
  /** Un premier appui sur une réserve (ou son repère) la situe ; un second l'ouvre. Voir ReserveTracker. */
  onActivate: (id: string) => void;
  onOpen: (id: string) => void;
  /** Position posée sur le plan pour une nouvelle réserve, pas encore enregistrée. */
  pendingCoords: { x: number; y: number } | null;
  onPlaceMarker: (x: number, y: number) => void;
  onCreateHere: () => void;
  onCancelPending: () => void;
  onStatusChange: (reserve: ReserveLike, status: ReserveStatus) => void;
  renderThumb: (reserve: ReserveLike, className: string) => React.ReactNode;
}

/**
 * Visualisation par plan : le plan occupe toute la largeur disponible, et les réserves repérées dessus sont
 * listées dans un volet à droite (sous le plan sur téléphone), rangées par numéro de lot. Choisir une réserve
 * dans le volet centre le plan sur son repère ; toucher un repère met sa réserve en évidence dans le volet.
 */
export function ReservePlanView({
  plans, planId, onPlanChange, rows, markers, countsByPlan, unplacedCount, couleurs, numeros, selectedId,
  onActivate, onOpen, pendingCoords, onPlaceMarker, onCreateHere, onCancelPending, onStatusChange, renderThumb,
}: ReservePlanViewProps) {
  const { t } = useTranslation();
  const plan = plans.find(p => p.id === planId) || null;
  const listRef = useRef<HTMLUListElement>(null);

  // La réserve choisie sur le plan est ramenée au milieu du volet (calcul à la main : pas de défilement de la page).
  useEffect(() => {
    const liste = listRef.current;
    if (!selectedId || !liste) return;
    const ligne = liste.querySelector<HTMLElement>(`[data-row-id="${selectedId.replace(/"/g, '\\"')}"]`);
    if (!ligne) return;
    const listeTop = liste.getBoundingClientRect().top;
    const haut = liste.scrollTop + (ligne.getBoundingClientRect().top - listeTop);
    if (haut < liste.scrollTop || haut + ligne.offsetHeight > liste.scrollTop + liste.clientHeight) {
      liste.scrollTo({ top: haut - liste.clientHeight / 2 + ligne.offsetHeight / 2, behavior: 'smooth' });
    }
  }, [selectedId]);

  // Les lignes sont déjà classées : on ne fait que les regrouper sous l'en-tête de leur lot, dans l'ordre reçu.
  const groupes = useMemo(() => {
    const out: { cle: string; titre: string; rows: ReserveLike[] }[] = [];
    for (const r of rows) {
      const titre = libelleGroupe({ lots: r.lots, entreprises: [] }, numeros);
      const dernier = out[out.length - 1];
      if (dernier && dernier.titre === titre) dernier.rows.push(r); else out.push({ cle: `${titre}#${out.length}`, titre, rows: [r] });
    }
    return out;
  }, [rows, numeros]);

  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_24rem] border-t border-[var(--tblr-border)]">
      <div className="min-w-0 p-3 sm:p-4 space-y-2">
        <div className="flex items-center gap-2 flex-wrap text-xs font-medium text-[var(--tblr-muted)]">
          <select
            aria-label={t('reserve_plan_select_label')}
            className="min-w-0 max-w-full sm:max-w-sm bg-zinc-100 dark:bg-zinc-800 border-none rounded-lg px-3 py-2 pointer-coarse:min-h-11 text-sm font-bold outline-none"
            value={planId}
            onChange={e => onPlanChange(e.target.value)}
          >
            {plans.map(p => <option key={p.id} value={p.id}>{p.name} ({countsByPlan.get(p.id) ?? 0})</option>)}
          </select>
          <IconMapPin size={14} className={pendingCoords ? 'text-green-600' : 'text-blue-600'} />
          {pendingCoords ? (
            <>
              <span>{t('reserve_plan_pending')}</span>
              <button type="button" onClick={onCreateHere} className="px-2 py-1 rounded bg-blue-600 text-white font-bold">{t('reserve_plan_create_here')}</button>
              <button type="button" onClick={onCancelPending} className="px-2 py-1 rounded bg-zinc-100 dark:bg-zinc-800 font-bold">{t('reserve_plan_cancel')}</button>
            </>
          ) : (
            <span>{t('reserve_plan_hint')}</span>
          )}
        </div>
        <div className="h-[60dvh] lg:h-[calc(100dvh-14rem)] lg:min-h-[32rem]">
          {plan && (
            <PlanAnnotator
              key={plan.id}
              fileUrl={plan.file_url}
              markers={markers}
              pendingMarker={pendingCoords}
              selectedMarkerId={selectedId}
              onAddMarker={onPlaceMarker}
              onSelectMarker={onActivate}
              fitWidth
              compact
              isAddingMode
            />
          )}
        </div>
      </div>

      <aside
        className="min-w-0 flex flex-col border-t lg:border-t-0 lg:border-l border-[var(--tblr-border)] max-h-[70dvh] lg:max-h-none lg:h-[calc(100dvh-10rem)] lg:min-h-[36rem]"
        aria-label={t('reserve_plan_panel_label')}
      >
        <div className="px-4 py-3 border-b border-[var(--tblr-border)] shrink-0">
          <div className="text-sm font-bold text-[var(--tblr-text)]">{t('reserve_plan_panel_title', { count: rows.length })}</div>
          {unplacedCount > 0 && <div className="text-xs text-[var(--tblr-muted)]">{t('reserve_plan_unplaced', { count: unplacedCount })}</div>}
        </div>
        <ul ref={listRef} className="relative flex-1 min-h-0 overflow-y-auto list-none m-0 p-0">
          {rows.length === 0 && (
            <li className="px-4 py-8 text-center text-sm italic text-[var(--tblr-muted)]">{t('reserve_plan_empty')}</li>
          )}
          {groupes.map(g => (
            <li key={g.cle} className="list-none">
              <div className="sticky top-0 z-10 px-4 py-1.5 bg-[var(--tblr-surface-2)] border-y border-[var(--tblr-border)] text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--tblr-text)]">
                {g.titre} <span className="font-normal text-[var(--tblr-muted)]">({g.rows.length})</span>
              </div>
              <ul className="list-none m-0 p-0 divide-y divide-[var(--tblr-border)]">
                {g.rows.map(res => {
                  const retard = reserveOverdueDays(res);
                  const choisie = res.id === selectedId;
                  const entreprises = parseJsonList(res.entreprises);
                  return (
                    <li
                      key={res.id}
                      data-row-id={res.id}
                      className={cn('flex items-start gap-2 border-l-4 pl-3 pr-2 py-2', choisie ? 'bg-[var(--tblr-primary-lt)]' : retard > 0 && 'bg-red-50/40 dark:bg-red-950/10')}
                      style={{ borderLeftColor: couleurDe(res, couleurs) }}
                    >
                      <button
                        type="button"
                        onClick={() => onActivate(res.id)}
                        aria-pressed={choisie}
                        className="flex min-w-0 flex-1 gap-2 text-left"
                      >
                        {renderThumb(res, 'w-12 h-12 shrink-0')}
                        <span className="min-w-0 flex-1 space-y-0.5">
                          <span className="flex items-start gap-1.5">
                            <span className="font-mono text-xs font-bold text-[var(--tblr-muted)] pt-0.5">#{res.number ?? '-'}</span>
                            <span className="text-sm font-semibold leading-snug text-[var(--tblr-text)] line-clamp-2">{res.title}</span>
                          </span>
                          <span className="block truncate text-xs text-[var(--tblr-muted)]">
                            {[entreprises.join(', '), [res.batiment, res.local].filter(Boolean).join(' / ')].filter(Boolean).join(' · ') || ' '}
                          </span>
                          <span className={cn('block text-xs font-medium', retard > 0 ? 'text-red-600' : 'text-[var(--tblr-muted)]')}>
                            {res.due_date ? new Date(res.due_date).toLocaleDateString('fr-FR') : t('reserve_plan_no_due')}
                            {retard > 0 && <span className="ml-1 px-1 py-0.5 rounded bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400 text-[0.6875rem] font-bold">+{retard}j</span>}
                          </span>
                        </span>
                      </button>
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        <StatusSelect value={res.status} onChange={s => onStatusChange(res, s)} className="max-w-[8.5rem]" />
                        <button
                          type="button"
                          onClick={() => onOpen(res.id)}
                          className="p-1.5 pointer-coarse:min-h-11 pointer-coarse:min-w-11 rounded-lg text-[var(--tblr-muted)] hover:bg-[var(--tblr-surface-2)] hover:text-[var(--tblr-text)]"
                          title={t('reserve_plan_open_sheet')}
                          aria-label={t('reserve_plan_open_sheet')}
                        >
                          <IconArrowUpRight size={16} />
                        </button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
        <p className="px-4 py-2 border-t border-[var(--tblr-border)] text-xs text-[var(--tblr-muted)] shrink-0">{t('reserve_plan_panel_hint')}</p>
      </aside>
    </div>
  );
}

export default ReservePlanView;
