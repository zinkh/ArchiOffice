import { useMemo } from 'react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isWithinInterval } from 'date-fns';
import { cn } from '../lib/utils';
import type { Milestone } from '../types';
import { useTranslation } from 'react-i18next';

interface MilestoneGanttProps {
  milestones: Milestone[];
  startDate: Date;
  endDate: Date;
}

export default function MilestoneGantt({ milestones, startDate, endDate }: MilestoneGanttProps) {
  const { t } = useTranslation();
  
  const days = useMemo(() => {
    return eachDayOfInterval({ start: startDate, end: endDate });
  }, [startDate, endDate]);

  return (
    <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden shadow-sm p-4">
      <h3 className="text-sm font-bold text-zinc-900 dark:text-white mb-4">{t('milestones')}</h3>
      <div className="overflow-x-auto">
        <div className="min-w-[600px] relative">
          <div className="flex border-b border-zinc-200 dark:border-zinc-700 pb-2">
            {days.map(day => (
              <div key={day.toISOString()} className="flex-1 min-w-[30px] text-center text-[10px] text-zinc-500 dark:text-zinc-400">
                {format(day, 'd')}
              </div>
            ))}
          </div>
          <div className="relative h-16 mt-2">
            {milestones.map(milestone => {
              const date = new Date(milestone.due_date);
              const left = ((date.getTime() - startDate.getTime()) / (endDate.getTime() - startDate.getTime())) * 100;
              
              return (
                <div 
                  key={milestone.id}
                  className="absolute top-0 -translate-x-1/2 flex flex-col items-center group"
                  style={{ left: `${left}%` }}
                >
                  <div className={cn(
                    "w-3 h-3 rounded-full border-2 border-white dark:border-zinc-800 shadow-sm",
                    milestone.completed ? "bg-green-500" : "bg-amber-500"
                  )} />
                  <span className="text-[9px] mt-1 text-zinc-600 dark:text-zinc-300 truncate max-w-[60px] text-center">
                    {milestone.title}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
