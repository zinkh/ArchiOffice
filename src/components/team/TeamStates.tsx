import { IconRefresh, IconUserPlus, IconUsers, IconSearch } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { FOCUS_RING, PANEL } from './teamShared';

function Panel({ children }: { children: React.ReactNode }) {
  return <div className={cn(PANEL, 'flex flex-col items-center px-6 py-12 text-center')}>{children}</div>;
}

export function EmptyTeam({ isAdmin, onAdd }: { isAdmin: boolean; onAdd: () => void }) {
  const { t } = useTranslation();
  return (
    <Panel>
      <IconUsers size={32} aria-hidden="true" className="text-[var(--tblr-muted)]" />
      <h2 className="mt-3 text-base font-semibold text-[var(--tblr-text)]">{t('team_empty_title')}</h2>
      <p className="mt-1 max-w-sm text-sm text-[var(--tblr-muted)]">
        {t(isAdmin ? 'team_empty_body' : 'team_empty_body_readonly')}
      </p>
      {isAdmin && (
        <button type="button" onClick={onAdd} className={cn('btn btn-primary mt-5', FOCUS_RING)}>
          <IconUserPlus size={18} aria-hidden="true" />
          {t('team_add_member_btn')}
        </button>
      )}
    </Panel>
  );
}

export function NoResults({ onReset }: { onReset: () => void }) {
  const { t } = useTranslation();
  return (
    <Panel>
      <IconSearch size={32} aria-hidden="true" className="text-[var(--tblr-muted)]" />
      <h2 className="mt-3 text-base font-semibold text-[var(--tblr-text)]">{t('team_no_results')}</h2>
      <p className="mt-1 max-w-sm text-sm text-[var(--tblr-muted)]">{t('team_no_results_body')}</p>
      <button type="button" onClick={onReset} className={cn('btn btn-secondary mt-5', FOCUS_RING)}>
        {t('team_reset_filters')}
      </button>
    </Panel>
  );
}

export function LoadError({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div role="alert" className={cn(PANEL, 'flex flex-col items-start gap-4 border-l-4 !border-l-[var(--tblr-danger)] p-5 sm:flex-row sm:items-center sm:justify-between')}>
      <div>
        <h2 className="text-base font-semibold text-[var(--tblr-text)]">{t('team_load_error')}</h2>
        <p className="mt-1 text-sm text-[var(--tblr-muted)]">{t('team_load_error_body')}</p>
      </div>
      <button type="button" onClick={onRetry} className={cn('btn btn-primary', FOCUS_RING)}>
        <IconRefresh size={16} aria-hidden="true" />
        {t('team_retry')}
      </button>
    </div>
  );
}

/** Squelette : les mêmes rangées que le tableau. */
export function TeamSkeleton() {
  return (
    <div aria-hidden="true" className={PANEL}>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex animate-pulse items-center gap-4 border-b border-[var(--tblr-border)] px-4 py-3 last:border-b-0">
          <span className="h-9 w-9 rounded-full bg-[var(--tblr-border)]" />
          <span className="flex-1 space-y-2">
            <span className="block h-3.5 w-1/3 rounded-[2px] bg-[var(--tblr-border)]" />
            <span className="block h-3 w-1/4 rounded-[2px] bg-[var(--tblr-surface-2)]" />
          </span>
          <span className="hidden h-8 w-40 rounded-[var(--tblr-radius)] bg-[var(--tblr-surface-2)] sm:block" />
        </div>
      ))}
    </div>
  );
}
