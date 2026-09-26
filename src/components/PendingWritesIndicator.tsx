import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { IconCloudUpload, IconAlertTriangle, IconRefresh, IconX } from '@tabler/icons-react';
import { db, PendingWrite } from '../db';
import { replayPendingWrites } from '../lib/offlineQueue';

const ENTITY_LABELS: Record<PendingWrite['entity'], string> = {
  meeting: 'Réunion',
  meetingPhoto: 'Photo de réunion',
  reserve: 'Réserve',
  reservePhoto: 'Photo de réserve',
  gpaReserve: 'Réserve GPA',
  gpaReservePhoto: 'Photo de réserve GPA',
  observation: 'Observation',
  observationPhoto: 'Photo d\'observation',
  project: 'Projet',
  siteReport: 'Compte-rendu de chantier',
};

/**
 * Écritures « suivi de chantier » en attente d'envoi (src/lib/offlineQueue.ts)
 * — réunions, réserves OPR/GPA, observations et leurs photos. Toujours
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
  const writes = useLiveQuery(() => db.pendingWrites.orderBy('createdAt').toArray(), []);

  if (!writes || writes.length === 0) return null;

  const hasError = writes.some(w => w.status === 'error');

  const retry = async () => {
    setRetrying(true);
    try { await replayPendingWrites(); } finally { setRetrying(false); }
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
        {hasError ? <IconAlertTriangle size={13} /> : <IconCloudUpload size={13} />}
        {writes.length}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 top-full mt-1 z-50 w-72 max-h-80 overflow-y-auto rounded-xl shadow-lg p-2"
            style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}
          >
            <div className="flex items-center justify-between px-1.5 py-1">
              <span className="text-xs font-bold" style={{ color: 'var(--tblr-text)' }}>
                {writes.length} en attente d'envoi
              </span>
              <button onClick={() => setOpen(false)} style={{ color: 'var(--tblr-muted)' }}><IconX size={14} /></button>
            </div>
            <ul className="space-y-1">
              {writes.map(w => (
                <li key={w.id} className="flex items-center justify-between gap-2 px-1.5 py-1 rounded text-xs" style={{ color: 'var(--tblr-text)' }}>
                  <span className="truncate">{ENTITY_LABELS[w.entity] || w.entity}</span>
                  {w.status === 'error' ? (
                    <span className="flex-shrink-0 text-[0.6875rem] font-semibold" style={{ color: 'var(--tblr-danger, #e03131)' }} title={w.lastError}>
                      Échec
                    </span>
                  ) : (
                    <span className="flex-shrink-0 text-[0.6875rem]" style={{ color: 'var(--tblr-muted)' }}>
                      {new Date(w.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={retry}
              disabled={retrying || !navigator.onLine}
              className="w-full mt-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs font-bold rounded-lg disabled:opacity-50"
              style={{ background: 'var(--tblr-primary)', color: '#fff' }}
            >
              <IconRefresh size={13} className={retrying ? 'animate-spin' : ''} />
              {navigator.onLine ? 'Réessayer maintenant' : 'Hors ligne'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default PendingWritesIndicator;
