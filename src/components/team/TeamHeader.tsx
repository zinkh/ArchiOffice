import { IconUserPlus } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { FOCUS_RING, MONO_LABEL } from './teamShared';

interface TeamHeaderProps {
  headcount: number;
  admins: number;
  pending: number;
  isAdmin: boolean;
  onAdd: () => void;
}

function Stat({ label, hint, value, tone }: { label: string; hint: string; value: number; tone?: string }) {
  return (
    <div className="stat-card min-w-0 !px-3 !py-3 sm:!px-5 sm:!py-4">
      <dt className={MONO_LABEL}>{label}</dt>
      <dd className="mt-1 text-xl font-semibold leading-tight tabular-nums text-[var(--tblr-text)] sm:text-2xl" style={tone ? { color: tone } : undefined}>
        {value}
      </dd>
      <p className="hidden text-xs text-[var(--tblr-muted)] sm:block">{hint}</p>
    </div>
  );
}

/** En-tête de page au gabarit des autres écrans (titre, sous-titre, action), suivi de trois chiffres. */
export default function TeamHeader({ headcount, admins, pending, isAdmin, onAdd }: TeamHeaderProps) {
  const { t } = useTranslation();

  return (
    <header className="space-y-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-[var(--tblr-text)]">{t('team_title')}</h1>
          <p className="text-sm text-[var(--tblr-muted)]">{t('team_subtitle')}</p>
        </div>
        {isAdmin && (
          <button type="button" onClick={onAdd} className={cn('btn btn-primary justify-center max-md:!py-2.5', FOCUS_RING)}>
            <IconUserPlus size={16} aria-hidden="true" />
            {t('team_add_member_btn')}
          </button>
        )}
      </div>

      <dl className="m-0 grid grid-cols-3 gap-2 sm:gap-4">
        <Stat label={t('team_stat_headcount')} hint={t('team_stat_headcount_hint')} value={headcount} />
        <Stat label={t('team_stat_admins')} hint={t('team_stat_admins_hint')} value={admins} tone="var(--tblr-primary)" />
        <Stat label={t('team_stat_pending')} hint={t('team_stat_pending_hint')} value={pending} tone={pending > 0 ? 'var(--tblr-warning)' : undefined} />
      </dl>
    </header>
  );
}
