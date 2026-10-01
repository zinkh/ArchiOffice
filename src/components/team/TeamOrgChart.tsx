import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import type { UserProfile } from '../../services/userService';
import type { MemberViewProps } from './memberViewTypes';
import { Avatar, FOCUS_RING, HAIRLINE, MONO_LABEL, RoleGlyph } from './teamShared';

interface Branch {
  member: UserProfile;
  children: Branch[];
}

/** Arbre des responsables. Les cycles (A responsable de B et B de A) sont coupés : un membre n'apparaît qu'une fois. */
function buildForest(team: UserProfile[]): Branch[] {
  const ids = new Set(team.map((m) => m.id));
  const kids = new Map<string, UserProfile[]>();
  const roots: UserProfile[] = [];
  for (const m of team) {
    if (m.manager_id && ids.has(m.manager_id) && m.manager_id !== m.id) {
      kids.set(m.manager_id, [...(kids.get(m.manager_id) ?? []), m]);
    } else {
      roots.push(m);
    }
  }
  const seen = new Set<string>();
  const grow = (m: UserProfile): Branch => {
    seen.add(m.id);
    return { member: m, children: (kids.get(m.id) ?? []).filter((c) => !seen.has(c.id)).map(grow) };
  };
  const forest = roots.map(grow);
  for (const m of team) if (!seen.has(m.id)) forest.push(grow(m));
  return forest;
}

function Node({ branch, highlightId, memberRefs, depth }: { branch: Branch } & Pick<MemberViewProps, 'highlightId' | 'memberRefs'> & { depth: number }) {
  const { t } = useTranslation();
  const { member } = branch;
  const highlighted = member.id === highlightId;
  return (
    <li
      className={cn(
        'relative',
        depth > 0 &&
          'pl-4 sm:pl-6 before:absolute before:bottom-0 before:left-0 before:top-0 before:border-l before:border-zinc-400 last:before:bottom-auto last:before:h-[1.625rem] after:absolute after:left-0 after:top-[1.625rem] after:w-3 sm:after:w-5 after:border-t after:border-zinc-400 dark:before:border-zinc-600 dark:after:border-zinc-600',
      )}
    >
      <Link
        to={`/profile/${member.id}`}
        ref={(el) => { memberRefs.current[member.id] = el; }}
        aria-current={highlighted ? 'true' : undefined}
        className={cn(
          'my-1 inline-flex min-w-0 max-w-full items-center gap-3 border bg-white py-1.5 pl-1.5 pr-4 transition-colors duration-100 dark:bg-zinc-900',
          highlighted ? 'border-zinc-900 outline-2 outline-offset-2 outline-zinc-900 dark:border-white dark:outline-white' : HAIRLINE,
          '[@media(hover:hover)]:hover:border-zinc-900 dark:[@media(hover:hover)]:hover:border-zinc-100',
          FOCUS_RING,
        )}
      >
        <Avatar member={member} size={36} />
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold leading-tight tracking-tight text-zinc-900 dark:text-white">{member.name}</span>
          <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">{member.role || t('team_no_function')}</span>
        </span>
        <RoleGlyph role={member.system_role} className="ml-1 text-zinc-900 dark:text-zinc-100" />
        <span className="sr-only">{t(`team_role_short_${member.system_role}`)}</span>
      </Link>
      {branch.children.length > 0 && (
        <ul className={cn(depth === 0 ? 'ml-3 sm:ml-5' : 'ml-0')}>
          {branch.children.map((c) => (
            <Node key={c.member.id} branch={c} highlightId={highlightId} memberRefs={memberRefs} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function TeamOrgChart({ team, highlightId, memberRefs }: Pick<MemberViewProps, 'team' | 'highlightId' | 'memberRefs'>) {
  const { t } = useTranslation();
  const forest = buildForest(team);
  const rooted = forest.filter((b) => !b.member.manager_id || !team.some((m) => m.id === b.member.manager_id));
  const withTeam = rooted.filter((b) => b.children.length > 0);
  const alone = rooted.filter((b) => b.children.length === 0);
  const rest = forest.filter((b) => !rooted.includes(b));

  return (
    <div className="min-w-0 overflow-x-auto">
      <p className={cn(MONO_LABEL, 'mb-5')}>{t('team_org_hint')}</p>
      <div className="grid gap-x-10 gap-y-8 lg:grid-cols-2">
        {[...withTeam, ...rest].map((b) => (
          <ul key={b.member.id} className="min-w-0">
            <Node branch={b} highlightId={highlightId} memberRefs={memberRefs} depth={0} />
          </ul>
        ))}
      </div>
      {alone.length > 0 && (
        <div className="mt-10 border-t border-dashed border-zinc-300 pt-4 dark:border-zinc-700">
          <p className={cn(MONO_LABEL, 'mb-3')}>{t('team_org_unassigned')}</p>
          <ul className="flex flex-wrap gap-x-4">
            {alone.map((b) => (
              <Node key={b.member.id} branch={b} highlightId={highlightId} memberRefs={memberRefs} depth={0} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
