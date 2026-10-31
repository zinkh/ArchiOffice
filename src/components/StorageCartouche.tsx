import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconChevronDown, IconChevronUp, IconDatabase } from '@tabler/icons-react';
import { apiFetch } from '../lib/api';
import {
  formatBytes, storageLevel, storagePercent,
  type StorageLevel, type StorageUsage,
} from '../lib/storageUsage';

const fetchStorageUsage = () => apiFetch<StorageUsage>('/api/billing/storage');

// Cartouche en bas de la barre latérale : l'espace que le cabinet occupe chez nous
// face à son plafond, puis le détail par personne. Le détail de toute l'équipe est
// réservé aux administrateurs et managers (le serveur ne renvoie que la ligne de
// l'appelant aux autres : voir server/storageBreakdown.ts). Silencieux en cas
// d'échec de lecture : un cartouche absent vaut mieux qu'un message d'erreur en
// permanence dans le menu.

const REFRESH_MS = 10 * 60 * 1000;
const DETAILS_KEY = 'sidebar:storage-details';

const LEVEL_COLOR: Record<StorageLevel, string> = {
  ok: 'var(--tblr-primary)',
  warning: 'var(--tblr-warning, #f59f00)',
  full: 'var(--tblr-danger)',
  expired: 'var(--tblr-danger)',
};

function readOpen(): boolean {
  try { return localStorage.getItem(DETAILS_KEY) === '1'; } catch { return false; }
}

export function StorageCartouche({ collapsed = false, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const { t, i18n } = useTranslation();
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [open, setOpen] = useState(readOpen);

  const load = useCallback(() => {
    fetchStorageUsage().then(setUsage).catch(() => { /* cartouche masqué */ });
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [load]);

  if (!usage) return null;

  const lang = i18n.language || 'fr';
  const level = storageLevel(usage.used_bytes, usage.limit_bytes);
  const percent = storagePercent(usage.used_bytes, usage.limit_bytes);
  const color = LEVEL_COLOR[level];
  const used = formatBytes(usage.used_bytes, lang);
  const limit = formatBytes(usage.limit_bytes, lang);
  const summary = level === 'expired' ? t('storage_cartouche_expired') as string : t('storage_cartouche_of', { used, limit }) as string;
  const breakdown = usage.breakdown;

  const toggle = () => {
    setOpen(prev => {
      const next = !prev;
      try { localStorage.setItem(DETAILS_KEY, next ? '1' : '0'); } catch { /* préférence non retenue */ }
      return next;
    });
  };

  if (collapsed) {
    return (
      <div className="border-t shrink-0 p-1.5" style={{ borderColor: 'var(--tblr-border)' }}>
        <Link
          to="/billing"
          onClick={onNavigate}
          title={`${t('storage_cartouche_title')} : ${summary}`}
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

  const lineName = (name: string, isMe: boolean) =>
    `${name || (t('storage_cartouche_unknown_author') as string)}${isMe ? ` (${t('storage_cartouche_you')})` : ''}`;
  const filesLabel = (count: number) => t('storage_cartouche_files', { count }) as string;
  const share = (bytes: number) => (usage.used_bytes > 0 ? Math.min(100, Math.round((bytes / usage.used_bytes) * 100)) : 0);

  const ownLine = breakdown?.scope === 'self' ? breakdown.users[0] : undefined;
  const teamLines = breakdown?.scope === 'all' ? breakdown.users : [];
  const unattributed = breakdown?.scope === 'all' ? breakdown.unattributed_bytes ?? 0 : 0;
  const hasDetail = breakdown?.scope === 'all' && (teamLines.length > 0 || unattributed > 0);

  return (
    <div className="shrink-0 p-3">
      <div className="rounded-xl p-4 space-y-3" style={{ background: 'var(--tblr-surface-2)' }}>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span style={{ color: 'var(--tblr-muted)' }}>{t('storage_cartouche_title')}</span>
        <span className="tabular-nums" style={{ color: level === 'expired' ? color : 'var(--tblr-muted)' }}>
          {summary}
        </span>
      </div>

      {level !== 'expired' && (
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-label={t('storage_cartouche_aria', { used, limit }) as string}
          className="h-1.5 rounded-full overflow-hidden"
          style={{ background: 'var(--tblr-surface)' }}
        >
          <div className="h-full rounded-full" style={{ width: `${percent}%`, background: color }} />
        </div>
      )}

      <Link
        to="/billing"
        onClick={onNavigate}
        className="flex items-center justify-center w-full min-h-10 pointer-coarse:min-h-11 rounded-lg border text-sm font-semibold"
        style={{ background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' }}
      >
        {t('storage_cartouche_upgrade')}
      </Link>

      {ownLine && (
        <div className="flex items-baseline justify-between gap-2 text-[0.75rem]" title={filesLabel(ownLine.files)}>
          <span style={{ color: 'var(--tblr-muted)' }}>{t('storage_cartouche_mine')}</span>
          <span className="tabular-nums" style={{ color: 'var(--tblr-text)' }}>{formatBytes(ownLine.bytes, lang)}</span>
        </div>
      )}

      {hasDetail && (
        <>
          <button
            type="button"
            onClick={toggle}
            aria-expanded={open}
            className="flex w-full items-center justify-between gap-2 text-[0.75rem] font-medium min-h-[28px] pointer-coarse:min-h-11"
            style={{ color: 'var(--tblr-muted)' }}
          >
            <span>{open ? t('storage_cartouche_details_hide') : t('storage_cartouche_details_show')}</span>
            {open ? <IconChevronUp size={14} aria-hidden /> : <IconChevronDown size={14} aria-hidden />}
          </button>

          {open && (
            <ul className="space-y-1.5">
              {teamLines.map(line => (
                <li key={line.name || '__sans_auteur__'} title={filesLabel(line.files)}>
                  <div className="flex items-baseline justify-between gap-2 text-[0.75rem]">
                    <span className="truncate" style={{ color: 'var(--tblr-text)' }}>{lineName(line.name, line.is_me)}</span>
                    <span className="tabular-nums shrink-0" style={{ color: 'var(--tblr-muted)' }}>{formatBytes(line.bytes, lang)}</span>
                  </div>
                  <div className="h-1 rounded-full overflow-hidden mt-0.5" style={{ background: 'var(--tblr-surface-2)' }}>
                    <div className="h-full rounded-full" style={{ width: `${share(line.bytes)}%`, background: 'var(--tblr-primary)' }} />
                  </div>
                </li>
              ))}
              {unattributed > 0 && (
                <li>
                  <div className="flex items-baseline justify-between gap-2 text-[0.75rem]">
                    <span className="truncate" style={{ color: 'var(--tblr-muted)' }}>{t('storage_cartouche_unattributed')}</span>
                    <span className="tabular-nums shrink-0" style={{ color: 'var(--tblr-muted)' }}>{formatBytes(unattributed, lang)}</span>
                  </div>
                  <div className="h-1 rounded-full overflow-hidden mt-0.5" style={{ background: 'var(--tblr-surface-2)' }}>
                    <div className="h-full rounded-full" style={{ width: `${share(unattributed)}%`, background: 'var(--tblr-border)' }} />
                  </div>
                </li>
              )}
            </ul>
          )}
        </>
      )}
      </div>
    </div>
  );
}
