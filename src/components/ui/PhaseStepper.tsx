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
  currentId?: string;
  onSelect?: (id: string) => void;
  className?: string;
}

export function PhaseStepper({ steps, currentId, onSelect, className }: PhaseStepperProps) {
  const currentIndex = steps.findIndex(s => s.id === currentId);

  return (
    <div className={cn('flex items-start overflow-x-auto pb-1', className)}>
      {steps.map((step, i) => {
        const status: 'done' | 'current' | 'upcoming' =
          currentIndex === -1 ? 'upcoming' : i < currentIndex ? 'done' : i === currentIndex ? 'current' : 'upcoming';

        return (
          <React.Fragment key={step.id}>
            {i > 0 && (
              <div
                className="h-0.5 mt-[19px] flex-1 min-w-[20px] shrink-0 transition-colors"
                style={{ background: i <= currentIndex ? 'var(--tblr-primary)' : 'var(--tblr-border)' }}
              />
            )}
            <button
              type="button"
              onClick={() => onSelect?.(step.id)}
              disabled={!onSelect}
              className={cn(
                'flex flex-col items-center gap-1.5 px-2.5 py-2 rounded-xl shrink-0 transition-colors',
                onSelect && 'hover:bg-[var(--tblr-surface-2)] cursor-pointer'
              )}
              style={status === 'current' ? { background: 'var(--tblr-primary-lt)' } : undefined}
            >
              <span
                className="w-9 h-9 rounded-xl flex items-center justify-center text-xs font-bold border-2 transition-colors shrink-0"
                style={
                  status === 'done'
                    ? { background: 'var(--tblr-primary)', borderColor: 'var(--tblr-primary)', color: '#fff' }
                    : status === 'current'
                    ? { background: 'var(--tblr-primary)', borderColor: 'var(--tblr-primary)', color: '#fff', boxShadow: '0 0 0 4px var(--tblr-primary-lt)' }
                    : { background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)', color: 'var(--tblr-muted)' }
                }
              >
                {status === 'done' ? <IconCheck size={16} /> : status === 'current' ? <span className="w-2 h-2 rounded-full bg-white" /> : i + 1}
              </span>
              <span className="text-center leading-tight max-w-[92px]">
                <span
                  className="block text-[11px] font-bold whitespace-nowrap"
                  style={{ color: status === 'upcoming' ? 'var(--tblr-muted)' : 'var(--tblr-text)' }}
                >
                  {step.label}
                </span>
                {step.description && (
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
