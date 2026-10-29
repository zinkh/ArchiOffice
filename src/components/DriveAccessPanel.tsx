import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { IconCloud, IconRefresh } from '@tabler/icons-react';
import { apiFetch } from '../lib/api';

interface Capability { enabled: boolean; code: string | null; message: string | null }
interface Device { id: string; name: string; platform: string; expiresAt: string }

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
      await apiFetch(`/api/desktop/v1/devices/${encodeURIComponent(pending)}`, { method: 'DELETE', signal: AbortSignal.timeout(15000) });
      setDevices(list => list.filter(d => d.id !== pending)); setPending(null);
    } catch { setRevokeError(true); }
    finally { setBusy(false); }
  };

  return <section aria-labelledby="drive-title" className="rounded-lg p-5 space-y-4" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-2 max-w-prose">
        <h2 id="drive-title" className="text-base font-semibold flex items-center gap-2"><IconCloud size={20} aria-hidden="true" />ArchiOffice Drive</h2>
        <p className="text-sm">{t('drive_access_intro')}</p>
      </div>
      <button type="button" className="btn btn-ghost" disabled={loading || busy} onClick={() => setRevision(v => v + 1)}>
        <IconRefresh size={16} aria-hidden="true" />{t('drive_access_refresh')}
      </button>
    </div>
    <div aria-live="polite" className="text-sm space-y-2">
      {loading ? <p>{t('drive_access_loading')}</p> : capability && <>
        <p className="font-semibold">{t(capability.enabled ? 'drive_access_eligible' : capability.code === 'DRIVE_ONLINE_VERIFICATION_REQUIRED' ? 'drive_access_online' : 'drive_access_paid')}</p>
        {!capability.enabled && capability.code === 'DRIVE_SUBSCRIPTION_REQUIRED' && <Link className="btn btn-primary" to="/billing">{t('drive_access_billing')}</Link>}
      </>}
      {error && <p role="alert">{t('drive_access_error')}</p>}
    </div>
    <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>{t('drive_access_native_pending')}</p>
    <div className="pt-4 space-y-3" style={{ borderTop: '1px solid var(--tblr-border)' }}>
      <h3 className="text-sm font-semibold">{t('drive_access_devices')}</h3>
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
