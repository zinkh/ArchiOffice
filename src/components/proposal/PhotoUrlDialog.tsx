// Insertion d'une photo par son lien (comme « Ajouter un lien » des planches d'inspiration).
// L'image est téléchargée par le serveur (garde SSRF), puis remise à l'écran appelant sous
// forme de fichier : la boîte de légendes (FeasibilityPhotoDialog) prend ensuite le relais.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconLink, IconLoader2, IconX } from '@tabler/icons-react';
import { getAccessToken } from '../../lib/authToken';
import { fetchPhotoFromUrl, isHttpUrl } from '../../lib/feasibilityPhoto';

interface Props {
  onFile: (file: File) => void;
  onClose: () => void;
}

export function PhotoUrlDialog({ onFile, onClose }: Props) {
  const { t } = useTranslation();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const value = url.trim();
    if (!value || busy) return;
    if (!isHttpUrl(value)) { setError(t('feas_photo_url_invalid') as string); return; }
    setBusy(true);
    setError(null);
    try {
      const file = await fetchPhotoFromUrl(value, await getAccessToken());
      onFile(file);
    } catch (err: any) {
      setError(err?.message && err.message !== 'fetch' ? err.message : (t('feas_photo_url_failed') as string));
      setBusy(false);
    }
  };

  const inputStyle = { background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={t('feas_photo_url_title') as string}>
      <div className="rounded-lg shadow-xl w-full max-w-lg flex flex-col overflow-hidden" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}>
        <div className="p-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--tblr-border)' }}>
          <h3 className="text-sm font-bold flex items-center gap-2" style={{ color: 'var(--tblr-text)' }}><IconLink size={16} /> {t('feas_photo_url_title')}</h3>
          <button type="button" onClick={onClose} disabled={busy} aria-label={t('feas_cancel') as string} style={{ color: 'var(--tblr-muted)' }}><IconX size={18} /></button>
        </div>
        <div className="p-4 space-y-2">
          <input
            type="url" autoFocus value={url} disabled={busy}
            aria-label={t('feas_photo_url_title') as string}
            placeholder={t('feas_photo_url_placeholder') as string}
            className="w-full px-3 py-2 rounded-lg text-sm" style={inputStyle}
            onChange={e => { setUrl(e.target.value); setError(null); }}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void submit(); } }}
          />
          <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('feas_photo_url_hint')}</p>
          {error && <div role="alert" className="text-xs px-3 py-2 rounded-lg" style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}>{error}</div>}
        </div>
        <div className="p-4 flex justify-end gap-2" style={{ borderTop: '1px solid var(--tblr-border)' }}>
          <button type="button" onClick={onClose} disabled={busy} className="px-3 py-1.5 rounded-lg text-sm" style={{ color: 'var(--tblr-muted)' }}>{t('feas_cancel')}</button>
          <button type="button" onClick={() => void submit()} disabled={busy || !url.trim()}
            className="px-3 py-1.5 rounded-lg text-sm font-semibold disabled:opacity-60 flex items-center gap-1.5" style={{ background: 'var(--tblr-primary)', color: '#fff' }}>
            {busy && <IconLoader2 size={14} className="animate-spin" />} {busy ? t('feas_photo_url_loading') : t('feas_photo_url_add')}
          </button>
        </div>
      </div>
    </div>
  );
}
