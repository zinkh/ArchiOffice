// Réglage personnel, propre à l'appareil : garder une copie des photos de chantier prises avec
// l'appareil (DET, OPR, GPA). Voir src/lib/localPhotoCopy.ts pour les limites de chaque système.
import { useState } from 'react';
import { IconDeviceTablet } from '@tabler/icons-react';
import { isLocalCopyEnabled, localCopyNeedsConfirmation, setLocalCopyEnabled } from '../lib/localPhotoCopy';

export function LocalPhotoCopyCard() {
  const [enabled, setEnabled] = useState(isLocalCopyEnabled);
  const ios = localCopyNeedsConfirmation();

  const toggle = (value: boolean) => { setLocalCopyEnabled(value); setEnabled(value); };

  return (
    <div className="rounded-xl p-5 space-y-3" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
      <div className="flex items-center gap-2">
        <IconDeviceTablet size={16} style={{ color: 'var(--tblr-muted)' }} />
        <h3 className="text-sm font-bold" style={{ color: 'var(--tblr-text)' }}>Photos de chantier sur cet appareil</h3>
      </div>
      <label className="flex items-start gap-3 min-h-11 cursor-pointer">
        <input type="checkbox" className="mt-1 h-5 w-5" checked={enabled} onChange={e => toggle(e.target.checked)} />
        <span className="text-sm" style={{ color: 'var(--tblr-text)' }}>
          Enregistrer aussi sur l'appareil les photos prises dans le DET, l'OPR et le GPA
        </span>
      </label>
      <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>
        Réglage propre à cet appareil. Seules les photos prises avec l'appareil photo sont copiées.
        {ios
          ? " Sur iPad et iPhone, une barre propose d'enregistrer les photos en attente d'un seul appui (menu « Enregistrer l'image »), car iOS l'exige."
          : ' Sur Android, chaque photo est enregistrée dans le dossier Téléchargements.'}
      </p>
    </div>
  );
}
