import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconTrash } from '@tabler/icons-react';
import { fetchJson } from '../../lib/api';

interface ProjectOption { id: string; name: string; project_code?: string | null; reference?: string | null }

/**
 * Suppression définitive d'une affaire : volontairement absente de la fiche et
 * de la liste des affaires (on y archive), réservée ici aux administrateurs.
 */
export function DeleteProjectCard() {
  const { t } = useTranslation();
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [confirmInput, setConfirmInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    fetchJson<ProjectOption[]>('/api/projects')
      .then(list => setProjects(Array.isArray(list) ? list : []))
      .catch(() => setProjects([]));
  }, []);

  const word = t('projects_delete_confirm_word');
  const selected = projects.find(p => p.id === selectedId);
  const canDelete = !!selected && !busy && confirmInput.trim().toLowerCase() === word.toLowerCase();

  const handleDelete = async () => {
    if (!selected || !canDelete) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/projects/${selected.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || '');
      }
      setProjects(prev => prev.filter(p => p.id !== selected.id));
      setSelectedId('');
      setConfirmInput('');
      setMessage({ kind: 'ok', text: t('settings_delete_project_done', { name: selected.name }) });
    } catch (e: any) {
      setMessage({ kind: 'error', text: t('projects_delete_failed', { error: e?.message || '' }) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl p-5 space-y-4" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
      <div>
        <h2 className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{t('settings_delete_project_title')}</h2>
        <p className="text-xs mt-1" style={{ color: 'var(--tblr-muted)' }}>{t('settings_delete_project_help')}</p>
      </div>
      <div className="max-w-md space-y-3">
        <div>
          <label htmlFor="delete-project-select" className="block text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--tblr-muted)' }}>{t('settings_delete_project_select')}</label>
          <select
            id="delete-project-select"
            className="w-full p-2 rounded-lg text-sm"
            style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
            value={selectedId}
            onChange={e => { setSelectedId(e.target.value); setConfirmInput(''); setMessage(null); }}
          >
            <option value="">{t('settings_delete_project_placeholder')}</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{[p.project_code || p.reference, p.name].filter(Boolean).join(' · ')}</option>
            ))}
          </select>
        </div>
        {selected && (
          <div>
            <p className="text-sm mb-2" style={{ color: 'var(--tblr-muted)' }}>{t('projects_delete_confirm_body', { name: selected.name })}</p>
            <label htmlFor="delete-project-confirm" className="block text-sm mb-2" style={{ color: 'var(--tblr-muted)' }}>{t('projects_delete_confirm_instruction', { word })}</label>
            <input
              id="delete-project-confirm"
              className="w-full p-2 rounded-lg text-sm"
              style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
              value={confirmInput}
              onChange={e => setConfirmInput(e.target.value)}
              placeholder={word}
              onKeyDown={e => { if (e.key === 'Enter') void handleDelete(); }}
            />
          </div>
        )}
      </div>
      {message && (
        <p role={message.kind === 'error' ? 'alert' : 'status'} className="text-sm" style={{ color: message.kind === 'error' ? 'var(--tblr-danger)' : 'var(--tblr-muted)' }}>{message.text}</p>
      )}
      <button type="button" disabled={!canDelete} onClick={() => { void handleDelete(); }}
        className="btn btn-danger disabled:opacity-40 disabled:cursor-not-allowed">
        <IconTrash size={16} aria-hidden />
        {busy ? t('projects_deleting') : t('projects_delete_confirm_button')}
      </button>
    </div>
  );
}
