import React from 'react';
import { IconCheck } from '@tabler/icons-react';
import { cn } from '../../lib/utils';

export interface PhaseStepperItem {
  id: string;
  label: string;
  description?: string;
}

interface PhaseStepperProps {
  steps: PhaseStepperItem[];
  /** Drives the done / current / upcoming status of each node (the project's real progress). */
  currentId?: string;
  /** Node to visually highlight as "being viewed" — defaults to currentId. */
  activeId?: string;
  onSelect?: (id: string) => void;
  /** 'compact' fits a header toolbar; 'default' suits a standalone card. */
  size?: 'default' | 'compact';
  className?: string;
}

export function PhaseStepper({ steps, currentId, activeId, onSelect, size = 'default', className }: PhaseStepperProps) {
  const currentIndex = steps.findIndex(s => s.id === currentId);
  const highlightId = activeId ?? currentId;
  const compact = size === 'compact';
  const nodeSize = compact ? 'w-7 h-7' : 'w-9 h-9';

  return (
    <div className={cn('flex items-start overflow-x-auto pb-1', className)}>
      {steps.map((step, i) => {
        const status: 'done' | 'current' | 'upcoming' =
          currentIndex === -1 ? 'upcoming' : i < currentIndex ? 'done' : i === currentIndex ? 'current' : 'upcoming';
        const isActive = step.id === highlightId;

        return (
          <React.Fragment key={step.id}>
            {i > 0 && (
              <div
                className={cn('h-0.5 flex-1 min-w-[16px] shrink-0 transition-colors', compact ? 'mt-[15px]' : 'mt-[19px]')}
                style={{ background: i <= currentIndex ? 'var(--tblr-primary)' : 'var(--tblr-border)' }}
              />
            )}
            <button
              type="button"
              onClick={() => onSelect?.(step.id)}
              disabled={!onSelect}
              className={cn(
                'flex flex-col items-center rounded-xl shrink-0 transition-colors',
                compact ? 'gap-1 px-1.5 py-1.5' : 'gap-1.5 px-2.5 py-2',
                onSelect && 'hover:bg-[var(--tblr-surface-2)] cursor-pointer'
              )}
              style={isActive ? { background: 'var(--tblr-primary-lt)' } : undefined}
            >
              <span
                className={cn(nodeSize, 'rounded-xl flex items-center justify-center text-xs font-bold border-2 transition-colors shrink-0')}
                style={
                  status === 'done'
                    ? { background: 'var(--tblr-primary)', borderColor: 'var(--tblr-primary)', color: '#fff' }
                    : status === 'current'
                    ? { background: 'var(--tblr-primary)', borderColor: 'var(--tblr-primary)', color: '#fff', boxShadow: '0 0 0 4px var(--tblr-primary-lt)' }
                    : { background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)', color: 'var(--tblr-muted)' }
                }
              >
                {status === 'done' ? <IconCheck size={compact ? 14 : 16} /> : status === 'current' ? <span className="w-2 h-2 rounded-full bg-white" /> : i + 1}
              </span>
              <span className={cn('text-center leading-tight', compact ? 'max-w-[64px]' : 'max-w-[92px]')}>
                <span
                  className={cn('block font-bold whitespace-nowrap', compact ? 'text-[10px]' : 'text-[11px]')}
                  style={{ color: status === 'upcoming' ? 'var(--tblr-muted)' : 'var(--tblr-text)' }}
                >
                  {step.label}
                </span>
                {step.description && !compact && (
                  <span className="block text-[10px] truncate" style={{ color: 'var(--tblr-muted)' }}>
                    {step.description}
                  </span>
                )}
              </span>
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
}
