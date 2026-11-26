import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconDatabase } from '@tabler/icons-react';
import { useStorageUsage } from '../hooks/useStorageUsage';
import { formatBytes, storageLevel, storagePercent, type StorageLevel } from '../lib/storageUsage';

// Cartouche discret en bas de la barre latérale : l'espace que le cabinet occupe face à son plafond, une jauge
// fine et le raccourci vers le changement de forfait. Le détail par utilisateur n'est plus ici : cliquer sur
// « Stockage » ouvre l'onglet « Stockage » des paramètres (`StorageUsageCard`). Silencieux en cas d'échec de
// lecture : un cartouche absent vaut mieux qu'un message d'erreur en permanence dans le menu.

/** Onglet des paramètres qui porte le détail par utilisateur. */
export const STORAGE_SETTINGS_PATH = '/settings?tab=stockage';

const LEVEL_COLOR: Record<StorageLevel, string> = {
  ok: 'var(--tblr-primary)',
  warning: 'var(--tblr-warning, #f59f00)',
  full: 'var(--tblr-danger)',
  expired: 'var(--tblr-danger)',
};

export function StorageCartouche({ collapsed = false, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const { t, i18n } = useTranslation();
  const usage = useStorageUsage();

  if (!usage) return null;

  const lang = i18n.language || 'fr';
  const level = storageLevel(usage.used_bytes, usage.limit_bytes);
  const percent = storagePercent(usage.used_bytes, usage.limit_bytes);
  const color = LEVEL_COLOR[level];
  const used = formatBytes(usage.used_bytes, lang);
  const limit = formatBytes(usage.limit_bytes, lang);
  const summary = level === 'expired' ? t('storage_cartouche_expired') as string : t('storage_cartouche_of', { used, limit }) as string;
  const tooltip = t('storage_cartouche_details_show') as string;

  if (collapsed) {
    return (
      <div className="border-t shrink-0 p-1.5" style={{ borderColor: 'var(--tblr-border)' }}>
        <Link
          to={STORAGE_SETTINGS_PATH}
          onClick={onNavigate}
          title={`${t('storage_cartouche_title')} : ${summary}. ${tooltip}`}
          aria-label={t('storage_cartouche_aria', { used, limit }) as string}
          className="relative flex items-center justify-center min-h-[44px] rounded"
          style={{ color: 'var(--tblr-muted)' }}
        >
          <IconDatabase size={20} />
          {level !== 'ok' && (
            <span aria-hidden className="absolute top-2 right-3 w-2 h-2 rounded-full" style={{ background: color }} />
          )}
        </Link>
      </div>
    );
  }

  return (
    <div className="shrink-0 p-3">
      <div className="rounded-xl p-3 space-y-2" style={{ background: 'var(--tblr-surface-2)' }}>
        {/* « Stockage » et le volume ouvrent le détail par utilisateur dans les paramètres. */}
        <Link
          to={STORAGE_SETTINGS_PATH}
          onClick={onNavigate}
          title={tooltip}
          className="flex items-baseline justify-between gap-2 text-xs whitespace-nowrap rounded hover:underline"
          style={{ color: 'var(--tblr-muted)' }}
        >
          <span>{t('storage_cartouche_title')}</span>
          <span className="tabular-nums" style={{ color: level === 'expired' ? color : 'var(--tblr-muted)' }}>{summary}</span>
        </Link>

        {level !== 'expired' && (
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-label={t('storage_cartouche_aria', { used, limit }) as string}
            className="h-1 rounded-full overflow-hidden"
            style={{ background: 'var(--tblr-surface)' }}
          >
            <div className="h-full rounded-full" style={{ width: `${percent}%`, background: color }} />
          </div>
        )}

        <Link
          to="/billing"
          onClick={onNavigate}
          className="flex items-center justify-center w-full min-h-9 pointer-coarse:min-h-11 rounded-lg border text-xs font-semibold"
          style={{ background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' }}
        >
          {t('storage_cartouche_upgrade')}
        </Link>
      </div>
    </div>
  );
}
