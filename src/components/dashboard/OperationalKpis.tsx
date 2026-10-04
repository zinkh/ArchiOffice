import * as React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  IconActivity,
  IconRubberStamp,
  IconClock,
  IconCalendarStats,
  IconMessageDots,
  IconClipboardCheck,
  IconShieldCheck,
  IconChecklist,
} from '@tabler/icons-react';
import { fetchJson } from '../../lib/api';
import { computeOpsKpis, type OpsInput, type OpsKpis, type ProjectScope } from '../../lib/dashboardOps';
import { ErrorState, StatCardSkeletonGrid } from '../DataState';
import { StatCard } from './DashboardWidgets';

type OmittableKpi = 'projects' | 'deadlines';

interface OperationalKpisProps {
  /** `null` : toute l'agence (administrateur). Un ensemble : les affaires de l'équipe (manager). */
  scopeProjectIds: ProjectScope;
  projects: OpsInput['projects'];
  /** Cartes déjà présentes ailleurs sur la page, à ne pas répéter. */
  omit?: OmittableKpi[];
  /** Rend les chiffres calculés à la page (ex. pour son panneau d'accueil). */
  onKpis?: (kpis: OpsKpis) => void;
}

const EMPTY_DATA: Omit<OpsInput, 'projects'> = {
  permits: [], rfis: [], meetings: [], milestones: [], reserves: [], gpaReserves: [], tasks: [],
};

const asList = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

function GroupTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[0.6875rem] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--tblr-muted)' }}>
      {children}
    </p>
  );
}

/**
 * Indicateurs de suivi des affaires et du chantier : permis, échéances,
 * réunions, RFI, réserves OPR et GPA, tâches. Les mêmes pour l'administrateur
 * (toute l'agence) et le manager (son équipe), seul le périmètre diffère.
 */
export default function OperationalKpis({ scopeProjectIds, projects, omit = [], onKpis }: OperationalKpisProps) {
  const { t } = useTranslation();
  const [data, setData] = useState(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [permits, rfis, meetings, milestones, reserves, gpaReserves, tasks] = await Promise.all([
        fetchJson('/api/permits'),
        fetchJson('/api/rfis'),
        fetchJson('/api/meetings'),
        fetchJson('/api/milestones'),
        fetchJson('/api/reserves'),
        fetchJson('/api/gpa-reserves'),
        fetchJson('/api/tasks'),
      ]);
      setData({
        permits: asList(permits),
        rfis: asList(rfis),
        meetings: asList(meetings),
        milestones: asList(milestones),
        reserves: asList(reserves),
        gpaReserves: asList(gpaReserves),
        tasks: asList(tasks),
      });
    } catch (err) {
      console.error('Failed to load operational KPIs:', err);
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const kpis = useMemo(
    () => computeOpsKpis({ projects, ...data }, scopeProjectIds),
    [projects, data, scopeProjectIds],
  );

  useEffect(() => {
    if (!loading && !loadError) onKpis?.(kpis);
  }, [kpis, loading, loadError, onKpis]);

  if (loading) return <StatCardSkeletonGrid count={6} />;
  if (loadError) return <ErrorState compact message={loadError} onRetry={load} />;

  const lateTrend = (late: number) => ({
    trend: late > 0 ? t('kpi_late_count', { count: late }) : t('kpi_no_late'),
    trendUp: late === 0,
  });
  const show = (kpi: OmittableKpi) => !omit.includes(kpi);

  return (
    <div className="space-y-4">
      <div>
        <GroupTitle>{t('kpi_group_admin')}</GroupTitle>
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          {show('projects') && (
            <StatCard
              label={t('dashboard_kpi_active')}
              value={kpis.activeProjects}
              icon={IconActivity}
              accent="#206bc4"
              accentBg="#e8f0fb"
              trend={t('dashboard_kpi_active_hint', { total: kpis.totalProjects })}
              to="/projects"
            />
          )}
          <StatCard
            label={t('kpi_active_permits')}
            value={kpis.activePermits}
            icon={IconRubberStamp}
            accent="#206bc4"
            accentBg="#e8f0fb"
            trend={kpis.permitsInInstruction > 0 ? t('kpi_permits_instruction', { count: kpis.permitsInInstruction }) : undefined}
            to="/projects"
          />
          {show('deadlines') && (
            <StatCard
              label={t('kpi_upcoming_deadlines')}
              value={kpis.upcomingDeadlines}
              icon={IconClock}
              accent="#d63939"
              accentBg="#ffe3e3"
              to="/gantt"
              {...lateTrend(kpis.lateDeadlines)}
            />
          )}
          <StatCard
            label={t('kpi_tasks_open')}
            value={kpis.tasksOpen}
            icon={IconChecklist}
            accent="#0ca678"
            accentBg="#d3f9e8"
            to="/kanban"
            {...lateTrend(kpis.tasksLate)}
          />
        </div>
      </div>

      <div>
        <GroupTitle>{t('kpi_group_site')}</GroupTitle>
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          <StatCard
            label={t('kpi_meetings_week')}
            value={kpis.meetingsThisWeek}
            icon={IconCalendarStats}
            accent="#ae3ec9"
            accentBg="#f8d7ff"
            to="/reunions"
          />
          <StatCard
            label={t('kpi_rfis_pending')}
            value={kpis.rfisPending}
            icon={IconMessageDots}
            accent="#f76707"
            accentBg="#fff4e6"
            {...lateTrend(kpis.rfisLate)}
          />
          <StatCard
            label={t('kpi_opr_tracking')}
            value={kpis.oprOpen}
            icon={IconClipboardCheck}
            accent="#2fb344"
            accentBg="#d3f9d8"
            {...lateTrend(kpis.oprLate)}
          />
          <StatCard
            label={t('kpi_gpa_tracking')}
            value={kpis.gpaOpen}
            icon={IconShieldCheck}
            accent="#f59f00"
            accentBg="#fff9db"
            {...lateTrend(kpis.gpaLate)}
          />
        </div>
      </div>
    </div>
  );
}
