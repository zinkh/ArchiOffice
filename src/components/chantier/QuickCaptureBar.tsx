import React from 'react';
import { IconCamera, IconPlus } from '@tabler/icons-react';
import { PhotoSourcePicker } from '../PhotoSourcePicker';

/**
 * Les deux gestes du chantier à portée de pouce : noter une observation, prendre
 * une photo (qui crée l'observation à laquelle elle se rattache). Téléphone
 * seulement : au bureau, les boutons des sections suffisent.
 */
export function QuickCaptureBar({ onAddObservation, onCapturePhoto }: {
  onAddObservation: () => void;
  onCapturePhoto: (file: File) => void;
}) {
  return (
    <div
      className="md:hidden fixed inset-x-0 bottom-0 z-30 flex gap-2 border-t px-3 pt-2"
      style={{
        background: 'var(--tblr-surface)',
        borderColor: 'var(--tblr-border)',
        paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom, 0px))',
      }}
    >
      <button
        type="button"
        onClick={onAddObservation}
        className="flex-1 min-h-12 flex items-center justify-center gap-2 rounded-lg bg-[var(--tblr-primary)] text-white text-sm font-bold active:scale-[0.98] transition-transform"
      >
        <IconPlus size={18} /> Observation
      </button>
      {/* Appareil photo OU pellicule, au choix (PhotoSourcePicker). */}
      <PhotoSourcePicker accept="image/*" onFiles={files => onCapturePhoto(files[0])}>
        {open => (
          <button
            type="button"
            onClick={open}
            className="flex-1 min-h-12 flex items-center justify-center gap-2 rounded-lg border text-sm font-bold active:scale-[0.98] transition-transform"
            style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' }}
          >
            <IconCamera size={18} /> Photo
          </button>
        )}
      </PhotoSourcePicker>
    </div>
  );
}
