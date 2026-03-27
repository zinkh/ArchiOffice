import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { 
  IconTrendingUp, 
  IconClock, 
  IconCircleCheck, 
  IconAlertCircle,
  IconArrowUpRight,
  IconCalendar,
  IconActivity
} from '@tabler/icons-react';
import { motion } from 'motion/react';
import { formatCurrency, cn } from '../lib/utils';
import { fetchJson } from '../lib/api';
import type { Project, Milestone } from '../types';
import { useTranslation } from 'react-i18next';
import ActivityFeed from '../components/ActivityFeed';

export default function Dashboard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [projectsData, milestonesData] = await Promise.all([
          fetchJson<Project[]>('/api/projects'),
          fetchJson<Milestone[]>('/api/milestones')
        ]);
        setProjects(projectsData);
        setMilestones(milestonesData);
      } catch (err) {
        console.error('Dashboard data fetch failed:', err);
      }
    };
    loadData();
  }, []);

  const stats = [
    { label: 'active_projects', value: projects.filter(p => p.status === 'In Progress').length, icon: IconActivity, trend: '+2', color: 'text-blue-500' },
    { label: 'pending_tenders', value: 3, icon: IconAlertCircle, trend: 'STABLE', color: 'text-yellow-500' },
    { label: 'completed_month', value: projects.filter(p => p.status === 'Completed').length, icon: IconCircleCheck, trend: '+1', color: 'text-green-500' },
    { label: 'upcoming_deadlines', value: milestones.filter(m => !m.completed).length, icon: IconClock, trend: 'URGENT', color: 'text-red-500' },
  ];

  return (
    <div className="p-4 grid grid-cols-1 md:grid-cols-4 gap-6">
      <div className="md:col-span-4 p-4">
        <h1 className="text-zinc-900 dark:text-zinc-100 text-4xl font-bold leading-none tracking-tight">{t('dashboard')}</h1>
        <p className="text-zinc-500 dark:text-zinc-400 text-sm mt-2 font-medium">Monday, October 24th</p>
      </div>

      {stats.map((stat, i) => (
        <motion.div
          key={stat.label}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.1 }}
          className="card flex flex-col gap-2"
        >
          <p className="text-zinc-500 dark:text-zinc-400 text-xs font-semibold uppercase tracking-wider">{t(stat.label)}</p>
          <p className="text-zinc-900 dark:text-zinc-100 text-4xl font-bold leading-none tracking-tight">{stat.value}</p>
          <div className="flex items-center gap-1 text-zinc-900 dark:text-zinc-100 text-sm font-medium">
            <IconTrendingUp size={16} />
            <span>{stat.trend}</span>
          </div>
        </motion.div>
      ))}

      <div className="md:col-span-2 card">
        <div className="flex justify-between items-end mb-6">
          <h2 className="text-zinc-900 dark:text-zinc-100 text-2xl font-bold leading-none tracking-tight">{t('recent_projects')}</h2>
          <Link to="/projects" className="text-blue-600 text-sm font-medium hover:underline">{t('view_all')}</Link>
        </div>

        <div className="flex flex-col gap-4">
          {projects?.slice(0, 2).map((project) => (
            <div key={project.id} className="flex items-center gap-4 p-4 border border-zinc-200 dark:border-zinc-800 rounded-lg">
              <div className="size-16 shrink-0 bg-zinc-200 dark:bg-zinc-800 rounded-lg" />
              <div className="flex-1 min-w-0">
                <h3 className="text-zinc-900 dark:text-zinc-100 font-bold truncate">{project.name}</h3>
                <p className="text-zinc-500 dark:text-zinc-400 text-xs font-medium truncate">{project.status}</p>
                <div className="w-full bg-zinc-200 dark:bg-zinc-800 h-2 mt-2 rounded-full overflow-hidden">
                  <div className="bg-blue-600 h-2 rounded-full" style={{ width: '65%' }}></div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      
      <div className="md:col-span-2">
        <ActivityFeed />
      </div>
    </div>
  );
}
