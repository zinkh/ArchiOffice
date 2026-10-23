import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconCamera, IconPhotoPlus, IconX } from '@tabler/icons-react';

/** Un doigt (téléphone, tablette) : c'est là que l'appareil photo a un sens. */
function isTouchDevice(): boolean {
  try {
    return window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

/**
 * Point d'entrée unique pour ajouter des photos. `capture` seul force l'appareil photo
 * sans jamais proposer la pellicule : le choix est donc posé explicitement, avec deux
 * entrées de fichier distinctes (l'une avec `capture`, l'autre sans).
 *
 * - Téléphone ou tablette : une feuille propose « Prendre une photo » ou « Choisir dans
 *   la pellicule ».
 * - Poste de bureau : le sélecteur de fichiers s'ouvre directement (`capture` y est
 *   ignoré, une feuille ne ferait qu'ajouter un clic).
 *
 * `children` reçoit la fonction d'ouverture à brancher sur le ou les boutons.
 */
export function PhotoSourcePicker({
  onFiles,
  multiple = false,
  accept = 'image/*',
  disabled = false,
  children,
}: {
  onFiles: (files: File[]) => void;
  multiple?: boolean;
  accept?: string;
  disabled?: boolean;
  children: (open: () => void) => React.ReactNode;
}) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [sheet, setSheet] = useState(false);

  const open = () => {
    if (disabled) return;
    if (isTouchDevice()) setSheet(true);
    else galleryRef.current?.click();
  };

  const deliver = (input: HTMLInputElement) => {
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (files.length) onFiles(multiple ? files : files.slice(0, 1));
  };

  // `click()` doit partir du geste de l'utilisateur : on déclenche l'entrée AVANT de fermer la feuille.
  const choose = (ref: React.RefObject<HTMLInputElement | null>) => {
    ref.current?.click();
    setSheet(false);
  };

  return (
    <>
      {children(open)}
      <input ref={cameraRef} type="file" accept={accept} capture="environment" className="hidden" tabIndex={-1} aria-hidden
        onChange={e => deliver(e.currentTarget)} />
      <input ref={galleryRef} type="file" accept={accept} multiple={multiple} className="hidden" tabIndex={-1} aria-hidden
        onChange={e => deliver(e.currentTarget)} />
      {sheet && createPortal(
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/50 p-3"
          onClick={() => setSheet(false)} role="presentation">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Ajouter une photo"
            className="w-full max-w-sm rounded-2xl p-3 space-y-2 shadow-2xl"
            style={{
              background: 'var(--tblr-surface)',
              border: '1px solid var(--tblr-border)',
              marginBottom: 'env(safe-area-inset-bottom, 0px)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-1 pb-1">
              <span className="text-sm font-bold" style={{ color: 'var(--tblr-text)' }}>Ajouter une photo</span>
              <button type="button" aria-label="Fermer" onClick={() => setSheet(false)}
                className="p-2 -m-2 min-h-11 min-w-11 flex items-center justify-center" style={{ color: 'var(--tblr-muted)' }}>
                <IconX size={18} />
              </button>
            </div>
            <button type="button" onClick={() => choose(cameraRef)}
              className="w-full min-h-12 flex items-center gap-3 px-4 rounded-xl text-sm font-bold text-left active:scale-[0.99] transition-transform"
              style={{ background: 'var(--tblr-primary)', color: '#fff' }}>
              <IconCamera size={20} /> Prendre une photo
            </button>
            <button type="button" onClick={() => choose(galleryRef)}
              className="w-full min-h-12 flex items-center gap-3 px-4 rounded-xl text-sm font-bold text-left border active:scale-[0.99] transition-transform"
              style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' }}>
              <IconPhotoPlus size={20} /> Choisir dans la pellicule
            </button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
