import { IconAlertTriangle, IconRefresh } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';

/** Pulsing placeholder block — use in place of content while a fetch is in flight. */
export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-md ${className}`}
      style={{ background: 'var(--tblr-surface-2)' }}
    />
  );
}

/** Grid of skeleton stat cards, matching the shape of the real StatCard grid. */
export function StatCardSkeletonGrid({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="rounded-xl p-4 flex flex-col gap-3"
          style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}
        >
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      ))}
    </div>
  );
}

/** Skeleton rows for list-style sections (recent items, table rows...). */
export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 py-1">
          <Skeleton className="w-9 h-9 rounded-lg shrink-0" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-2.5 w-1/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Skeleton cards for the Projects grid view. */
export function ProjectCardSkeletonGrid({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="rounded-lg overflow-hidden"
          style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}
        >
          <Skeleton className="h-44 rounded-none" />
          <div className="p-4 space-y-3">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-3 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Visible, retry-able error state. Pages that previously swallowed fetch
 * failures into `console.error` (leaving the user staring at an empty list
 * with no explanation) should render this instead.
 */
export function ErrorState({
  message,
  onRetry,
  compact = false,
}: {
  message?: string;
  onRetry?: () => void;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={`flex flex-col items-center justify-center text-center gap-3 rounded-xl ${compact ? 'py-6 px-4' : 'py-14 px-6'}`}
      style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}
    >
      <div
        className="w-11 h-11 rounded-full flex items-center justify-center"
        style={{ background: '#ffe3e3', color: '#d63939' }}
      >
        <IconAlertTriangle size={22} />
      </div>
      <div>
        <p className="text-sm font-semibold" style={{ color: 'var(--tblr-text)' }}>
          {t('error_loading_title')}
        </p>
        <p className="text-xs mt-1 max-w-sm" style={{ color: 'var(--tblr-muted)' }}>
          {message || t('error_loading_desc')}
        </p>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
          style={{ background: 'var(--tblr-primary)', color: 'white' }}
        >
          <IconRefresh size={14} />
          {t('retry_btn')}
        </button>
      )}
    </div>
  );
}
