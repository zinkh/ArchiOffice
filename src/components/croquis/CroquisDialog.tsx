import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { IconLoader2, IconX } from '@tabler/icons-react';
import { useCroquisSession } from '../../hooks/useCroquisSession';
import type { Croquis } from '../../types';
import CroquisEditor from './CroquisEditor';

interface CroquisDialogProps {
  row: Croquis;
  /** Consultation seule (affaire archivée) : on peut déplacer la vue et exporter, pas dessiner. */
  readOnly?: boolean;
  onClose: () => void;
}

/**
 * L'éditeur de croquis en plein écran. Monté à la racine de la page (portail), comme `ModalShell` : un parent
 * transformé ou filtré donnerait à un élément `fixed` la taille du parent au lieu de celle de l'écran.
 *
 * Pas de fermeture par Échap : la touche sert déjà à désélectionner dans l'éditeur, et une fermeture
 * accidentelle au milieu d'un tracé serait pire que de devoir cliquer « Fermer ». Fermer enregistre tout de suite
 * et prépare l'aperçu ; si cela échoue, le brouillon local et la file gardent ce qui n'est pas parti.
 */
export default function CroquisDialog({ row, readOnly = false, onClose }: CroquisDialogProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const session = useCroquisSession(row);
  const [closing, setClosing] = useState(false);

  // Le focus entre dans la fenêtre et revient au déclencheur ; la page derrière ne défile plus.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    rootRef.current?.focus({ preventScroll: true });
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus?.({ preventScroll: true });
    };
  }, []);

  const close = async () => {
    if (closing) return;
    setClosing(true);
    if (!readOnly) {
      try {
        await session.finish();
      } catch {
        /* le brouillon local et la file d'écritures gardent ce qui n'est pas parti */
      }
    }
    onClose();
  };

  return createPortal(
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex flex-col bg-white outline-none"
    >
      <header
        className="flex shrink-0 items-center justify-between gap-3 border-b border-neutral-200 bg-neutral-50 px-3 pb-2 sm:px-4"
        style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}
      >
        <h2 id={titleId} className="min-w-0 truncate text-sm font-semibold text-neutral-900">
          {row.title}
        </h2>
        <button
          type="button"
          onClick={() => { void close(); }}
          disabled={closing}
          className="inline-flex h-11 shrink-0 items-center gap-2 rounded-lg border border-neutral-300 bg-white px-3 text-sm font-medium text-neutral-900 hover:border-neutral-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 disabled:opacity-60"
        >
          {closing ? <IconLoader2 size={18} className="animate-spin" aria-hidden /> : <IconX size={18} aria-hidden />}
          {t('croquis_close')}
        </button>
      </header>

      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-0" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
          {session.ready ? (
            <CroquisEditor
              key={row.id}
              initialScene={session.initialScene}
              onSceneChange={session.onSceneChange}
              background={session.background}
              bgOpacity={session.bgOpacity}
              onBgOpacityChange={session.onBgOpacityChange}
              onBackgroundImport={session.onBackgroundImport}
              onBackgroundClear={session.onBackgroundClear}
              readOnly={readOnly}
              statusLabel={session.statusLabel}
              exportFileName={`${row.title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'croquis'}.png`}
            />
          ) : (
            <div className="grid h-full place-items-center text-sm text-neutral-500" role="status" aria-live="polite">
              <span className="inline-flex items-center gap-2">
                <IconLoader2 size={18} className="animate-spin" aria-hidden />
                {t('croquis_loading')}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
