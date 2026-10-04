import React from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
  if (!versions) return null;

  const handleRestore = async (v: DpgfVersion) => {
    const confirmed = await confirmAction({
      title: t('pro_versions_restore_title', { label: v.label }),
      message: t('pro_versions_restore_message'),
      confirmLabel: t('pro_versions_restore'),
      cancelLabel: t('pro_snap_cancel'),
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
            <h3 className="font-semibold">{t('pro_versions_title')}</h3>
            <p className="text-xs text-zinc-500">{t('pro_versions_subtitle')}</p>
          </div>
          <button
            onClick={onClose}
            aria-label={t('pro_versions_close')}
            className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <IconX size={18} />
          </button>
        </div>

        {/* Version list */}
        <div className="divide-y">
          {versions.length === 0 ? (
            <div className="p-6 text-sm text-zinc-500">{t('pro_versions_empty')}</div>
          ) : (
            versions.map(v => (
              <div key={v.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div>
                  <div className="font-medium text-sm">{v.label}</div>
                  <div className="text-xs text-zinc-500">
                    {v.phase || t('pro_versions_no_phase')} · v{v.version || '—'} ·{' '}
                    {new Date(v.created_at).toLocaleString('fr-FR')}
                  </div>
                </div>
                <button
                  className="px-3 py-1.5 text-xs border rounded text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950 transition-colors shrink-0"
                  onClick={() => void handleRestore(v)}
                >
                  {t('pro_versions_restore')}
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
