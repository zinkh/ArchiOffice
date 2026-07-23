import * as React from 'react';
import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  IconActivity,
  IconAlertCircle,
  IconCircleCheck,
  IconClock,
  IconChevronRight,
  IconTrendingUp,
  IconTrendingDown,
  IconPlus,
  IconFileInvoice,
  IconBriefcase,
  IconFileText,
  IconCurrencyEuro,
  IconReceiptOff,
} from '@tabler/icons-react';
import { cn } from '../lib/utils';
import { fetchJson } from '../lib/api';
import type { Project, Milestone } from '../types';
import { useTranslation } from 'react-i18next';
import ActivityFeed from '../components/ActivityFeed';
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

const PIE_COLORS = ['#2fb344', '#206bc4', '#f76707', '#6c7a91'];
const BAR_COLOR  = '#206bc4';
const BUDGET_ESTIMATED_COLOR = '#6c7a91';
const BUDGET_ACTUAL_COLOR = '#2fb344';

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    'In Progress': { bg: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)' },
    'Completed':   { bg: '#d3f9d8',                color: '#2f9e44' },
    'Planning':    { bg: '#fff3bf',                color: '#e67700' },
    'On Hold':     { bg: '#ffe3e3',                color: '#c92a2a' },
  };
  const s = map[status] ?? { bg: 'var(--tblr-surface-2)', color: 'var(--tblr-muted)' };
  return (
    <span
      className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded"
      style={{ background: s.bg, color: s.color }}
    >
      {status}
    </span>
  );
}

/* ── Colored stat card (mobile-first) ── */
interface StatCardProps {
  label: string;
  value: string | number;
  icon: React.ElementType;
  accent: string;       // hex color
  accentBg: string;     // light tint
  cardBg?: string;      // optional card background tint
  trend?: string;
  trendUp?: boolean;
  to?: string;
}
function StatCard({ label, value, icon: Icon, accent, accentBg, cardBg, trend, trendUp, to }: StatCardProps) {
  const navigate = useNavigate();
  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-2 cursor-pointer transition-all active:scale-[0.98] relative overflow-hidden"
      style={{
        background: cardBg ?? 'var(--tblr-surface)',
        border: `1px solid ${cardBg ? accent + '33' : 'var(--tblr-border)'}`,
        boxShadow: 'var(--tblr-shadow)',
      }}
      onClick={() => to && navigate(to)}
    >
      {/* Watermark icon */}
      <div
        className="absolute -bottom-3 -right-3 pointer-events-none"
        style={{ color: accent, opacity: 0.12 }}
      >
        <Icon size={80} strokeWidth={1.2} />
      </div>

      <div className="flex items-center justify-between">
        <span
          className="text-[10px] font-bold uppercase tracking-wider"
          style={{ color: cardBg ? accent : 'var(--tblr-muted)' }}
        >
          {label}
        </span>
        <span
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: accentBg, color: accent }}
        >
          <Icon size={16} />
        </span>
      </div>

      <p
        className="text-2xl font-bold leading-none"
        style={{ color: cardBg ? accent : 'var(--tblr-text)' }}
      >
        {value}
      </p>

      {trend && (
        <div className="flex items-center gap-1 text-[11px] font-medium">
          {trendUp !== undefined && (
            trendUp
              ? <IconTrendingUp size={12} style={{ color: '#2fb344' }} />
              : <IconTrendingDown size={12} style={{ color: '#d63939' }} />
          )}
          <span style={{ color: cardBg ? accent + 'cc' : 'var(--tblr-muted)' }}>{trend}</span>
        </div>
      )}
    </div>
  );
}

function TblrTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="px-3 py-2 text-[13px] rounded"
      style={{
        background: 'var(--tblr-surface)',
        border: '1px solid var(--tblr-border)',
        boxShadow: 'var(--tblr-shadow)',
        color: 'var(--tblr-text)',
      }}
    >
      {label && <p className="font-semibold mb-1" style={{ color: 'var(--tblr-muted)', fontSize: '11px', textTransform: 'uppercase' }}>{label}</p>}
      {payload.map((p: any, i: number) => (
        <p key={i}><span style={{ color: p.color }}>{p.name}: </span>{p.value}</p>
      ))}
    </div>
  );
}

function SectionCard({ title, action, children }: { title: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}
    >
      <div
        className="flex items-center justify-between px-4 py-3 border-b"
        style={{ borderColor: 'var(--tblr-border)' }}
      >
        <h2 className="text-[13px] font-semibold" style={{ color: 'var(--tblr-text)' }}>{title}</h2>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

/* ── Quick action button ── */
function QuickAction({ icon: Icon, label, to, color }: { icon: React.ElementType; label: string; to: string; color: string }) {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => navigate(to)}
      className="flex flex-col items-center gap-2 p-3 rounded-xl transition-all active:scale-95 flex-1"
      style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}
    >
      <span
        className="w-11 h-11 rounded-xl flex items-center justify-center"
        style={{ background: color + '18', color }}
      >
        <Icon size={22} />
      </span>
      <span className="text-[11px] font-semibold text-center leading-tight" style={{ color: 'var(--tblr-muted)' }}>
        {label}
      </span>
    </button>
  );
}

export default function Dashboard() {
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
  const overdueInvoices  = invoices.filter(inv => inv.status === 'overdue' || inv.status === 'Overdue').length;
  const totalRevenue     = invoices
    .filter(inv => inv.status === 'paid' || inv.status === 'Paid')
    .reduce((s, inv) => s + (inv.total_amount || inv.amount || 0), 0);
  const pendingProposals = proposals.filter(p => p.status === 'Pending' || p.status === 'Draft').length;

  const formatEur = (n: number) =>
    new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);

  const upcomingDeadlines = milestones.filter(m => !m.completed).length;

  const statusData = [
    { name: 'Terminés',      value: projects.filter(p => p.status === 'Completed').length },
    { name: 'En cours',      value: projects.filter(p => p.status === 'In Progress').length },
    { name: 'Planification', value: projects.filter(p => p.status === 'Planning').length },
    { name: 'En attente',    value: projects.filter(p => p.status === 'On Hold').length },
  ].filter(d => d.value > 0);

  const categoryData = React.useMemo(() => {
    const counts: Record<string, number> = {};
    projects.forEach(p => { const c = p.client || 'Autre'; counts[c] = (counts[c] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 6);
  }, [projects]);

  // ── Budget tracking: estimated (devis budget) vs actual (paid invoices) per project ──
  const budgetByProject = React.useMemo(() => {
    const actualByProjectId: Record<string, number> = {};
    invoices
      .filter(inv => inv.status === 'paid' || inv.status === 'Paid')
      .forEach(inv => {
        const key = inv.project_id;
        if (!key) return;
        actualByProjectId[key] = (actualByProjectId[key] || 0) + (inv.total_amount || inv.amount || 0);
      });
    return projects
      .filter(p => p.budget > 0)
      .map(p => ({
        name: p.name.length > 16 ? `${p.name.slice(0, 15)}…` : p.name,
        fullName: p.name,
        estimated: p.budget,
        actual: actualByProjectId[p.id] || 0,
      }))
      .sort((a, b) => b.estimated - a.estimated)
      .slice(0, 6);
  }, [projects, invoices]);

  const totalEstimatedBudget = React.useMemo(() => projects.reduce((s, p) => s + (p.budget || 0), 0), [projects]);
  const totalActualBudget = React.useMemo(
    () => invoices.filter(inv => inv.status === 'paid' || inv.status === 'Paid').reduce((s, inv) => s + (inv.total_amount || inv.amount || 0), 0),
    [invoices]
  );

  // ── Proactive AI suggestions — simple rule-based read of the data already
  // on this page (no extra network round-trip). Each suggestion opens the
  // agent chat with a prefilled draft the user reviews before sending, so
  // the AI never acts without the user's go-ahead. ──
  type Suggestion = { id: string; tone: 'danger' | 'warning'; text: string; draft: string };
  const suggestions = React.useMemo<Suggestion[]>(() => {
    const list: Suggestion[] = [];
    const now = new Date();

    const overdueMilestonesByProject = new Map<string, Milestone[]>();
    milestones
      .filter(m => !m.completed && m.project_id && new Date(m.due_date) < now)
      .forEach(m => {
        const arr = overdueMilestonesByProject.get(m.project_id!) || [];
        arr.push(m);
        overdueMilestonesByProject.set(m.project_id!, arr);
      });
    for (const [projectId, ms] of overdueMilestonesByProject) {
      const project = projects.find(p => p.id === projectId);
      if (!project) continue;
      list.push({
        id: `overdue-milestone-${projectId}`,
        tone: 'danger',
        text: t('ai_suggestion_overdue_milestone', { count: ms.length, project: project.name }),
        draft: t('ai_draft_overdue_milestone', {
          project: project.name,
          client: project.client,
          titles: ms.map(m => m.title).join(', '),
        }),
      });
    }

    projects
      .filter(p => p.status === 'In Progress' && p.end_date)
      .forEach(p => {
        const daysLeft = Math.ceil((new Date(p.end_date).getTime() - now.getTime()) / 86400000);
        if (daysLeft >= 0 && daysLeft <= 14 && (p.progression || 0) < 80) {
          list.push({
            id: `behind-schedule-${p.id}`,
            tone: 'warning',
            text: t('ai_suggestion_project_behind', { project: p.name, progress: p.progression || 0, days: daysLeft }),
            draft: t('ai_draft_project_behind', { project: p.name, client: p.client, progress: p.progression || 0, days: daysLeft }),
          });
        }
      });

    invoices
      .filter(inv => inv.status === 'overdue' || inv.status === 'Overdue')
      .slice(0, 3)
      .forEach(inv => {
        list.push({
          id: `overdue-invoice-${inv.id}`,
          tone: 'danger',
          text: t('ai_suggestion_invoice_overdue', { number: inv.invoice_number, client: inv.project_name || inv.client || '' }),
          draft: t('ai_draft_invoice_overdue', { number: inv.invoice_number, client: inv.project_name || inv.client || '', amount: formatEur(inv.total_amount || inv.amount || 0) }),
        });
      });

    return list.slice(0, 5);
  }, [milestones, projects, invoices, t]);

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

      {/* ── Financial summary cards (2 cols on mobile) ── */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <StatCard
          label="CA encaissé"
          value={formatEur(totalRevenue)}
          icon={IconCurrencyEuro}
          accent="#206bc4"
          accentBg="#e8f0fb"
          cardBg="#eef3fb"
          trend="Factures payées"
          trendUp={true}
          to="/invoices"
        />
        <StatCard
          label="Factures en retard"
          value={overdueInvoices}
          icon={IconReceiptOff}
          accent="#d63939"
          accentBg="#ffe3e3"
          cardBg="#fef2f2"
          trend={overdueInvoices > 0 ? 'À régulariser' : 'Aucun retard'}
          trendUp={overdueInvoices === 0}
          to="/invoices"
        />
        <StatCard
          label={t('active_projects')}
          value={projects.filter(p => p.status === 'In Progress').length}
          icon={IconActivity}
          accent="#206bc4"
          accentBg="#e8f0fb"
          trend="Projets actifs"
          trendUp={true}
          to="/projects"
        />
        <StatCard
          label="Devis en attente"
          value={pendingProposals}
          icon={IconAlertCircle}
          accent="#f76707"
          accentBg="#fff4e6"
          trend={pendingProposals > 0 ? 'En cours de réponse' : 'Aucun en attente'}
          trendUp={pendingProposals === 0}
          to="/proposals"
        />
      </div>

      {/* 2nd row of stats */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <StatCard
          label={t('pending_tenders')}
          value={pendingTenders}
          icon={IconBriefcase}
          accent="#ae3ec9"
          accentBg="#f8d7ff"
          trend={pendingTenders > 0 ? "Appels d'offres" : 'Aucun en attente'}
          to="/tenders"
        />
        <StatCard
          label={t('completed_month')}
          value={projects.filter(p => p.status === 'Completed').length}
          icon={IconCircleCheck}
          accent="#2fb344"
          accentBg="#d3f9d8"
          trend="Projets livrés"
          trendUp={true}
          to="/projects"
        />
        <StatCard
          label={t('upcoming_deadlines')}
          value={upcomingDeadlines}
          icon={IconClock}
          accent="#d63939"
          accentBg="#ffe3e3"
          trend={upcomingDeadlines > 0 ? 'Jalons à traiter' : 'Tout à jour'}
          trendUp={upcomingDeadlines === 0}
        />
        <StatCard
          label="Total projets"
          value={projects.length}
          icon={IconFileText}
          accent="#6c7a91"
          accentBg="#f1f3f6"
          trend="Tous statuts"
          to="/projects"
        />
      </div>

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

      {/* ── Charts (desktop only) ── */}
      <div className="hidden lg:grid grid-cols-2 gap-4">
        <SectionCard title={t('dashboard_project_status')}>
          {statusData.length === 0 ? (
            <p className="text-[13px] text-center py-8" style={{ color: 'var(--tblr-muted)' }}>Aucun projet</p>
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={statusData} cx="50%" cy="50%" innerRadius={55} outerRadius={80} paddingAngle={3} dataKey="value">
                    {statusData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip content={<TblrTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
            {statusData.map((d, i) => (
              <div key={d.name} className="flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--tblr-muted)' }}>
                <span className="w-2 h-2 rounded-full inline-block" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                {d.name} <strong style={{ color: 'var(--tblr-text)' }}>{d.value}</strong>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title={t('dashboard_top_categories')}>
          {categoryData.length === 0 ? (
            <p className="text-[13px] text-center py-8" style={{ color: 'var(--tblr-muted)' }}>Aucune donnée</p>
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <RechartsBarChart data={categoryData} layout="vertical" margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--tblr-border)" />
                  <XAxis type="number" hide />
                  <YAxis
                    dataKey="name"
                    type="category"
                    width={90}
                    tick={{ fill: 'var(--tblr-muted)', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip content={<TblrTooltip />} cursor={{ fill: 'var(--tblr-surface-2)' }} />
                  <Bar dataKey="value" fill={BAR_COLOR} radius={[0, 2, 2, 0]} barSize={14} />
                </RechartsBarChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>
      </div>

      {/* ── Budget tracking: estimated vs actual (paid) per project ── */}
      <SectionCard
        title={t('dashboard_budget_tracking')}
        action={
          <div className="flex items-center gap-3 text-[11px]" style={{ color: 'var(--tblr-muted)' }}>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full inline-block" style={{ background: BUDGET_ESTIMATED_COLOR }} />
              {t('budget_estimated')}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full inline-block" style={{ background: BUDGET_ACTUAL_COLOR }} />
              {t('budget_actual')}
            </span>
          </div>
        }
      >
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="p-3 rounded-lg" style={{ background: 'var(--tblr-surface-2)' }}>
            <p className="text-[11px]" style={{ color: 'var(--tblr-muted)' }}>{t('budget_estimated')}</p>
            <p className="text-lg font-bold" style={{ color: 'var(--tblr-text)' }}>{formatEur(totalEstimatedBudget)}</p>
          </div>
          <div className="p-3 rounded-lg" style={{ background: 'var(--tblr-surface-2)' }}>
            <p className="text-[11px]" style={{ color: 'var(--tblr-muted)' }}>{t('budget_actual')}</p>
            <p className="text-lg font-bold" style={{ color: totalActualBudget > totalEstimatedBudget ? '#d63939' : 'var(--tblr-text)' }}>
              {formatEur(totalActualBudget)}
            </p>
          </div>
        </div>
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
