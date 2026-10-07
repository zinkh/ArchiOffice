// Légendes des photos choisies avant leur insertion dans une rubrique de
// l'étude de faisabilité (FeasibilityStudy.tsx) : une vignette et un champ de
// légende par photo. L'envoi lui-même est fait par l'écran appelant.
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconX, IconPhoto, IconLoader2 } from '@tabler/icons-react';

export interface PhotoWithCaption { file: File; caption: string }

interface Props {
  files: File[];
  saving: boolean;
  onConfirm: (photos: PhotoWithCaption[]) => void;
  onClose: () => void;
}

export function FeasibilityPhotoDialog({ files, saving, onConfirm, onClose }: Props) {
  const { t } = useTranslation();
  const [captions, setCaptions] = useState<string[]>(() => files.map(() => ''));
  // Aperçus locaux, libérés à la fermeture. Un format illisible (HEIC) n'a pas de vignette.
  const previews = useMemo(() => files.map(f => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach(u => URL.revokeObjectURL(u)), [previews]);

  const inputStyle = { background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={t('feas_photo_title') as string}>
      <div className="rounded-lg shadow-xl w-full max-w-xl max-h-[92dvh] flex flex-col overflow-hidden" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}>
        <div className="p-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--tblr-border)' }}>
          <h3 className="text-sm font-bold flex items-center gap-2" style={{ color: 'var(--tblr-text)' }}><IconPhoto size={16} /> {t('feas_photo_title')}</h3>
          <button type="button" onClick={onClose} disabled={saving} aria-label={t('feas_cancel') as string} style={{ color: 'var(--tblr-muted)' }}><IconX size={18} /></button>
        </div>
        <div className="p-4 space-y-3 overflow-y-auto">
          {files.map((file, i) => (
            <div key={`${file.name}-${i}`} className="flex gap-3 items-start">
              <img src={previews[i]} alt="" className="w-24 h-20 object-cover rounded-lg shrink-0" style={{ border: '1px solid var(--tblr-border)', background: 'var(--tblr-surface-2)' }} />
              <label className="flex-1 min-w-0 text-xs font-semibold space-y-1" style={{ color: 'var(--tblr-muted)' }}>
                <span className="block truncate">{file.name}</span>
                <input className="w-full px-3 py-1.5 rounded-lg text-sm font-normal" style={inputStyle} maxLength={300}
                  placeholder={t('feas_photo_caption_placeholder') as string}
                  value={captions[i]} autoFocus={i === 0}
                  onChange={e => setCaptions(prev => prev.map((c, j) => (j === i ? e.target.value : c)))} />
              </label>
            </div>
          ))}
        </div>
        <div className="p-4 flex justify-end gap-2" style={{ borderTop: '1px solid var(--tblr-border)' }}>
          <button type="button" onClick={onClose} disabled={saving} className="px-3 py-1.5 rounded-lg text-sm" style={{ color: 'var(--tblr-muted)' }}>{t('feas_cancel')}</button>
          <button type="button" disabled={saving}
            onClick={() => onConfirm(files.map((file, i) => ({ file, caption: captions[i].trim() })))}
            className="px-3 py-1.5 rounded-lg text-sm font-semibold disabled:opacity-60 flex items-center gap-1.5" style={{ background: 'var(--tblr-primary)', color: '#fff' }}>
            {saving && <IconLoader2 size={14} className="animate-spin" />} {saving ? t('feas_saving') : t('feas_map_insert')}
          </button>
        </div>
      </div>
    </div>
  );
}
