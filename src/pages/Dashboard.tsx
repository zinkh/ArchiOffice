import * as React from 'react';
import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  IconActivity,
  IconChevronRight,
  IconPlus,
  IconFileInvoice,
  IconBriefcase,
  IconFileText,
  IconCurrencyEuro,
  IconHourglass,
} from '@tabler/icons-react';
import { cn } from '../lib/utils';
import { fetchJson } from '../lib/api';
import { computeCopilotSuggestions, formatCopilotSuggestion } from '../lib/copilotSuggestions';
import type { Project, Milestone } from '../types';
import { useTranslation } from 'react-i18next';
import ActivityFeed from '../components/ActivityFeed';
import MyTasksWidget from '../components/dashboard/MyTasksWidget';
import { ErrorState, StatCardSkeletonGrid, ListSkeleton } from '../components/DataState';
import { useAgentChat } from '@zinkh/archioffice-agents/client';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { IconSparkles, IconAlertTriangle } from '@tabler/icons-react';
import { useUser } from '../UserContext';
import ManagerDashboard from '../components/dashboard/ManagerDashboard';
import ResponsibleDashboard from '../components/dashboard/ResponsibleDashboard';
import {
  StatusBadge,
  TblrTooltip,
  SectionCard,
  QuickAction,
  KpiTile,
  MiniStatStrip,
  RankedBars,
  STATUS_GROUP_COLORS,
  REVENUE_INVOICED_COLOR,
  REVENUE_PAID_COLOR,
} from '../components/dashboard/DashboardWidgets';
import {
  normalizeProjectStatus,
  statusBreakdown,
  categoryBreakdown,
  monthlyRevenue,
  feesProgressByProject,
  deliveredThisMonth,
  invoiceTotal,
  isPaid,
  isIssued,
  isOverdue,
  UNCATEGORIZED,
} from '../lib/dashboardMetrics';

export default function Dashboard() {
  const { currentUser } = useUser();

  if (currentUser?.system_role === 'manager') return <ManagerDashboard />;
  if (currentUser && currentUser.system_role !== 'admin') return <ResponsibleDashboard />;
  return <AdminDashboardView />;
}

// Admin dashboard — unchanged from before role-based dashboards were introduced.
function AdminDashboardView() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { openChat } = useAgentChat();
  const [projects,   setProjects]   = useState<Project[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [tenders,    setTenders]    = useState<any[]>([]);
  const [invoices,   setInvoices]   = useState<any[]>([]);
  const [proposals,  setProposals]  = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadAll = React.useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [projectsData, milestonesData, tendersData, invoicesData, proposalsData] = await Promise.all([
        fetchJson('/api/projects'),
        fetchJson('/api/milestones'),
        fetchJson('/api/tenders'),
        fetchJson('/api/invoices'),
        fetchJson('/api/proposals'),
      ]);
      setProjects(Array.isArray(projectsData) ? projectsData : []);
      setMilestones(Array.isArray(milestonesData) ? milestonesData : []);
      setTenders(Array.isArray(tendersData) ? tendersData : []);
      setInvoices(Array.isArray(invoicesData) ? invoicesData : []);
      setProposals(Array.isArray(proposalsData) ? proposalsData : []);
    } catch (err) {
      console.error('Failed to load dashboard data:', err);
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const pendingTenders   = tenders.filter(t => !t.status || t.status === 'pending' || t.status === 'Pending').length;
  const pendingProposals = proposals.filter(p => p.status === 'Pending' || p.status === 'Draft').length;
  const upcomingDeadlines = milestones.filter(m => !m.completed).length;

  const formatEur = (n: number) =>
    new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
  const formatEurShort = (n: number) =>
    n >= 1000 ? `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(n / 1000)} k€` : `${Math.round(n)} €`;

  // ── Finances : tout est lu sur les factures émises (hors brouillons) ──
  const finance = React.useMemo(() => {
    const issued = invoices.filter(isIssued);
    const invoiced = issued.reduce((s, inv) => s + invoiceTotal(inv), 0);
    const paid = issued.filter(isPaid).reduce((s, inv) => s + invoiceTotal(inv), 0);
    const overdue = issued.filter(isOverdue);
    return {
      invoiced,
      paid,
      receivable: invoiced - paid,
      overdueCount: overdue.length,
      collectionRate: invoiced > 0 ? Math.round((paid / invoiced) * 100) : 0,
    };
  }, [invoices]);

  // ── Affaires : statuts normalisés (FR/EN), aucune affaire hors du compte ──
  const statusData = React.useMemo(
    () => statusBreakdown(projects).map(d => ({ ...d, name: t(`dashboard_status_${d.group}`) })),
    [projects, t]
  );
  const activeProjects = React.useMemo(
    () => projects.filter(p => normalizeProjectStatus(p.status) === 'active').length,
    [projects]
  );
  const deliveredCount = React.useMemo(() => deliveredThisMonth(projects), [projects]);
  const categoryData = React.useMemo(() => categoryBreakdown(projects), [projects]);
  const revenueSeries = React.useMemo(() => monthlyRevenue(invoices), [invoices]);
  const feesRows = React.useMemo(() => feesProgressByProject(projects, invoices), [projects, invoices]);

  // ── Proactive AI suggestions — simple rule-based read of the data already
  // on this page (no extra network round-trip). Each suggestion opens the
  // agent chat with a prefilled draft the user reviews before sending, so
  // the AI never acts without the user's go-ahead. Rules live in
  // src/lib/copilotSuggestions.ts, shared with the global chat badge. ──
  const suggestions = React.useMemo(
    () => computeCopilotSuggestions({ projects, milestones, invoices }).map(raw => formatCopilotSuggestion(raw, t)),
    [milestones, projects, invoices, t]
  );

  const dashboardHeader = (
    <>
      {/* Page header */}
      <div className="flex items-center justify-between pb-4 hidden sm:flex" style={{ borderBottom: '1px solid var(--tblr-border)' }}>
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--tblr-text)' }}>
            {t('dashboard')}
          </h1>
          <p className="text-[12px] mt-0.5" style={{ color: 'var(--tblr-muted)' }}>
            {new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
      </div>

      {/* Mobile date greeting */}
      <div className="sm:hidden">
        <p className="text-[12px] capitalize" style={{ color: 'var(--tblr-muted)' }}>
          {new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
      </div>
    </>
  );

  // First load: show skeleton placeholders instead of an empty-looking dashboard.
  if (loading && projects.length === 0 && tenders.length === 0 && invoices.length === 0 && !loadError) {
    return (
      <div className="space-y-5">
        {dashboardHeader}
        <StatCardSkeletonGrid count={4} />
        <StatCardSkeletonGrid count={4} />
        <div className="hidden lg:grid grid-cols-2 gap-4">
          <div className="rounded-xl p-4" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}>
            <ListSkeleton rows={4} />
          </div>
          <div className="rounded-xl p-4" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}>
            <ListSkeleton rows={4} />
          </div>
        </div>
      </div>
    );
  }

  // Fetch failed and we have nothing cached to fall back to — show a clear,
  // retry-able error instead of a dashboard that silently looks empty.
  if (loadError && projects.length === 0 && tenders.length === 0 && invoices.length === 0) {
    return (
      <div className="space-y-5">
        {dashboardHeader}
        <ErrorState message={loadError} onRetry={loadAll} />
      </div>
    );
  }

  return (
    <div className="space-y-5">

      {dashboardHeader}

      {/* Stale-but-visible data plus a dismissible-by-retry banner, for the
          case a background refresh failed but we still have the last good load. */}
      {loadError && (projects.length > 0 || tenders.length > 0 || invoices.length > 0) && (
        <ErrorState compact message={loadError} onRetry={loadAll} />
      )}

      {/* ── Indicateurs clés ── */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <KpiTile
          label={t('dashboard_kpi_revenue')}
          value={formatEur(finance.paid)}
          icon={IconCurrencyEuro}
          hint={t('dashboard_kpi_revenue_hint', { total: formatEur(finance.invoiced) })}
          progress={finance.collectionRate}
          to="/invoices"
        />
        <KpiTile
          label={t('dashboard_kpi_receivable')}
          value={formatEur(finance.receivable)}
          icon={IconHourglass}
          hint={finance.overdueCount > 0
            ? t('dashboard_kpi_overdue', { count: finance.overdueCount })
            : t('dashboard_kpi_no_overdue')}
          hintTone={finance.overdueCount > 0 ? 'danger' : 'success'}
          to="/invoices"
        />
        <KpiTile
          label={t('dashboard_kpi_active')}
          value={activeProjects}
          icon={IconActivity}
          hint={t('dashboard_kpi_active_hint', { total: projects.length })}
          to="/projects"
        />
        <KpiTile
          label={t('dashboard_kpi_proposals')}
          value={pendingProposals}
          icon={IconFileText}
          hint={t('dashboard_kpi_proposals_hint')}
          to="/proposals"
        />
      </div>

      <MiniStatStrip
        items={[
          { label: t('dashboard_mini_tenders'), value: pendingTenders, to: '/tenders' },
          { label: t('dashboard_mini_milestones'), value: upcomingDeadlines, tone: upcomingDeadlines > 0 ? 'danger' : 'default' },
          { label: t('dashboard_mini_delivered'), value: deliveredCount, to: '/projects' },
          { label: t('dashboard_mini_collection'), value: `${finance.collectionRate} %`, to: '/invoices' },
        ]}
      />

      {/* ── Quick actions (mobile-prominent) ── */}
      <div className="xl:hidden">
        <p className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--tblr-muted)' }}>
          Création rapide
        </p>
        <div className="flex gap-2">
          <QuickAction icon={IconPlus}         label="Nouveau projet"  to="/projects"   color="#206bc4" />
          <QuickAction icon={IconFileText}      label="Nouveau devis"   to="/proposals"  color="#f76707" />
          <QuickAction icon={IconFileInvoice}   label="Nouvelle facture" to="/invoices"  color="#2fb344" />
          <QuickAction icon={IconBriefcase}     label="Appel d'offres"  to="/tenders"   color="#ae3ec9" />
        </div>
      </div>

      {/* ── Facturation mensuelle + statut des affaires ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <SectionCard
            title={t('dashboard_revenue_12m')}
            action={
              <div className="flex items-center gap-3 text-[11px]" style={{ color: 'var(--tblr-muted)' }}>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: REVENUE_INVOICED_COLOR }} />
                  {t('dashboard_invoiced')}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: REVENUE_PAID_COLOR }} />
                  {t('dashboard_paid')}
                </span>
              </div>
            }
          >
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <RechartsBarChart data={revenueSeries} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barGap={2}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--tblr-border)" />
                  <XAxis dataKey="label" tick={{ fill: 'var(--tblr-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: 'var(--tblr-muted)', fontSize: 11 }} axisLine={false} tickLine={false} width={52} tickFormatter={formatEurShort} />
                  <Tooltip content={<TblrTooltip valueFormatter={formatEur} />} cursor={{ fill: 'var(--tblr-surface-2)' }} />
                  <Bar dataKey="invoiced" name={t('dashboard_invoiced')} fill={REVENUE_INVOICED_COLOR} radius={[3, 3, 0, 0]} maxBarSize={18} />
                  <Bar dataKey="paid" name={t('dashboard_paid')} fill={REVENUE_PAID_COLOR} radius={[3, 3, 0, 0]} maxBarSize={18} />
                </RechartsBarChart>
              </ResponsiveContainer>
            </div>
          </SectionCard>
        </div>

        <SectionCard title={t('dashboard_project_status')}>
          {statusData.length === 0 ? (
            <p className="text-[13px] text-center py-8" style={{ color: 'var(--tblr-muted)' }}>Aucun projet</p>
          ) : (
            <>
              <div className="h-44 relative">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={statusData} cx="50%" cy="50%" innerRadius={58} outerRadius={78} paddingAngle={2} dataKey="value" stroke="none">
                      {statusData.map(d => <Cell key={d.group} fill={STATUS_GROUP_COLORS[d.group]} />)}
                    </Pie>
                    <Tooltip content={<TblrTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-[26px] font-bold leading-none tabular-nums" style={{ color: 'var(--tblr-text)' }}>{projects.length}</span>
                  <span className="text-[11px] mt-1" style={{ color: 'var(--tblr-muted)' }}>{t('dashboard_projects_total')}</span>
                </div>
              </div>
              <ul className="mt-3 space-y-1.5">
                {statusData.map(d => (
                  <li key={d.group} className="flex items-center gap-2 text-[12px]">
                    <span className="w-2 h-2 rounded-full inline-block shrink-0" style={{ background: STATUS_GROUP_COLORS[d.group] }} />
                    <span className="flex-1" style={{ color: 'var(--tblr-muted)' }}>{d.name}</span>
                    <strong className="tabular-nums" style={{ color: 'var(--tblr-text)' }}>{d.value}</strong>
                    <span className="w-10 text-right tabular-nums" style={{ color: 'var(--tblr-muted)' }}>
                      {Math.round((d.value / projects.length) * 100)} %
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </SectionCard>
      </div>

      {/* ── Catégories + facturation des honoraires par affaire ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard
          title={t('dashboard_categories')}
          action={<span className="text-[11px]" style={{ color: 'var(--tblr-muted)' }}>{t('dashboard_categories_hint')}</span>}
        >
          {categoryData.length === 0 ? (
            <p className="text-[13px] text-center py-8" style={{ color: 'var(--tblr-muted)' }}>{t('dashboard_no_data')}</p>
          ) : (
            <RankedBars rows={categoryData} muted={UNCATEGORIZED} />
          )}
        </SectionCard>

        <SectionCard title={t('dashboard_fees_progress')}>
          {feesRows.length === 0 ? (
            <p className="text-[13px] text-center py-8" style={{ color: 'var(--tblr-muted)' }}>{t('dashboard_no_data')}</p>
          ) : (
            <ul className="space-y-3.5">
              {feesRows.map(r => (
                <li key={r.id} className="cursor-pointer" onClick={() => navigate(`/projects/${r.id}`)}>
                  <div className="flex items-baseline justify-between gap-3 mb-1">
                    <span className="text-[13px] font-medium truncate" style={{ color: 'var(--tblr-text)' }} title={r.name}>{r.name}</span>
                    <span className="text-[12px] tabular-nums shrink-0" style={{ color: 'var(--tblr-muted)' }}>
                      {r.pct !== null ? <strong style={{ color: 'var(--tblr-text)' }}>{r.pct} %</strong> : formatEur(r.invoiced)}
                    </span>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden flex" style={{ background: 'var(--tblr-surface-2)' }}>
                    {r.fees > 0 && (
                      <>
                        <div style={{ width: `${Math.min(100, (r.paid / r.fees) * 100)}%`, background: REVENUE_PAID_COLOR }} />
                        <div style={{ width: `${Math.max(0, Math.min(100, (r.invoiced / r.fees) * 100) - Math.min(100, (r.paid / r.fees) * 100))}%`, background: REVENUE_INVOICED_COLOR }} />
                      </>
                    )}
                  </div>
                  <p className="text-[11px] mt-1" style={{ color: 'var(--tblr-muted)' }}>
                    {r.fees > 0
                      ? <>{formatEur(r.paid)} {t('dashboard_paid').toLowerCase()} · {formatEur(r.invoiced)} {t('dashboard_invoiced').toLowerCase()} {t('dashboard_of_fees', { fees: formatEur(r.fees) })}</>
                      : <>{formatEur(r.paid)} {t('dashboard_paid').toLowerCase()} · {t('dashboard_fees_unknown')}</>}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      {/* ── Proactive AI suggestions ── */}
      <SectionCard
        title={
          <span className="flex items-center gap-1.5">
            {t('dashboard_ai_suggestions')}
            <span
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide"
              style={{ background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)' }}
            >
              <IconSparkles size={10} /> IA
            </span>
          </span>
        }
      >
        {suggestions.length === 0 ? (
          <p className="text-[13px] text-center py-8" style={{ color: 'var(--tblr-muted)' }}>{t('ai_suggestions_empty')}</p>
        ) : (
          <div className="space-y-2.5">
            {suggestions.map(s => (
              <div
                key={s.id}
                className="flex items-start gap-3 p-3 rounded-lg"
                style={{
                  background: s.tone === 'danger' ? '#fff5f5' : '#fff4e6',
                  border: `1px solid ${s.tone === 'danger' ? '#ffc9c9' : '#ffd8a8'}`,
                }}
              >
                <IconAlertTriangle size={16} className="mt-0.5 shrink-0" style={{ color: s.tone === 'danger' ? '#c92a2a' : '#e67700' }} />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px]" style={{ color: 'var(--tblr-text)' }}>{s.text}</p>
                  <button
                    onClick={() => openChat(undefined, s.draft)}
                    className="mt-1.5 flex items-center gap-1 text-[11px] font-semibold hover:underline"
                    style={{ color: 'var(--tblr-primary)' }}
                  >
                    <IconSparkles size={12} />
                    {t('ai_draft_reminder_btn')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <MyTasksWidget />

      {/* Recent projects */}
      <SectionCard
        title={t('recent_projects')}
        action={
          <Link
            to="/projects"
            className="flex items-center gap-1 text-[12px] font-medium transition-colors"
            style={{ color: 'var(--tblr-primary)' }}
          >
            {t('view_all')} <IconChevronRight size={14} />
          </Link>
        }
      >
        {projects.length === 0 ? (
          <p className="text-[13px] text-center py-8" style={{ color: 'var(--tblr-muted)' }}>Aucun projet</p>
        ) : (
          <div className="divide-y" style={{ borderColor: 'var(--tblr-border)' }}>
            {projects.slice(0, 6).map(project => (
              <div
                key={project.id}
                className="flex items-center gap-3 py-3 cursor-pointer transition-colors"
                style={{ borderColor: 'var(--tblr-border)' }}
                onClick={() => navigate(`/projects/${project.id}`)}
                onMouseOver={e => (e.currentTarget.style.background = 'var(--tblr-surface-2)')}
                onMouseOut={e => (e.currentTarget.style.background = '')}
              >
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center text-sm font-bold shrink-0"
                  style={{ background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)' }}
                >
                  {project.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--tblr-text)' }}>
                    {project.name}
                  </p>
                  {project.client && (
                    <p className="text-[11px] truncate" style={{ color: 'var(--tblr-muted)' }}>
                      {project.client}
                    </p>
                  )}
                </div>
                <StatusBadge status={project.status} />
                <IconChevronRight size={14} style={{ color: 'var(--tblr-muted)' }} className="shrink-0" />
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Activity feed */}
      <ActivityFeed />
    </div>
  );
}
