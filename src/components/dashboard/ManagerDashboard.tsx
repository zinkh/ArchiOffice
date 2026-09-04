import * as React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  IconRubberStamp,
  IconClock,
  IconCalendarStats,
  IconMessageDots,
  IconClipboardCheck,
  IconShieldCheck,
  IconCurrencyEuro,
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
import type { Project, Milestone, Permit, Rfi, Reserve, GpaReserve, TeamMember } from '../../types';
import {
  StatCard,
  SectionCard,
  TblrTooltip,
  formatEur,
  BUDGET_ESTIMATED_COLOR,
  BUDGET_ACTUAL_COLOR,
} from './DashboardWidgets';

function startOfWeek(d: Date) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

/**
 * Dashboard for managers — same operational KPIs as ResponsibleDashboard but
 * aggregated over the projects of every user they manage, plus financial
 * KPIs scoped to that same set of projects (not tenant-wide).
 */
export default function ManagerDashboard() {
  const { t } = useTranslation();
  const { currentUser } = useUser();
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [teamProjectIds, setTeamProjectIds] = useState<Set<string>>(new Set());
  const [permits, setPermits] = useState<Permit[]>([]);
  const [rfis, setRfis] = useState<Rfi[]>([]);
  const [meetings, setMeetings] = useState<any[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [reserves, setReserves] = useState<Reserve[]>([]);
  const [gpaReserves, setGpaReserves] = useState<GpaReserve[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadAll = React.useCallback(async () => {
    if (!currentUser?.id) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [teamData, projectsData, membershipData, permitsData, rfisData, meetingsData, milestonesData, invoicesData, reservesData, gpaReservesData] = await Promise.all([
        fetchJson('/api/team'),
        fetchJson('/api/projects'),
        fetchJson('/api/project-members'),
        fetchJson('/api/permits'),
        fetchJson('/api/rfis'),
        fetchJson('/api/meetings'),
        fetchJson('/api/milestones'),
        fetchJson('/api/invoices'),
        fetchJson('/api/reserves'),
        fetchJson('/api/gpa-reserves'),
      ]);
      const teamList: TeamMember[] = Array.isArray(teamData) ? teamData : [];
      setTeam(teamList);
      const reportIds = new Set([currentUser.id, ...teamList.filter(m => m.manager_id === currentUser.id).map(m => m.id)]);
      const memberships = Array.isArray(membershipData) ? membershipData : [];
      setTeamProjectIds(new Set(memberships.filter((m: any) => reportIds.has(m.user_id)).map((m: any) => m.project_id)));
      setProjects(Array.isArray(projectsData) ? projectsData : []);
      setPermits(Array.isArray(permitsData) ? permitsData : []);
      setRfis(Array.isArray(rfisData) ? rfisData : []);
      setMeetings(Array.isArray(meetingsData) ? meetingsData : []);
      setMilestones(Array.isArray(milestonesData) ? milestonesData : []);
      setInvoices(Array.isArray(invoicesData) ? invoicesData : []);
      setReserves(Array.isArray(reservesData) ? reservesData : []);
      setGpaReserves(Array.isArray(gpaReservesData) ? gpaReservesData : []);
    } catch (err) {
      console.error('Failed to load manager dashboard data:', err);
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [currentUser?.id]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const teamProjects = useMemo(() => projects.filter(p => teamProjectIds.has(p.id)), [projects, teamProjectIds]);

  const activePermitsCount = useMemo(
    () => permits.filter(p => teamProjectIds.has(p.project_id) && p.status !== 'refuse').length,
    [permits, teamProjectIds]
  );

  const upcomingDeadlinesCount = useMemo(() => {
    const now = new Date();
    const in30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    return milestones.filter(m => m.project_id && teamProjectIds.has(m.project_id) && !m.completed && new Date(m.due_date) <= in30).length;
  }, [milestones, teamProjectIds]);

  const meetingsThisWeekCount = useMemo(() => {
    const weekStart = startOfWeek(new Date());
    const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
    return meetings.filter(m => m.project_id && teamProjectIds.has(m.project_id) && new Date(m.date) >= weekStart && new Date(m.date) < weekEnd).length;
  }, [meetings, teamProjectIds]);

  const rfisAwaitingCount = useMemo(
    () => rfis.filter(r => teamProjectIds.has(r.project_id) && r.status === 'en_attente').length,
    [rfis, teamProjectIds]
  );

  const oprStats = useMemo(() => {
    const scoped = reserves.filter(r => teamProjectIds.has(r.project_id));
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return {
      open: scoped.filter(r => r.status !== 'Levée' && r.status !== 'Quitus Transmis').length,
      late: scoped.filter(r => r.status !== 'Levée' && r.status !== 'Quitus Transmis' && new Date(r.due_date) < today).length,
    };
  }, [reserves, teamProjectIds]);

  const gpaStats = useMemo(() => {
    const scoped = gpaReserves.filter(r => teamProjectIds.has(r.project_id));
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return {
      open: scoped.filter(r => r.status !== 'Levée' && r.status !== 'Quitus Transmis').length,
      late: scoped.filter(r => r.status !== 'Levée' && r.status !== 'Quitus Transmis' && new Date(r.due_date) < today).length,
    };
  }, [gpaReserves, teamProjectIds]);

  const teamInvoices = useMemo(() => invoices.filter(inv => teamProjectIds.has(inv.project_id)), [invoices, teamProjectIds]);
  const totalRevenue = useMemo(
    () => teamInvoices.filter(inv => inv.status === 'paid' || inv.status === 'Paid').reduce((s, inv) => s + (inv.total_amount || inv.amount || 0), 0),
    [teamInvoices]
  );
  const overdueInvoicesCount = useMemo(() => teamInvoices.filter(inv => inv.status === 'overdue' || inv.status === 'Overdue').length, [teamInvoices]);

  const budgetByProject = useMemo(() => {
    const paidByProjectId: Record<string, number> = {};
    teamInvoices
      .filter(inv => inv.status === 'paid' || inv.status === 'Paid')
      .forEach(inv => {
        paidByProjectId[inv.project_id] = (paidByProjectId[inv.project_id] || 0) + (inv.total_amount || inv.amount || 0);
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

  const totalEstimatedBudget = useMemo(() => teamProjects.reduce((s, p) => s + (p.budget || 0), 0), [teamProjects]);

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
        <p className="text-[12px] mt-0.5" style={{ color: 'var(--tblr-muted)' }}>
          {new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      </div>

      {loadError && <ErrorState compact message={loadError} onRetry={loadAll} />}

      {/* Financial KPIs — scoped to the manager's team's projects */}
      <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
        <StatCard label={t('kpi_team_revenue')} value={formatEur(totalRevenue)} icon={IconCurrencyEuro} accent="#206bc4" accentBg="#e8f0fb" cardBg="#eef3fb" />
        <StatCard label={t('kpi_team_overdue_invoices')} value={overdueInvoicesCount} icon={IconReceiptOff} accent="#d63939" accentBg="#ffe3e3" cardBg="#fef2f2" />
        <StatCard label={t('budget_estimated')} value={formatEur(totalEstimatedBudget)} icon={IconCurrencyEuro} accent="#6c7a91" accentBg="#f1f3f6" />
      </div>

      {/* Operational KPIs — aggregated over direct reports' projects */}
      <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
        <StatCard label={t('kpi_active_permits')} value={activePermitsCount} icon={IconRubberStamp} accent="#206bc4" accentBg="#e8f0fb" to="/projects" />
        <StatCard label={t('kpi_upcoming_deadlines')} value={upcomingDeadlinesCount} icon={IconClock} accent="#d63939" accentBg="#ffe3e3" />
        <StatCard label={t('kpi_meetings_week')} value={meetingsThisWeekCount} icon={IconCalendarStats} accent="#ae3ec9" accentBg="#f8d7ff" />
        <StatCard label={t('kpi_rfis_pending')} value={rfisAwaitingCount} icon={IconMessageDots} accent="#f76707" accentBg="#fff4e6" />
        <StatCard
          label={t('kpi_opr_tracking')}
          value={oprStats.open}
          icon={IconClipboardCheck}
          accent="#2fb344"
          accentBg="#d3f9d8"
          trend={oprStats.late > 0 ? t('kpi_late_count', { count: oprStats.late }) : undefined}
          trendUp={oprStats.late === 0}
        />
        <StatCard
          label={t('kpi_gpa_tracking')}
          value={gpaStats.open}
          icon={IconShieldCheck}
          accent="#f59f00"
          accentBg="#fff9db"
          trend={gpaStats.late > 0 ? t('kpi_late_count', { count: gpaStats.late }) : undefined}
          trendUp={gpaStats.late === 0}
        />
      </div>

      <SectionCard title={t('kpi_budget_vs_fees')}>
        {budgetByProject.length === 0 ? (
          <p className="text-[13px] text-center py-8" style={{ color: 'var(--tblr-muted)' }}>{t('budget_no_data')}</p>
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
