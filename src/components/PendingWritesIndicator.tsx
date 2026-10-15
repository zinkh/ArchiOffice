import { useState, useSyncExternalStore } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { motion, AnimatePresence } from 'motion/react';
import { IconCloudUpload, IconAlertTriangle, IconRefresh, IconX, IconLoader2 } from '@tabler/icons-react';
import { db } from '../db';
import { replayNow, getReplayProgress, subscribeReplayProgress } from '../lib/offlineQueue';
import { entityLabel } from '../lib/pendingWriteLabels';
import { QueueBackupExport } from './QueueBackupExport';
import { ReplayProgressBar } from './ReplayProgressBar';

/**
 * Écritures « suivi de chantier » en attente d'envoi (src/lib/offlineQueue.ts)
 * — réunions, réserves OPR/GPA, observations, inspirations et leurs photos. Toujours
 * visible, y compris sur téléphone : c'est précisément là que ce badge sert,
 * sur le chantier plutôt qu'au bureau (contrairement à `<SyncStatus />`,
 * réservée aux grands écrans).
 *
 * N'affiche rien tant que la file est vide — un badge en permanence serait
 * du bruit pour l'immense majorité du temps passé en ligne.
 */
export function PendingWritesIndicator() {
  const [open, setOpen] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [backupMessage, setBackupMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const writes = useLiveQuery(() => db.pendingWrites.orderBy('createdAt').toArray(), []);
  const progress = useSyncExternalStore(subscribeReplayProgress, getReplayProgress, getReplayProgress);

  if (!writes || writes.length === 0) return null;

  const hasError = writes.some(w => w.status === 'error');
  const busy = retrying || progress.running;

  const retry = async () => {
    setRetrying(true);
    try { await replayNow(); } finally { setRetrying(false); }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 px-2 py-1 text-[0.6875rem] font-semibold uppercase tracking-wider rounded"
        style={hasError
          ? { background: '#fff0f0', color: '#e03131', border: '1px solid #ffc9c9' }
          : { background: '#fff4e6', color: '#f76707', border: '1px solid #ffd8a8' }}
        title="Écritures en attente d'envoi"
      >
        {progress.running ? <IconLoader2 size={13} className="animate-spin" /> : hasError ? <IconAlertTriangle size={13} /> : <IconCloudUpload size={13} />}
        {writes.length}
      </button>

      <AnimatePresence>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          {/* Le panneau naît de la pastille (coin haut droit) et y retourne. */}
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ type: 'spring', bounce: 0, visualDuration: 0.18 }}
            className="absolute right-0 top-full mt-1 z-50 w-80 max-w-[calc(100vw-1rem)] rounded-xl shadow-lg p-2"
            style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', transformOrigin: 'top right' }}
          >
            <div className="flex items-center justify-between px-1.5 py-1">
              <span className="text-xs font-bold" style={{ color: 'var(--tblr-text)' }}>
                {writes.length} en attente d'envoi
              </span>
              <button onClick={() => setOpen(false)} aria-label="Fermer" style={{ color: 'var(--tblr-muted)' }}><IconX size={14} /></button>
            </div>
            <ReplayProgressBar className="px-1.5 pb-1.5" />
            <ul className="space-y-1 max-h-48 overflow-y-auto">
              {writes.map(w => {
                const current = progress.running && progress.currentId === w.id;
                return (
                  <li key={w.id} className="px-1.5 py-1 rounded text-xs" style={{ color: 'var(--tblr-text)', background: current ? 'var(--tblr-primary-lt)' : undefined }}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate">{entityLabel(w.entity) || w.entity}</span>
                      {current ? (
                        <span className="flex-shrink-0 flex items-center gap-1 text-[0.6875rem] font-semibold" style={{ color: 'var(--tblr-primary)' }}>
                          <IconLoader2 size={11} className="animate-spin" /> Envoi
                        </span>
                      ) : w.status === 'error' ? (
                        <span className="flex-shrink-0 text-[0.6875rem] font-semibold" style={{ color: 'var(--tblr-danger, #e03131)' }} title={w.lastError}>
                          Échec
                        </span>
                      ) : (
                        <span className="flex-shrink-0 text-[0.6875rem]" style={{ color: 'var(--tblr-muted)' }}>
                          {w.attempts > 0 ? `${w.attempts} ${w.attempts > 1 ? 'essais' : 'essai'} · ` : ''}
                          {new Date(w.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                    </div>
                    {/* La cause d'un échec ou d'un essai raté reste visible : sans elle, « en attente » ne dit pas pourquoi. */}
                    {!current && w.lastError && (
                      <div className="text-[0.6875rem] break-words" style={{ color: w.status === 'error' ? 'var(--tblr-danger, #e03131)' : 'var(--tblr-muted)' }}>
                        {w.lastError}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            <QueueBackupExport
              className="w-full mt-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs font-bold rounded-lg disabled:opacity-50"
              style={{ border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
              onMessage={setBackupMessage}
            />
            {backupMessage && (
              <p
                role="status"
                className="px-1.5 pt-1 text-[0.6875rem]"
                style={{ color: backupMessage.kind === 'error' ? 'var(--tblr-danger, #e03131)' : 'var(--tblr-muted)' }}
              >
                {backupMessage.text}
              </p>
            )}
            <button
              type="button"
              onClick={retry}
              disabled={busy || !navigator.onLine}
              className="w-full mt-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs font-bold rounded-lg disabled:opacity-50"
              style={{ background: 'var(--tblr-primary)', color: '#fff' }}
            >
              <IconRefresh size={13} className={busy ? 'animate-spin' : ''} />
              {!navigator.onLine ? 'Hors ligne' : busy ? 'Envoi en cours…' : 'Réessayer maintenant'}
            </button>
          </motion.div>
        </>
      )}
      </AnimatePresence>
    </div>
  );
}

export default PendingWritesIndicator;
