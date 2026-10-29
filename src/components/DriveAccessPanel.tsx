import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { IconCloud, IconRefresh } from '@tabler/icons-react';
import { apiFetch } from '../lib/api';
import { desktopBridge } from '../lib/desktopBridge';

interface Capability { enabled: boolean; code: string | null; message: string | null; local?: boolean; expiresAt?: string | null }
interface Device { id: string; name: string; platform: string; expiresAt: string | null }

/** Readiness and personal device management. Native enrollment ships with the agent. */
export function DriveAccessPanel() {
  const { t } = useTranslation();
  const [capability, setCapability] = useState<Capability | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revokeError, setRevokeError] = useState(false);
  const [localError, setLocalError] = useState(false);
  const bridge = desktopBridge();
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<'queued' | 'retried' | 'error' | null>(null);
  const [transfers, setTransfers] = useState<{ pending: number; blocked: number; conflicts: number } | null>(null);
  const enqueueFile = async () => {
    if (!bridge?.enqueueDriveFile || uploading) return;
    setUploading(true); setUploadMessage(null);
    try { const result = await bridge.enqueueDriveFile(); if (result.queued) setUploadMessage('queued'); }
    catch { setUploadMessage('error'); }
    finally { setUploading(false); }
  };
  const retryTransfers = async () => {
    if (!bridge?.retryDriveTransfers || uploading) return;
    setUploading(true); setUploadMessage(null);
    try { await bridge.retryDriveTransfers(); setUploadMessage('retried'); }
    catch { setUploadMessage('error'); }
    finally { setUploading(false); }
  };
  useEffect(() => {
    if (!capability?.local || !capability.enabled || !bridge?.getDriveStatus) { setTransfers(null); return; }
    let current = true;
    const load = async () => { try { const value = await bridge.getDriveStatus!(); if (current) setTransfers(value); } catch { if (current) setTransfers(null); } };
    void load(); const timer = setInterval(() => void load(), 10000);
    return () => { current = false; clearInterval(timer); };
  }, [capability?.local, capability?.enabled]);
  const [remotePending, setRemotePending] = useState(false);
  const localAction = async (action: 'connect' | 'refresh') => {
    if (busy) return;
    setBusy(true); setLocalError(false);
    try {
      await apiFetch(`/api/desktop/v1/local/${action}`, { method: 'POST', signal: AbortSignal.timeout(30000) });
    } catch { setLocalError(true); }
    finally { setBusy(false); setRevision(v => v + 1); }
  };

  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let current = true;
    setLoading(true); setError(false); setCapability(null); setDevices([]);
    Promise.allSettled([
      apiFetch<Capability>('/api/desktop/v1/capabilities', { signal: controller.signal }),
      apiFetch<Device[]>('/api/desktop/v1/devices', { signal: controller.signal }),
    ]).then(([cap, list]) => {
      if (!current) return;
      if (cap.status === 'fulfilled' && typeof cap.value?.enabled === 'boolean') setCapability(cap.value);
      else setError(true);
      if (list.status === 'fulfilled' && Array.isArray(list.value)) setDevices(list.value);
      else setError(true);
      setLoading(false);
    }).finally(() => clearTimeout(timeout));
    return () => { current = false; clearTimeout(timeout); controller.abort(); };
  }, [revision]);

  const revoke = async () => {
    if (!pending || busy) return;
    setBusy(true); setRevokeError(false);
    try {
      const result = await apiFetch<{ remoteRevocationPending?: boolean }>(`/api/desktop/v1/devices/${encodeURIComponent(pending)}`, { method: 'DELETE', signal: AbortSignal.timeout(15000) });
      setRemotePending(!!result.remoteRevocationPending);
      setDevices(list => list.filter(d => d.id !== pending)); setPending(null); setRevision(v => v + 1);
    } catch { setRevokeError(true); }
    finally { setBusy(false); }
  };

  return <section aria-labelledby="drive-title" className="rounded-lg p-5 space-y-4" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-2 max-w-prose">
        <h2 id="drive-title" className="text-base font-semibold flex items-center gap-2"><IconCloud size={20} aria-hidden="true" />ArchiOffice Drive</h2>
        <p className="text-sm">{t('drive_access_intro')}</p>
      </div>
      <button type="button" className="btn btn-ghost" disabled={loading || busy} onClick={() => capability?.local ? void localAction('refresh') : setRevision(v => v + 1)}>
        <IconRefresh size={16} aria-hidden="true" />{t('drive_access_refresh')}
      </button>
    </div>
    <div aria-live="polite" className="text-sm space-y-2">
      {loading ? <p>{t('drive_access_loading')}</p> : capability && <>
        <p className="font-semibold">{t(capability.enabled ? (capability.local ? 'drive_local_authorized' : 'drive_access_eligible') : capability.local ? (capability.code === 'DRIVE_TRUST_UNCONFIGURED' ? 'drive_local_unconfigured' : 'drive_local_required') : 'drive_access_paid')}</p>
        {capability.local && capability.expiresAt && <p>{t('drive_local_until', { date: new Date(capability.expiresAt).toLocaleString() })}</p>}
        {capability.local && !capability.enabled && capability.code !== 'DRIVE_TRUST_UNCONFIGURED' && <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void localAction('connect')}>{t(busy ? 'drive_local_connecting' : 'drive_local_connect')}</button>}
        {!capability.enabled && capability.code === 'DRIVE_SUBSCRIPTION_REQUIRED' && <Link className="btn btn-primary" to="/billing">{t('drive_access_billing')}</Link>}
      </>}
      {error && <p role="alert">{t('drive_access_error')}</p>}
      {localError && <p role="alert">{t('drive_local_error')}</p>}
      {remotePending && <p role="status">{t('drive_local_revoke_pending')}</p>}
    </div>
    <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>{t('drive_access_native_pending')}</p>
    {capability?.local && capability.enabled && bridge?.enqueueDriveFile && <div className="space-y-2 text-sm">
      <button type="button" className="btn btn-primary" disabled={busy || uploading} onClick={() => void enqueueFile()}>{t(uploading ? 'drive_transfer_preparing' : 'drive_transfer_add')}</button>
      {transfers && transfers.blocked > 0 && bridge.retryDriveTransfers && <button type="button" className="btn btn-ghost" disabled={busy || uploading} onClick={() => void retryTransfers()}>{t('drive_transfer_retry')}</button>}
      <div aria-live="polite">
        {uploadMessage && <p role={uploadMessage === 'error' ? 'alert' : 'status'}>{t(uploadMessage === 'queued' ? 'drive_transfer_queued' : uploadMessage === 'retried' ? 'drive_transfer_retried' : 'drive_transfer_error')}</p>}
        {transfers && <p>{t('drive_transfer_counts', transfers)}</p>}
      </div>
    </div>}
    <div className="pt-4 space-y-3" style={{ borderTop: '1px solid var(--tblr-border)' }}>
      <h3 className="text-sm font-semibold">{t(capability?.local ? 'drive_local_device' : 'drive_access_devices')}</h3>
      {!loading && !error && devices.length === 0 && <p className="text-sm">{t('drive_access_empty')}</p>}
      <ul className="space-y-3">
        {devices.map(device => <li key={device.id} className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <div className="min-w-0"><p className="font-medium break-words">{device.name}</p><p style={{ color: 'var(--tblr-muted)' }}>{device.platform === 'macos' ? 'macOS' : 'Windows'}</p></div>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => { setPending(device.id); setRevokeError(false); }}>{t('drive_access_disconnect')}</button>
        </li>)}
      </ul>
      {pending && <div className="space-y-3 text-sm" role="group" aria-label={t('drive_access_disconnect')}>
        <p>{t('drive_access_confirm')}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={revoke}>{t(busy ? 'drive_access_disconnecting' : 'drive_access_confirm_action')}</button>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setPending(null)}>{t('drive_access_cancel')}</button>
        </div>
        {revokeError && <p role="alert">{t('drive_access_revoke_error')}</p>}
      </div>}
      <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>{t('drive_access_devices_help')}</p>
    </div>
  </section>;
}
