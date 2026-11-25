import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useStorageUsage } from '../hooks/useStorageUsage';
import { formatBytes, storageLevel, storagePercent, type StorageLevel } from '../lib/storageUsage';

// Onglet « Stockage » des paramètres : l'espace que le cabinet occupe face à son plafond, puis le détail par
// personne (auparavant dans le cartouche de la barre latérale, désormais atteint en cliquant sur « Stockage »).
// Le détail de toute l'équipe est réservé aux administrateurs et managers : le serveur ne renvoie que la ligne
// de l'appelant aux autres (voir server/storageBreakdown.ts), la carte n'a donc rien à filtrer.

const LEVEL_COLOR: Record<StorageLevel, string> = {
  ok: 'var(--tblr-primary)',
  warning: 'var(--tblr-warning, #f59f00)',
  full: 'var(--tblr-danger)',
  expired: 'var(--tblr-danger)',
};

export function StorageUsageCard() {
  const { t, i18n } = useTranslation();
  const usage = useStorageUsage();

  if (!usage) {
    return <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>{t('storage_settings_loading')}</p>;
  }

  const lang = i18n.language || 'fr';
  const level = storageLevel(usage.used_bytes, usage.limit_bytes);
  const percent = storagePercent(usage.used_bytes, usage.limit_bytes);
  const color = LEVEL_COLOR[level];
  const used = formatBytes(usage.used_bytes, lang);
  const limit = formatBytes(usage.limit_bytes, lang);
  const breakdown = usage.breakdown;

  const lineName = (name: string, isMe: boolean) =>
    `${name || (t('storage_cartouche_unknown_author') as string)}${isMe ? ` (${t('storage_cartouche_you')})` : ''}`;
  const filesLabel = (count: number) => t('storage_cartouche_files', { count }) as string;
  const share = (bytes: number) => (usage.used_bytes > 0 ? Math.min(100, Math.round((bytes / usage.used_bytes) * 100)) : 0);

  const teamLines = breakdown?.scope === 'all' ? breakdown.users : [];
  const ownLine = breakdown?.scope === 'self' ? breakdown.users[0] : undefined;
  const unattributed = breakdown?.scope === 'all' ? breakdown.unattributed_bytes ?? 0 : 0;
  const hasTeamDetail = breakdown?.scope === 'all' && (teamLines.length > 0 || unattributed > 0);

  return (
    <section
      className="rounded-xl p-5 space-y-4"
      style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}
      aria-label={t('storage_cartouche_title') as string}
    >
      <div>
        <h2 className="text-base font-bold" style={{ color: 'var(--tblr-text)' }}>{t('storage_cartouche_title')}</h2>
        <p className="text-xs mt-1" style={{ color: 'var(--tblr-muted)' }}>{t('storage_settings_intro')}</p>
      </div>

      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-2 text-sm">
          <span style={{ color: 'var(--tblr-muted)' }}>{t('storage_settings_used')}</span>
          <span className="tabular-nums font-semibold" style={{ color: level === 'expired' ? color : 'var(--tblr-text)' }}>
            {level === 'expired' ? t('storage_cartouche_expired') : t('storage_cartouche_of', { used, limit })}
          </span>
        </div>
        {level !== 'expired' && (
          <div
            role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}
            aria-label={t('storage_cartouche_aria', { used, limit }) as string}
            className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--tblr-surface-2)' }}
          >
            <div className="h-full rounded-full" style={{ width: `${percent}%`, background: color }} />
          </div>
        )}
        <Link
          to="/billing"
          className="inline-flex items-center justify-center min-h-9 px-3 rounded-lg border text-sm font-semibold"
          style={{ background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' }}
        >
          {t('storage_cartouche_upgrade')}
        </Link>
      </div>

      <div>
        <h3 className="text-[0.6875rem] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--tblr-muted)' }}>
          {t('storage_cartouche_details_show')}
        </h3>
        {ownLine && (
          <div className="flex items-baseline justify-between gap-2 text-sm" title={filesLabel(ownLine.files)}>
            <span style={{ color: 'var(--tblr-muted)' }}>{t('storage_cartouche_mine')}</span>
            <span className="tabular-nums" style={{ color: 'var(--tblr-text)' }}>{formatBytes(ownLine.bytes, lang)}</span>
          </div>
        )}
        {hasTeamDetail && (
          <ul className="space-y-2.5">
            {teamLines.map(line => (
              <li key={line.name || '__sans_auteur__'} title={filesLabel(line.files)}>
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="truncate" style={{ color: 'var(--tblr-text)' }}>{lineName(line.name, line.is_me)}</span>
                  <span className="tabular-nums shrink-0" style={{ color: 'var(--tblr-muted)' }}>
                    {formatBytes(line.bytes, lang)} · {filesLabel(line.files)}
                  </span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden mt-1" style={{ background: 'var(--tblr-surface-2)' }}>
                  <div className="h-full rounded-full" style={{ width: `${share(line.bytes)}%`, background: 'var(--tblr-primary)' }} />
                </div>
              </li>
            ))}
            {unattributed > 0 && (
              <li>
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="truncate" style={{ color: 'var(--tblr-muted)' }}>{t('storage_cartouche_unattributed')}</span>
                  <span className="tabular-nums shrink-0" style={{ color: 'var(--tblr-muted)' }}>{formatBytes(unattributed, lang)}</span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden mt-1" style={{ background: 'var(--tblr-surface-2)' }}>
                  <div className="h-full rounded-full" style={{ width: `${share(unattributed)}%`, background: 'var(--tblr-border)' }} />
                </div>
              </li>
            )}
          </ul>
        )}
        {!ownLine && !hasTeamDetail && (
          <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>{t('storage_settings_no_detail')}</p>
        )}
      </div>
    </section>
  );
}
