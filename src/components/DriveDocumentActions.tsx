import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DriveDocumentStatus, DriveRemoteCheck } from '../../shared/driveDocumentStatus';
import { desktopBridge } from '../lib/desktopBridge';

/** Only mounted after local paid authorization has been checked by the page. */
export function DriveDocumentActions({ documentId, transfer, unavailable = false, onActivity }: { documentId: string; transfer?: DriveDocumentStatus; unavailable?: boolean; onActivity?: () => void }) {
  const { t } = useTranslation();
  const busyRef = useRef(false);
  const [busy, setBusy] = useState<'open' | 'upload' | 'preserve' | 'restart' | 'reveal' | 'check' | 'refresh' | null>(null);
  const [remote, setRemote] = useState<DriveRemoteCheck | null>(null);
  const [confirmRefresh, setConfirmRefresh] = useState(false);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const run = async (action: 'open' | 'upload' | 'preserve' | 'restart' | 'reveal' | 'check' | 'refresh') => {
    if (busyRef.current) return;
    const bridge = desktopBridge();
    const command = action === 'check' ? bridge?.checkDriveRemoteVersion : action === 'refresh' ? bridge?.refreshDriveDocument : action === 'restart' ? bridge?.restartDriveDocument : action === 'reveal' ? bridge?.revealDriveCopies : action === 'open' ? bridge?.openDriveDocument : action === 'preserve' ? bridge?.preserveDriveConflict : bridge?.uploadDriveDocument;
    if (!command) return;
    busyRef.current = true; setBusy(action); setMessage(null); setRemote(null); setConfirmRefresh(false);
    try {
      const result = await command(`doc:${documentId}`);
      if(action==='check'||action==='refresh')setRemote(result as DriveRemoteCheck);
      else setMessage(`drive_document_${result.status}`);
      if(result.status==='restarted')setConfirmRestart(false);
    } catch { setMessage('drive_document_error'); }
    finally { busyRef.current = false; setBusy(null); onActivity?.(); }
  };
  return <div className="space-y-1" aria-busy={!!busy}>
    <div className="flex flex-wrap gap-2">
      <button type="button" className="btn btn-ghost min-h-11" disabled={!!busy} onClick={() => void run('open')}>{t(busy === 'open' ? 'drive_document_opening' : 'drive_document_open')}</button>
      <button type="button" className="btn btn-ghost min-h-11" disabled={!!busy} onClick={() => void run('upload')}>{t(busy === 'upload' ? 'drive_document_uploading' : 'drive_document_upload')}</button>
      {desktopBridge()?.checkDriveRemoteVersion && <button type="button" className="btn btn-ghost min-h-11" disabled={!!busy} onClick={() => void run('check')}>{t(busy === 'check' ? 'drive_remote_checking' : 'drive_remote_check')}</button>}
      {desktopBridge()?.revealDriveCopies && <button type="button" className="btn btn-ghost min-h-11" disabled={!!busy} onClick={() => void run('reveal')}>{t('drive_document_reveal_copies')}</button>}
    </div>
    {(unavailable || (transfer && transfer.state !== 'none')) && <p className="text-xs max-w-xs break-words" role={transfer?.state === 'conflict' || transfer?.state === 'blocked' ? 'alert' : 'status'}>
      {t(unavailable ? 'drive_document_transfer_unavailable' : `drive_document_transfer_${transfer!.state}`, { version: transfer?.version })}
    </p>}
    {transfer?.state === 'conflict' && !unavailable && <div className="space-y-1 max-w-xs">
      <p className="text-xs break-words" role="status">{t(transfer.preservation ? `drive_conflict_copy_${transfer.preservation}` : 'drive_conflict_copy_explanation')}</p>
      {!transfer.preservation && desktopBridge()?.preserveDriveConflict && <button type="button" className="btn btn-ghost min-h-11" disabled={!!busy} onClick={() => void run('preserve')}>
        {t(busy === 'preserve' ? 'drive_conflict_copy_preparing' : 'drive_conflict_copy_action')}
      </button>}
    </div>}
    {transfer?.state === 'conflict' && transfer.preservation === 'done' && !unavailable && desktopBridge()?.restartDriveDocument && <div className="space-y-1 max-w-xs">
      {confirmRestart ? <>
        <p className="text-xs break-words">{t('drive_restart_explanation')}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-ghost min-h-11" disabled={!!busy} onClick={() => void run('restart')}>{t(busy === 'restart' ? 'drive_restart_preparing' : 'drive_restart_confirm')}</button>
          <button type="button" className="btn btn-ghost min-h-11" disabled={!!busy} onClick={() => setConfirmRestart(false)}>{t('drive_restart_cancel')}</button>
        </div>
      </> : <button type="button" className="btn btn-ghost min-h-11" disabled={!!busy} onClick={() => setConfirmRestart(true)}>{t('drive_restart_action')}</button>}
    </div>}
    {busy === 'refresh' && <p className="text-xs max-w-xs" role="status">{t('drive_remote_preparing')}</p>}
    {remote && <div className="space-y-1 max-w-xs">
      <p className="text-xs break-words" role={['error','changed','modified','busy','local_newer'].includes(remote.status) ? 'alert' : 'status'}>{t(`drive_remote_${remote.status}`, { localVersion: remote.localVersion, remoteVersion: remote.remoteVersion })}</p>
      {remote.status === 'remote_newer' && desktopBridge()?.refreshDriveDocument && (confirmRefresh ? <>
        <p className="text-xs break-words">{t('drive_remote_confirm_explanation')}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-ghost min-h-11" disabled={!!busy} onClick={() => void run('refresh')}>{t('drive_remote_confirm')}</button>
          <button type="button" className="btn btn-ghost min-h-11" disabled={!!busy} onClick={() => setConfirmRefresh(false)}>{t('drive_restart_cancel')}</button>
        </div>
      </> : <button type="button" className="btn btn-ghost min-h-11" disabled={!!busy} onClick={() => setConfirmRefresh(true)}>{t('drive_remote_refresh_action')}</button>)}
    </div>}
    {message && <p className="text-xs max-w-xs" role={['drive_document_error', 'drive_document_conflict', 'drive_document_unsupported'].includes(message) ? 'alert' : 'status'}>{t(message)}</p>}
  </div>;
}
