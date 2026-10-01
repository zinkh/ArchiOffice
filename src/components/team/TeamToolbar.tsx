import { IconLayoutList, IconSearch, IconSitemap, IconId, IconX } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import type { UserProfile } from '../../services/userService';
import { FOCUS_FIELD, FOCUS_RING, HAIRLINE, INK_LINE, MONO_LABEL, ROLES, RoleGlyph, hatchStyle, pad2, type SystemRole } from './teamShared';

export type TeamView = 'registry' | 'cards' | 'org';
export type TeamSort = 'name' | 'role' | 'access';
export type RoleFilter = SystemRole | 'all';

interface TeamToolbarProps {
  team: UserProfile[];
  query: string;
  onQuery: (q: string) => void;
  roleFilter: RoleFilter;
  onRoleFilter: (r: RoleFilter) => void;
  sort: TeamSort;
  onSort: (s: TeamSort) => void;
  view: TeamView;
  onView: (v: TeamView) => void;
  /** Le registre dense n'a pas de sens sous la largeur d'un téléphone. */
  registryAvailable: boolean;
}

/** Ligne de cote : repères en biais aux extrémités, effectif au centre, répartition hachurée dessous. */
function DimensionLine({ team }: { team: UserProfile[] }) {
  const { t } = useTranslation();
  const total = team.length;
  const counts = ROLES.map((r) => ({ role: r, n: team.filter((m) => m.system_role === r).length }));
  return (
    <div className="mb-5" role="img" aria-label={counts.map((c) => `${t(`team_role_short_${c.role}`)} ${c.n}`).join(', ')}>
      <div className="flex items-center gap-2 text-zinc-900 dark:text-zinc-100">
        <svg width="10" height="14" viewBox="0 0 10 14" aria-hidden="true" className="shrink-0">
          <path d="M5 0v14M1 11 9 3" stroke="currentColor" strokeWidth="1.25" fill="none" />
        </svg>
        <span aria-hidden="true" className="h-px flex-1 bg-current opacity-60" />
        <span className="font-mono text-xs tabular-nums">{pad2(total)}</span>
        <span aria-hidden="true" className="h-px flex-1 bg-current opacity-60" />
        <svg width="10" height="14" viewBox="0 0 10 14" aria-hidden="true" className="shrink-0">
          <path d="M5 0v14M1 11 9 3" stroke="currentColor" strokeWidth="1.25" fill="none" />
        </svg>
      </div>
      <div className={cn('mt-1.5 flex h-2.5 border text-zinc-900 dark:text-zinc-100', INK_LINE)}>
        {total === 0 ? (
          <span className="h-full w-full" style={{ backgroundImage: 'repeating-linear-gradient(90deg, currentColor 0 1px, transparent 1px 8px)', opacity: 0.2 }} />
        ) : (
          counts.filter((c) => c.n > 0).map((c, i) => (
            <span
              key={c.role}
              title={`${t(`team_role_short_${c.role}`)} : ${c.n}`}
              style={{ ...hatchStyle(c.role), flexGrow: c.n, flexBasis: 0 }}
              className={cn('h-full min-w-[3px]', i > 0 && 'border-l border-zinc-900 dark:border-zinc-100')}
            />
          ))
        )}
      </div>
    </div>
  );
}

const VIEWS: { id: TeamView; icon: typeof IconLayoutList; label: string }[] = [
  { id: 'registry', icon: IconLayoutList, label: 'team_view_registry' },
  { id: 'cards', icon: IconId, label: 'team_view_cards' },
  { id: 'org', icon: IconSitemap, label: 'team_view_org' },
];

export default function TeamToolbar(p: TeamToolbarProps) {
  const { t } = useTranslation();
  const views = VIEWS.filter((v) => v.id !== 'registry' || p.registryAvailable);

  return (
    <section aria-label={t('team_view_label') as string}>
      <DimensionLine team={p.team} />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div role="group" aria-label={t('team_filter_role_aria') as string} className="flex flex-wrap gap-1.5">
          <button
            type="button"
            aria-pressed={p.roleFilter === 'all'}
            onClick={() => p.onRoleFilter('all')}
            className={chip(p.roleFilter === 'all')}
          >
            {t('team_filter_all')}
            <span className="font-mono tabular-nums opacity-60">{pad2(p.team.length)}</span>
          </button>
          {ROLES.slice().reverse().map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={p.roleFilter === r}
              onClick={() => p.onRoleFilter(p.roleFilter === r ? 'all' : r)}
              title={t(`team_role_hint_${r}`) as string}
              className={chip(p.roleFilter === r)}
            >
              <RoleGlyph role={r} size={12} />
              {t(`team_role_short_${r}`)}
              <span className="font-mono tabular-nums opacity-60">{pad2(p.team.filter((m) => m.system_role === r).length)}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <label className="relative min-w-0 flex-1 lg:w-64 lg:flex-none">
            <span className="sr-only">{t('team_search_label')}</span>
            <IconSearch size={15} aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              type="search"
              value={p.query}
              onChange={(e) => p.onQuery(e.target.value)}
              placeholder={t('team_search_placeholder') as string}
              className={cn(
                'w-full rounded-[2px] border bg-white py-1.5 pl-8 pr-7 text-sm text-zinc-900 placeholder:text-zinc-400 hover:border-zinc-900 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:border-zinc-100 [&::-webkit-search-cancel-button]:hidden',
                HAIRLINE,
                FOCUS_FIELD,
              )}
            />
            {p.query && (
              <button
                type="button"
                onClick={() => p.onQuery('')}
                aria-label={t('team_reset_filters') as string}
                className={cn('absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-zinc-500 hover:text-zinc-900 dark:hover:text-white', FOCUS_RING)}
              >
                <IconX size={13} aria-hidden="true" />
              </button>
            )}
          </label>

          <label className="hidden items-center gap-2 sm:flex">
            <span className={MONO_LABEL}>{t('team_sort_label')}</span>
            <select
              value={p.sort}
              onChange={(e) => p.onSort(e.target.value as TeamSort)}
              className={cn('rounded-[2px] border bg-white py-1.5 pl-2 pr-1 text-sm text-zinc-900 hover:border-zinc-900 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:border-zinc-100', HAIRLINE, FOCUS_FIELD)}
            >
              <option value="name">{t('team_sort_name')}</option>
              <option value="role">{t('team_sort_role')}</option>
              <option value="access">{t('team_sort_access')}</option>
            </select>
          </label>

          <div role="group" aria-label={t('team_view_label') as string} className={cn('flex shrink-0 border', INK_LINE)}>
            {views.map((v, i) => (
              <button
                key={v.id}
                type="button"
                aria-pressed={p.view === v.id}
                title={t(v.label) as string}
                aria-label={t(v.label) as string}
                onClick={() => p.onView(v.id)}
                className={cn(
                  'p-2 transition-colors duration-100',
                  i > 0 && 'border-l border-zinc-900/80 dark:border-zinc-100/70',
                  p.view === v.id
                    ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
                    : 'text-zinc-700 [@media(hover:hover)]:hover:bg-zinc-100 dark:text-zinc-300 dark:[@media(hover:hover)]:hover:bg-zinc-800',
                  FOCUS_RING,
                )}
              >
                <v.icon size={16} aria-hidden="true" />
              </button>
            ))}
          </div>
        </div>
      </div>

      <dl className="mt-3 hidden flex-wrap gap-x-5 gap-y-1 lg:flex" aria-hidden="true">
        {ROLES.slice().reverse().map((r) => (
          <div key={r} className="flex items-center gap-1.5 text-[0.6875rem] text-zinc-500 dark:text-zinc-400">
            <dt><RoleGlyph role={r} size={11} className="text-zinc-900 dark:text-zinc-100" /></dt>
            <dd><span className="font-semibold text-zinc-700 dark:text-zinc-200">{t(`team_role_short_${r}`)}</span> : {t(`team_role_hint_${r}`)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function chip(active: boolean): string {
  return cn(
    'inline-flex shrink-0 items-center gap-1.5 rounded-[2px] border px-2.5 py-1 text-xs font-medium transition-colors duration-100 active:scale-[0.97]',
    active
      ? 'border-zinc-900 bg-zinc-900 text-white dark:border-white dark:bg-white dark:text-zinc-900'
      : 'border-zinc-300 text-zinc-700 [@media(hover:hover)]:hover:border-zinc-900 dark:border-zinc-700 dark:text-zinc-300 dark:[@media(hover:hover)]:hover:border-zinc-100',
    FOCUS_RING,
  );
}
