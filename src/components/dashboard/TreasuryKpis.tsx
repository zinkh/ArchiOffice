import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { IconCurrencyEuro, IconHourglass, IconReceiptOff } from '@tabler/icons-react';
import type { Treasury } from '../../lib/dashboardTreasury';
import { StatCard, formatEur } from './DashboardWidgets';

interface TreasuryKpisProps {
  treasury: Treasury;
  /** `team` : l'équipe d'un manager. `mine` : les affaires d'un chef de projet. */
  scope: 'team' | 'mine';
}

/** Encaissé, reste à encaisser et factures en retard : les trois chiffres, sans doublon. */
export default function TreasuryKpis({ treasury, scope }: TreasuryKpisProps) {
  const { t } = useTranslation();
  const prefix = scope === 'team' ? 'kpi_team' : 'kpi_mine';
  return (
    <div>
      <p className="text-[0.6875rem] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--tblr-muted)' }}>
        {t('kpi_group_treasury')}
      </p>
      <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
        <StatCard label={t(`${prefix}_revenue`)} value={formatEur(treasury.paid)} icon={IconCurrencyEuro} accent="#206bc4" accentBg="#e8f0fb" cardBg="#eef3fb" to="/invoices" />
        <StatCard
          label={t(`${prefix}_receivable`)}
          value={formatEur(treasury.receivable)}
          icon={IconHourglass}
          accent="#e67700"
          accentBg="#ffec99"
          cardBg="#fff9db"
          trend={t('dashboard_unpaid_count', { count: treasury.unpaidCount })}
          to="/invoices"
        />
        <StatCard
          label={t(`${prefix}_overdue_invoices`)}
          value={treasury.overdueCount}
          icon={IconReceiptOff}
          accent="#d63939"
          accentBg="#ffe3e3"
          cardBg="#fef2f2"
          trend={treasury.overdueCount > 0 ? formatEur(treasury.overdueAmount) : t('dashboard_kpi_no_overdue')}
          trendUp={treasury.overdueCount === 0}
          to="/invoices"
        />
      </div>
    </div>
  );
}
