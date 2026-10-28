import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ModalShell } from '../ui/ModalShell';
import { fetchJson } from '../../lib/api';
import { isMergeConfirmed, MERGE_CONFIRM_WORD } from '../../lib/contactMerge';

interface Preview {
  groups: number;
  duplicates: number;
  skipped: number;
  sample: { primary_id: string; name: string; count: number }[];
}

interface Props {
  onClose: () => void;
  onDone: (merged: number) => void;
}

/**
 * Fusion automatique des doublons sûrs (même nom, aucune valeur en conflit) : aperçu fourni
 * par le serveur, confirmation en tapant FUSIONNER, puis passages de 25 groupes jusqu'à épuisement.
 */
export function SafeMergeDialog({ onClose, onDone }: Props) {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const [word, setWord] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    fetchJson<Preview>('/api/contacts/merge-safe', { method: 'POST', body: JSON.stringify({ dry_run: true }) })
      .then(setPreview)
      .catch((e: any) => setError(e?.message || t('contacts_safe_merge_error')));
  }, [t]);

  const run = async () => {
    setBusy(true);
    setError('');
    let merged = 0;
    try {
      for (;;) {
        const r = await fetchJson<{ merged: number; remaining: number; failed: unknown[] }>(
          '/api/contacts/merge-safe', { method: 'POST', body: JSON.stringify({ confirm: word }) });
        merged += r.merged;
        setProgress(merged);
        if (r.remaining === 0 || r.merged === 0) {
          if (r.failed.length) setError(t('contacts_safe_merge_partial', { count: r.failed.length }));
          break;
        }
      }
      onDone(merged);
    } catch (e: any) {
      setError(e?.message || t('contacts_safe_merge_error'));
      if (merged) onDone(merged);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell title={t('contacts_safe_merge_title')} subtitle={t('contacts_safe_merge_subtitle')} onClose={onClose} busy={busy} size="md"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>{t('btn_cancel')}</button>
          <button type="button" className="btn btn-primary" onClick={run}
            disabled={busy || !preview || preview.groups === 0 || !isMergeConfirmed(word)}>
            {busy ? t('contacts_safe_merge_running', { count: progress }) : t('contacts_safe_merge_run', { count: preview?.groups ?? 0 })}
          </button>
        </div>
      )}>
      {!preview && !error && <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>{t('contacts_safe_merge_loading')}</p>}
      {error && <p role="alert" className="text-sm mb-3" style={{ color: 'var(--tblr-danger)' }}>{error}</p>}
      {preview && (
        <div className="space-y-4 text-sm" style={{ color: 'var(--tblr-text)' }}>
          <p>{t('contacts_safe_merge_summary', { groups: preview.groups, duplicates: preview.duplicates })}</p>
          {preview.skipped > 0 && <p style={{ color: 'var(--tblr-muted)' }}>{t('contacts_safe_merge_skipped', { count: preview.skipped })}</p>}
          {preview.sample.length > 0 && (
            <ul className="max-h-56 overflow-y-auto space-y-1 rounded-md p-2" style={{ border: '1px solid var(--tblr-border)' }}>
              {preview.sample.map(g => (
                <li key={g.primary_id} className="flex justify-between gap-2">
                  <span className="truncate">{g.name}</span>
                  <span className="shrink-0" style={{ color: 'var(--tblr-muted)' }}>{t('contacts_safe_merge_fiches', { count: g.count })}</span>
                </li>
              ))}
            </ul>
          )}
          {preview.groups > 0 && (
            <div>
              <label htmlFor="safe-merge-word" className="block mb-1 font-medium">{t('contacts_safe_merge_confirm', { word: MERGE_CONFIRM_WORD })}</label>
              <input id="safe-merge-word" className="form-control w-full" value={word} onChange={e => setWord(e.target.value)} disabled={busy} autoComplete="off" />
            </div>
          )}
        </div>
      )}
    </ModalShell>
  );
}
