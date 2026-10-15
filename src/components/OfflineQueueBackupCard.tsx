// Solution d'urgence de la file d'écritures hors ligne (src/lib/offlineQueueBackup.ts) :
// sauvegarder dans un fichier ce qui n'a pas pu partir (iPad sans réseau, file bloquée), puis le
// recharger depuis un poste connecté. Personnel comme MailAccountsCard : la file est celle de
// l'appareil et de la session, pas du cabinet.
import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { IconDownload, IconUpload, IconLoader2, IconLifebuoy } from '@tabler/icons-react';
import { db } from '../db';
import { downloadQueueBackup, importQueueBackupFile } from '../lib/offlineQueueBackup';

export function OfflineQueueBackupCard() {
  const pending = useLiveQuery(() => db.pendingWrites.count(), [], 0);
  const [busy, setBusy] = useState<'export' | 'import' | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const exportQueue = async () => {
    setBusy('export');
    setMessage(null);
    try {
      const { count, filename, unreadable } = await downloadQueueBackup();
      const extra = unreadable > 0
        ? ` ${unreadable} photo${unreadable > 1 ? 's' : ''} illisible${unreadable > 1 ? 's' : ''} sur cet appareil n'${unreadable > 1 ? 'ont' : 'a'} pas pu être sauvegardée${unreadable > 1 ? 's' : ''} : à reprendre.`
        : '';
      setMessage({ kind: unreadable > 0 ? 'error' : 'ok', text: `${count} écriture${count > 1 ? 's' : ''} sauvegardée${count > 1 ? 's' : ''} dans ${filename}.${extra}` });
    } catch (err) {
      setMessage({ kind: 'error', text: (err as Error).message || 'La sauvegarde a échoué.' });
    } finally {
      setBusy(null);
    }
  };

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
        <button
          type="button"
          onClick={exportQueue}
          disabled={busy !== null || pending === 0}
          className="btn btn-sm flex items-center gap-1.5 disabled:opacity-50"
        >
          {busy === 'export' ? <IconLoader2 size={14} className="animate-spin" /> : <IconDownload size={14} />}
          Sauvegarder la file ({pending})
        </button>
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
