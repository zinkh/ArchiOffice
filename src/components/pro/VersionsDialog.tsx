import React from 'react';
import { IconX } from '@tabler/icons-react';
import type { ConfirmOptions } from '../ui/ConfirmDialog';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DpgfVersion {
  id: string;
  label: string;
  phase?: string;
  version?: string;
  created_at: string;
}

interface VersionsDialogProps {
  versions: DpgfVersion[] | null;
  onClose: () => void;
  onRestore: (v: DpgfVersion) => void;
  /** Délégué au useConfirmDialog du parent, pour éviter un second hook ici. */
  confirmAction: (opts: ConfirmOptions) => Promise<boolean>;
}

// ── Component ─────────────────────────────────────────────────────────────────

export const VersionsDialog: React.FC<VersionsDialogProps> = ({
  versions,
  onClose,
  onRestore,
  confirmAction,
}) => {
  if (!versions) return null;

  const handleRestore = async (v: DpgfVersion) => {
    const confirmed = await confirmAction({
      title: `Restaurer « ${v.label} » ?`,
      message:
        "L'état courant doit être figé au préalable si vous souhaitez le conserver. " +
        'Cette action remplacera le document par la version sélectionnée.',
      confirmLabel: 'Restaurer',
      cancelLabel: 'Annuler',
      tone: 'danger',
    });
    if (!confirmed) return;
    onRestore(v);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-2xl max-h-[75dvh] overflow-auto rounded-xl bg-white dark:bg-zinc-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div>
            <h3 className="font-semibold">Versions figées du dossier PRO</h3>
            <p className="text-xs text-zinc-500">CCTP, DPGF et estimation au même instant</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Fermer"
            className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <IconX size={18} />
          </button>
        </div>

        {/* Version list */}
        <div className="divide-y">
          {versions.length === 0 ? (
            <div className="p-6 text-sm text-zinc-500">Aucune version figée.</div>
          ) : (
            versions.map(v => (
              <div key={v.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div>
                  <div className="font-medium text-sm">{v.label}</div>
                  <div className="text-xs text-zinc-500">
                    {v.phase || 'Sans phase'} · v{v.version || '—'} ·{' '}
                    {new Date(v.created_at).toLocaleString('fr-FR')}
                  </div>
                </div>
                <button
                  className="px-3 py-1.5 text-xs border rounded text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950 transition-colors shrink-0"
                  onClick={() => void handleRestore(v)}
                >
                  Restaurer
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
