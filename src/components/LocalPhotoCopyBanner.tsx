import { useState, useSyncExternalStore } from 'react';
import { IconDeviceFloppy, IconX } from '@tabler/icons-react';
import {
  discardPendingLocalCopies, flushPendingLocalCopies, getPendingLocalCopies, subscribePendingLocalCopies,
} from '../lib/localPhotoCopy';

/**
 * iOS / iPadOS : les photos prises à copier dans Photos attendent ici, car seul un appui ouvre
 * le menu de partage (« Enregistrer N images »). Invisible tant que rien n'attend.
 */
export function LocalPhotoCopyBanner() {
  const pending = useSyncExternalStore(subscribePendingLocalCopies, getPendingLocalCopies, getPendingLocalCopies);
  const [error, setError] = useState<string | null>(null);
  if (!pending.length) return null;

  const save = async () => {
    setError(null);
    try { await flushPendingLocalCopies(); } catch { setError("Enregistrement impossible, réessayez."); }
  };

  return (
    <div role="status"
      className="fixed left-3 right-3 z-[90] flex items-center gap-2 rounded-xl p-2 pl-3 shadow-2xl"
      style={{
        bottom: 'calc(88px + env(safe-area-inset-bottom, 0px))',
        background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)',
      }}>
      <span className="flex-1 text-sm font-bold">
        {pending.length} photo{pending.length > 1 ? 's' : ''} à enregistrer sur l'appareil
        {error && <span className="block text-xs font-normal text-red-600">{error}</span>}
      </span>
      <button type="button" onClick={save}
        className="min-h-11 px-3 rounded-lg text-sm font-bold flex items-center gap-2"
        style={{ background: 'var(--tblr-primary)', color: '#fff' }}>
        <IconDeviceFloppy size={18} /> Enregistrer
      </button>
      <button type="button" onClick={discardPendingLocalCopies} aria-label="Ignorer ces photos"
        className="min-h-11 min-w-11 flex items-center justify-center" style={{ color: 'var(--tblr-muted)' }}>
        <IconX size={18} />
      </button>
    </div>
  );
}
