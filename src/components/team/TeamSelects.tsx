import { IconChevronDown } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import type { UserProfile } from '../../services/userService';
import { FOCUS_FIELD, ROLES, RoleBadge, RoleGlyph, type SystemRole } from './teamShared';

const FIELD = 'tblr-input appearance-none pr-7 hover:border-[var(--tblr-primary)]';

export function RoleSelect({ member, onChange }: { member: UserProfile; onChange: (id: string, role: SystemRole) => void }) {
  const { t } = useTranslation();
  return (
    <div className="relative">
      <RoleGlyph role={member.system_role} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2" />
      <select
        value={member.system_role}
        aria-label={t('team_aria_role_of', { name: member.name })}
        onChange={(e) => onChange(member.id, e.target.value as SystemRole)}
        className={cn(FIELD, 'pl-8', FOCUS_FIELD)}
      >
        {ROLES.slice().reverse().map((r) => (
          <option key={r} value={r}>{t(`team_role_short_${r}`)}</option>
        ))}
      </select>
      <IconChevronDown size={14} aria-hidden="true" className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[var(--tblr-muted)]" />
    </div>
  );
}

export function ManagerSelect({ member, team, onChange }: { member: UserProfile; team: UserProfile[]; onChange: (id: string, managerId: string) => void }) {
  const { t } = useTranslation();
  const candidates = team.filter((m) => m.id !== member.id && (m.system_role === 'manager' || m.system_role === 'admin'));
  return (
    <div className="relative">
      <select
        value={member.manager_id || ''}
        aria-label={t('team_aria_manager_of', { name: member.name })}
        onChange={(e) => onChange(member.id, e.target.value)}
        className={cn(FIELD, FOCUS_FIELD)}
      >
        <option value="">{t('team_no_manager')}</option>
        {candidates.map((m) => (
          <option key={m.id} value={m.id}>{m.name}</option>
        ))}
      </select>
      <IconChevronDown size={14} aria-hidden="true" className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[var(--tblr-muted)]" />
    </div>
  );
}

/** Lecture seule (non administrateur) : la pastille de rôle, sans contrôle. */
export function RoleReadout({ role }: { role: SystemRole }) {
  const { t } = useTranslation();
  return <RoleBadge role={role} label={t(`team_role_short_${role}`, { defaultValue: role }) as string} />;
}

export function ManagerReadout({ member, team }: { member: UserProfile; team: UserProfile[] }) {
  const { t } = useTranslation();
  const manager = team.find((m) => m.id === member.manager_id);
  return (
    <span className="text-sm text-[var(--tblr-text)]">
      {manager ? manager.name : <span className="text-zinc-500 dark:text-zinc-400">{t('team_no_manager')}</span>}
    </span>
  );
}
