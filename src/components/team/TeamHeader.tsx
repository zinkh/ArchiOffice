import { IconUserPlus } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { FOCUS_RING, MONO_LABEL, PANEL, pad2 } from './teamShared';

interface TeamHeaderProps {
  headcount: number;
  admins: number;
  pending: number;
  isAdmin: boolean;
  onAdd: () => void;
}

function Cell({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex flex-col justify-between gap-2 px-3 py-2.5">
      <dt className={MONO_LABEL}>{label}</dt>
      <dd className="font-mono text-2xl font-light leading-none tabular-nums text-[var(--tblr-text)]" style={tone ? { color: tone } : undefined}>
        {value}
      </dd>
    </div>
  );
}

/**
 * En-tête en planche : titre éditorial, cartouche de chiffres, trame de points
 * bleu primaire qui s'estompe vers le bas.
 */
export default function TeamHeader({ headcount, admins, pending, isAdmin, onAdd }: TeamHeaderProps) {
  const { t } = useTranslation();

  return (
    <header className="relative">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-x-4 -top-4 bottom-0 text-[var(--tblr-primary)] opacity-[0.22] [mask-image:linear-gradient(to_bottom,black,transparent)]"
        style={{ backgroundImage: 'radial-gradient(currentColor 1px, transparent 1.2px)', backgroundSize: '16px 16px' }}
      />
      <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className={cn(MONO_LABEL, 'flex items-center gap-3')}>
            <span aria-hidden="true" className="h-px w-8 bg-[var(--tblr-primary)]" />
            {t('team_eyebrow')}
          </p>
          <h1 className="mt-3 text-[clamp(2.5rem,7vw,4.5rem)] font-semibold leading-[0.92] tracking-[-0.045em] text-[var(--tblr-text)]">
            {t('team_title')}
            <span aria-hidden="true" className="text-[var(--tblr-primary)]">.</span>
          </h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{t('team_subtitle')}</p>
          {isAdmin && (
            <button type="button" onClick={onAdd} className={cn('btn btn-primary mt-6 !px-4 !py-2.5 font-semibold', FOCUS_RING)}>
              <IconUserPlus size={18} aria-hidden="true" />
              {t('team_add_member_btn')}
            </button>
          )}
        </div>

        <dl
          className={cn(
            PANEL,
            'grid w-full shrink-0 grid-cols-2 divide-x divide-y divide-[var(--tblr-border)] border-l-[3px] border-l-[var(--tblr-primary)] sm:w-[22rem]',
          )}
        >
          <Cell label={t('team_stat_headcount')} value={pad2(headcount)} />
          <Cell label={t('team_stat_admins')} value={pad2(admins)} tone="var(--tblr-primary)" />
          <Cell label={t('team_stat_pending')} value={pad2(pending)} tone={pending > 0 ? 'var(--tblr-warning)' : undefined} />
          <Cell label={t('team_stat_revision')} value={new Date().toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: '2-digit' })} />
        </dl>
      </div>
    </header>
  );
}
