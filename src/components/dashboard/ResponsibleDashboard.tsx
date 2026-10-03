import * as React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import RoleHero from './RoleHero';
import type { OpsKpis } from '../../lib/dashboardOps';
import type { Project } from '../../types';
import {
  SectionCard,
  TblrTooltip,
  formatEur,
  BUDGET_ESTIMATED_COLOR,
  BUDGET_ACTUAL_COLOR,
} from './DashboardWidgets';

/**
 * Dashboard for non-admin, non-manager users ("responsible" users) — scoped
 * to the projects they belong to via `project_members`.
 */
export default function ResponsibleDashboard() {
  const { t } = useTranslation();
  const { currentUser } = useUser();
  const [projects, setProjects] = useState<Project[]>([]);
  const [myProjectIds, setMyProjectIds] = useState<Set<string>>(new Set());
  const [invoices, setInvoices] = useState<any[]>([]);
  const [ops, setOps] = useState<OpsKpis | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadAll = React.useCallback(async () => {
    if (!currentUser?.id) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [projectsData, membershipData, invoicesData] = await Promise.all([
        fetchJson('/api/projects'),
        fetchJson(`/api/project-members?user_id=${currentUser.id}`),
        fetchJson('/api/invoices'),
      ]);
      setProjects(Array.isArray(projectsData) ? projectsData : []);
      setMyProjectIds(new Set((Array.isArray(membershipData) ? membershipData : []).map((m: any) => m.project_id)));
      setInvoices(Array.isArray(invoicesData) ? invoicesData : []);
    } catch (err) {
      console.error('Failed to load responsible dashboard data:', err);
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [currentUser?.id]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const myProjects = useMemo(() => projects.filter(p => myProjectIds.has(p.id)), [projects, myProjectIds]);

  const budgetByProject = useMemo(() => {
    const paidByProjectId: Record<string, number> = {};
    invoices
      .filter(inv => (inv.status === 'paid' || inv.status === 'Paid') && myProjectIds.has(inv.project_id))
      .forEach(inv => {
        paidByProjectId[inv.project_id] = (paidByProjectId[inv.project_id] || 0) + (inv.total_amount || inv.amount || 0);
      });
    return myProjects
      .filter(p => (p.remuneration || 0) > 0)
      .map(p => ({
        name: p.name.length > 16 ? `${p.name.slice(0, 15)}…` : p.name,
        estimated: p.remuneration || 0,
        actual: paidByProjectId[p.id] || 0,
      }))
      .sort((a, b) => b.estimated - a.estimated)
      .slice(0, 6);
  }, [myProjects, invoices, myProjectIds]);

  const totalFees = useMemo(() => myProjects.reduce((s, p) => s + (p.remuneration || 0), 0), [myProjects]);
  const totalConsumed = useMemo(
    () => invoices.filter(inv => (inv.status === 'paid' || inv.status === 'Paid') && myProjectIds.has(inv.project_id)).reduce((s, inv) => s + (inv.total_amount || inv.amount || 0), 0),
    [invoices, myProjectIds]
  );

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

      {/* Rien tant que le suivi n'est pas lu : « rien en retard » serait faux. */}
      {ops && (
        <RoleHero
          role="member"
          name={currentUser?.name ?? ''}
          stats={{
            paidThisMonth: 0,
            overdueInvoices: 0,
            activeProjects: ops?.activeProjects ?? 0,
            openDeadlines: ops?.upcomingDeadlines ?? 0,
            meetingsThisWeek: ops?.meetingsThisWeek ?? 0,
            lateItems: ops ? ops.lateDeadlines + ops.rfisLate + ops.oprLate + ops.gpaLate + ops.tasksLate : 0,
          }}
        />
      )}

      <OperationalKpis scopeProjectIds={myProjectIds} projects={projects} onKpis={setOps} />

      <SectionCard title={t('kpi_budget_vs_fees')}>
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="p-3 rounded-lg" style={{ background: 'var(--tblr-surface-2)' }}>
            <p className="text-[0.6875rem]" style={{ color: 'var(--tblr-muted)' }}>{t('budget_estimated')}</p>
            <p className="text-lg font-bold" style={{ color: 'var(--tblr-text)' }}>{formatEur(totalFees)}</p>
          </div>
          <div className="p-3 rounded-lg" style={{ background: 'var(--tblr-surface-2)' }}>
            <p className="text-[0.6875rem]" style={{ color: 'var(--tblr-muted)' }}>{t('budget_actual')}</p>
            <p className="text-lg font-bold" style={{ color: totalConsumed > totalFees ? '#d63939' : 'var(--tblr-text)' }}>{formatEur(totalConsumed)}</p>
          </div>
        </div>
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
