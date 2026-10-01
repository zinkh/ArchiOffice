import { useState } from 'react';
import { IconArrowUpRight, IconChevronDown } from '@tabler/icons-react';
import { AnimatePresence, motion } from 'motion/react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { DEFAULT_SPRING } from '../../lib/motion';
import type { UserProfile } from '../../services/userService';
import type { MemberViewProps } from './memberViewTypes';
import { ManagerReadout, ManagerSelect, RoleReadout, RoleSelect } from './TeamSelects';
import { Avatar, CropMarks, FOCUS_RING, MONO_LABEL, PANEL, RoleBadge, RoleGlyph, pad2 } from './teamShared';

type CardProps = Omit<MemberViewProps, 'members'> & { member: UserProfile; index: number };

/**
 * Fiche compacte : une ligne de synthèse (numéro, monogramme, nom, fonction,
 * pastille de rôle) qui se déplie sur les réglages. Neuf fiches tiennent dans
 * un écran de téléphone au lieu de quatre mille pixels.
 */
function Card({ member, index, team, isAdmin, highlightId, currentUserId, memberRefs, onRoleChange, onManagerChange }: CardProps) {
  const { t } = useTranslation();
  const highlighted = member.id === highlightId;
  const [open, setOpen] = useState(highlighted);
  const panelId = `team-card-${member.id}`;

  return (
    <li
      ref={(el) => { memberRefs.current[member.id] = el; }}
      aria-current={highlighted ? 'true' : undefined}
      className={cn(PANEL, 'relative', highlighted && 'border-[var(--tblr-primary)] shadow-[0_0_0_3px_var(--tblr-primary-lt)]')}
    >
      <CropMarks />
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`${member.name} : ${t(open ? 'team_card_collapse' : 'team_card_expand')}`}
        onClick={() => setOpen(!open)}
        className={cn('flex w-full items-center gap-3 p-3 text-left', FOCUS_RING, '-outline-offset-2')}
      >
        <span className="w-6 shrink-0 font-mono text-xs tabular-nums text-zinc-600 dark:text-zinc-400">{pad2(index + 1)}</span>
        <Avatar member={member} size={40} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-base font-semibold leading-tight tracking-tight text-[var(--tblr-text)]">{member.name}</span>
            {member.id === currentUserId && (
              <span className="tblr-badge shrink-0 !normal-case" style={{ background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)' }}>{t('team_you')}</span>
            )}
          </span>
          <span className="block truncate text-sm text-zinc-600 dark:text-zinc-400">{member.role || t('team_no_function')}</span>
        </span>
        <span className="shrink-0 sm:hidden" title={t(`team_role_short_${member.system_role}`) as string}><RoleGlyph role={member.system_role} size={16} /></span>
        <span className="hidden shrink-0 sm:block"><RoleBadge role={member.system_role} label={t(`team_role_short_${member.system_role}`) as string} /></span>
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
            <div className="space-y-3 border-t border-dashed border-[var(--tblr-border)] px-3 pb-3 pt-3">
              <p className="truncate font-mono text-xs text-zinc-600 dark:text-zinc-400">{member.email}</p>
              <div className="sm:hidden"><RoleBadge role={member.system_role} label={t(`team_role_short_${member.system_role}`) as string} /></div>
              <div>
                <p className={cn(MONO_LABEL, 'mb-1.5')}>{t('team_system_access')}</p>
                {isAdmin ? <RoleSelect member={member} onChange={onRoleChange} /> : <RoleReadout role={member.system_role} />}
              </div>
              <div>
                <p className={cn(MONO_LABEL, 'mb-1.5')}>{t('team_manager_label')}</p>
                {isAdmin ? <ManagerSelect member={member} team={team} onChange={onManagerChange} /> : <ManagerReadout member={member} team={team} />}
              </div>
              <Link to={`/profile/${member.id}`} className={cn('inline-flex items-center gap-1 text-sm font-medium text-[var(--tblr-primary)] hover:underline', FOCUS_RING)}>
                {t('team_view_profile')}
                <IconArrowUpRight size={14} aria-hidden="true" />
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

export default function TeamCards({ members, ...rest }: MemberViewProps) {
  return (
    <ul className="grid grid-cols-1 items-start gap-x-5 gap-y-3 md:grid-cols-2 xl:grid-cols-3">
      {members.map((member, i) => (
        <Card key={member.id} member={member} index={i} {...rest} />
      ))}
    </ul>
  );
}
