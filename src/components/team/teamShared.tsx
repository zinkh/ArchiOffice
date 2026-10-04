import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { cn } from '../../lib/utils';
import type { UserProfile } from '../../services/userService';

export type SystemRole = UserProfile['system_role'];

/** Du plus au moins élevé : sert aussi à trier par niveau d'accès. */
export const ROLES: SystemRole[] = ['admin', 'manager', 'pm', 'user'];

export const ROLE_RANK: Record<SystemRole, number> = { admin: 0, manager: 1, pm: 2, user: 3 };

/**
 * Teinte sémantique Tabler de chaque niveau d'accès. La couleur n'est jamais seule
 * porteuse du sens : le glyphe, la hachure et le libellé disent la même chose.
 */
const ROLE_TONE: Record<SystemRole, string> = {
  admin: 'var(--tblr-primary)',
  manager: 'var(--tblr-warning)',
  pm: 'var(--tblr-success)',
  user: 'var(--tblr-muted)',
};
export const roleTone = (role: SystemRole): string => ROLE_TONE[role];
export const tint = (color: string, pct = 14): string => `color-mix(in srgb, ${color} ${pct}%, transparent)`;

/** Même enveloppe que `.card` (surface, bordure, ombre, rayon), sans son remplissage. */
export const PANEL = 'bg-[var(--tblr-surface)] border border-[var(--tblr-border)] rounded-[var(--tblr-radius)] shadow-[var(--tblr-shadow)]';
/** Libellé de colonne ou de champ : le `.subheader` Tabler, comme sur les autres pages. */
export const MONO_LABEL = 'text-[0.6875rem] font-semibold uppercase tracking-[0.04em] text-[var(--tblr-muted)]';

/** Anneau décalé des boutons et liens. */
export const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--tblr-primary)]';
/** Champs : filet intérieur et halo, comme `.tblr-input:focus`. */
export const FOCUS_FIELD =
  'focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-[var(--tblr-primary)] focus-visible:border-[var(--tblr-primary)] focus-visible:shadow-[0_0_0_3px_var(--tblr-primary-lt)]';

/** Pastille de couleur du niveau d'accès. Le libellé qui l'accompagne porte le sens, la couleur seule ne suffit jamais. */
export function RoleGlyph({ role, size = 14, className }: { role: SystemRole; size?: number; className?: string }) {
  const d = Math.max(6, Math.round(size / 2));
  return (
    <span
      aria-hidden="true"
      style={{ width: d, height: d, backgroundColor: roleTone(role) }}
      className={cn('inline-block shrink-0 rounded-full', className)}
    />
  );
}

/** Pastille de rôle : le `tblr-badge` Tabler, teinte du niveau d'accès. */
export function RoleBadge({ role, label }: { role: SystemRole; label: string }) {
  return (
    <span className="tblr-badge gap-1.5" style={{ backgroundColor: tint(roleTone(role), 14), color: role === 'user' ? 'var(--tblr-muted)' : `color-mix(in srgb, ${roleTone(role)} 70%, var(--tblr-text))` }}>
      <RoleGlyph role={role} size={12} />
      {label}
    </span>
  );
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const letters = parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0];
  return letters.toUpperCase();
}

/** Avatar rond : la photo si elle existe, sinon les initiales sur fond primaire clair. */
export function Avatar({ member, size = 40 }: { member: Pick<UserProfile, 'name' | 'avatar'>; size?: number }) {
  return (
    <span
      style={{ width: size, height: size, fontSize: Math.max(11, Math.round(size * 0.36)) }}
      className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--tblr-primary-lt)] font-semibold text-[var(--tblr-primary)]"
    >
      {member.avatar ? <img src={member.avatar} alt="" className="h-full w-full object-cover" /> : initialsOf(member.name)}
    </span>
  );
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => (typeof window === 'undefined' ? false : window.matchMedia(query).matches));
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}
