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
  IconReceiptOff,
  IconAlertCircle,
  IconClock,
  IconWallet,
  IconCash,
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
  StatCard,
  HeroCard,
  RadialGauge,
  Sparkline,
  RankedBars,
  CATEGORY_COLORS,
  STATUS_GROUP_COLORS,
  REVENUE_INVOICED_COLOR,
  REVENUE_PAID_COLOR,
  ELEVATED_SHADOW,
} from '../components/dashboard/DashboardWidgets';
import {
  normalizeProjectStatus,
  statusBreakdown,
  categoryBreakdown,
  monthlyRevenue,
  feesProgressByProject,
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
  const { currentUser } = useUser();
  const firstName = (currentUser?.name ?? '').trim().split(/\s+/)[0] ?? '';
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
      unpaidCount: issued.filter(inv => !isPaid(inv)).length,
      overdueAmount: overdue.reduce((s, inv) => s + invoiceTotal(inv), 0),
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
  const categoryData = React.useMemo(() => categoryBreakdown(projects), [projects]);
  const revenueSeries = React.useMemo(() => monthlyRevenue(invoices), [invoices]);
  const paidThisMonth = revenueSeries[revenueSeries.length - 1]?.paid ?? 0;
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
          <p className="text-[0.75rem] mt-0.5" style={{ color: 'var(--tblr-muted)' }}>
            {new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
      </div>

      {/* Mobile date greeting */}
      <div className="sm:hidden">
        <p className="text-[0.75rem] capitalize" style={{ color: 'var(--tblr-muted)' }}>
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

      {/* ── Grille principale, partitionnée à la manière de Sneat : accueil
          et indicateurs financiers, puis facturation et indicateurs d'activité,
          puis trois cartes d'analyse ── */}
      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 xl:col-span-8">
          <HeroCard
            title={firstName ? t('dashboard_hero_title', { name: firstName }) : t('dashboard_hero_title_anon')}
            action={
              <Link
                to="/invoices"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[0.75rem] font-semibold transition-colors"
                style={{ background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)' }}
              >
                {finance.overdueCount > 0 ? t('dashboard_hero_cta_overdue') : t('dashboard_hero_cta')}
                <IconChevronRight size={14} />
              </Link>
            }
          >
            <p>
              {t('dashboard_hero_paid_month', { amount: formatEur(paidThisMonth) })}{' '}
              {finance.overdueCount > 0
                ? <strong style={{ color: '#d63939' }}>{t('dashboard_kpi_overdue', { count: finance.overdueCount })}.</strong>
                : t('dashboard_kpi_no_overdue') + '.'}
            </p>
            <p className="mt-1">{t('dashboard_hero_activity', { active: activeProjects, deadlines: upcomingDeadlines })}</p>
          </HeroCard>
        </div>

        <div className="col-span-12 xl:col-span-4 grid grid-cols-2 gap-4">
          <StatCard
            label={t('dashboard_kpi_revenue')}
            value={formatEur(finance.paid)}
            icon={IconCurrencyEuro}
            accent="#206bc4"
            accentBg="#e8f0fb"
            cardBg="#eef3fb"
            trend={t('dashboard_kpi_revenue_hint', { total: formatEur(finance.invoiced) })}
            trendUp={true}
            to="/invoices"
          >
            <Sparkline data={revenueSeries.slice(-6).map(m => m.paid)} color="#206bc4" height={36} />
          </StatCard>
          <StatCard
            label={t('dashboard_overdue_invoices')}
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

        {/* Facturation sur 12 mois + jauge d'encaissement, dans une même carte */}
        <div className="col-span-12 xl:col-span-8">
          <div
            className="rounded-xl overflow-hidden grid grid-cols-1 md:grid-cols-3 h-full"
            style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: ELEVATED_SHADOW }}
          >
            <div className="md:col-span-2 p-4 md:border-r" style={{ borderColor: 'var(--tblr-border)' }}>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-[0.9375rem] font-semibold" style={{ color: 'var(--tblr-text)' }}>{t('dashboard_revenue_12m')}</h2>
                <div className="flex items-center gap-3 text-[0.6875rem]" style={{ color: 'var(--tblr-muted)' }}>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full inline-block" style={{ background: REVENUE_INVOICED_COLOR }} />
                    {t('dashboard_invoiced')}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full inline-block" style={{ background: REVENUE_PAID_COLOR }} />
                    {t('dashboard_paid')}
                  </span>
                </div>
              </div>
              <div className="h-60">
                <ResponsiveContainer width="100%" height="100%">
                  <RechartsBarChart data={revenueSeries} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barGap={3}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--tblr-border)" />
                    <XAxis dataKey="label" tick={{ fill: 'var(--tblr-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: 'var(--tblr-muted)', fontSize: 11 }} axisLine={false} tickLine={false} width={52} tickFormatter={formatEurShort} />
                    <Tooltip content={<TblrTooltip valueFormatter={formatEur} />} cursor={{ fill: 'var(--tblr-surface-2)' }} />
                    <Bar dataKey="invoiced" name={t('dashboard_invoiced')} fill={REVENUE_INVOICED_COLOR} radius={[6, 6, 6, 6]} maxBarSize={10} />
                    <Bar dataKey="paid" name={t('dashboard_paid')} fill={REVENUE_PAID_COLOR} radius={[6, 6, 6, 6]} maxBarSize={10} />
                  </RechartsBarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="p-4 flex flex-col items-center justify-center gap-3 border-t md:border-t-0" style={{ borderColor: 'var(--tblr-border)' }}>
              <span
                className="text-[0.6875rem] font-semibold px-2 py-0.5 rounded"
                style={{ background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)' }}
              >
                {new Date().getFullYear()}
              </span>
              <RadialGauge value={finance.collectionRate} label={t('dashboard_gauge_label')} />
              <p className="text-[0.75rem] font-medium text-center" style={{ color: 'var(--tblr-muted)' }}>
                {t('dashboard_gauge_caption', { rate: finance.collectionRate })}
              </p>
              <div className="grid grid-cols-2 gap-3 w-full">
                {[
                  { label: t('dashboard_invoiced'), value: finance.invoiced, icon: IconWallet, color: '#1c7ed6' },
                  { label: t('dashboard_paid'), value: finance.paid, icon: IconCash, color: '#2fb344' },
                ].map(item => (
                  <div key={item.label} className="flex items-center gap-2 min-w-0">
                    <span className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: item.color + '1f', color: item.color }}>
                      <item.icon size={16} />
                    </span>
                    <div className="min-w-0">
                      <p className="text-[0.6875rem]" style={{ color: 'var(--tblr-muted)' }}>{item.label}</p>
                      <p className="text-[0.8125rem] font-semibold tabular-nums truncate" style={{ color: 'var(--tblr-text)' }}>{formatEurShort(item.value)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="col-span-12 xl:col-span-4 grid grid-cols-2 gap-4 content-start">
          <StatCard
            label={t('dashboard_kpi_active')}
            value={activeProjects}
            icon={IconActivity}
            accent="#206bc4"
            accentBg="#e8f0fb"
            trend={t('dashboard_kpi_active_hint', { total: projects.length })}
            trendUp={true}
            to="/projects"
          />
          <StatCard
            label={t('dashboard_kpi_proposals')}
            value={pendingProposals}
            icon={IconAlertCircle}
            accent="#f76707"
            accentBg="#fff4e6"
            trend={t('dashboard_kpi_proposals_hint')}
            to="/proposals"
          />
          <StatCard
            label={t('dashboard_mini_tenders')}
            value={pendingTenders}
            icon={IconBriefcase}
            accent="#ae3ec9"
            accentBg="#f8d7ff"
            trend={t('dashboard_tenders_hint')}
            to="/tenders"
          />
          <StatCard
            label={t('dashboard_mini_milestones')}
            value={upcomingDeadlines}
            icon={IconClock}
            accent="#d63939"
            accentBg="#ffe3e3"
            trend={upcomingDeadlines > 0 ? t('dashboard_milestones_hint') : t('dashboard_milestones_ok')}
            trendUp={upcomingDeadlines === 0}
          />
          {/* Reste à encaisser, carte large avec courbe du facturé */}
          <div
            className="col-span-2 rounded-xl p-4 flex items-center gap-4 cursor-pointer relative overflow-hidden"
            style={{ background: '#fff9db', border: '1px solid #f59f0033', boxShadow: ELEVATED_SHADOW }}
            onClick={() => navigate('/invoices')}
          >
            <div className="shrink-0">
              <p className="text-[0.6875rem] font-bold uppercase tracking-wider" style={{ color: '#e67700' }}>{t('dashboard_kpi_receivable')}</p>
              <span className="inline-block mt-1 text-[0.6875rem] font-semibold px-1.5 py-0.5 rounded" style={{ background: '#ffec99', color: '#e67700' }}>
                {t('dashboard_unpaid_count', { count: finance.unpaidCount })}
              </span>
              <p className="text-2xl font-bold mt-2 leading-none tabular-nums" style={{ color: '#e67700' }}>{formatEur(finance.receivable)}</p>
            </div>
            <div className="flex-1 min-w-0">
              <Sparkline data={revenueSeries.slice(-8).map(m => m.invoiced)} color="#f59f00" height={60} />
            </div>
            <div className="absolute -bottom-3 -right-3 pointer-events-none" style={{ color: '#f59f00', opacity: 0.12 }}>
              <IconHourglass size={80} strokeWidth={1.2} />
            </div>
          </div>
        </div>

        {/* ── Trois cartes d'analyse ── */}
        <div className="col-span-12 md:col-span-6 xl:col-span-4">
          <SectionCard title={t('dashboard_project_status')}>
            {statusData.length === 0 ? (
              <p className="text-[0.8125rem] text-center py-8" style={{ color: 'var(--tblr-muted)' }}>Aucun projet</p>
            ) : (
              <>
                <div className="h-44 relative">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={statusData} cx="50%" cy="50%" innerRadius={56} outerRadius={76} paddingAngle={3} cornerRadius={6} dataKey="value" stroke="none">
                        {statusData.map(d => <Cell key={d.group} fill={STATUS_GROUP_COLORS[d.group]} />)}
                      </Pie>
                      <Tooltip content={<TblrTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-[1.625rem] font-bold leading-none tabular-nums" style={{ color: 'var(--tblr-text)' }}>{projects.length}</span>
                    <span className="text-[0.6875rem] mt-1" style={{ color: 'var(--tblr-muted)' }}>{t('dashboard_projects_total')}</span>
                  </div>
                </div>
                <ul className="mt-3 space-y-2">
                  {statusData.map(d => (
                    <li key={d.group} className="flex items-center gap-2.5 text-[0.75rem]">
                      <span className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: STATUS_GROUP_COLORS[d.group] + '1f' }}>
                        <span className="w-2 h-2 rounded-full" style={{ background: STATUS_GROUP_COLORS[d.group] }} />
                      </span>
                      <span className="flex-1" style={{ color: 'var(--tblr-text)' }}>{d.name}</span>
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

        <div className="col-span-12 md:col-span-6 xl:col-span-4">
          <SectionCard
            title={t('dashboard_categories')}
            action={<span className="text-[0.6875rem]" style={{ color: 'var(--tblr-muted)' }}>{t('dashboard_categories_hint')}</span>}
          >
            {categoryData.length === 0 ? (
              <p className="text-[0.8125rem] text-center py-8" style={{ color: 'var(--tblr-muted)' }}>{t('dashboard_no_data')}</p>
            ) : (
              <RankedBars rows={categoryData} muted={UNCATEGORIZED} />
            )}
          </SectionCard>
        </div>

        <div className="col-span-12 xl:col-span-4">
          <SectionCard title={t('dashboard_fees_progress')}>
            {feesRows.length === 0 ? (
              <p className="text-[0.8125rem] text-center py-8" style={{ color: 'var(--tblr-muted)' }}>{t('dashboard_no_data')}</p>
            ) : (
              <ul className="space-y-4">
                {feesRows.map((r, i) => {
                  const color = CATEGORY_COLORS[i % CATEGORY_COLORS.length];
                  return (
                    <li key={r.id} className="flex items-center gap-3 cursor-pointer" onClick={() => navigate(`/projects/${r.id}`)}>
                      <span className="w-9 h-9 rounded-lg flex items-center justify-center text-sm font-bold shrink-0" style={{ background: color + '1f', color }}>
                        {r.name.charAt(0).toUpperCase()}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[0.8125rem] font-medium truncate" style={{ color: 'var(--tblr-text)' }} title={r.name}>{r.name}</p>
                        <p className="text-[0.6875rem] truncate" style={{ color: 'var(--tblr-muted)' }}>
                          {r.fees > 0
                            ? t('dashboard_fees_line', { paid: formatEur(r.paid), fees: formatEur(r.fees) })
                            : t('dashboard_fees_unknown')}
                        </p>
                        {r.fees > 0 && (
                          <div className="h-1.5 rounded-full overflow-hidden flex mt-1.5" style={{ background: 'var(--tblr-surface-2)' }}>
                            <div style={{ width: `${Math.min(100, (r.paid / r.fees) * 100)}%`, background: REVENUE_PAID_COLOR }} />
                            <div style={{ width: `${Math.max(0, Math.min(100, (r.invoiced / r.fees) * 100) - Math.min(100, (r.paid / r.fees) * 100))}%`, background: REVENUE_INVOICED_COLOR }} />
                          </div>
                        )}
                      </div>
                      <span className="text-[0.8125rem] font-semibold tabular-nums shrink-0" style={{ color: r.pct !== null ? '#2f9e44' : 'var(--tblr-text)' }}>
                        {r.pct !== null ? `${r.pct} %` : formatEurShort(r.invoiced)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </SectionCard>
        </div>
      </div>

      {/* ── Quick actions (mobile-prominent) ── */}
      <div className="xl:hidden">
        <p className="text-[0.6875rem] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--tblr-muted)' }}>
          Création rapide
        </p>
        <div className="flex gap-2">
          <QuickAction icon={IconPlus}         label="Nouveau projet"  to="/projects"   color="#206bc4" />
          <QuickAction icon={IconFileText}      label="Nouveau devis"   to="/proposals"  color="#f76707" />
          <QuickAction icon={IconFileInvoice}   label="Nouvelle facture" to="/invoices"  color="#2fb344" />
          <QuickAction icon={IconBriefcase}     label="Appel d'offres"  to="/tenders"   color="#ae3ec9" />
        </div>
      </div>

      {/* ── Proactive AI suggestions ── */}
      <SectionCard
        title={
          <span className="flex items-center gap-1.5">
            {t('dashboard_ai_suggestions')}
            <span
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[0.6875rem] font-bold uppercase tracking-wide"
              style={{ background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)' }}
            >
              <IconSparkles size={10} /> IA
            </span>
          </span>
        }
      >
        {suggestions.length === 0 ? (
          <p className="text-[0.8125rem] text-center py-8" style={{ color: 'var(--tblr-muted)' }}>{t('ai_suggestions_empty')}</p>
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
                  <p className="text-[0.8125rem]" style={{ color: 'var(--tblr-text)' }}>{s.text}</p>
                  <button
                    onClick={() => openChat(undefined, s.draft)}
                    className="mt-1.5 flex items-center gap-1 text-[0.6875rem] font-semibold hover:underline"
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
            className="flex items-center gap-1 text-[0.75rem] font-medium transition-colors"
            style={{ color: 'var(--tblr-primary)' }}
          >
            {t('view_all')} <IconChevronRight size={14} />
          </Link>
        }
      >
        {projects.length === 0 ? (
          <p className="text-[0.8125rem] text-center py-8" style={{ color: 'var(--tblr-muted)' }}>Aucun projet</p>
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
                  <p className="text-[0.8125rem] font-semibold truncate" style={{ color: 'var(--tblr-text)' }}>
                    {project.name}
                  </p>
                  {project.client && (
                    <p className="text-[0.6875rem] truncate" style={{ color: 'var(--tblr-muted)' }}>
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
