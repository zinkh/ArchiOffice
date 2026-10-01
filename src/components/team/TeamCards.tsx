import { IconArrowUpRight } from '@tabler/icons-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import type { MemberViewProps } from './memberViewTypes';
import { ManagerReadout, ManagerSelect, RoleReadout, RoleSelect } from './TeamSelects';
import { Avatar, CropMarks, FOCUS_RING, HAIRLINE, INK_LINE, MONO_LABEL, pad2 } from './teamShared';

/**
 * Fiches : des planches à repères de coupe, pas une grille de cartes de
 * profil. Numéro en marge, nom en gros, deux champs étiquetés au pied.
 */
export default function TeamCards({ members, team, isAdmin, highlightId, currentUserId, memberRefs, onRoleChange, onManagerChange }: MemberViewProps) {
  const { t } = useTranslation();
  return (
    <ul className="grid grid-cols-1 gap-x-6 gap-y-7 md:grid-cols-2 xl:grid-cols-3">
      {members.map((member, i) => {
        const highlighted = member.id === highlightId;
        return (
          <li
            key={member.id}
            ref={(el) => { memberRefs.current[member.id] = el; }}
            aria-current={highlighted ? 'true' : undefined}
            className={cn(
              'relative border bg-white transition-colors duration-100 dark:bg-zinc-900/70',
              INK_LINE,
              highlighted && 'outline-2 outline-offset-4 outline-zinc-900 dark:outline-white',
            )}
          >
            <CropMarks />
            <div className="flex items-stretch">
              <div className="flex w-11 shrink-0 flex-col items-center justify-between border-r border-zinc-300 py-3 dark:border-zinc-700">
                <span className="font-mono text-xs tabular-nums text-zinc-500 dark:text-zinc-400">{pad2(i + 1)}</span>
                <span
                  className="font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-zinc-400 [writing-mode:vertical-rl] dark:text-zinc-500"
                  aria-hidden="true"
                >
                  {t(`team_role_short_${member.system_role}`)}
                </span>
              </div>
              <div className="min-w-0 flex-1 p-4">
                <div className="flex items-start justify-between gap-3">
                  <Avatar member={member} size={56} />
                  <Link
                    to={`/profile/${member.id}`}
                    className={cn('inline-flex items-center gap-1 border-b border-zinc-900 pb-px text-xs font-semibold text-zinc-900 dark:border-zinc-100 dark:text-white', FOCUS_RING)}
                  >
                    {t('team_view_profile')}
                    <IconArrowUpRight size={13} aria-hidden="true" />
                  </Link>
                </div>
                <h3 className="mt-4 truncate text-[1.375rem] font-semibold leading-tight tracking-[-0.025em] text-zinc-900 dark:text-white">
                  {member.name}
                  {member.id === currentUserId && (
                    <span className={cn(MONO_LABEL, 'ml-2 border border-zinc-400 px-1 py-px align-middle dark:border-zinc-600')}>{t('team_you')}</span>
                  )}
                </h3>
                <p className="mt-0.5 truncate text-sm text-zinc-700 dark:text-zinc-300">
                  {member.role || <span className="text-zinc-400 dark:text-zinc-500">{t('team_no_function')}</span>}
                </p>
                <p className="truncate font-mono text-xs text-zinc-500 dark:text-zinc-400">{member.email}</p>

                <dl className={cn('mt-4 space-y-3 border-t border-dashed pt-3', HAIRLINE)}>
                  <div>
                    <dt className={cn(MONO_LABEL, 'mb-1.5')}>{t('team_system_access')}</dt>
                    <dd>{isAdmin ? <RoleSelect member={member} onChange={onRoleChange} /> : <RoleReadout role={member.system_role} />}</dd>
                  </div>
                  <div>
                    <dt className={cn(MONO_LABEL, 'mb-1.5')}>{t('team_manager_label')}</dt>
                    <dd>{isAdmin ? <ManagerSelect member={member} team={team} onChange={onManagerChange} /> : <ManagerReadout member={member} team={team} />}</dd>
                  </div>
                </dl>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
