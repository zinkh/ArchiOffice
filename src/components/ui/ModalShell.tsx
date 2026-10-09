import { useEffect, useId, useRef, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { IconX } from '@tabler/icons-react';
import { launchOriginRef } from '../../lib/launchOrigin';
import { useConfirmDialog } from './ConfirmDialog';
import { cn } from '../../lib/utils';

interface ModalShellProps {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  /** Pendant un enregistrement : Échap, le voile et la croix ne ferment pas. */
  busy?: boolean;
  /** Saisie non enregistrée : fermer demande d'abord une confirmation. */
  dirty?: boolean;
  /** Largeur maximale sur ordinateur. */
  size?: 'md' | 'lg' | 'xl';
  /** Contenu libre à droite du titre. */
  headerActions?: ReactNode;
  /** Bandeau au-dessus du contenu (image, message). Reste fixe au défilement. */
  banner?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  /** Classes du conteneur défilant. */
  bodyClassName?: string;
}

const SIZES = { md: 'sm:max-w-md', lg: 'sm:max-w-3xl', xl: 'sm:max-w-5xl' } as const;

/**
 * Pile des fenêtres ouvertes : seule la plus récente réagit à Échap, sinon une
 * confirmation de suppression ouverte par-dessus une fiche fermerait les deux.
 */
const openModals: symbol[] = [];

/**
 * Coquille commune des fenêtres de saisie (affaires, propositions) :
 * `role="dialog"`, Échap, clic sur le voile, focus rendu à la fermeture,
 * plein écran sur téléphone avec les marges de zone sûre, et confirmation
 * avant de perdre une saisie non enregistrée.
 *
 * À monter comme enfant DIRECT d'un `AnimatePresence` (avec une `key`) pour que
 * la sortie soit animée : le voile est lui-même le `motion.div`.
 */
export function ModalShell({
  title, subtitle, onClose, busy, dirty, size = 'lg', headerActions, banner, footer, children, bodyClassName,
}: ModalShellProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const confirming = useRef(false);
  const { confirm, dialog } = useConfirmDialog();

  // Les props les plus récentes sont lues par le gestionnaire d'Échap, sans
  // réinscrire l'écouteur (donc sans changer sa place dans la pile) à chaque rendu.
  const requestCloseRef = useRef<() => void>(() => {});
  requestCloseRef.current = () => {
    if (busy || confirming.current) return;
    if (!dirty) { onClose(); return; }
    confirming.current = true;
    void confirm({
      title: t('modal_discard_title'),
      message: t('modal_discard_message'),
      confirmLabel: t('modal_discard_confirm'),
      cancelLabel: t('modal_keep_editing'),
      tone: 'danger',
    }).then(discard => {
      confirming.current = false;
      if (discard) onClose();
    });
  };

  useEffect(() => {
    const id = Symbol('modal');
    openModals.push(id);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (openModals[openModals.length - 1] !== id) return;
      requestCloseRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      const i = openModals.indexOf(id);
      if (i >= 0) openModals.splice(i, 1);
    };
  }, []);

  // Le focus entre dans la fenêtre et revient au déclencheur à la fermeture.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus({ preventScroll: true });
    return () => { previous?.focus?.({ preventScroll: true }); };
  }, []);

  const setPanelRef = (el: HTMLDivElement | null) => {
    panelRef.current = el;
    launchOriginRef(el);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center bg-black/50 sm:p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) requestCloseRef.current(); }}
    >
      <motion.div
        ref={setPanelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className={cn(
          'flex flex-col w-full max-h-dvh sm:max-h-[92dvh] sm:rounded-lg shadow-xl overflow-hidden outline-none',
          SIZES[size],
        )}
        style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}
      >
        <div
          className="flex items-start justify-between gap-3 px-4 sm:px-6 py-4 shrink-0"
          style={{
            borderBottom: '1px solid var(--tblr-border)',
            background: 'var(--tblr-surface-2)',
            paddingTop: 'max(1rem, env(safe-area-inset-top))',
          }}
        >
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold truncate" style={{ color: 'var(--tblr-text)' }}>{title}</h2>
            {subtitle && <p className="text-xs mt-0.5" style={{ color: 'var(--tblr-muted)' }}>{subtitle}</p>}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {headerActions}
            <button
              type="button"
              onClick={() => requestCloseRef.current()}
              disabled={busy}
              aria-label={t('modal_close')}
              className="btn btn-ghost p-2 -m-1 disabled:opacity-40"
            >
              <IconX size={20} />
            </button>
          </div>
        </div>
        {banner}
        <div className={cn('flex-1 min-h-0 overflow-y-auto overscroll-contain', bodyClassName)}>{children}</div>
        {footer && (
          <div
            className="flex flex-wrap items-center justify-end gap-2 px-4 sm:px-6 py-3 shrink-0"
            style={{
              borderTop: '1px solid var(--tblr-border)',
              background: 'var(--tblr-surface-2)',
              paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))',
            }}
          >
            {footer}
          </div>
        )}
      </motion.div>
      {dialog}
    </motion.div>
  );
}
