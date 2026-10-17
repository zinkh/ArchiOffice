import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../../lib/api';
import { buildProfitability, type MissionLike, type PhaseTotals } from '../../lib/profitability';

interface TimeByPhase {
  by_phase: Record<string, PhaseTotals>;
  unrated_user_ids: string[];
  costs_available: boolean;
}

const eur = (n: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n).replace(/[  ]/g, ' ');
const hours = (h: number) => `${(Math.round(h * 10) / 10).toLocaleString('fr-FR')} h`;

/**
 * Honoraires prévus de chaque phase face au coût du temps passé. Réservé aux
 * administrateurs et managers (le serveur refuse les autres en 403).
 */
export default function ProjectProfitability({ projectId, honoraires, missions }: {
  projectId: string;
  honoraires: number;
  missions: MissionLike[];
}) {
  const { t } = useTranslation();
  const [data, setData] = useState<TimeByPhase | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    apiFetch(`/api/projects/${projectId}/time-by-phase`)
      .then((res: TimeByPhase) => { if (!cancelled) setData(res); })
      .catch((e: any) => { if (!cancelled) setError(e.message || t('profitability_load_error')); });
    return () => { cancelled = true; };
  }, [projectId, t]);

  const result = useMemo(() => (data ? buildProfitability(honoraires, missions, data.by_phase) : null), [data, honoraires, missions]);

  if (error) return <p role="alert" className="text-xs text-red-600">{error}</p>;
  if (!data || !result) return null;

  const th = 'px-3 py-2 text-right text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--tblr-muted)] bg-[var(--tblr-surface-2)]';
  const td = 'px-3 py-2 text-right tabular-nums';

  return (
    <div className="pt-2 border-t border-[var(--tblr-border)] space-y-3">
      <div>
        <p className="text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--tblr-muted)]">{t('profitability_title')}</p>
        <p className="text-xs text-[var(--tblr-muted)] mt-0.5">{t('profitability_desc')}</p>
      </div>
      {!data.costs_available && <p role="alert" className="text-xs text-amber-600">{t('profitability_no_costs')}</p>}
      {data.costs_available && data.unrated_user_ids.length > 0 && (
        <p role="alert" className="text-xs text-amber-600">{t('profitability_unrated', { count: data.unrated_user_ids.length })}</p>
      )}
      {result.rows.length === 0 ? (
        <p className="text-sm italic text-[var(--tblr-muted)]">{t('profitability_empty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--tblr-border)]">
          <table className="min-w-full text-sm">
            <thead>
              <tr>
                <th scope="col" className={`${th} text-left`}>{t('profitability_col_phase')}</th>
                <th scope="col" className={th}>{t('profitability_col_budget')}</th>
                <th scope="col" className={th}>{t('profitability_col_hours')}</th>
                <th scope="col" className={th}>{t('profitability_col_billable')}</th>
                <th scope="col" className={th}>{t('profitability_col_cost')}</th>
                <th scope="col" className={th}>{t('profitability_col_margin')}</th>
                <th scope="col" className={th}>{t('profitability_col_fee_hour')}</th>
              </tr>
            </thead>
            <tbody>
              {[...result.rows, result.total].map(row => {
                const isTotal = row.phase === 'TOTAL';
                // Rouge uniquement pour une marge négative : c'est une donnée, pas une décoration.
                const marginColor = row.margin < 0 ? 'text-red-600' : '';
                return (
                  <tr key={row.phase || 'none'} className={`border-t border-[var(--tblr-border)] ${isTotal ? 'font-bold' : ''}`}>
                    <th scope="row" className="px-3 py-2 text-left font-semibold">
                      {isTotal ? t('profitability_total') : row.phase === '' ? t('profitability_no_phase') : row.phase}
                    </th>
                    <td className={td}>{eur(row.budget)}</td>
                    <td className={td}>{hours(row.hours)}</td>
                    <td className={td}>{hours(row.billableHours)}</td>
                    <td className={td}>{eur(row.cost)}</td>
                    <td className={`${td} ${marginColor}`}>
                      {eur(row.margin)}{row.marginPct != null ? ` (${Math.round(row.marginPct)} %)` : ''}
                    </td>
                    <td className={td}>{row.feePerHour != null ? eur(row.feePerHour) : '---'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
