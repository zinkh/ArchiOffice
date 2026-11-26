import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { launchOriginRef } from '../../lib/launchOrigin';
import { useEscapeKey } from '../../hooks/useEscapeKey';

export interface ConfirmOptions {
  title: string;
  /** Détail sous le titre : texte ou contenu (récapitulatif de montants...). */
  message?: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  /** `danger` pour une suppression : le focus part alors sur « Annuler ». */
  tone?: 'danger' | 'primary';
  /**
   * Choix supplémentaires, entre « Annuler » et la validation (qui reste le choix principal). Un choix se lit
   * avec `choose()` : `confirm()` ne rend que vrai pour la validation, faux pour tout autre bouton.
   */
  alternatives?: { id: string; label: string }[];
}

interface PendingConfirm extends ConfirmOptions {
  /** `confirm` pour la validation, `cancel` pour l'annulation, sinon l'identifiant de l'alternative choisie. */
  resolve: (choice: string) => void;
}

/**
 * Confirmation dans une fenêtre de l'application, à la place de
 * `window.confirm()` : même voile, même Échap et même charte que les autres
 * fenêtres de la fiche, et un contenu riche quand l'enjeu le demande (montants
 * d'une facture). `confirm()` rend une promesse résolue par le choix.
 */
export function useConfirmDialog() {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const confirm = useCallback(
    (opts: ConfirmOptions) => new Promise<boolean>(resolve => setPending({ ...opts, resolve: choice => resolve(choice === 'confirm') })),
    [],
  );

  /** Comme `confirm`, mais rend le choix : `confirm`, `cancel` ou l'identifiant d'une alternative. */
  const choose = useCallback(
    (opts: ConfirmOptions) => new Promise<string>(resolve => setPending({ ...opts, resolve })),
    [],
  );

  const close = useCallback((choice: string) => {
    setPending(prev => {
      prev?.resolve(choice);
      return null;
    });
  }, []);

  const dialog = <ConfirmDialog pending={pending} onClose={close} />;
  return { confirm, choose, dialog };
}

function ConfirmDialog({ pending, onClose }: { pending: PendingConfirm | null; onClose: (choice: string) => void }) {
  const titleId = useId();
  const messageId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const isOpen = !!pending;

  useEscapeKey(isOpen, () => onClose('cancel'));

  // Focus sur le choix sans risque : « Annuler » pour une suppression, la
  // validation sinon. L'élément qui avait le focus le retrouve à la fermeture.
  useEffect(() => {
    if (!pending) return;
    const previous = document.activeElement as HTMLElement | null;
    const target = pending.tone === 'danger' ? cancelRef.current : confirmRef.current;
    target?.focus();
    return () => { previous?.focus?.(); };
  }, [pending]);

  // Le focus reste dans la fenêtre : Tab passe d'un bouton à l'autre.
  const trapFocus = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const first = cancelRef.current;
    const last = confirmRef.current;
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  const danger = pending?.tone === 'danger';

  return (
    <AnimatePresence>
      {pending && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50" onClick={() => onClose('cancel')}>
          <motion.div
            ref={launchOriginRef}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={pending.message ? messageId : undefined}
            onKeyDown={trapFocus}
            onClick={e => e.stopPropagation()}
            initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
            className="w-full max-w-md rounded-lg shadow-2xl p-6"
            style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}
          >
            <h3 id={titleId} className="text-base font-bold" style={{ color: 'var(--tblr-text)' }}>{pending.title}</h3>
            {pending.message && (
              <div id={messageId} className="mt-2 text-sm leading-relaxed" style={{ color: 'var(--tblr-muted)' }}>
                {pending.message}
              </div>
            )}
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                ref={cancelRef}
                type="button"
                onClick={() => onClose('cancel')}
                className="h-9 px-4 rounded-lg text-sm font-medium border transition-colors hover:bg-[var(--tblr-surface-2)] outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' }}
              >
                {pending.cancelLabel}
              </button>
              {pending.alternatives?.map(alternative => (
                <button
                  key={alternative.id}
                  type="button"
                  onClick={() => onClose(alternative.id)}
                  className="h-9 px-4 rounded-lg text-sm font-medium border transition-colors hover:bg-[var(--tblr-surface-2)] outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  style={{ borderColor: danger ? 'var(--tblr-danger)' : 'var(--tblr-border)', color: danger ? 'var(--tblr-danger)' : 'var(--tblr-text)' }}
                >
                  {alternative.label}
                </button>
              ))}
              <button
                ref={confirmRef}
                type="button"
                onClick={() => onClose('confirm')}
                className="h-9 px-4 rounded-lg text-sm font-semibold text-white transition-opacity hover:opacity-90 outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-500"
                style={{ background: danger ? 'var(--tblr-danger)' : 'var(--tblr-primary)' }}
              >
                {pending.confirmLabel}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
