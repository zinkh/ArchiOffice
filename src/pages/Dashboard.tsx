import * as React from 'react';
import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { 
  IconTrendingUp, 
  IconClock, 
  IconCircleCheck, 
  IconAlertCircle,
  IconActivity,
} from '@tabler/icons-react';
import { motion } from 'motion/react';
import { cn } from '../lib/utils';
import type { Project, Milestone } from '../types';
import { useTranslation } from 'react-i18next';
import { Card, Title, Text, DonutChart, BarChart, Legend } from '@tremor/react';

export default function Dashboard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);

  useEffect(() => {
    fetch('/api/projects')
      .then(res => {
        if (!res.ok) throw new Error('Failed to fetch projects');
        return res.json();
      })
      .then(setProjects)
      .catch(err => console.error(err));

    fetch('/api/milestones')
      .then(res => {
        if (!res.ok) throw new Error('Failed to fetch milestones');
        return res.json();
      })
      .then(setMilestones)
      .catch(err => console.error(err));
  }, []);

  const stats = [
    { label: 'active_projects', value: projects.filter(p => p.status === 'In Progress').length, icon: IconActivity, trend: '+2', color: 'text-blue-500' },
    { label: 'pending_tenders', value: 3, icon: IconAlertCircle, trend: 'STABLE', color: 'text-yellow-500' },
    { label: 'completed_month', value: projects.filter(p => p.status === 'Completed').length, icon: IconCircleCheck, trend: '+1', color: 'text-green-500' },
    { label: 'upcoming_deadlines', value: milestones.filter(m => !m.completed).length, icon: IconClock, trend: 'URGENT', color: 'text-red-500' },
  ];

  const statusData = [
    { name: 'Completed', value: projects.filter(p => p.status === 'Completed').length },
    { name: 'In Progress', value: projects.filter(p => p.status === 'In Progress').length },
    { name: 'Planning', value: projects.filter(p => p.status === 'Planning').length },
    { name: 'On Hold', value: projects.filter(p => p.status === 'On Hold').length },
  ].filter(d => d.value > 0);

  const categoryData = React.useMemo(() => {
    const counts: Record<string, number> = {};
    projects.forEach(p => {
      const cat = p.client || 'Other';
      counts[cat] = (counts[cat] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 5);
  }, [projects]);

  return (
    <div className="p-4 grid grid-cols-1 md:grid-cols-4 gap-6">
      <div className="md:col-span-4 p-4">
        <h1 className="text-zinc-900 dark:text-zinc-100 text-4xl font-bold leading-none tracking-tight">{t('dashboard')}</h1>
        <p className="text-zinc-500 dark:text-zinc-400 text-sm mt-2 font-medium">
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
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

      <Card className="md:col-span-2">
        <Title>Project Status</Title>
        <DonutChart
          className="mt-6 h-60"
          data={statusData}
          category="value"
          index="name"
          colors={['green', 'blue', 'yellow', 'slate']}
        />
        <Legend
          className="mt-6"
          categories={statusData.map(d => d.name)}
          colors={['green', 'blue', 'yellow', 'slate']}
        />
      </Card>

      <Card className="md:col-span-2">
        <Title>Top Categories</Title>
        <BarChart
          className="mt-6 h-60"
          data={categoryData}
          index="name"
          categories={['value']}
          colors={['violet']}
          layout="vertical"
          yAxisWidth={100}
        />
      </Card>

      <div className="md:col-span-4 card">
        <div className="flex justify-between items-end mb-6">
          <h2 className="text-zinc-900 dark:text-zinc-100 text-2xl font-bold leading-none tracking-tight">{t('recent_projects')}</h2>
          <Link to="/projects" className="text-blue-600 text-sm font-medium hover:underline">{t('view_all')}</Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {projects?.slice(0, 4).map((project) => (
            <div 
              key={project.id} 
              className="flex items-center gap-4 p-4 border border-zinc-200 dark:border-zinc-800 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors cursor-pointer"
              onClick={() => navigate(`/projects/${project.id}`)}
            >
              <div className="size-12 shrink-0 bg-blue-50 dark:bg-blue-900/20 rounded-lg flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold">
                {project.name.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-zinc-900 dark:text-zinc-100 font-bold truncate">{project.name}</h3>
                <div className="flex items-center gap-2">
                  <span className={cn(
                    "text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider",
                    project.status === 'Completed' ? "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400" :
                    project.status === 'In Progress' ? "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400" :
                    "bg-zinc-100 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-400"
                  )}>
                    {project.status}
                  </span>
                  <p className="text-zinc-500 dark:text-zinc-400 text-[10px] font-medium truncate uppercase tracking-wider">{project.client}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
