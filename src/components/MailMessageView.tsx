// Full-message read view for the Mailbox page and CorrespondenceTab — fetches
// a single message's body live (never persisted) from whichever provider it
// came from, and renders it inside a fully sandboxed iframe.
//
// The iframe has an empty `sandbox=""` — no allow-scripts, no
// allow-same-origin. That second omission is deliberate and has a real
// consequence worth documenting: without allow-same-origin the iframe's
// content has an opaque origin, so the parent page cannot read
// contentDocument/contentWindow to measure its rendered height (a
// same-origin-policy restriction, not a bug) — a height-reporting script
// injected into the body would also need allow-scripts, which is exactly
// the attribute this view must never grant. So instead of an auto-sizing
// iframe, this uses a fixed height with its own internal scrollbar.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconX, IconPaperclip, IconPhoto, IconLoader2, IconDownload, IconArrowBackUp } from '@tabler/icons-react';
import { apiFetch } from '../lib/api';
import MailComposeModal, { type MailReplyContext } from './MailComposeModal';

export type MailProvider = 'google' | 'microsoft' | 'infomaniak';

interface FullMailMessage {
  id: string;
  subject: string;
  from: string;
  to: string;
  cc: string;
  date: string | null;
  messageIdHeader: string | null;
  threadId: string | null;
  bodyHtml: string | null;
  bodyText: string | null;
  attachments: { id: string; filename: string; mimeType: string; size: number }[];
}

interface MailMessageViewProps {
  provider: MailProvider;
  messageId: string; // Gmail/Outlook message id, or the IMAP uid as a string
  folder?: string; // IMAP only — required to reopen the right mailbox
  // All connected mailboxes able to send natively — passed through to the
  // reply compose modal so it can offer a provider switch when relevant.
  connectedProviders?: { provider: MailProvider; email: string }[];
  onClose: () => void;
}

function messageEndpoint(provider: MailProvider, messageId: string, folder?: string): string {
  if (provider === 'google') return `/api/gmail/messages/${encodeURIComponent(messageId)}`;
  if (provider === 'microsoft') return `/api/outlook/messages/${encodeURIComponent(messageId)}`;
  return `/api/mail/imap/messages/${encodeURIComponent(folder || 'INBOX')}/${encodeURIComponent(messageId)}`;
}

function attachmentUrl(provider: MailProvider, messageId: string, folder: string | undefined, attachment: { id: string; filename: string; mimeType: string }): string {
  if (provider === 'google') {
    return `/api/gmail/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachment.id)}?filename=${encodeURIComponent(attachment.filename)}&mimeType=${encodeURIComponent(attachment.mimeType)}`;
  }
  if (provider === 'microsoft') return `/api/outlook/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachment.id)}`;
  return `/api/mail/imap/messages/${encodeURIComponent(folder || 'INBOX')}/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachment.id)}`;
}

// "From" headers commonly read as "Name <email@example.com>" — replying
// needs just the address, not the display name.
function extractEmailAddress(raw: string): string {
  const match = raw.match(/<([^>]+)>/);
  return (match ? match[1] : raw).trim();
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

export default function MailMessageView({ provider, messageId, folder, connectedProviders, onClose }: MailMessageViewProps) {
  const { t } = useTranslation();
  const [message, setMessage] = useState<FullMailMessage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showImages, setShowImages] = useState(false);
  const [replying, setReplying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiFetch<FullMailMessage>(messageEndpoint(provider, messageId, folder))
      .then(m => { if (!cancelled) setMessage(m); })
      .catch(err => { if (!cancelled) setError(err?.message || t('mail_read_error') as string); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, messageId, folder]);

  const hasBlockedImages = !!message?.bodyHtml?.includes('data-blocked-src=');
  const renderedHtml = message?.bodyHtml && showImages
    ? message.bodyHtml.replace(/data-blocked-src="([^"]*)"/g, (_m, url) => `src="${url}" data-blocked-src="${url}"`)
    : message?.bodyHtml || '';

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="rounded-xl shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col"
        style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="p-4 flex justify-between items-start gap-3" style={{ borderBottom: '1px solid var(--tblr-border)' }}>
          <div className="min-w-0">
            <h3 className="text-base font-bold truncate" style={{ color: 'var(--tblr-text)' }}>{message?.subject || (loading ? t('mail_loading') : '(Sans objet)')}</h3>
            {message && (
              <div className="text-xs mt-1 space-y-0.5" style={{ color: 'var(--tblr-muted)' }}>
                <div className="truncate">{t('mail_from')}: {message.from}</div>
                <div className="truncate">{t('mail_to')}: {message.to}{message.cc ? ` · ${t('mail_cc')}: ${message.cc}` : ''}</div>
                {message.date && <div>{new Date(message.date).toLocaleString()}</div>}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {message && (
              <button
                onClick={() => setReplying(true)}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium"
                style={{ border: '1px solid var(--tblr-primary)', color: 'var(--tblr-primary)' }}
              >
                <IconArrowBackUp size={13} /> {t('mailbox_reply')}
              </button>
            )}
            <button onClick={onClose} style={{ color: 'var(--tblr-muted)' }}><IconX size={18} /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading && (
            <div className="flex items-center justify-center py-12" style={{ color: 'var(--tblr-muted)' }}>
              <IconLoader2 size={20} className="animate-spin" />
            </div>
          )}
          {error && (
            <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-900/20 dark:border-red-700 px-3 py-2 text-sm text-red-700 dark:text-red-400">
              {error}
            </div>
          )}
          {!loading && !error && message && (
            <>
              {hasBlockedImages && !showImages && (
                <button
                  onClick={() => setShowImages(true)}
                  className="flex items-center gap-1.5 mb-3 px-2.5 py-1.5 rounded-lg text-xs font-medium"
                  style={{ border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
                >
                  <IconPhoto size={13} /> {t('mail_show_images')}
                </button>
              )}
              {message.bodyHtml ? (
                <iframe
                  title={message.subject || 'email'}
                  sandbox=""
                  srcDoc={renderedHtml}
                  className="w-full rounded-lg"
                  style={{ height: '55vh', border: '1px solid var(--tblr-border)', background: 'white' }}
                />
              ) : (
                <pre className="whitespace-pre-wrap text-sm font-sans" style={{ color: 'var(--tblr-text)' }}>{message.bodyText || t('mail_empty_body')}</pre>
              )}

              {message.attachments.length > 0 && (
                <div className="mt-4 space-y-1.5">
                  <h4 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--tblr-muted)' }}>{t('mail_attachments')}</h4>
                  {message.attachments.map(a => (
                    <a
                      key={a.id}
                      href={attachmentUrl(provider, messageId, folder, a)}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                      style={{ border: '1px solid var(--tblr-border)' }}
                    >
                      <IconPaperclip size={14} className="shrink-0" />
                      <span className="truncate flex-1">{a.filename}</span>
                      <span className="text-xs shrink-0" style={{ color: 'var(--tblr-muted)' }}>{formatSize(a.size)}</span>
                      <IconDownload size={14} className="shrink-0" />
                    </a>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>

    {replying && message && (
      <MailComposeModal
        connectedProviders={connectedProviders || [{ provider, email: '' }]}
        replyTo={{
          provider,
          messageId,
          threadId: message.threadId,
          messageIdHeader: message.messageIdHeader,
          subject: message.subject,
          fromAddress: extractEmailAddress(message.from),
        } as MailReplyContext}
        onClose={() => setReplying(false)}
      />
    )}
    </>
  );
}
