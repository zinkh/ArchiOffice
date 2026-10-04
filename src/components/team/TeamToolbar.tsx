import { IconSearch, IconSitemap, IconLayoutList, IconX } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import type { UserProfile } from '../../services/userService';
import { FOCUS_FIELD, FOCUS_RING, ROLES, RoleGlyph, type SystemRole } from './teamShared';

export type TeamView = 'list' | 'org';
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
}

const VIEWS: { id: TeamView; icon: typeof IconLayoutList; label: string }[] = [
  { id: 'list', icon: IconLayoutList, label: 'team_view_list' },
  { id: 'org', icon: IconSitemap, label: 'team_view_org' },
];

function chip(active: boolean, empty: boolean): string {
  return cn(
    'press inline-flex shrink-0 items-center gap-1.5 rounded-[var(--tblr-radius)] border px-2.5 py-1 text-[0.8125rem] font-medium',
    active
      ? 'border-[var(--tblr-primary)] bg-[var(--tblr-primary-lt)] text-[var(--tblr-primary)]'
      : 'border-[var(--tblr-border)] bg-[var(--tblr-surface)] text-[var(--tblr-text)] [@media(hover:hover)]:hover:border-[var(--tblr-primary)]',
    empty && !active && 'opacity-60',
    FOCUS_RING,
  );
}

/** Puces de niveau d'accès avec compteurs, recherche, tri et choix de l'affichage. */
export default function TeamToolbar(p: TeamToolbarProps) {
  const { t } = useTranslation();
  const count = (r: SystemRole) => p.team.filter((m) => m.system_role === r).length;

  return (
    <section aria-label={t('team_view_label') as string} className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex min-w-0 items-center gap-2 lg:order-2">
        <label className="relative min-w-0 flex-1 lg:w-64 lg:flex-none">
          <span className="sr-only">{t('team_search_label')}</span>
          <IconSearch size={15} aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--tblr-muted)]" />
          <input
            type="search"
            value={p.query}
            onChange={(e) => p.onQuery(e.target.value)}
            placeholder={t('team_search_placeholder') as string}
            className={cn('tblr-input pl-8 pr-7 [&::-webkit-search-cancel-button]:hidden', FOCUS_FIELD)}
          />
          {p.query && (
            <button
              type="button"
              onClick={() => p.onQuery('')}
              aria-label={t('team_reset_filters') as string}
              className={cn('absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-[var(--tblr-muted)] hover:text-[var(--tblr-text)]', FOCUS_RING)}
            >
              <IconX size={13} aria-hidden="true" />
            </button>
          )}
        </label>

        <label className="hidden shrink-0 sm:block">
          <span className="sr-only">{t('team_sort_label')}</span>
          <select value={p.sort} onChange={(e) => p.onSort(e.target.value as TeamSort)} className={cn('tblr-input !w-auto', FOCUS_FIELD)}>
            <option value="name">{t('team_sort_name')}</option>
            <option value="role">{t('team_sort_role')}</option>
            <option value="access">{t('team_sort_access')}</option>
          </select>
        </label>

        <div role="group" aria-label={t('team_view_label') as string} className="flex shrink-0 overflow-hidden rounded-[var(--tblr-radius)] border border-[var(--tblr-border)] bg-[var(--tblr-surface)]">
          {VIEWS.map((v, i) => (
            <button
              key={v.id}
              type="button"
              aria-pressed={p.view === v.id}
              title={t(v.label) as string}
              aria-label={t(v.label) as string}
              onClick={() => p.onView(v.id)}
              className={cn(
                'press p-2',
                i > 0 && 'border-l border-[var(--tblr-border)]',
                p.view === v.id
                  ? 'bg-[var(--tblr-primary-lt)] text-[var(--tblr-primary)]'
                  : 'text-[var(--tblr-muted)] [@media(hover:hover)]:hover:bg-[var(--tblr-surface-2)] [@media(hover:hover)]:hover:text-[var(--tblr-text)]',
                FOCUS_RING,
                '-outline-offset-2',
              )}
            >
              <v.icon size={16} aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>

      <div role="group" aria-label={t('team_filter_role_aria') as string} className="-mb-1 flex gap-1.5 overflow-x-auto pb-1 lg:order-1 lg:mb-0 lg:flex-wrap lg:overflow-visible lg:pb-0">
        <button type="button" aria-pressed={p.roleFilter === 'all'} onClick={() => p.onRoleFilter('all')} className={chip(p.roleFilter === 'all', false)}>
          {t('team_filter_all')}
          <span className="tabular-nums opacity-70">{p.team.length}</span>
        </button>
        {ROLES.map((r) => {
          const active = p.roleFilter === r;
          const n = count(r);
          return (
            <button
              key={r}
              type="button"
              aria-pressed={active}
              onClick={() => p.onRoleFilter(active ? 'all' : r)}
              title={t(`team_role_hint_${r}`) as string}
              className={chip(active, n === 0)}
            >
              <RoleGlyph role={r} size={12} />
              {t(`team_role_short_${r}`)}
              <span className="tabular-nums opacity-70">{n}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
