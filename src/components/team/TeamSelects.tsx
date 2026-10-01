import { IconChevronDown } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import type { UserProfile } from '../../services/userService';
import { FOCUS_RING, HAIRLINE, ROLES, RoleGlyph, type SystemRole } from './teamShared';

const FIELD =
  'w-full appearance-none rounded-[2px] border bg-white py-1.5 pr-7 text-sm text-zinc-900 transition-colors hover:border-zinc-900 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:border-zinc-100';

export function RoleSelect({
  member,
  onChange,
}: {
  member: UserProfile;
  onChange: (id: string, role: SystemRole) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="relative">
      <RoleGlyph
        role={member.system_role}
        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-900 dark:text-zinc-100"
      />
      <select
        value={member.system_role}
        aria-label={t('team_aria_role_of', { name: member.name })}
        onChange={(e) => onChange(member.id, e.target.value as SystemRole)}
        className={cn(FIELD, HAIRLINE, 'pl-8', FOCUS_RING)}
      >
        {ROLES.slice().reverse().map((r) => (
          <option key={r} value={r}>{t(`team_role_short_${r}`)}</option>
        ))}
      </select>
      <IconChevronDown size={14} aria-hidden="true" className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500" />
    </div>
  );
}

export function ManagerSelect({
  member,
  team,
  onChange,
}: {
  member: UserProfile;
  team: UserProfile[];
  onChange: (id: string, managerId: string) => void;
}) {
  const { t } = useTranslation();
  const candidates = team.filter((m) => m.id !== member.id && (m.system_role === 'manager' || m.system_role === 'admin'));
  return (
    <div className="relative">
      <select
        value={member.manager_id || ''}
        aria-label={t('team_aria_manager_of', { name: member.name })}
        onChange={(e) => onChange(member.id, e.target.value)}
        className={cn(FIELD, HAIRLINE, 'pl-2.5', FOCUS_RING)}
      >
        <option value="">{t('team_no_manager')}</option>
        {candidates.map((m) => (
          <option key={m.id} value={m.id}>{m.name}</option>
        ))}
      </select>
      <IconChevronDown size={14} aria-hidden="true" className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500" />
    </div>
  );
}

/** Lecture seule (non administrateur) : le glyphe et le libellé, sans contrôle. */
export function RoleReadout({ role }: { role: SystemRole }) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-center gap-2 text-sm text-zinc-900 dark:text-zinc-100">
      <RoleGlyph role={role} />
      {t(`team_role_short_${role}`, { defaultValue: role })}
    </span>
  );
}

export function ManagerReadout({ member, team }: { member: UserProfile; team: UserProfile[] }) {
  const { t } = useTranslation();
  const manager = team.find((m) => m.id === member.manager_id);
  return (
    <span className="text-sm text-zinc-700 dark:text-zinc-300">
      {manager ? manager.name : <span className="text-zinc-400 dark:text-zinc-500">{t('team_no_manager')}</span>}
    </span>
  );
}
