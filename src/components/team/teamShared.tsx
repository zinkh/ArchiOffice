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

/** Trait de planche : bleu primaire atténué (les cotes et cadres du dessin). */
export const INK_LINE = 'border-[var(--tblr-primary)]/45';
export const HAIRLINE = 'border-[var(--tblr-border)]';
export const SURFACE = 'bg-[var(--tblr-surface)]';
/** Même enveloppe que `.card` (surface, bordure, ombre, rayon), sans son remplissage. */
export const PANEL = 'bg-[var(--tblr-surface)] border border-[var(--tblr-border)] rounded-[var(--tblr-radius)] shadow-[var(--tblr-shadow)]';
export const TEXT = 'text-[var(--tblr-text)]';
export const TEXT_SOFT = 'text-zinc-600 dark:text-zinc-400';
export const MONO_LABEL = 'font-mono text-[0.6875rem] uppercase tracking-[0.08em] text-zinc-600 dark:text-zinc-400';

/** Anneau décalé des boutons et liens. */
export const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--tblr-primary)]';
/** Champs : filet intérieur et halo, comme `.tblr-input:focus`. */
export const FOCUS_FIELD =
  'focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-[var(--tblr-primary)] focus-visible:border-[var(--tblr-primary)] focus-visible:shadow-[0_0_0_3px_var(--tblr-primary-lt)]';

/**
 * Chaque niveau a sa hachure, comme les matériaux d'une coupe : vide, traits,
 * croisillons, plein. Elle prend la teinte courante (`color`).
 */
export function hatchStyle(role: SystemRole): CSSProperties {
  const color = roleTone(role);
  switch (role) {
    case 'admin':
      return { color, backgroundColor: 'currentColor' };
    case 'manager':
      return {
        color,
        backgroundColor: tint(color, 10),
        backgroundImage:
          'repeating-linear-gradient(45deg, currentColor 0 1px, transparent 1px 4px), repeating-linear-gradient(-45deg, currentColor 0 1px, transparent 1px 4px)',
      };
    case 'pm':
      return { color, backgroundColor: tint(color, 10), backgroundImage: 'repeating-linear-gradient(45deg, currentColor 0 1px, transparent 1px 4px)' };
    default:
      return { color, backgroundColor: tint(color, 10) };
  }
}

export function RoleGlyph({ role, size = 14, className }: { role: SystemRole; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.25}
      shapeRendering="crispEdges"
      aria-hidden="true"
      style={{ color: roleTone(role) }}
      className={cn('shrink-0', className)}
    >
      {role === 'admin' ? (
        <>
          <rect x="1" y="1" width="12" height="12" fill="currentColor" />
          <rect x="4" y="4" width="6" height="6" stroke="var(--tblr-surface)" />
        </>
      ) : (
        <rect x="1" y="1" width="12" height="12" />
      )}
      {role === 'pm' && <path d="M1 13 13 1" />}
      {role === 'manager' && <path d="M1 1l12 12M13 1 1 13" />}
    </svg>
  );
}

/** Pastille de rôle : glyphe, libellé, fond teinté (le style des `tblr-badge`). */
export function RoleBadge({ role, label }: { role: SystemRole; label: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-[var(--tblr-radius)] px-2 py-0.5 text-xs font-medium text-[var(--tblr-text)]"
      style={{ backgroundColor: tint(roleTone(role), 14) }}
    >
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

/** Monogramme : une photo reste en couleur, sans photo on garde les initiales sur une trame primaire. */
export function Avatar({ member, size = 40 }: { member: Pick<UserProfile, 'name' | 'avatar'>; size?: number }) {
  return (
    <span
      style={{ width: size, height: size }}
      className="relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[var(--tblr-radius)] border border-[var(--tblr-border)] bg-[var(--tblr-primary-lt)] text-[var(--tblr-primary)]"
    >
      {member.avatar ? (
        <img src={member.avatar} alt="" className="h-full w-full object-cover" />
      ) : (
        <>
          <span
            aria-hidden="true"
            className="absolute inset-0 opacity-[0.16]"
            style={{ backgroundImage: 'repeating-linear-gradient(135deg, currentColor 0 1px, transparent 1px 5px)' }}
          />
          <span className="relative font-mono font-medium tracking-tight" style={{ fontSize: Math.max(11, Math.round(size * 0.34)) }}>
            {initialsOf(member.name)}
          </span>
        </>
      )}
    </span>
  );
}

/** Repères de coupe aux quatre angles d'une planche. */
export function CropMarks() {
  const base = 'pointer-events-none absolute h-2 w-2 border-[var(--tblr-primary)]';
  return (
    <>
      <span aria-hidden="true" className={cn(base, '-left-px -top-px border-l border-t')} />
      <span aria-hidden="true" className={cn(base, '-right-px -top-px border-r border-t')} />
      <span aria-hidden="true" className={cn(base, '-bottom-px -left-px border-b border-l')} />
      <span aria-hidden="true" className={cn(base, '-bottom-px -right-px border-b border-r')} />
    </>
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
