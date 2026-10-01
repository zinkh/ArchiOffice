import { IconArrowUpRight } from '@tabler/icons-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import type { MemberViewProps } from './memberViewTypes';
import { ManagerReadout, ManagerSelect, RoleReadout, RoleSelect } from './TeamSelects';
import { Avatar, FOCUS_RING, INK_LINE, MONO_LABEL, pad2 } from './teamShared';

/** Registre : un tableau de nomenclature, une ligne par personne, numérotée comme un bordereau. */
export default function TeamRegistry({ members, team, isAdmin, highlightId, currentUserId, memberRefs, onRoleChange, onManagerChange }: MemberViewProps) {
  const { t } = useTranslation();
  const th = cn(MONO_LABEL, 'px-3 py-2.5 text-left font-normal');

  return (
    <div className={cn('overflow-x-auto border-y-2', INK_LINE)}>
      <table className="w-full min-w-[56rem] border-collapse text-left">
        <thead>
          <tr className="border-b border-zinc-900/80 dark:border-zinc-100/70">
            <th scope="col" className={cn(th, 'w-14 pl-4')}>{t('team_col_index')}</th>
            <th scope="col" className={th}>{t('team_col_member')}</th>
            <th scope="col" className={th}>{t('team_col_function')}</th>
            <th scope="col" className={cn(th, 'w-52')}>{t('team_col_access')}</th>
            <th scope="col" className={cn(th, 'w-56')}>{t('team_col_manager')}</th>
            <th scope="col" className="w-14 px-3"><span className="sr-only">{t('team_view_profile')}</span></th>
          </tr>
        </thead>
        <tbody>
          {members.map((member, i) => {
            const highlighted = member.id === highlightId;
            return (
              <tr
                key={member.id}
                ref={(el) => { memberRefs.current[member.id] = el; }}
                aria-current={highlighted ? 'true' : undefined}
                className={cn(
                  'group border-b border-zinc-300 transition-colors duration-100 last:border-b-0 dark:border-zinc-700',
                  highlighted
                    ? 'bg-zinc-900/[0.07] dark:bg-white/[0.1]'
                    : '[@media(hover:hover)]:hover:bg-zinc-900/[0.035] dark:[@media(hover:hover)]:hover:bg-white/[0.05]',
                )}
              >
                <td
                  className={cn(
                    'py-3 pl-4 pr-3 align-middle font-mono text-xs tabular-nums text-zinc-500 dark:text-zinc-400',
                    highlighted && 'shadow-[inset_3px_0_0_0] shadow-zinc-900 dark:shadow-white',
                  )}
                >
                  {pad2(i + 1)}
                </td>
                <td className="px-3 py-3 align-middle">
                  <div className="flex items-center gap-3.5">
                    <Avatar member={member} size={44} />
                    <div className="min-w-0">
                      <p className="truncate text-[1.0625rem] font-semibold leading-tight tracking-tight text-zinc-900 dark:text-white">
                        {member.name}
                        {member.id === currentUserId && (
                          <span className={cn(MONO_LABEL, 'ml-2 border border-zinc-400 px-1 py-px align-middle dark:border-zinc-600')}>{t('team_you')}</span>
                        )}
                      </p>
                      <p className="truncate font-mono text-xs text-zinc-500 dark:text-zinc-400">{member.email}</p>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-3 align-middle text-sm text-zinc-700 dark:text-zinc-300">
                  {member.role || <span className="text-zinc-400 dark:text-zinc-500">{t('team_no_function')}</span>}
                </td>
                <td className="px-3 py-3 align-middle">
                  {isAdmin ? <RoleSelect member={member} onChange={onRoleChange} /> : <RoleReadout role={member.system_role} />}
                </td>
                <td className="px-3 py-3 align-middle">
                  {isAdmin ? <ManagerSelect member={member} team={team} onChange={onManagerChange} /> : <ManagerReadout member={member} team={team} />}
                </td>
                <td className="px-3 py-3 text-right align-middle">
                  <Link
                    to={`/profile/${member.id}`}
                    aria-label={`${t('team_view_profile')} : ${member.name}`}
                    title={t('team_view_profile') as string}
                    className={cn('inline-flex border border-transparent p-1.5 text-zinc-600 dark:text-zinc-300 transition-colors hover:border-zinc-900 hover:text-zinc-900 dark:hover:border-zinc-100 dark:hover:text-white', FOCUS_RING)}
                  >
                    <IconArrowUpRight size={17} aria-hidden="true" />
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
