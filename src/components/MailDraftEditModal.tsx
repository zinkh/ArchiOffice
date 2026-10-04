// Modification d'un brouillon de la boîte connectée : destinataires (À, Cc),
// objet et corps. Enregistrer réécrit le brouillon là où il vit (Gmail,
// Outlook ou dossier Brouillons IMAP) et ne l'envoie jamais : l'envoi reste
// un geste fait depuis la messagerie elle-même.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconX, IconLoader2, IconDeviceFloppy } from '@tabler/icons-react';
import { apiFetch } from '../lib/api';

interface MailDraftEditModalProps {
  accountId: string;
  draftId: string;
  onClose: () => void;
  onSaved: () => void;
}

interface DraftContent { id: string; to: string; cc: string; subject: string; text: string }

const FIELD_STYLE = { background: 'var(--tblr-bg)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' };

export default function MailDraftEditModal({ accountId, draftId, onClose, onSaved }: MailDraftEditModalProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState('');
  const [text, setText] = useState('');

  useEffect(() => {
    let cancelled = false;
    apiFetch<DraftContent>(`/api/mail/drafts/${encodeURIComponent(draftId)}?account_id=${encodeURIComponent(accountId)}`)
      .then(d => { if (cancelled) return; setTo(d.to); setCc(d.cc); setSubject(d.subject); setText(d.text); })
      .catch(err => { if (!cancelled) setError(err?.message || t('mail_action_error') as string); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, draftId]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!to.trim() || !subject.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/api/mail/drafts/${encodeURIComponent(draftId)}`, {
        method: 'PUT',
        body: JSON.stringify({ account_id: accountId, to, cc: cc || undefined, subject, text }),
      });
      onSaved();
      onClose();
    } catch (err: any) {
      setError(err?.message || t('mail_action_error') as string);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <form
        onSubmit={save}
        className="rounded-xl shadow-xl w-full max-w-lg max-h-[85dvh] flex flex-col"
        style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="p-4 flex justify-between items-center" style={{ borderBottom: '1px solid var(--tblr-border)' }}>
          <h3 className="text-base font-bold" style={{ color: 'var(--tblr-text)' }}>{t('mail_draft_edit_title')}</h3>
          <button type="button" onClick={onClose} style={{ color: 'var(--tblr-muted)' }}><IconX size={18} /></button>
        </div>

        <div className="p-4 space-y-3 flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-10" style={{ color: 'var(--tblr-muted)' }}><IconLoader2 size={20} className="animate-spin" /></div>
          ) : (
            <>
              <input required type="text" placeholder={t('mail_to') as string} value={to} onChange={e => setTo(e.target.value)} className="w-full p-2 rounded-lg text-sm" style={FIELD_STYLE} />
              <input type="text" placeholder={t('mail_cc') as string} value={cc} onChange={e => setCc(e.target.value)} className="w-full p-2 rounded-lg text-sm" style={FIELD_STYLE} />
              <input required type="text" placeholder={t('mailbox_compose_subject') as string} value={subject} onChange={e => setSubject(e.target.value)} className="w-full p-2 rounded-lg text-sm" style={FIELD_STYLE} />
              <textarea rows={10} placeholder={t('mailbox_compose_body') as string} value={text} onChange={e => setText(e.target.value)} className="w-full p-2 rounded-lg text-sm resize-none" style={FIELD_STYLE} />
              <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('mail_draft_edit_hint')}</p>
            </>
          )}
          {error && (
            <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-900/20 dark:border-red-700 px-3 py-2 text-xs text-red-700 dark:text-red-400">{error}</div>
          )}
        </div>

        <div className="p-4 flex justify-end" style={{ borderTop: '1px solid var(--tblr-border)' }}>
          <button type="submit" disabled={saving || loading} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-60" style={{ background: 'var(--tblr-primary)', color: 'white' }}>
            {saving ? <IconLoader2 size={14} className="animate-spin" /> : <IconDeviceFloppy size={14} />} {t('mail_draft_save')}
          </button>
        </div>
      </form>
    </div>
  );
}
