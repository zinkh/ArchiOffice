// Réglages (client de bureau, administrateurs) : ranger les fichiers déjà déposés
// dans l'arborescence lisible Affaire / Phase / Fichier.
//
// Trois gestes séparés, chacun explicite :
//   1. Simuler : compte ce qui serait copié, ne touche à rien.
//   2. Copier : copie (jamais de déplacement) puis repointe les références. Les
//      anciens fichiers restent en place.
//   3. Supprimer les anciens fichiers : seulement ceux que plus aucune référence
//      n'utilise, à faire quand tous les postes sont à jour.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconFolders, IconLoader2 } from '@tabler/icons-react';
import { apiFetch } from '../lib/api';

interface Report {
  dryRun: boolean;
  total: number;
  aMigrer: number;
  migres: number;
  dejaranges: number;
  introuvables: number;
  erreurs: number;
  bytes: number;
}

interface Job {
  status: 'running' | 'done' | 'error';
  processed: number;
  total: number;
  report?: Report;
  error?: string;
}

interface PurgeReport {
  dryRun: boolean;
  supprimables: number;
  supprimes: number;
  encoreReferences: number;
  bytes: number;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  const units = ['Ko', 'Mo', 'Go', 'To'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} ${units[unit]}`;
}

const POLL_MS = 1500;

export default function StorageTreeMigrationCard() {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<Report | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [purge, setPurge] = useState<PurgeReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  const fail = (err: unknown) => {
    const detail = err instanceof Error ? err.message : String(err);
    setMessage(t('storage_tree_error', { message: detail }));
  };

  /** Relit le travail ; tant qu'il tourne, se replanifie. */
  const poll = useCallback(async () => {
    try {
      const { job: current } = await apiFetch<{ job: Job | null }>('/api/storage/tree-migration');
      if (!mounted.current) return;
      setJob(current);
      if (current?.status === 'running') timer.current = setTimeout(poll, POLL_MS);
    } catch {
      /* hors client de bureau la route répond 404 : la carte n'est de toute façon pas affichée */
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    poll();
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [poll]);

  const running = job?.status === 'running';

  const runPreview = async () => {
    setBusy(true);
    setMessage(null);
    try {
      setPreview(await apiFetch<Report>('/api/storage/tree-migration/preview', { method: 'POST' }));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const startCopy = async () => {
    if (!preview || preview.aMigrer === 0) return;
    if (!window.confirm(t('storage_tree_confirm_start', { n: preview.aMigrer, size: formatBytes(preview.bytes) }))) return;
    setBusy(true);
    setMessage(null);
    try {
      await apiFetch('/api/storage/tree-migration/start', { method: 'POST', body: JSON.stringify({ confirm: true }) });
      setPreview(null);
      await poll();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const runPurge = async () => {
    setBusy(true);
    setMessage(null);
    try {
      // Toujours une simulation d'abord : on montre ce qui serait supprimé.
      const dry = await apiFetch<PurgeReport>('/api/storage/tree-migration/purge', { method: 'POST', body: JSON.stringify({}) });
      setPurge(dry);
      if (dry.supprimables === 0) return;
      if (!window.confirm(t('storage_tree_purge_confirm', { n: dry.supprimables }))) return;
      const real = await apiFetch<PurgeReport>('/api/storage/tree-migration/purge', {
        method: 'POST',
        body: JSON.stringify({ dryRun: false, confirm: true }),
      });
      setPurge(null);
      setMessage(t('storage_tree_purge_done', { n: real.supprimes }));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const buttonStyle = { background: 'var(--tblr-surface)', color: 'var(--tblr-text)', border: '1px solid var(--tblr-border)' };

  return (
    <div className="rounded-xl p-5 space-y-3" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
      <h2 className="text-sm font-bold uppercase tracking-wider flex items-center gap-1.5" style={{ color: 'var(--tblr-muted)' }}>
        <IconFolders size={15} /> {t('storage_tree_title')}
      </h2>
      <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('storage_tree_intro')}</p>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={runPreview}
          disabled={busy || running}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors disabled:opacity-50"
          style={buttonStyle}
        >
          {busy && <IconLoader2 size={13} className="animate-spin" />}
          {t('storage_tree_preview')}
        </button>
        <button
          type="button"
          onClick={startCopy}
          disabled={busy || running || !preview || preview.aMigrer === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors disabled:opacity-50"
          style={{ background: 'var(--tblr-primary)', color: '#fff' }}
        >
          {t('storage_tree_start')}
        </button>
        <button
          type="button"
          onClick={runPurge}
          disabled={busy || running}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors disabled:opacity-50"
          style={buttonStyle}
        >
          {t('storage_tree_purge')}
        </button>
      </div>

      {preview && (
        <p className="text-xs" style={{ color: 'var(--tblr-text)' }} role="status">
          {preview.aMigrer === 0
            ? t('storage_tree_nothing')
            : t('storage_tree_summary', {
              aMigrer: preview.aMigrer,
              size: formatBytes(preview.bytes),
              dejaranges: preview.dejaranges,
              introuvables: preview.introuvables,
            })}
        </p>
      )}

      {running && job && (
        <p className="text-xs flex items-center gap-1.5" style={{ color: 'var(--tblr-text)' }} role="status">
          <IconLoader2 size={13} className="animate-spin" />
          {t('storage_tree_running', { done: job.processed, total: job.total })}
        </p>
      )}

      {job?.status === 'done' && job.report && (
        <p className="text-xs" style={{ color: 'var(--tblr-text)' }} role="status">
          {t('storage_tree_done', { migres: job.report.migres, erreurs: job.report.erreurs, introuvables: job.report.introuvables })}
        </p>
      )}

      {job?.status === 'error' && (
        <p className="text-xs" style={{ color: 'var(--tblr-danger)' }} role="alert">
          {t('storage_tree_error', { message: job.error || '' })}
        </p>
      )}

      {purge && (
        <p className="text-xs" style={{ color: 'var(--tblr-text)' }} role="status">
          {purge.supprimables === 0
            ? t('storage_tree_purge_nothing')
            : t('storage_tree_purge_summary', { n: purge.supprimables, size: formatBytes(purge.bytes), kept: purge.encoreReferences })}
        </p>
      )}

      {message && <p className="text-xs" style={{ color: 'var(--tblr-text)' }} role="status">{message}</p>}
    </div>
  );
}
