import React from 'react';
import { cn } from '../../lib/utils';

export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-lg overflow-hidden', className)}
      style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}
      {...rest}
    >
      {children}
    </div>
  );
}

interface CardHeaderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  icon?: React.ElementType;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
}

export function CardHeader({ className, icon: Icon, title, description, action, ...rest }: CardHeaderProps) {
  return (
    <div
      // Sur un téléphone, l'action passe sous le titre plutôt que de le tronquer
      // à trois lettres : le titre garde au moins 14rem avant de céder la ligne.
      className={cn('p-4 sm:p-6 border-b flex flex-wrap items-center justify-between gap-x-3 gap-y-3', className)}
      style={{ borderColor: 'var(--tblr-border)' }}
      {...rest}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1 basis-56">
        {Icon && (
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
            style={{ background: 'var(--tblr-surface-2)' }}
          >
            <Icon size={20} style={{ color: 'var(--tblr-primary)' }} />
          </div>
        )}
        <div className="min-w-0">
          <h3 className="text-base font-bold truncate" style={{ color: 'var(--tblr-text)' }}>{title}</h3>
          {description && (
            <p className="text-sm line-clamp-2 sm:line-clamp-none sm:truncate" style={{ color: 'var(--tblr-muted)' }}>{description}</p>
          )}
        </div>
      </div>
      {action && <div className="shrink-0 max-w-full">{action}</div>}
    </div>
  );
}

export function CardBody({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('p-6', className)} {...rest}>
      {children}
    </div>
  );
}
