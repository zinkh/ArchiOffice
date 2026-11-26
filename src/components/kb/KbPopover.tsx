// Fenêtre flottante ancrée à un élément (cellule, bouton de barre d'outils) de la « Base de données ».
// Rendue dans <body> : un tableau qui défile ou qui masque son débordement ne la coupe pas.
import { useEffect, useLayoutEffect, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

interface KbPopoverProps {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  /** Nom accessible de la fenêtre. */
  label: string;
  width?: number;
  children: ReactNode;
}

export function KbPopover({ anchorRef, open, onClose, label, width = 260, children }: KbPopoverProps) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({ top: rect.bottom + 4, left: Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - width - 8)) });
  }, [open, width, anchorRef]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onClose);
    return () => { document.removeEventListener('keydown', onKey, true); window.removeEventListener('resize', onClose); };
  }, [open, onClose]);

  if (!open || !pos) return null;
  return createPortal(
    <>
      <div className="fixed inset-0 z-[60]" onMouseDown={onClose} aria-hidden />
      <div
        role="dialog"
        aria-label={label}
        className="fixed z-[61] p-1 rounded-lg border overflow-y-auto"
        style={{
          top: pos.top, left: pos.left, width,
          maxHeight: `calc(100dvh - ${pos.top + 16}px)`,
          background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)', boxShadow: 'var(--tblr-shadow)',
        }}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}
