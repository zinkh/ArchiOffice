import { IconRefresh, IconUserPlus } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { FOCUS_RING, PANEL } from './teamShared';

/** Cadre de plan vide : rectangle pointillé barré de ses diagonales, comme un emplacement réservé. */
function EmptyFrame() {
  return (
    <svg viewBox="0 0 160 100" className="h-24 w-40 text-[var(--tblr-primary)]" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="158" height="98" stroke="currentColor" strokeDasharray="4 4" opacity="0.6" />
      <path d="M1 1l158 98M159 1 1 99" stroke="currentColor" opacity="0.25" />
      <rect x="62" y="30" width="36" height="40" fill="var(--tblr-surface)" stroke="currentColor" />
      <circle cx="80" cy="45" r="6" stroke="currentColor" />
      <path d="M69 64c1-7 5-10 11-10s10 3 11 10" stroke="currentColor" />
    </svg>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return <div className={cn(PANEL, 'flex flex-col items-center border-dashed px-6 py-14 text-center')}>{children}</div>;
}

export function EmptyTeam({ isAdmin, onAdd }: { isAdmin: boolean; onAdd: () => void }) {
  const { t } = useTranslation();
  return (
    <Panel>
      <EmptyFrame />
      <h2 className="mt-6 text-2xl font-semibold tracking-tight text-[var(--tblr-text)]">{t('team_empty_title')}</h2>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
        {t(isAdmin ? 'team_empty_body' : 'team_empty_body_readonly')}
      </p>
      {isAdmin && (
        <button type="button" onClick={onAdd} className={cn('btn btn-primary mt-6 !px-4 !py-2.5 font-semibold', FOCUS_RING)}>
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
      <p className="font-mono text-5xl font-extralight text-[var(--tblr-primary)] opacity-40" aria-hidden="true">00</p>
      <h2 className="mt-3 text-xl font-semibold tracking-tight text-[var(--tblr-text)]">{t('team_no_results')}</h2>
      <p className="mt-2 max-w-sm text-sm text-zinc-600 dark:text-zinc-400">{t('team_no_results_body')}</p>
      <button type="button" onClick={onReset} className={cn('btn btn-secondary mt-5 font-semibold', FOCUS_RING)}>
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
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{t('team_load_error_body')}</p>
      </div>
      <button type="button" onClick={onRetry} className={cn('btn btn-primary font-semibold', FOCUS_RING)}>
        <IconRefresh size={16} aria-hidden="true" />
        {t('team_retry')}
      </button>
    </div>
  );
}

/** Squelette : les mêmes rangées que le registre. */
export function TeamSkeleton() {
  return (
    <div aria-hidden="true" className={cn(PANEL, 'border-t-2 !border-t-[var(--tblr-primary)]')}>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex animate-pulse items-center gap-4 border-b border-[var(--tblr-border)] px-4 py-3.5 last:border-b-0">
          <span className="h-3 w-5 rounded-[2px] bg-[var(--tblr-border)]" />
          <span className="h-11 w-11 rounded-[var(--tblr-radius)] bg-[var(--tblr-border)]" />
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
