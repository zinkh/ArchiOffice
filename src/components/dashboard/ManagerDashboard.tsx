import * as React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  IconCurrencyEuro,
  IconHourglass,
  IconReceiptOff,
} from '@tabler/icons-react';
import {
  ResponsiveContainer,
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { fetchJson } from '../../lib/api';
import { useUser } from '../../UserContext';
import { ErrorState, StatCardSkeletonGrid } from '../DataState';
import MyTasksWidget from './MyTasksWidget';
import OperationalKpis from './OperationalKpis';
import { invoiceTotal, isIssued, isOverdue, isPaid } from '../../lib/dashboardMetrics';
import type { Project, TeamMember } from '../../types';
import {
  StatCard,
  SectionCard,
  TblrTooltip,
  formatEur,
  BUDGET_ESTIMATED_COLOR,
  BUDGET_ACTUAL_COLOR,
} from './DashboardWidgets';

/**
 * Dashboard for managers — operational KPIs (OperationalKpis, same block as
 * the administrator's) and financial KPIs, both scoped to the projects of the
 * manager and the people they manage, never the whole agency.
 */
export default function ManagerDashboard() {
  const { t } = useTranslation();
  const { currentUser } = useUser();
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [teamProjectIds, setTeamProjectIds] = useState<Set<string>>(new Set());
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadAll = React.useCallback(async () => {
    if (!currentUser?.id) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [teamData, projectsData, membershipData, invoicesData] = await Promise.all([
        fetchJson('/api/team'),
        fetchJson('/api/projects'),
        fetchJson('/api/project-members'),
        fetchJson('/api/invoices'),
      ]);
      const teamList: TeamMember[] = Array.isArray(teamData) ? teamData : [];
      setTeam(teamList);
      const reportIds = new Set([currentUser.id, ...teamList.filter(m => m.manager_id === currentUser.id).map(m => m.id)]);
      const memberships = Array.isArray(membershipData) ? membershipData : [];
      setTeamProjectIds(new Set(memberships.filter((m: any) => reportIds.has(m.user_id)).map((m: any) => m.project_id)));
      setProjects(Array.isArray(projectsData) ? projectsData : []);
      setInvoices(Array.isArray(invoicesData) ? invoicesData : []);
    } catch (err) {
      console.error('Failed to load manager dashboard data:', err);
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [currentUser?.id]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const teamProjects = useMemo(() => projects.filter(p => teamProjectIds.has(p.id)), [projects, teamProjectIds]);

  const teamInvoices = useMemo(() => invoices.filter(inv => teamProjectIds.has(inv.project_id)), [invoices, teamProjectIds]);
  const finance = useMemo(() => {
    const issued = teamInvoices.filter(isIssued);
    const paid = issued.filter(isPaid).reduce((sum, inv) => sum + invoiceTotal(inv), 0);
    const invoiced = issued.reduce((sum, inv) => sum + invoiceTotal(inv), 0);
    const overdue = issued.filter(isOverdue);
    return {
      paid,
      receivable: invoiced - paid,
      unpaidCount: issued.filter(inv => !isPaid(inv)).length,
      overdueCount: overdue.length,
      overdueAmount: overdue.reduce((sum, inv) => sum + invoiceTotal(inv), 0),
    };
  }, [teamInvoices]);

  const budgetByProject = useMemo(() => {
    const paidByProjectId: Record<string, number> = {};
    teamInvoices
      .filter(isPaid)
      .forEach(inv => {
        paidByProjectId[inv.project_id] = (paidByProjectId[inv.project_id] || 0) + invoiceTotal(inv);
      });
    return teamProjects
      .filter(p => (p.budget || 0) > 0)
      .map(p => ({
        name: p.name.length > 16 ? `${p.name.slice(0, 15)}…` : p.name,
        estimated: p.budget || 0,
        actual: paidByProjectId[p.id] || 0,
      }))
      .sort((a, b) => b.estimated - a.estimated)
      .slice(0, 6);
  }, [teamProjects, teamInvoices]);

  if (loading && projects.length === 0 && !loadError) {
    return (
      <div className="space-y-5">
        <StatCardSkeletonGrid count={6} />
      </div>
    );
  }

  if (loadError && projects.length === 0) {
    return <ErrorState message={loadError} onRetry={loadAll} />;
  }

  return (
    <div className="space-y-5">
      <div className="pb-4 hidden sm:block" style={{ borderBottom: '1px solid var(--tblr-border)' }}>
        <h1 className="text-xl font-bold" style={{ color: 'var(--tblr-text)' }}>{t('dashboard')}</h1>
        <p className="text-[0.75rem] mt-0.5" style={{ color: 'var(--tblr-muted)' }}>
          {new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      </div>

      {loadError && <ErrorState compact message={loadError} onRetry={loadAll} />}

      {/* Trésorerie, limitée aux affaires de l'équipe. Le budget estimé n'a plus sa carte :
          il figure déjà sur le graphique « honoraires consommés vs prévus » plus bas. */}
      <div>
        <p className="text-[0.6875rem] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--tblr-muted)' }}>
          {t('kpi_group_treasury')}
        </p>
        <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
          <StatCard label={t('kpi_team_revenue')} value={formatEur(finance.paid)} icon={IconCurrencyEuro} accent="#206bc4" accentBg="#e8f0fb" cardBg="#eef3fb" to="/invoices" />
          <StatCard
            label={t('kpi_team_receivable')}
            value={formatEur(finance.receivable)}
            icon={IconHourglass}
            accent="#e67700"
            accentBg="#ffec99"
            cardBg="#fff9db"
            trend={t('dashboard_unpaid_count', { count: finance.unpaidCount })}
            to="/invoices"
          />
          <StatCard
            label={t('kpi_team_overdue_invoices')}
            value={finance.overdueCount}
            icon={IconReceiptOff}
            accent="#d63939"
            accentBg="#ffe3e3"
            cardBg="#fef2f2"
            trend={finance.overdueCount > 0 ? formatEur(finance.overdueAmount) : t('dashboard_kpi_no_overdue')}
            trendUp={finance.overdueCount === 0}
            to="/invoices"
          />
        </div>
      </div>

      {/* Suivi des affaires et du chantier, sur les affaires de l'équipe */}
      <OperationalKpis scopeProjectIds={teamProjectIds} projects={projects} />

      <SectionCard title={t('kpi_budget_vs_fees')}>
        {budgetByProject.length === 0 ? (
          <p className="text-[0.8125rem] text-center py-8" style={{ color: 'var(--tblr-muted)' }}>{t('budget_no_data')}</p>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <RechartsBarChart data={budgetByProject} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--tblr-border)" />
                <XAxis dataKey="name" tick={{ fill: 'var(--tblr-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: 'var(--tblr-muted)', fontSize: 11 }} axisLine={false} tickLine={false} width={56} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                <Tooltip content={<TblrTooltip />} cursor={{ fill: 'var(--tblr-surface-2)' }} />
                <Bar dataKey="estimated" name={t('budget_estimated')} fill={BUDGET_ESTIMATED_COLOR} radius={[3, 3, 0, 0]} barSize={16} />
                <Bar dataKey="actual" name={t('budget_actual')} fill={BUDGET_ACTUAL_COLOR} radius={[3, 3, 0, 0]} barSize={16} />
              </RechartsBarChart>
            </ResponsiveContainer>
          </div>
        )}
      </SectionCard>

      <MyTasksWidget />
    </div>
  );
}
