import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useEscapeKey } from '../../hooks/useEscapeKey';

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  /** Nom de la feuille, annoncé par un lecteur d'écran et affiché en tête. */
  title: string;
  children: ReactNode;
}

/**
 * Feuille ancrée au bas de l'écran pour choisir parmi une liste, au pouce.
 * Voile partagé `bg-black/50`, rôle `dialog`, Échap et appui sur le voile
 * ferment ; le focus passe sur l'entrée sélectionnée (`aria-current` ou
 * `aria-selected`), à défaut sur la première.
 */
export function BottomSheet({ open, onClose, title, children }: BottomSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  useEscapeKey(open, onClose);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const target =
      panel?.querySelector<HTMLElement>('[aria-current="true"], [aria-selected="true"]') ??
      panel?.querySelector<HTMLElement>('button');
    target?.focus();
    return () => previous?.focus?.();
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end bg-black/50" onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={e => e.stopPropagation()}
        className="w-full max-h-[80dvh] overflow-y-auto rounded-t-2xl border-t shadow-xl"
        style={{
          background: 'var(--tblr-surface)',
          borderColor: 'var(--tblr-border)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        <div className="sticky top-0 z-10 px-4 pt-2 pb-2" style={{ background: 'var(--tblr-surface)' }}>
          <div aria-hidden className="mx-auto mb-2 h-1 w-10 rounded-full" style={{ background: 'var(--tblr-border)' }} />
          <h2 className="text-[0.6875rem] font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{title}</h2>
        </div>
        <div className="px-2 pb-3">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/** Rangée d'une feuille : cible de 44 px, repère de l'entrée en cours. */
export function SheetOption({
  selected, onSelect, children, trailing, indent,
}: {
  selected: boolean;
  onSelect: () => void;
  children: ReactNode;
  trailing?: ReactNode;
  indent?: boolean;
}) {
  return (
    <button
      type="button"
      aria-current={selected ? 'true' : undefined}
      onClick={onSelect}
      className={`w-full min-h-11 flex items-center gap-3 rounded-lg px-3 py-2 text-left text-[0.9375rem] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-500 hover:bg-[var(--tblr-surface-2)] ${indent ? 'pl-9' : ''} ${selected ? 'font-semibold' : 'font-medium'}`}
      style={{
        color: selected ? 'var(--tblr-text)' : 'var(--tblr-muted)',
        background: selected ? 'var(--tblr-primary-lt)' : undefined,
      }}
    >
      {children}
      {trailing && <span className="ml-auto shrink-0">{trailing}</span>}
    </button>
  );
}
