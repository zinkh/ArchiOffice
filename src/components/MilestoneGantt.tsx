import { useMemo } from 'react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isWithinInterval } from 'date-fns';
import { cn } from '../lib/utils';
import type { Milestone } from '../types';
import { useTranslation } from 'react-i18next';

interface MilestoneGanttProps {
  milestones: Milestone[];
  startDate: Date;
  endDate: Date;
  onUpdate?: (milestones: Milestone[]) => void;
}

export default function MilestoneGantt({ milestones, startDate, endDate, onUpdate }: MilestoneGanttProps) {
  const { t } = useTranslation();
  
  const days = useMemo(() => {
    return eachDayOfInterval({ start: startDate, end: endDate });
  }, [startDate, endDate]);

  const handleDurationChange = (id: string, duration: number) => {
    if (!onUpdate) return;
    const updated = milestones.map(m => m.id === id ? { ...m, duration_days: duration } : m);
    onUpdate(updated);
  };

  const handleDependencyChange = (id: string, depId: string) => {
    if (!onUpdate) return;
    const updated = milestones.map(m => 
      m.id === id ? { ...m, dependencies: depId ? [depId] : [] } : m
    );
    onUpdate(updated);
  };

  // Calculate cascading dates based on dependencies
  const milestonesWithDates = useMemo(() => {
    const result: (Milestone & { calculated_start: Date; calculated_end: Date })[] = [];
    const visited = new Set<string>();

    const calculate = (m: Milestone, path = new Set<string>()) => {
      if (visited.has(m.id)) return;
      if (path.has(m.id)) return; // Circular dependency detected
      
      path.add(m.id);
      let currentStart = new Date(startDate);
      
      if (m.dependencies && m.dependencies.length > 0) {
        const depId = m.dependencies[0];
        const dep = milestones.find(ms => ms.id === depId);
        if (dep) {
          calculate(dep, new Set(path));
          const depResult = result.find(r => r.id === depId);
          if (depResult) {
            currentStart = new Date(depResult.calculated_end);
          }
        }
      }

      const duration = m.duration_days || 30;
      const calculated_end = new Date(currentStart.getTime() + duration * 24 * 60 * 60 * 1000);
      
      result.push({
        ...m,
        calculated_start: currentStart,
        calculated_end
      });
      visited.add(m.id);
    };

    milestones.forEach(m => calculate(m));
    return result;
  }, [milestones, startDate]);

  return (
    <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden shadow-sm p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold text-zinc-900 dark:text-white">{t('milestones')}</h3>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-6">
        <div className="space-y-2">
          <h4 className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Liste des missions</h4>
          <div className="space-y-1 max-h-[400px] overflow-y-auto pr-2">
            {milestones.map(m => (
              <div key={m.id} className="p-2 bg-zinc-50 dark:bg-zinc-900/50 rounded-lg border border-zinc-100 dark:border-zinc-700/50 space-y-2">
                <div className="text-xs text-zinc-700 dark:text-zinc-300 font-bold truncate">{m.title}</div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-[8px] font-bold text-zinc-400 uppercase">Durée</label>
                    <div className="flex items-center gap-1">
                      <input 
                        type="number"
                        className="w-full px-2 py-1 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded text-[10px] outline-none focus:ring-1 focus:ring-blue-500"
                        value={m.duration_days || 0}
                        onChange={(e) => handleDurationChange(m.id, Number(e.target.value))}
                      />
                      <span className="text-[8px] text-zinc-400">j</span>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[8px] font-bold text-zinc-400 uppercase">Après</label>
                    <select 
                      className="w-full px-1 py-1 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded text-[10px] outline-none focus:ring-1 focus:ring-blue-500"
                      value={m.dependencies?.[0] || ''}
                      onChange={(e) => handleDependencyChange(m.id, e.target.value)}
                    >
                      <option value="">Début</option>
                      {milestones.filter(ms => ms.id !== m.id).map(ms => (
                        <option key={ms.id} value={ms.id}>{ms.title}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-[500px] relative">
            <div className="flex border-b border-zinc-200 dark:border-zinc-700 pb-2">
              {days.filter((_, i) => i % 30 === 0).map(day => (
                <div key={day.toISOString()} className="flex-1 min-w-[60px] text-center text-[10px] text-zinc-500 dark:text-zinc-400">
                  {format(day, 'MMM yyyy')}
                </div>
              ))}
            </div>
            <div className="relative mt-4 space-y-2">
              {milestonesWithDates.map((milestone) => {
                const totalDays = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
                
                const startOffset = ((milestone.calculated_start.getTime() - startDate.getTime()) / (endDate.getTime() - startDate.getTime())) * 100;
                const width = ((milestone.calculated_end.getTime() - milestone.calculated_start.getTime()) / (endDate.getTime() - startDate.getTime())) * 100;
                
                return (
                  <div key={milestone.id} className="h-6 relative bg-zinc-100/30 dark:bg-zinc-900/20 rounded-full">
                    <div 
                      className={cn(
                        "absolute top-0 h-full flex items-center px-2 text-[8px] text-white font-bold transition-all rounded-full shadow-sm",
                        milestone.completed ? "bg-green-500" : "bg-blue-500"
                      )}
                      style={{ left: `${Math.max(0, startOffset)}%`, width: `${Math.max(width, 2)}%` }}
                    >
                      <span className="truncate">{milestone.title}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
