import { IconRefresh, IconUserPlus } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { FOCUS_RING, INK_LINE } from './teamShared';

/** Cadre de plan vide : rectangle pointillé barré de ses diagonales, comme un emplacement réservé. */
function EmptyFrame() {
  return (
    <svg viewBox="0 0 160 100" className="h-24 w-40 text-zinc-900 dark:text-zinc-100" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="158" height="98" stroke="currentColor" strokeDasharray="4 4" opacity="0.55" />
      <path d="M1 1l158 98M159 1 1 99" stroke="currentColor" opacity="0.22" />
      <rect x="62" y="30" width="36" height="40" fill="var(--empty-fill, white)" stroke="currentColor" />
      <circle cx="80" cy="45" r="6" stroke="currentColor" />
      <path d="M69 64c1-7 5-10 11-10s10 3 11 10" stroke="currentColor" />
    </svg>
  );
}

const SOLID_BTN = cn(
  'inline-flex items-center gap-2 rounded-[2px] bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white transition-[transform,background-color] duration-100 active:scale-[0.97] dark:bg-white dark:text-zinc-900',
  '[@media(hover:hover)]:hover:bg-zinc-700 dark:[@media(hover:hover)]:hover:bg-zinc-200',
  FOCUS_RING,
);

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className={cn('flex flex-col items-center border border-dashed bg-white/60 px-6 py-14 text-center [--empty-fill:white] dark:bg-zinc-900/40 dark:[--empty-fill:#18181b]', INK_LINE)}>
      {children}
    </div>
  );
}

export function EmptyTeam({ isAdmin, onAdd }: { isAdmin: boolean; onAdd: () => void }) {
  const { t } = useTranslation();
  return (
    <Panel>
      <EmptyFrame />
      <h2 className="mt-6 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-white">{t('team_empty_title')}</h2>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
        {t(isAdmin ? 'team_empty_body' : 'team_empty_body_readonly')}
      </p>
      {isAdmin && (
        <button type="button" onClick={onAdd} className={cn(SOLID_BTN, 'mt-6')}>
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
      <p className="font-mono text-5xl font-extralight text-zinc-300 dark:text-zinc-700" aria-hidden="true">00</p>
      <h2 className="mt-3 text-xl font-semibold tracking-tight text-zinc-900 dark:text-white">{t('team_no_results')}</h2>
      <p className="mt-2 max-w-sm text-sm text-zinc-600 dark:text-zinc-400">{t('team_no_results_body')}</p>
      <button
        type="button"
        onClick={onReset}
        className={cn('mt-5 rounded-[2px] border border-zinc-900/80 px-4 py-2 text-sm font-semibold text-zinc-900 dark:border-zinc-100/70 dark:text-white', FOCUS_RING)}
      >
        {t('team_reset_filters')}
      </button>
    </Panel>
  );
}

export function LoadError({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div role="alert" className={cn('flex flex-col items-start gap-4 border border-l-4 border-red-600 bg-white p-5 sm:flex-row sm:items-center sm:justify-between dark:bg-zinc-900')}>
      <div>
        <h2 className="text-base font-semibold text-zinc-900 dark:text-white">{t('team_load_error')}</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{t('team_load_error_body')}</p>
      </div>
      <button type="button" onClick={onRetry} className={SOLID_BTN}>
        <IconRefresh size={16} aria-hidden="true" />
        {t('team_retry')}
      </button>
    </div>
  );
}

/** Squelette : les mêmes rangées que le registre, en traits. */
export function TeamSkeleton() {
  return (
    <div aria-hidden="true" className={cn('border-y-2', INK_LINE)}>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex animate-pulse items-center gap-4 border-b border-zinc-300 px-4 py-3.5 last:border-b-0 dark:border-zinc-700">
          <span className="h-3 w-5 bg-zinc-200 dark:bg-zinc-800" />
          <span className="h-11 w-11 bg-zinc-200 dark:bg-zinc-800" />
          <span className="flex-1 space-y-2">
            <span className="block h-3.5 w-1/3 bg-zinc-200 dark:bg-zinc-800" />
            <span className="block h-3 w-1/4 bg-zinc-100 dark:bg-zinc-800/60" />
          </span>
          <span className="hidden h-8 w-40 bg-zinc-100 sm:block dark:bg-zinc-800/60" />
        </div>
      ))}
    </div>
  );
}
