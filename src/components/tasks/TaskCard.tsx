import { useTranslation } from 'react-i18next';
import { IconCalendar, IconAlignLeft } from '@tabler/icons-react';
import { format, parseISO, isPast } from 'date-fns';
import { cn } from '../../lib/utils';
import { PRIORITY_COLORS, initialsOf, taskDeadline } from './taskDisplay';
import type { Task } from '../../types';

export interface TaskCardProps {
  task: Task;
  projectName?: string;
  assigneeName?: string;
  isDragging: boolean;
  isDone: boolean;
  onClick: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}

export function TaskCard({ task, projectName, assigneeName, isDragging, isDone, onClick, onDragStart, onDragEnd }: TaskCardProps) {
  const { t } = useTranslation();
  const deadline = taskDeadline(task);
  const isOverdue = !!deadline && isPast(parseISO(deadline)) && !isDone;
  const priority = task.priority || 'normal';

  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      className={cn(
        "rounded-lg p-3 cursor-pointer active:cursor-grabbing select-none transition-all",
        isDragging ? 'opacity-40 scale-95' : 'hover:-translate-y-0.5'
      )}
      style={{
        background: 'var(--tblr-surface)',
        border: '1px solid var(--tblr-border)',
        borderLeft: `3px solid ${PRIORITY_COLORS[priority]}`,
        boxShadow: isDragging ? 'none' : 'var(--tblr-shadow)',
      }}
    >
      <p className="text-sm font-medium leading-snug" style={{ color: 'var(--tblr-text)' }}>{task.title}</p>

      <div className="flex items-center gap-2 mt-1">
        <p className="text-xs truncate flex-1" style={{ color: task.project_id ? 'var(--tblr-primary)' : 'var(--tblr-muted)' }}>
          {task.project_id ? projectName : t('task_no_project')}
        </p>
        {task.description && <IconAlignLeft size={12} style={{ color: 'var(--tblr-muted)' }} />}
      </div>

      <div className="flex items-center justify-between mt-2 gap-2">
        {deadline && (
          <div className="flex items-center gap-1 text-xs shrink-0" style={{ color: isOverdue ? 'var(--tblr-danger)' : 'var(--tblr-muted)' }}>
            <IconCalendar size={12} />
            <span>{format(parseISO(deadline), 'dd/MM')}</span>
          </div>
        )}
        <div className="flex-1">
          <div className="h-1 rounded-full overflow-hidden" style={{ background: 'var(--tblr-border)' }}>
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${task.progress || 0}%`, background: isDone ? 'var(--tblr-success)' : 'var(--tblr-primary)' }}
            />
          </div>
        </div>
        <span className="text-xs shrink-0" style={{ color: 'var(--tblr-muted)' }}>{task.progress || 0}%</span>
        {task.assignee_id && (
          <span
            title={assigneeName}
            className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0"
            style={{ background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)' }}
          >
            {initialsOf(assigneeName)}
          </span>
        )}
      </div>
    </div>
  );
}

export default TaskCard;
