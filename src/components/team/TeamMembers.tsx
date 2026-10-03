import { useState } from 'react';
import { IconChevronDown } from '@tabler/icons-react';
import { AnimatePresence, motion } from 'motion/react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { DEFAULT_SPRING } from '../../lib/motion';
import type { UserProfile } from '../../services/userService';
import type { MemberViewProps } from './memberViewTypes';
import { ManagerReadout, ManagerSelect, RoleReadout, RoleSelect } from './TeamSelects';
import { Avatar, FOCUS_RING, MONO_LABEL, PANEL, RoleBadge, useMediaQuery } from './teamShared';

type RowProps = Omit<MemberViewProps, 'members'> & { member: UserProfile };

function YouBadge() {
  const { t } = useTranslation();
  return <span className="tblr-badge shrink-0" style={{ background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)' }}>{t('team_you')}</span>;
}

function Table({ members, ...rest }: MemberViewProps) {
  const { t } = useTranslation();
  const { team, isAdmin, highlightId, currentUserId, memberRefs, onRoleChange, onManagerChange } = rest;
  const th = cn(MONO_LABEL, 'bg-[var(--tblr-surface-2)] px-4 py-2.5 text-left');

  return (
    <div className={cn(PANEL, 'overflow-x-auto')}>
      <table className="w-full min-w-[46rem] border-collapse text-left">
        <thead>
          <tr className="border-b border-[var(--tblr-border)]">
            <th scope="col" className={th}>{t('team_col_member')}</th>
            <th scope="col" className={th}>{t('team_col_function')}</th>
            <th scope="col" className={cn(th, 'w-52')}>{t('team_col_access')}</th>
            <th scope="col" className={cn(th, 'w-56')}>{t('team_col_manager')}</th>
            <th scope="col" className="w-36 bg-[var(--tblr-surface-2)] px-4"><span className="sr-only">{t('team_view_profile')}</span></th>
          </tr>
        </thead>
        <tbody>
          {members.map((member) => {
            const highlighted = member.id === highlightId;
            return (
              <tr
                key={member.id}
                ref={(el) => { memberRefs.current[member.id] = el; }}
                aria-current={highlighted ? 'true' : undefined}
                className={cn(
                  'border-b border-[var(--tblr-border)] last:border-b-0',
                  highlighted ? 'bg-[var(--tblr-primary-lt)]' : '[@media(hover:hover)]:hover:bg-[var(--tblr-surface-2)]',
                )}
              >
                <td className="px-4 py-3 align-middle">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar member={member} size={36} />
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 font-semibold text-[var(--tblr-text)]">
                        <span className="truncate">{member.name}</span>
                        {member.id === currentUserId && <YouBadge />}
                      </p>
                      <p className="truncate text-[0.8125rem] text-[var(--tblr-muted)]">{member.email}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 align-middle text-[var(--tblr-text)]">
                  {member.role || <span className="italic text-[var(--tblr-muted)]">{t('team_no_function')}</span>}
                </td>
                <td className="px-4 py-3 align-middle">
                  {isAdmin ? <RoleSelect member={member} onChange={onRoleChange} /> : <RoleReadout role={member.system_role} />}
                </td>
                <td className="px-4 py-3 align-middle">
                  {isAdmin ? <ManagerSelect member={member} team={team} onChange={onManagerChange} /> : <ManagerReadout member={member} team={team} />}
                </td>
                <td className="px-4 py-3 text-right align-middle">
                  <Link
                    to={`/profile/${member.id}`}
                    aria-label={`${t('team_view_profile')} : ${member.name}`}
                    className={cn('whitespace-nowrap font-medium text-[var(--tblr-primary)] hover:underline', FOCUS_RING)}
                  >
                    {t('team_view_profile')}
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

/** Une ligne de synthèse qui se déplie sur les réglages : une seule carte pour toute l'équipe. */
function Row({ member, team, isAdmin, highlightId, currentUserId, memberRefs, onRoleChange, onManagerChange }: RowProps) {
  const { t } = useTranslation();
  const highlighted = member.id === highlightId;
  const [open, setOpen] = useState(highlighted);
  const panelId = `team-row-${member.id}`;

  return (
    <li
      ref={(el) => { memberRefs.current[member.id] = el; }}
      aria-current={highlighted ? 'true' : undefined}
      className={cn('border-b border-[var(--tblr-border)] last:border-b-0', highlighted && 'bg-[var(--tblr-primary-lt)]')}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`${member.name} : ${t(open ? 'team_card_collapse' : 'team_card_expand')}`}
        onClick={() => setOpen(!open)}
        className={cn('flex w-full items-center gap-3 px-3.5 py-3 text-left', FOCUS_RING, '-outline-offset-2')}
      >
        <Avatar member={member} size={36} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 font-semibold text-[var(--tblr-text)]">
            <span className="truncate">{member.name}</span>
            {member.id === currentUserId && <YouBadge />}
          </span>
          <span className="block truncate text-[0.8125rem] text-[var(--tblr-muted)]">{member.role || t('team_no_function')}</span>
        </span>
        <span className="shrink-0"><RoleBadge role={member.system_role} label={t(`team_role_short_${member.system_role}`) as string} /></span>
        <IconChevronDown size={16} aria-hidden="true" className={cn('shrink-0 text-[var(--tblr-muted)] transition-transform duration-200', open && 'rotate-180')} />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={panelId}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={DEFAULT_SPRING}
            className="overflow-hidden"
          >
            <div className="grid gap-3 px-3.5 pb-3.5 pl-[3.75rem]">
              <p className="truncate text-[0.8125rem] text-[var(--tblr-muted)]">{member.email}</p>
              <div>
                <p className={cn(MONO_LABEL, 'mb-1')}>{t('team_system_access')}</p>
                {isAdmin ? <RoleSelect member={member} onChange={onRoleChange} /> : <RoleReadout role={member.system_role} />}
              </div>
              <div>
                <p className={cn(MONO_LABEL, 'mb-1')}>{t('team_manager_label')}</p>
                {isAdmin ? <ManagerSelect member={member} team={team} onChange={onManagerChange} /> : <ManagerReadout member={member} team={team} />}
              </div>
              <Link to={`/profile/${member.id}`} className={cn('font-medium text-[var(--tblr-primary)] hover:underline', FOCUS_RING)}>
                {t('team_view_profile')}
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

function List({ members, ...rest }: MemberViewProps) {
  return (
    <ul className={cn(PANEL, 'overflow-hidden')}>
      {members.map((member) => (
        <Row key={member.id} member={member} {...rest} />
      ))}
    </ul>
  );
}

/** Tableau sur ordinateur, liste dépliable sur téléphone. Un seul des deux est monté : les repères de défilement ne se doublent pas. */
export default function TeamMembers(props: MemberViewProps) {
  const wide = useMediaQuery('(min-width: 768px)');
  return wide ? <Table {...props} /> : <List {...props} />;
}
