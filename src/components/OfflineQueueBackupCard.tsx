// Solution d'urgence de la file d'écritures hors ligne (src/lib/offlineQueueBackup.ts) :
// sauvegarder dans un fichier ce qui n'a pas pu partir (iPad sans réseau, file bloquée), puis le
// recharger depuis un poste connecté. Personnel comme MailAccountsCard : la file est celle de
// l'appareil et de la session, pas du cabinet.
import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { IconUpload, IconLoader2, IconLifebuoy } from '@tabler/icons-react';
import { db } from '../db';
import { importQueueBackupFile, type ImportPhase, type ImportResult } from '../lib/offlineQueueBackup';
import { entityLabel } from '../lib/pendingWriteLabels';
import { QueueBackupExport } from './QueueBackupExport';
import { ReplayProgressBar } from './ReplayProgressBar';

const plural = (n: number, one: string, many: string) => (n > 1 ? many : one);

export function OfflineQueueBackupCard() {
  const pending = useLiveQuery(() => db.pendingWrites.count(), [], 0);
  const [busy, setBusy] = useState<'import' | null>(null);
  const [phase, setPhase] = useState<ImportPhase | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy('import');
    setPhase({ step: 'reading' });
    setMessage(null);
    setResult(null);
    try {
      const outcome = await importQueueBackupFile(file, setPhase);
      setResult(outcome);
      const { imported, sent, stillPending, rejected, attempted } = outcome;
      const rejectedText = rejected.length > 0
        ? ` ${rejected.length} ${plural(rejected.length, 'entrée refusée', 'entrées refusées')} (${[...new Set(rejected.map(r => r.reason))].join(', ')}).`
        : '';
      if (imported === 0) {
        setMessage({ kind: 'error', text: `Rien à envoyer : le fichier ne contient aucune écriture valide.${rejectedText}` });
      } else if (!attempted) {
        setMessage({ kind: 'error', text: `${imported} ${plural(imported, 'écriture rechargée', 'écritures rechargées')} mais PAS envoyée${imported > 1 ? 's' : ''} : l'appareil est hors ligne. L'envoi reprendra au retour du réseau.${rejectedText}` });
      } else if (stillPending.length === 0) {
        setMessage({ kind: rejected.length > 0 ? 'error' : 'ok', text: `Envoyé : ${sent} ${plural(sent, 'écriture est arrivée', 'écritures sont arrivées')} sur le serveur (${sent}/${imported}).${rejectedText}` });
      } else {
        setMessage({ kind: 'error', text: `${sent} sur ${imported} ${plural(sent, 'envoyée', 'envoyées')} au serveur. ${stillPending.length} ${plural(stillPending.length, 'reste', 'restent')} en attente (causes ci-dessous) : l'envoi sera retenté automatiquement.${rejectedText}` });
      }
    } catch (err) {
      setMessage({ kind: 'error', text: (err as Error).message || 'L\'import a échoué.' });
    } finally {
      setBusy(null);
      setPhase(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const phaseText = phase?.step === 'reading'
    ? 'Lecture du fichier…'
    : phase?.step === 'storing'
      ? `Rechargement dans la file : ${phase.done}/${phase.total}`
      : phase?.step === 'sending'
        ? 'Envoi au serveur…'
        : null;

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
          {busy === 'import' ? 'Import en cours…' : 'Importer une sauvegarde'}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={e => void importFile(e.target.files?.[0])}
        />
      </div>
      {phaseText && <p role="status" className="text-xs font-semibold" style={{ color: 'var(--tblr-text)' }}>{phaseText}</p>}
      {/* Avancement réel de l'envoi : écriture en cours, octets de la photo, envoyées / restantes. */}
      <ReplayProgressBar />
      {message && (
        <p
          role="status"
          className="text-xs"
          style={{ color: message.kind === 'error' ? 'var(--tblr-danger, #e03131)' : 'var(--tblr-text)' }}
        >
          {message.text}
        </p>
      )}
      {result && result.stillPending.length > 0 && (
        <ul className="space-y-1 text-[0.6875rem]" style={{ color: 'var(--tblr-muted)' }}>
          {result.stillPending.map(item => (
            <li key={item.id}><span className="font-semibold" style={{ color: 'var(--tblr-text)' }}>{entityLabel(item.entity)}</span> : {item.message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default OfflineQueueBackupCard;
