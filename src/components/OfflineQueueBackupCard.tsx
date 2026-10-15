// Solution d'urgence de la file d'écritures hors ligne (src/lib/offlineQueueBackup.ts) :
// sauvegarder dans un fichier ce qui n'a pas pu partir (iPad sans réseau, file bloquée), puis le
// recharger depuis un poste connecté. Personnel comme MailAccountsCard : la file est celle de
// l'appareil et de la session, pas du cabinet.
import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { IconUpload, IconLoader2, IconLifebuoy } from '@tabler/icons-react';
import { db } from '../db';
import { importQueueBackupFile } from '../lib/offlineQueueBackup';
import { QueueBackupExport } from './QueueBackupExport';

export function OfflineQueueBackupCard() {
  const pending = useLiveQuery(() => db.pendingWrites.count(), [], 0);
  const [busy, setBusy] = useState<'import' | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy('import');
    setMessage(null);
    try {
      const { imported, rejected } = await importQueueBackupFile(file);
      const rejectedText = rejected.length > 0
        ? ` ${rejected.length} entrée${rejected.length > 1 ? 's' : ''} refusée${rejected.length > 1 ? 's' : ''} (${[...new Set(rejected.map(r => r.reason))].join(', ')}).`
        : '';
      setMessage({
        kind: rejected.length > 0 ? 'error' : 'ok',
        text: `${imported} écriture${imported > 1 ? 's' : ''} rechargée${imported > 1 ? 's' : ''} : envoi en cours.${rejectedText} Importer deux fois le même fichier ne crée pas de doublon.`,
      });
    } catch (err) {
      setMessage({ kind: 'error', text: (err as Error).message || 'L\'import a échoué.' });
    } finally {
      setBusy(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="rounded-xl p-5 space-y-4" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
      <div className="flex items-start gap-2">
        <IconLifebuoy size={16} className="mt-0.5" style={{ color: 'var(--tblr-muted)' }} />
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>Sauvegarde de secours hors ligne</h2>
          <p className="text-xs mt-1" style={{ color: 'var(--tblr-muted)' }}>
            Si des saisies de chantier restent « en attente d'envoi » sur un appareil (iPad, téléphone), sauvegardez-les dans un fichier
            depuis cet appareil, puis importez ce fichier depuis un poste connecté avec le même compte. Le fichier contient aussi les photos.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <QueueBackupExport
          pending={pending}
          className="btn btn-sm flex items-center gap-1.5 disabled:opacity-50"
          onMessage={setMessage}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy !== null}
          className="btn btn-sm flex items-center gap-1.5 disabled:opacity-50"
        >
          {busy === 'import' ? <IconLoader2 size={14} className="animate-spin" /> : <IconUpload size={14} />}
          Importer une sauvegarde
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={e => void importFile(e.target.files?.[0])}
        />
      </div>
      {message && (
        <p
          role="status"
          className="text-xs"
          style={{ color: message.kind === 'error' ? 'var(--tblr-danger, #e03131)' : 'var(--tblr-text)' }}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}

export default OfflineQueueBackupCard;
