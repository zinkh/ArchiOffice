import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconCheck } from '@tabler/icons-react';
import { cn } from '../../../lib/utils';
import { isHeading, isSeparator, type ToolbarMenuEntry } from './proToolbar';

interface ToolbarMenuProps {
  /** Entrées, ou fonction qui les calcule à l'ouverture (menu de ligne). */
  entries: ToolbarMenuEntry[] | (() => ToolbarMenuEntry[]);
  /** Exécute l'entrée choisie (ProTab la relit dans la dernière version des actions). */
  onSelect: (entry: Extract<ToolbarMenuEntry, { onClick: () => void }>) => void;
  /** Contenu du bouton déclencheur. */
  trigger: React.ReactNode;
  triggerClassName?: string;
  triggerStyle?: React.CSSProperties;
  /** Nom accessible du déclencheur quand il ne montre qu'une icône. */
  ariaLabel?: string;
  title?: string;
  align?: 'start' | 'end';
  /** Rappelé à l'ouverture, ex. pour sélectionner la ligne d'un menu de ligne. */
  onOpen?: () => void;
}

const MENU_WIDTH = 288;
const GAP = 4;

/**
 * Menu déroulant au motif ARIA « menu button » : flèches, Début, Fin, Échap
 * (rend le focus au déclencheur), clic extérieur et Tab ferment. Le panneau est
 * posé en position fixe dans <body> : un menu de ligne vit dans un tableau à
 * défilement qui le couperait sinon. Il se retourne vers le haut quand la
 * place manque en bas de l'écran, et se ferme quand la page défile.
 */
export function ToolbarMenu({
  entries, onSelect, trigger, triggerClassName, triggerStyle, ariaLabel, title, align = 'start', onOpen,
}: ToolbarMenuProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }, []);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(MENU_WIDTH, vw - 16);
    let left = align === 'end' ? r.right - width : r.left;
    left = Math.max(8, Math.min(left, vw - width - 8));
    const below = vh - r.bottom;
    setPos(below < 280 && r.top > below
      ? { bottom: vh - r.top + GAP, left }
      : { top: r.bottom + GAP, left });
  }, [open, align]);

  // Focus sur la première entrée active à l'ouverture.
  useEffect(() => {
    if (!open || !pos) return;
    const items = panelRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]');
    const first = Array.from(items ?? []).find(el => el.getAttribute('aria-disabled') !== 'true') ?? items?.[0];
    first?.focus();
  }, [open, pos]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close(false);
    };
    const onScroll = (e: Event) => {
      if (panelRef.current?.contains(e.target as Node)) return;
      close(false);
    };
    const onResize = () => close(false);
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open, close]);

  const onPanelKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role^="menuitem"]'));
    const index = items.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (e.key === 'ArrowDown') next = (index + 1) % items.length;
    else if (e.key === 'ArrowUp') next = (index - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); return; }
    else if (e.key === 'Tab') { close(false); return; }
    if (next === -1) return;
    e.preventDefault();
    items[next]?.focus();
  };

  const toggle = () => {
    if (!open) onOpen?.();
    setPos(null);
    setOpen(v => !v);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={ariaLabel}
        title={title}
        onClick={toggle}
        onKeyDown={e => {
          if (e.key === 'ArrowDown' && !open) { e.preventDefault(); toggle(); }
        }}
        className={triggerClassName}
        style={triggerStyle}
      >
        {trigger}
      </button>
      {open && pos && createPortal(
        <div
          ref={panelRef}
          id={menuId}
          role="menu"
          aria-label={ariaLabel ?? (typeof trigger === 'string' ? trigger : undefined)}
          onKeyDown={onPanelKeyDown}
          className="fixed z-[60] py-1 rounded-lg border max-h-[min(70dvh,32rem)] overflow-y-auto text-sm"
          style={{
            ...pos,
            width: Math.min(MENU_WIDTH, window.innerWidth - 16),
            background: 'var(--tblr-surface)',
            borderColor: 'var(--tblr-border)',
            color: 'var(--tblr-text)',
            boxShadow: '0 8px 24px rgba(29,39,59,.16)',
          }}
        >
          {(typeof entries === 'function' ? entries() : entries).map(entry => {
            if (isSeparator(entry)) {
              return <div key={entry.id} role="separator" className="my-1 border-t" style={{ borderColor: 'var(--tblr-border)' }} />;
            }
            if (isHeading(entry)) {
              return (
                <div key={entry.id} role="presentation" className="px-3 pt-2 pb-1 text-[0.6875rem] font-semibold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>
                  {entry.heading}
                </div>
              );
            }
            const role = entry.checked === undefined ? 'menuitem' : 'menuitemcheckbox';
            return (
              <div
                key={entry.id}
                role={role}
                tabIndex={-1}
                aria-checked={entry.checked === undefined ? undefined : entry.checked}
                aria-disabled={entry.disabled || undefined}
                aria-keyshortcuts={entry.shortcut ? entry.shortcut.replace(/ /g, '') : undefined}
                title={entry.hint}
                onClick={() => {
                  if (entry.disabled) return;
                  close(true);
                  onSelect(entry);
                }}
                onKeyDown={e => {
                  if (e.key !== 'Enter' && e.key !== ' ') return;
                  e.preventDefault();
                  if (entry.disabled) return;
                  close(true);
                  onSelect(entry);
                }}
                className={cn(
                  'mx-1 flex items-center gap-2.5 px-2.5 min-h-9 pointer-coarse:min-h-11 rounded-md outline-none select-none',
                  entry.disabled ? 'opacity-45 cursor-not-allowed' : 'cursor-pointer hover:bg-[var(--tblr-surface-2)] focus:bg-[var(--tblr-primary-lt)]',
                )}
                style={entry.danger && !entry.disabled ? { color: 'var(--tblr-danger)' } : undefined}
              >
                <span className="w-4 shrink-0 flex items-center justify-center" aria-hidden>
                  {entry.checked ? <IconCheck size={16} /> : entry.icon}
                </span>
                <span className="flex-1 min-w-0 truncate">{entry.label}</span>
                {entry.shortcut && (
                  <span className="shrink-0 text-xs font-mono" style={{ color: 'var(--tblr-muted)' }}>{entry.shortcut}</span>
                )}
              </div>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}
