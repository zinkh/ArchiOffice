import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { IconX, IconChevronLeft, IconChevronRight, IconExternalLink } from '@tabler/icons-react';
import { openSignedUrl } from '../../lib/signedStorageUrl';
import type { ReservePhoto } from '../../types';
import { ReservePhotoImage } from './reserveShared';

interface ReservePhotoViewerProps {
  photos: ReservePhoto[];
  /** Position de la photo affichée dans `photos`. */
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}

/** Distance horizontale (px) à partir de laquelle un glissement du doigt change de photo. */
const SEUIL_GLISSEMENT = 50;

/**
 * La photo d'une réserve en grand, dans une fenêtre au-dessus de la fiche : plus d'onglet à fermer, et
 * les flèches (ou les touches ← →, ou un glissement du doigt) passent d'une photo de la réserve à l'autre.
 * Échap ferme la visionneuse seule, la fiche reste ouverte dessous. La photo affichée est toujours le
 * fichier complet, jamais la miniature de la grille ; une photo pas encore envoyée montre son aperçu local.
 */
export function ReservePhotoViewer({ photos, index, onIndexChange, onClose }: ReservePhotoViewerProps) {
  const { t } = useTranslation();
  const total = photos.length;
  const courant = Math.min(Math.max(index, 0), Math.max(total - 1, 0));
  const photo = photos[courant];
  const departX = useRef<number | null>(null);

  const aller = useCallback((delta: -1 | 1) => {
    const cible = courant + delta;
    if (cible >= 0 && cible < total) onIndexChange(cible);
  }, [courant, total, onIndexChange]);

  // Pas de photo (la dernière vient d'être retirée) : la visionneuse n'a plus rien à montrer.
  useEffect(() => { if (!photo) onClose(); }, [photo, onClose]);

  useEffect(() => {
    // En phase de capture et en stoppant la propagation : la fiche dessous ne doit ni se fermer ni changer de réserve.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); aller(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); aller(1); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [aller, onClose]);

  if (!photo) return null;

  const boutonRond = 'flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 disabled:opacity-30 disabled:hover:bg-white/10';

  return (
    <div
      className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/90 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('reserve_photo_viewer_label')}
      onClick={onClose}
      onTouchStart={e => { departX.current = e.touches[0]?.clientX ?? null; }}
      onTouchEnd={e => {
        const depart = departX.current;
        departX.current = null;
        const fin = e.changedTouches[0]?.clientX;
        if (depart == null || fin == null || Math.abs(fin - depart) < SEUIL_GLISSEMENT) return;
        aller(fin < depart ? 1 : -1);
      }}
    >
      <div className="absolute top-3 left-4 right-4 flex items-center justify-between gap-3 text-white" onClick={e => e.stopPropagation()}>
        <span className="text-sm font-bold tabular-nums" aria-live="polite">{courant + 1} / {total}</span>
        <div className="flex items-center gap-2">
          {!photo.pendingSync && (
            <button
              type="button"
              onClick={() => { void openSignedUrl(photo.file_url); }}
              className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-2 text-xs font-bold hover:bg-white/20"
              title={t('reserve_photo_viewer_open_tab')}
            >
              <IconExternalLink size={14} /> {t('reserve_photo_viewer_open_tab')}
            </button>
          )}
          <button type="button" onClick={onClose} className={boutonRond} aria-label={t('reserve_photo_viewer_close')}>
            <IconX size={20} />
          </button>
        </div>
      </div>

      {total > 1 && (
        <>
          <button
            type="button"
            onClick={e => { e.stopPropagation(); aller(-1); }}
            disabled={courant === 0}
            className={`${boutonRond} absolute left-3 top-1/2 -translate-y-1/2`}
            aria-label={t('reserve_photo_viewer_previous')}
          >
            <IconChevronLeft size={24} />
          </button>
          <button
            type="button"
            onClick={e => { e.stopPropagation(); aller(1); }}
            disabled={courant === total - 1}
            className={`${boutonRond} absolute right-3 top-1/2 -translate-y-1/2`}
            aria-label={t('reserve_photo_viewer_next')}
          >
            <IconChevronRight size={24} />
          </button>
        </>
      )}

      <div className="flex max-h-full max-w-full items-center justify-center" onClick={e => e.stopPropagation()}>
        {photo.pendingSync ? (
          <img src={photo.localPreviewUrl} alt={photo.caption || t('reserve_photo_alt')} className="max-h-[82dvh] max-w-full rounded-lg object-contain" />
        ) : (
          <ReservePhotoImage
            key={photo.id}
            photo={photo}
            full
            alt={photo.caption || t('reserve_photo_alt')}
            className="max-h-[82dvh] max-w-full rounded-lg object-contain"
          />
        )}
      </div>
      {photo.caption && <p className="mt-3 text-center text-sm text-white/70" onClick={e => e.stopPropagation()}>{photo.caption}</p>}
    </div>
  );
}

export default ReservePhotoViewer;
