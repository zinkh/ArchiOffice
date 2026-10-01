import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { cn } from '../../lib/utils';
import type { UserProfile } from '../../services/userService';

export type SystemRole = UserProfile['system_role'];

/** Du plus au moins élevé : sert aussi à trier par niveau d'accès. */
export const ROLES: SystemRole[] = ['admin', 'manager', 'pm', 'user'];

export const ROLE_RANK: Record<SystemRole, number> = { admin: 0, manager: 1, pm: 2, user: 3 };

/** Trait fin, comme une ligne de plan : encre en clair, craie en sombre. */
export const INK_LINE = 'border-zinc-900/80 dark:border-zinc-100/70';
export const HAIRLINE = 'border-zinc-300 dark:border-zinc-700';
export const MONO_LABEL = 'font-mono text-[0.6875rem] uppercase tracking-[0.08em] text-zinc-500 dark:text-zinc-400';
/** Champs : le trait de focus se pose DANS le cadre (double filet), pour se distinguer de l'anneau décalé des boutons. */
export const FOCUS_FIELD =
  'focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-zinc-900 dark:focus-visible:outline-white focus-visible:border-zinc-900 dark:focus-visible:border-white';
export const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:focus-visible:outline-white';

/**
 * Chaque niveau d'accès a sa hachure, comme les matériaux d'une coupe :
 * vide (collaborateur), traits (chef de projet), croisillons (manager),
 * plein (administrateur). La nuance de gris ne porte jamais seule le sens.
 */
export function hatchStyle(role: SystemRole): CSSProperties {
  switch (role) {
    case 'admin':
      return { backgroundColor: 'currentColor' };
    case 'manager':
      return {
        backgroundImage:
          'repeating-linear-gradient(45deg, currentColor 0 1px, transparent 1px 4px), repeating-linear-gradient(-45deg, currentColor 0 1px, transparent 1px 4px)',
      };
    case 'pm':
      return { backgroundImage: 'repeating-linear-gradient(45deg, currentColor 0 1px, transparent 1px 4px)' };
    default:
      return {};
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
      className={cn('shrink-0', className)}
    >
      {role === 'admin' ? (
        <>
          <rect x="1" y="1" width="12" height="12" fill="currentColor" />
          <rect x="4" y="4" width="6" height="6" className="stroke-white dark:stroke-zinc-900" />
        </>
      ) : (
        <rect x="1" y="1" width="12" height="12" />
      )}
      {role === 'pm' && <path d="M1 13 13 1" />}
      {role === 'manager' && <path d="M1 1l12 12M13 1 1 13" />}
    </svg>
  );
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const letters = parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0];
  return letters.toUpperCase();
}

/** Monogramme carré : une photo passe en niveaux de gris, sans photo on garde les initiales sur une trame. */
export function Avatar({ member, size = 40 }: { member: Pick<UserProfile, 'name' | 'avatar'>; size?: number }) {
  const px = { width: size, height: size };
  return (
    <span
      style={px}
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden border bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100',
        INK_LINE,
      )}
    >
      {member.avatar ? (
        <img src={member.avatar} alt="" className="h-full w-full object-cover grayscale" />
      ) : (
        <>
          <span
            aria-hidden="true"
            className="absolute inset-0 opacity-[0.12]"
            style={{ backgroundImage: 'repeating-linear-gradient(135deg, currentColor 0 1px, transparent 1px 5px)' }}
          />
          <span
            className="relative font-mono font-medium tracking-tight"
            style={{ fontSize: Math.max(11, Math.round(size * 0.34)) }}
          >
            {initialsOf(member.name)}
          </span>
        </>
      )}
    </span>
  );
}

/** Repères de coupe aux quatre angles d'une fiche, comme sur une planche. */
export function CropMarks() {
  const base = 'pointer-events-none absolute h-2 w-2 border-zinc-900 dark:border-zinc-100';
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
