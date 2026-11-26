import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
export function SignatureProviderSettings({ plugin }: { plugin: 'docuseal' | 'zoho' }) {
  const { t } = useTranslation(); const [status, setStatus] = useState<any>(null); const [key, setKey] = useState(''); const [region, setRegion] = useState('eu');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [saved, setSaved] = useState(false);
  const refresh = async () => { const r = await fetch('/api/signatures/status'); const s = await r.json(); if (!r.ok) throw new Error(s.error); setStatus(s); setRegion(s.docuseal_region); };
  useEffect(() => { void refresh().catch(e => setError(e.message)); }, []);
  const save = async (disconnect = false) => {
    setBusy(true); setError(''); setSaved(false);
    try {
      const r = await fetch('/api/signatures/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        provider: disconnect ? null : plugin, ...(plugin === 'docuseal' ? { docuseal_api_key: key, docuseal_region: region, disconnect_docuseal: disconnect } : {}),
      }) });
      const s = await r.json(); if (!r.ok) throw new Error(s.error); setKey(''); await refresh(); setSaved(true);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  return <section className="space-y-3">
    <p className="text-sm">{t('signature_provider_current')} <strong>{status?.provider || t('signature_provider_none')}</strong></p>
    {status?.firma_enabled && <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>{t('signature_firma_priority')}</p>}
    {error && <p role="alert" style={{ color: 'var(--tblr-danger)' }}>{error}</p>}{saved && <p role="status">{t('signature_saved')}</p>}
    {plugin === 'docuseal' && <>
      <label className="block text-sm" htmlFor="docuseal-key">{t('signature_docuseal_key')}</label>
      <input id="docuseal-key" type="password" autoComplete="new-password" className="form-control w-full" value={key} onChange={e => setKey(e.target.value)} placeholder={status?.docuseal_connected ? t('signature_key_saved') : ''} />
      <label className="block text-sm" htmlFor="docuseal-region">{t('signature_docuseal_region')}</label>
      <select id="docuseal-region" className="form-control" value={region} onChange={e => setRegion(e.target.value)}><option value="eu">Europe (.eu)</option><option value="com">International (.com)</option></select>
    </>}
    <div className="flex flex-wrap gap-2">
      <button type="button" className="btn btn-primary" disabled={busy || (plugin === 'zoho' && !status?.zoho_connected) || (plugin === 'docuseal' && !key.trim() && !status?.docuseal_connected)} onClick={() => save()}>{t('signature_use_plugin')}</button>
      {plugin === 'docuseal' && status?.docuseal_connected && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => save(true)}>{t('proposal_sign_disconnect')}</button>}
    </div>
  </section>;
}
export function FirmaSignatureAdmin() {
  const { t } = useTranslation(); const [status, setStatus] = useState<any>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => { void fetch('/api/admin/signatures').then(async r => { const s = await r.json(); if (!r.ok) throw new Error(s.error); setStatus(s); }).catch(e => setError(e.message)); }, []);
  const toggle = async () => {
    setBusy(true); setError('');
    try {
      const r = await fetch('/api/admin/signatures', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ firma_enabled: !status.firma_enabled }) });
      const s = await r.json(); if (!r.ok) throw new Error(s.error); setStatus(s);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  return <section className="rounded-lg border p-4 space-y-3" style={{ background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)' }}>
    <h2 className="font-bold">{t('signature_platform_title')}</h2><p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>{t('signature_platform_rule')}</p>
    {error && <p role="alert" style={{ color: 'var(--tblr-danger)' }}>{error}</p>}
    {status && <>{!status.firma_configured && <p className="text-sm">{t('signature_firma_key_missing')}</p>}
      <button className="btn btn-primary" type="button" disabled={busy || (!status.firma_enabled && !status.firma_configured)} onClick={toggle}>{status.firma_enabled ? t('signature_firma_disable') : t('signature_firma_enable')}</button>
    </>}
  </section>;
}
export function ZohoSignConnection() {
  const { t } = useTranslation(); const [status, setStatus] = useState<any>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const call = async (path: string, method = 'GET') => { const r = await fetch('/api/zoho-sign/' + path, { method }); const s = await r.json(); if (!r.ok) throw new Error(s.error); return s; };
  const refresh = () => call('status').then(setStatus).catch(e => setError(e.message));
  useEffect(() => { void refresh(); }, []);
  const act = async () => {
    setBusy(true); setError('');
    try { if (status.connected) { await call('disconnect', 'DELETE'); await refresh(); } else window.location.assign((await call('auth')).url); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  return <section className="space-y-4">
    <p className="text-sm">{t('proposal_sign_setup')}</p>{error && <p role="alert" style={{ color: 'var(--tblr-danger)' }}>{error}</p>}
    {new URLSearchParams(window.location.search).has('zoho_sign_error') && <p role="alert" style={{ color: 'var(--tblr-danger)' }}>{t('proposal_sign_connect_error')}</p>}
    {status && <><p className="text-sm font-semibold">{status.connected ? t('proposal_sign_connected') : t('proposal_sign_disconnected')}</p>
      <p className="text-sm">{t('proposal_sign_callback')}</p><code className="block text-sm break-all select-all">{status.callback_url}</code>
      <button type="button" className="btn btn-primary" disabled={busy || (!status.connected && !status.has_credentials)} onClick={act}>{status.connected ? t('proposal_sign_disconnect') : t('proposal_sign_connect')}</button>
    </>}
  </section>;
}
