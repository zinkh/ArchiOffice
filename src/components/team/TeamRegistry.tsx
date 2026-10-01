import { IconArrowUpRight } from '@tabler/icons-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import type { MemberViewProps } from './memberViewTypes';
import { ManagerReadout, ManagerSelect, RoleReadout, RoleSelect } from './TeamSelects';
import { Avatar, FOCUS_RING, MONO_LABEL, PANEL, pad2 } from './teamShared';

/** Registre : un tableau de nomenclature, une ligne par personne, numérotée comme un bordereau. */
export default function TeamRegistry({ members, team, isAdmin, highlightId, currentUserId, memberRefs, onRoleChange, onManagerChange }: MemberViewProps) {
  const { t } = useTranslation();
  const th = cn(MONO_LABEL, 'px-3 py-2.5 text-left font-medium');

  return (
    <div className={cn(PANEL, 'overflow-x-auto border-t-2 !border-t-[var(--tblr-primary)]')}>
      <table className="w-full min-w-[56rem] border-collapse text-left">
        <thead className="bg-[var(--tblr-surface-2)]">
          <tr className="border-b border-[var(--tblr-border)]">
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
                  'group border-b border-[var(--tblr-border)] transition-colors duration-100 last:border-b-0',
                  highlighted ? 'bg-[var(--tblr-primary-lt)]' : '[@media(hover:hover)]:hover:bg-[var(--tblr-surface-2)]',
                )}
              >
                <td className={cn('py-3 pl-4 pr-3 align-middle font-mono text-xs tabular-nums text-zinc-600 dark:text-zinc-400', highlighted && 'shadow-[inset_3px_0_0_0_var(--tblr-primary)]')}>
                  {pad2(i + 1)}
                </td>
                <td className="px-3 py-3 align-middle">
                  <div className="flex items-center gap-3.5">
                    <Avatar member={member} size={44} />
                    <div className="min-w-0">
                      <p className="truncate text-[1.0625rem] font-semibold leading-tight tracking-tight text-[var(--tblr-text)]">
                        {member.name}
                        {member.id === currentUserId && (
                          <span className="tblr-badge ml-2 align-middle !normal-case" style={{ background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)' }}>{t('team_you')}</span>
                        )}
                      </p>
                      <p className="truncate font-mono text-xs text-zinc-600 dark:text-zinc-400">{member.email}</p>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-3 align-middle text-sm text-[var(--tblr-text)]">
                  {member.role || <span className="text-zinc-500 dark:text-zinc-400">{t('team_no_function')}</span>}
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
                    className={cn('btn btn-ghost !p-1.5 !text-[var(--tblr-primary)]', FOCUS_RING)}
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
