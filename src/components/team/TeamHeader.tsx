import { IconUserPlus } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { FOCUS_RING, INK_LINE, MONO_LABEL, pad2 } from './teamShared';

interface TeamHeaderProps {
  headcount: number;
  admins: number;
  pending: number;
  isAdmin: boolean;
  onAdd: () => void;
}

function Cell({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={cn('flex flex-col justify-between gap-2 px-3 py-2.5', className)}>
      <dt className={MONO_LABEL}>{label}</dt>
      <dd className="font-mono text-2xl font-light leading-none tabular-nums text-zinc-900 dark:text-white">{value}</dd>
    </div>
  );
}

/**
 * En-tête en planche d'architecte : titre éditorial à gauche, cartouche
 * de chiffres à droite, sur une trame de points qui s'estompe vers le bas.
 */
export default function TeamHeader({ headcount, admins, pending, isAdmin, onAdd }: TeamHeaderProps) {
  const { t, i18n } = useTranslation();
  const revision = new Date().toLocaleDateString(i18n.language, { day: '2-digit', month: '2-digit', year: '2-digit' });

  return (
    <header className="relative">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-x-4 -top-4 bottom-0 text-zinc-900 opacity-[0.11] [mask-image:linear-gradient(to_bottom,black,transparent)] dark:text-white dark:opacity-[0.14]"
        style={{ backgroundImage: 'radial-gradient(currentColor 1px, transparent 1.2px)', backgroundSize: '16px 16px' }}
      />
      <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className={cn(MONO_LABEL, 'flex items-center gap-3')}>
            <span aria-hidden="true" className="h-px w-8 bg-zinc-900 dark:bg-zinc-100" />
            {t('team_eyebrow')}
          </p>
          <h1 className="mt-3 text-[clamp(2.75rem,8vw,5rem)] font-semibold leading-[0.9] tracking-[-0.045em] text-zinc-900 dark:text-white">
            {t('team_title')}
            <span aria-hidden="true" className="text-zinc-400 dark:text-zinc-600">.</span>
          </h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{t('team_subtitle')}</p>
          {isAdmin && (
            <button
              type="button"
              onClick={onAdd}
              className={cn(
                'group mt-6 inline-flex items-center gap-2.5 rounded-[2px] bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white transition-[transform,background-color] duration-100 active:scale-[0.97] dark:bg-white dark:text-zinc-900',
                '[@media(hover:hover)]:hover:bg-zinc-700 dark:[@media(hover:hover)]:hover:bg-zinc-200',
                FOCUS_RING,
              )}
            >
              <IconUserPlus size={18} aria-hidden="true" />
              {t('team_add_member_btn')}
            </button>
          )}
        </div>

        <dl
          className={cn(
            'grid w-full shrink-0 grid-cols-2 divide-x divide-y bg-white/80 dark:bg-zinc-900/70 sm:w-[22rem]',
            'border divide-zinc-900/80 dark:divide-zinc-100/70',
            INK_LINE,
          )}
        >
          <Cell label={t('team_stat_headcount')} value={pad2(headcount)} />
          <Cell label={t('team_stat_admins')} value={pad2(admins)} />
          <Cell label={t('team_stat_pending')} value={pad2(pending)} />
          <Cell label={t('team_stat_revision')} value={revision} className="[&_dd]:text-base [&_dd]:font-normal [&_dd]:pt-1.5" />
        </dl>
      </div>
    </header>
  );
}
