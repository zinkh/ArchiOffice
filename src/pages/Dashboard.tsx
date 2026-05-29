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
} from '@tabler/icons-react';
import { cn } from '../lib/utils';
import type { Project, Milestone } from '../types';
import { useTranslation } from 'react-i18next';
import ActivityFeed from '../components/ActivityFeed';
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

/* ── Tabler color palette for charts ── */
const PIE_COLORS  = ['#2fb344', '#206bc4', '#f76707', '#6c7a91'];
const BAR_COLOR   = '#206bc4';

/* ── Status badge helper ── */
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

/* ── Tabler-style stat card ── */
interface StatCardProps {
  label: string;
  value: number;
  icon: React.ElementType;
  iconColor: string;
  iconBg: string;
  trend: string;
  trendUp?: boolean;
}
function StatCard({ label, value, icon: Icon, iconColor, iconBg, trend, trendUp }: StatCardProps) {
  return (
    <div
      className="rounded p-5 flex flex-col gap-3"
      style={{
        background: 'var(--tblr-surface)',
        border: '1px solid var(--tblr-border)',
        boxShadow: 'var(--tblr-shadow)',
      }}
    >
      <div className="flex items-center justify-between">
        <span
          className="subheader"
          style={{ color: 'var(--tblr-muted)', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}
        >
          {label}
        </span>
        <span
          className="w-9 h-9 rounded flex items-center justify-center"
          style={{ background: iconBg, color: iconColor }}
        >
          <Icon size={18} />
        </span>
      </div>

      <div>
        <p
          className="text-3xl font-bold leading-none"
          style={{ color: 'var(--tblr-text)' }}
        >
          {value}
        </p>
      </div>

      <div className="flex items-center gap-1 text-[12px] font-medium" style={{ color: 'var(--tblr-muted)' }}>
        {trendUp !== undefined && (
          trendUp
            ? <IconTrendingUp size={14} style={{ color: 'var(--tblr-success)' }} />
            : <IconTrendingDown size={14} style={{ color: 'var(--tblr-danger)' }} />
        )}
        <span style={{ color: trendUp ? 'var(--tblr-success)' : trendUp === false ? 'var(--tblr-danger)' : 'var(--tblr-muted)' }}>
          {trend}
        </span>
      </div>
    </div>
  );
}

/* ── Tabler tooltip ── */
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

/* ── Section card wrapper ── */
function SectionCard({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div
      className="rounded overflow-hidden"
      style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}
    >
      <div
        className="flex items-center justify-between px-5 py-3 border-b"
        style={{ borderColor: 'var(--tblr-border)' }}
      >
        <h2 className="text-[13px] font-semibold" style={{ color: 'var(--tblr-text)' }}>{title}</h2>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

/* ────────────────────────────────────────────────── */

export default function Dashboard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [projects,   setProjects]   = useState<Project[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [tenders,    setTenders]    = useState<any[]>([]);

  useEffect(() => {
    fetch('/api/projects').then(r => r.ok ? r.json() : []).then(setProjects).catch(() => {});
    fetch('/api/milestones').then(r => r.ok ? r.json() : []).then(setMilestones).catch(() => {});
    fetch('/api/tenders').then(r => r.ok ? r.json() : []).then(setTenders).catch(() => {});
  }, []);

  const pendingTenders = tenders.filter(t => !t.status || t.status === 'pending' || t.status === 'Pending').length;

  const stats: StatCardProps[] = [
    {
      label:     t('active_projects'),
      value:     projects.filter(p => p.status === 'In Progress').length,
      icon:      IconActivity,
      iconColor: '#206bc4',
      iconBg:    '#e8f0fb',
      trend:     'Projets actifs',
      trendUp:   true,
    },
    {
      label:     t('pending_tenders'),
      value:     pendingTenders,
      icon:      IconAlertCircle,
      iconColor: '#f76707',
      iconBg:    '#fff4e6',
      trend:     pendingTenders > 0 ? 'En attente de réponse' : 'Aucun en attente',
      trendUp:   undefined,
    },
    {
      label:     t('completed_month'),
      value:     projects.filter(p => p.status === 'Completed').length,
      icon:      IconCircleCheck,
      iconColor: '#2fb344',
      iconBg:    '#d3f9d8',
      trend:     'Projets livrés',
      trendUp:   true,
    },
    {
      label:     t('upcoming_deadlines'),
      value:     milestones.filter(m => !m.completed).length,
      icon:      IconClock,
      iconColor: '#d63939',
      iconBg:    '#ffe3e3',
      trend:     milestones.filter(m => !m.completed).length > 0 ? 'Jalons à traiter' : 'Tout à jour',
      trendUp:   milestones.filter(m => !m.completed).length === 0,
    },
  ];

  const statusData = [
    { name: 'Terminés',     value: projects.filter(p => p.status === 'Completed').length },
    { name: 'En cours',     value: projects.filter(p => p.status === 'In Progress').length },
    { name: 'Planification',value: projects.filter(p => p.status === 'Planning').length },
    { name: 'En attente',   value: projects.filter(p => p.status === 'On Hold').length },
  ].filter(d => d.value > 0);

  const categoryData = React.useMemo(() => {
    const counts: Record<string, number> = {};
    projects.forEach(p => { const c = p.client || 'Autre'; counts[c] = (counts[c] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 6);
  }, [projects]);

  return (
    <div className="space-y-6">

      {/* Page header — Tabler style */}
      <div className="flex items-center justify-between pb-4" style={{ borderBottom: '1px solid var(--tblr-border)' }}>
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--tblr-text)' }}>
            {t('dashboard')}
          </h1>
          <p className="text-[12px] mt-0.5" style={{ color: 'var(--tblr-muted)' }}>
            {new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {stats.map(s => <StatCard key={s.label} {...s} />)}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
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
          {/* Legend */}
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
                className="flex items-center gap-4 py-3 cursor-pointer transition-colors"
                style={{ borderColor: 'var(--tblr-border)' }}
                onClick={() => navigate(`/projects/${project.id}`)}
                onMouseOver={e => (e.currentTarget.style.background = 'var(--tblr-surface-2)')}
                onMouseOut={e => (e.currentTarget.style.background = '')}
              >
                {/* Avatar */}
                <div
                  className="w-9 h-9 rounded flex items-center justify-center text-sm font-bold shrink-0"
                  style={{ background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)' }}
                >
                  {project.name.charAt(0).toUpperCase()}
                </div>

                {/* Info */}
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

                {/* Status */}
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
