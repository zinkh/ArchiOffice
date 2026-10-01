import { IconLayoutList, IconSearch, IconSitemap, IconId, IconX } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import type { UserProfile } from '../../services/userService';
import { FOCUS_FIELD, FOCUS_RING, MONO_LABEL, ROLES, RoleGlyph, hatchStyle, pad2, roleTone, tint, type SystemRole } from './teamShared';

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
  /** Le registre dense n'a pas de sens sous la largeur d'une tablette. */
  registryAvailable: boolean;
}

const Tick = () => (
  <svg width="10" height="14" viewBox="0 0 10 14" aria-hidden="true" className="shrink-0">
    <path d="M5 0v14M1 11 9 3" stroke="currentColor" strokeWidth="1.25" fill="none" />
  </svg>
);

/**
 * Ligne de cote interactive : repères en biais, effectif au centre, et une barre
 * dont chaque segment (hachure et teinte du rôle) filtre l'équipe par niveau d'accès.
 * Les puces dessous en sont la légende.
 */
function DimensionLine({ team, roleFilter, onRoleFilter }: Pick<TeamToolbarProps, 'team' | 'roleFilter' | 'onRoleFilter'>) {
  const { t } = useTranslation();
  const total = team.length;
  const counts = ROLES.map((r) => ({ role: r, n: team.filter((m) => m.system_role === r).length })).filter((c) => c.n > 0);
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 text-[var(--tblr-primary)]">
        <Tick />
        <span aria-hidden="true" className="h-px flex-1 bg-current opacity-60" />
        <span className="font-mono text-xs tabular-nums">{pad2(total)}</span>
        <span aria-hidden="true" className="h-px flex-1 bg-current opacity-60" />
        <Tick />
      </div>
      <div className="mt-1.5 flex h-4 gap-px overflow-hidden rounded-[2px] border border-[var(--tblr-primary)]/45 bg-[var(--tblr-surface)]">
        {counts.map((c) => {
          const active = roleFilter === c.role;
          const label = t('team_bar_segment', { role: t(`team_role_short_${c.role}`), count: c.n }) as string;
          return (
            <button
              key={c.role}
              type="button"
              aria-pressed={active}
              aria-label={label}
              title={label}
              onClick={() => onRoleFilter(active ? 'all' : c.role)}
              style={{ ...hatchStyle(c.role), flexGrow: c.n, flexBasis: 0, opacity: roleFilter === 'all' || active ? 1 : 0.35 }}
              className={cn('h-full min-w-[6px] transition-opacity duration-150 [@media(hover:hover)]:hover:opacity-100', FOCUS_RING, '-outline-offset-2')}
            />
          );
        })}
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
      <DimensionLine team={p.team} roleFilter={p.roleFilter} onRoleFilter={p.onRoleFilter} />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div role="group" aria-label={t('team_filter_role_aria') as string} className="flex flex-wrap gap-1.5">
          <button type="button" aria-pressed={p.roleFilter === 'all'} onClick={() => p.onRoleFilter('all')} className={chip(p.roleFilter === 'all')}>
            {t('team_filter_all')}
            <span className="font-mono tabular-nums opacity-70">{pad2(p.team.length)}</span>
          </button>
          {ROLES.slice().reverse().map((r) => {
            const active = p.roleFilter === r;
            return (
              <button
                key={r}
                type="button"
                aria-pressed={active}
                onClick={() => p.onRoleFilter(active ? 'all' : r)}
                title={t(`team_role_hint_${r}`) as string}
                className={chip(active)}
                style={active ? { borderColor: roleTone(r), backgroundColor: tint(roleTone(r), 14) } : undefined}
              >
                <RoleGlyph role={r} size={12} />
                {t(`team_role_short_${r}`)}
                <span className="font-mono tabular-nums opacity-70">{pad2(p.team.filter((m) => m.system_role === r).length)}</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
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

          <label className="hidden items-center gap-2 sm:flex">
            <span className={MONO_LABEL}>{t('team_sort_label')}</span>
            <select value={p.sort} onChange={(e) => p.onSort(e.target.value as TeamSort)} className={cn('tblr-input !w-auto', FOCUS_FIELD)}>
              <option value="name">{t('team_sort_name')}</option>
              <option value="role">{t('team_sort_role')}</option>
              <option value="access">{t('team_sort_access')}</option>
            </select>
          </label>

          <div role="group" aria-label={t('team_view_label') as string} className="flex shrink-0 overflow-hidden rounded-[var(--tblr-radius)] border border-[var(--tblr-border)] bg-[var(--tblr-surface)]">
            {views.map((v, i) => (
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
      </div>
    </section>
  );
}

function chip(active: boolean): string {
  return cn(
    'press inline-flex shrink-0 items-center gap-1.5 rounded-[var(--tblr-radius)] border px-2.5 py-1 text-xs font-medium',
    active
      ? 'border-[var(--tblr-primary)] bg-[var(--tblr-primary-lt)] text-[var(--tblr-text)]'
      : 'border-[var(--tblr-border)] bg-[var(--tblr-surface)] text-zinc-600 dark:text-zinc-300 [@media(hover:hover)]:hover:border-[var(--tblr-primary)]',
    FOCUS_RING,
  );
}
