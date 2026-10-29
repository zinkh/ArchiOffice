import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DriveDocumentStatus } from '../../shared/driveDocumentStatus';
import { desktopBridge } from '../lib/desktopBridge';

/** Only mounted after local paid authorization has been checked by the page. */
export function DriveDocumentActions({ documentId, transfer, unavailable = false, onActivity }: { documentId: string; transfer?: DriveDocumentStatus; unavailable?: boolean; onActivity?: () => void }) {
  const { t } = useTranslation();
  const busyRef = useRef(false);
  const [busy, setBusy] = useState<'open' | 'upload' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const run = async (action: 'open' | 'upload') => {
    if (busyRef.current) return;
    const bridge = desktopBridge();
    const command = action === 'open' ? bridge?.openDriveDocument : bridge?.uploadDriveDocument;
    if (!command) return;
    busyRef.current = true; setBusy(action); setMessage(null);
    try {
      const result = await command(`doc:${documentId}`);
      setMessage(`drive_document_${result.status}`);
    } catch { setMessage('drive_document_error'); }
    finally { busyRef.current = false; setBusy(null); onActivity?.(); }
  };
  return <div className="space-y-1" aria-busy={!!busy}>
    <div className="flex flex-wrap gap-2">
      <button type="button" className="btn btn-ghost min-h-11" disabled={!!busy} onClick={() => void run('open')}>{t(busy === 'open' ? 'drive_document_opening' : 'drive_document_open')}</button>
      <button type="button" className="btn btn-ghost min-h-11" disabled={!!busy} onClick={() => void run('upload')}>{t(busy === 'upload' ? 'drive_document_uploading' : 'drive_document_upload')}</button>
    </div>
    {(unavailable || (transfer && transfer.state !== 'none')) && <p className="text-xs max-w-xs break-words" role={transfer?.state === 'conflict' || transfer?.state === 'blocked' ? 'alert' : 'status'}>
      {t(unavailable ? 'drive_document_transfer_unavailable' : `drive_document_transfer_${transfer!.state}`, { version: transfer?.version })}
    </p>}
    {message && <p className="text-xs max-w-xs" role={['drive_document_error', 'drive_document_conflict', 'drive_document_unsupported'].includes(message) ? 'alert' : 'status'}>{t(message)}</p>}
  </div>;
}
