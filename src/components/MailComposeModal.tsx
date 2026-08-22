// Compose/reply window — sends via the connected provider's own API
// (Gmail messages.send, Outlook sendMail/reply), never the legacy SMTP path,
// except for IMAP/Infomaniak connections: the IMAP protocol has no send
// capability at all (not a design choice — the protocol simply doesn't have
// one) and Infomaniak has no send API either, so that case falls back to the
// existing /api/send-email SMTP route. Kept deliberately simple — a plain
// <textarea>, no rich-text editor — consistent with "minimal but useful".
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconX, IconPaperclip, IconLoader2, IconSend, IconBrandGoogle, IconBrandWindows, IconMailbox } from '@tabler/icons-react';
import { apiFetch } from '../lib/api';
import { getAccessToken } from '../lib/authToken';

export type MailProvider = 'google' | 'microsoft' | 'infomaniak';

export interface MailReplyContext {
  provider: MailProvider;
  messageId: string; // Gmail/Outlook id — unused when replying from an infomaniak message (SMTP fallback has no native reply)
  threadId?: string | null; // Gmail only — keeps the reply in the same thread
  messageIdHeader?: string | null; // Gmail only — becomes In-Reply-To/References
  subject: string;
  fromAddress: string; // becomes the "to" field
}

interface MailComposeModalProps {
  connectedProviders: { provider: MailProvider; email: string }[];
  replyTo?: MailReplyContext | null;
  onClose: () => void;
  onSent?: () => void;
}

const SENDABLE: MailProvider[] = ['google', 'microsoft'];

const PROVIDER_ICON: Record<MailProvider, typeof IconBrandGoogle> = {
  google: IconBrandGoogle,
  microsoft: IconBrandWindows,
  infomaniak: IconMailbox,
};

async function postForm<T>(url: string, form: FormData): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(url, { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Échec de l'envoi (${res.status})`), { code: data.code });
  return data;
}

export default function MailComposeModal({ connectedProviders, replyTo, onClose, onSent }: MailComposeModalProps) {
  const { t } = useTranslation();
  const sendable = connectedProviders.filter(p => SENDABLE.includes(p.provider));
  const imapOnly = sendable.length === 0;

  const [provider, setProvider] = useState<MailProvider | null>(
    replyTo && SENDABLE.includes(replyTo.provider) ? replyTo.provider : sendable[0]?.provider || null
  );
  const [to, setTo] = useState(replyTo?.fromAddress || '');
  const [subject, setSubject] = useState(
    replyTo ? (/^re\s*:/i.test(replyTo.subject) ? replyTo.subject : `Re: ${replyTo.subject}`) : ''
  );
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isNativeReply = !!replyTo && replyTo.provider === provider;

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!to.trim() || !subject.trim() || !provider) return;
    setSending(true);
    setError(null);
    try {
      if (provider === 'google') {
        const fd = new FormData();
        fd.set('to', to);
        fd.set('subject', subject);
        fd.set('text', body);
        if (isNativeReply && replyTo?.threadId) fd.set('threadId', replyTo.threadId);
        if (isNativeReply && replyTo?.messageIdHeader) {
          fd.set('inReplyTo', replyTo.messageIdHeader);
          fd.set('references', replyTo.messageIdHeader);
        }
        files.forEach(f => fd.append('attachments', f));
        await postForm('/api/gmail/send', fd);
      } else if (provider === 'microsoft' && isNativeReply) {
        const fd = new FormData();
        fd.set('comment', body);
        files.forEach(f => fd.append('attachments', f));
        await postForm(`/api/outlook/messages/${encodeURIComponent(replyTo!.messageId)}/reply`, fd);
      } else if (provider === 'microsoft') {
        const fd = new FormData();
        fd.set('to', to);
        fd.set('subject', subject);
        fd.set('text', body);
        files.forEach(f => fd.append('attachments', f));
        await postForm('/api/outlook/send', fd);
      } else {
        // infomaniak (or no provider capable of sending natively): SMTP fallback.
        await apiFetch('/api/send-email', {
          method: 'POST',
          body: JSON.stringify({ to, subject, text: body, html: `<p>${body.replace(/\n/g, '<br/>')}</p>` }),
        });
      }
      onSent?.();
      onClose();
    } catch (err: any) {
      setError(err?.code === 'INSUFFICIENT_SCOPE' ? t('mail_reconnect_banner') as string : err?.message || t('mail_action_error') as string);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <form
        onSubmit={send}
        className="rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col"
        style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="p-4 flex justify-between items-center" style={{ borderBottom: '1px solid var(--tblr-border)' }}>
          <h3 className="text-base font-bold" style={{ color: 'var(--tblr-text)' }}>
            {replyTo ? t('mail_compose_reply_title') : t('mail_compose_new_title')}
          </h3>
          <button type="button" onClick={onClose} style={{ color: 'var(--tblr-muted)' }}><IconX size={18} /></button>
        </div>

        <div className="p-4 space-y-3 flex-1 overflow-y-auto">
          {sendable.length > 1 && !isNativeReply && (
            <div className="flex gap-2">
              {sendable.map(p => {
                const Icon = PROVIDER_ICON[p.provider];
                return (
                  <button
                    key={p.provider}
                    type="button"
                    onClick={() => setProvider(p.provider)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium"
                    style={p.provider === provider
                      ? { background: 'var(--tblr-primary-lt)', color: 'var(--tblr-primary)', border: '1px solid var(--tblr-primary)' }
                      : { border: '1px solid var(--tblr-border)', color: 'var(--tblr-muted)' }}
                  >
                    <Icon size={13} /> {p.email}
                  </button>
                );
              })}
            </div>
          )}

          {imapOnly && (
            <p className="text-xs rounded-lg px-3 py-2" style={{ background: 'var(--tblr-bg)', color: 'var(--tblr-muted)' }}>
              {t('mail_compose_imap_fallback')}
            </p>
          )}

          <input
            required
            type="text"
            placeholder={t('mail_to') as string}
            value={to}
            onChange={e => setTo(e.target.value)}
            disabled={isNativeReply}
            className="w-full p-2 rounded-lg text-sm disabled:opacity-60"
            style={{ background: 'var(--tblr-bg)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
          />
          <input
            required
            type="text"
            placeholder={t('mailbox_compose_subject') as string}
            value={subject}
            onChange={e => setSubject(e.target.value)}
            disabled={isNativeReply}
            className="w-full p-2 rounded-lg text-sm disabled:opacity-60"
            style={{ background: 'var(--tblr-bg)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
          />
          <textarea
            required
            rows={8}
            placeholder={t('mailbox_compose_body') as string}
            value={body}
            onChange={e => setBody(e.target.value)}
            className="w-full p-2 rounded-lg text-sm resize-none"
            style={{ background: 'var(--tblr-bg)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
          />

          <div className="flex items-center gap-2 flex-wrap">
            <label className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer" style={{ border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}>
              <IconPaperclip size={13} /> {t('mailbox_compose_attach')}
              <input type="file" multiple hidden onChange={e => setFiles(Array.from(e.target.files || []))} />
            </label>
            {files.map((f, i) => (
              <span key={i} className="text-xs px-2 py-1 rounded-lg" style={{ background: 'var(--tblr-bg)', color: 'var(--tblr-muted)' }}>{f.name}</span>
            ))}
          </div>

          {error && (
            <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-900/20 dark:border-red-700 px-3 py-2 text-xs text-red-700 dark:text-red-400">
              {error}
            </div>
          )}
        </div>

        <div className="p-4 flex justify-end" style={{ borderTop: '1px solid var(--tblr-border)' }}>
          <button
            type="submit"
            disabled={sending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-60"
            style={{ background: 'var(--tblr-primary)', color: 'white' }}
          >
            {sending ? <IconLoader2 size={14} className="animate-spin" /> : <IconSend size={14} />} {t('mailbox_compose_send')}
          </button>
        </div>
      </form>
    </div>
  );
}
