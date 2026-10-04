import { useCallback, useEffect, useRef } from 'react';
import { UndoableDeleteQueue, UNDO_DELETE_DELAY_MS } from '../lib/undoableDelete';
import type { ToastAction } from './useToastWithUndo';

type ShowToast = (
  message: string,
  type?: 'success' | 'error',
  opts?: { duration?: number; action?: ToastAction },
) => void;

interface UndoableDeleteOptions {
  /** Message affiché pendant le délai d'annulation (« Note supprimée. »). */
  message: string;
  /** Libellé du bouton d'annulation. */
  undoLabel: string;
  /** Message affiché après un appui sur « Annuler ». */
  undoneMessage: string;
  /** Message affiché si le serveur refuse la suppression. */
  failureMessage: string;
  /** Retire l'élément de l'écran (appelé tout de suite). */
  remove: () => void;
  /** Remet l'élément à l'écran (annulation ou refus du serveur). */
  restore: () => void;
  /**
   * Requête de suppression ; rend la réponse HTTP. À envoyer avec
   * `keepalive: true` : une suppression validée à la fermeture de l'onglet
   * doit aboutir quand même.
   */
  request: () => Promise<Response>;
}

/** Suppression annulable branchée sur le toast de la page (`useToastWithUndo`). */
export function useUndoableDelete(showToast: ShowToast) {
  const queueRef = useRef<UndoableDeleteQueue | null>(null);
  if (!queueRef.current) queueRef.current = new UndoableDeleteQueue();

  useEffect(() => {
    const queue = queueRef.current!;
    const onPageHide = () => { void queue.flush(); };
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      // Quitter l'écran valide la suppression demandée, jamais ne l'oublie.
      void queue.flush();
    };
  }, []);

  return useCallback((opts: UndoableDeleteOptions) => {
    const queue = queueRef.current!;
    opts.remove();
    queue.schedule({
      commit: async () => (await opts.request()).ok,
      restore: opts.restore,
      onFailure: () => showToast(opts.failureMessage, 'error', { duration: 6000 }),
    });
    showToast(opts.message, 'success', {
      duration: UNDO_DELETE_DELAY_MS,
      action: {
        label: opts.undoLabel,
        onClick: () => { if (queue.undo()) showToast(opts.undoneMessage, 'success', { duration: 2500 }); },
      },
    });
  }, [showToast]);
}
