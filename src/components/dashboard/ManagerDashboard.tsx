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
import TreasuryKpis from './TreasuryKpis';
import { computeTreasury } from '../../lib/dashboardTreasury';
import RoleHero from './RoleHero';
import type { OpsKpis } from '../../lib/dashboardOps';
import { invoiceTotal, isPaid } from '../../lib/dashboardMetrics';
import type { Project, TeamMember } from '../../types';
import {
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
  const [ops, setOps] = useState<OpsKpis | null>(null);
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
  const treasury = useMemo(() => computeTreasury(teamInvoices), [teamInvoices]);

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

      {/* Rien tant que le suivi n'est pas lu : « rien en retard » serait faux. */}
      {ops && (
        <RoleHero
          role="manager"
          name={currentUser?.name ?? ''}
          stats={{
            paidThisMonth: treasury.paidThisMonth,
            overdueInvoices: treasury.overdueCount,
            activeProjects: ops?.activeProjects ?? 0,
            openDeadlines: ops?.upcomingDeadlines ?? 0,
            meetingsThisWeek: ops?.meetingsThisWeek ?? 0,
            lateItems: 0,
          }}
        />
      )}

      {/* Le budget estimé n'a plus sa carte : il figure déjà sur le graphique
          « honoraires consommés vs prévus » plus bas. */}
      <TreasuryKpis treasury={treasury} scope="team" />

      {/* Suivi des affaires et du chantier, sur les affaires de l'équipe */}
      <OperationalKpis scopeProjectIds={teamProjectIds} projects={projects} onKpis={setOps} />

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
