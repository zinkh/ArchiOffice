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
//
// Gestes sur le message : répondre, répondre à tous, transférer (pièces
// jointes d'origine seulement sur case cochée), en faire une tâche, et la
// « Proposition IA » (résumé, classement, brouillons) qui ne fait rien sans clic.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconX, IconPaperclip, IconPhoto, IconLoader2, IconDownload, IconArrowBackUp, IconArrowBackUpDouble, IconArrowForwardUp, IconChecklist, IconSparkles } from '@tabler/icons-react';
import { apiFetch } from '../lib/api';
import MailComposeModal, { type MailReplyContext, type MailComposeInitial, type MailForwardAttachment } from './MailComposeModal';
import MailTaskModal, { type MailRef, type MailTaskDraft } from './MailTaskModal';
import MailAssistPanel from './MailAssistPanel';
import { forwardSubject, forwardedBody, messageText, quotedReply, replyAllRecipients } from '../lib/mailAssist';
import type { MailAccount, MailProvider } from '../hooks/useMailAccounts';

export type { MailProvider };

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

export type MailViewAction = 'reply' | 'replyAll' | 'forward';

interface MailMessageViewProps {
  provider: MailProvider;
  accountId: string; // désigne le compte, nécessaire dès qu'il en existe plusieurs du même fournisseur
  messageId: string; // Gmail/Outlook message id, or the IMAP uid as a string
  folder?: string; // IMAP only — required to reopen the right mailbox
  // All connected mailboxes able to send natively — passed through to the
  // reply compose modal so it can offer an account switch when relevant.
  accounts?: MailAccount[];
  /** Ouvre directement le composeur une fois le message lu (boutons de la liste). */
  initialAction?: MailViewAction;
  onClose: () => void;
}

/** Ce que le composeur ouvert doit reprendre : le geste, et le brouillon éventuel de l'IA. */
interface ComposerState {
  kind: MailViewAction;
  draft?: string;
  to?: string;
}

function messageEndpoint(provider: MailProvider, accountId: string, messageId: string, folder?: string): string {
  const accountParam = `accountId=${encodeURIComponent(accountId)}`;
  if (provider === 'google') return `/api/gmail/messages/${encodeURIComponent(messageId)}?${accountParam}`;
  if (provider === 'microsoft') return `/api/outlook/messages/${encodeURIComponent(messageId)}?${accountParam}`;
  return `/api/mail/imap/messages/${encodeURIComponent(folder || 'INBOX')}/${encodeURIComponent(messageId)}?${accountParam}`;
}

function attachmentUrl(provider: MailProvider, accountId: string, messageId: string, folder: string | undefined, attachment: { id: string; filename: string; mimeType: string }): string {
  const accountParam = `accountId=${encodeURIComponent(accountId)}`;
  if (provider === 'google') {
    return `/api/gmail/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachment.id)}?filename=${encodeURIComponent(attachment.filename)}&mimeType=${encodeURIComponent(attachment.mimeType)}&${accountParam}`;
  }
  if (provider === 'microsoft') return `/api/outlook/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachment.id)}?${accountParam}`;
  return `/api/mail/imap/messages/${encodeURIComponent(folder || 'INBOX')}/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachment.id)}?${accountParam}`;
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

const ACTION_BUTTON = 'flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium';

export default function MailMessageView({ provider, accountId, messageId, folder, accounts, initialAction, onClose }: MailMessageViewProps) {
  const { t } = useTranslation();
  const [message, setMessage] = useState<FullMailMessage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showImages, setShowImages] = useState(false);
  const [composer, setComposer] = useState<ComposerState | null>(null);
  const [taskDraft, setTaskDraft] = useState<MailTaskDraft | null>(null);
  const [assistOpen, setAssistOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiFetch<FullMailMessage>(messageEndpoint(provider, accountId, messageId, folder))
      .then(m => {
        if (cancelled) return;
        setMessage(m);
        if (initialAction) setComposer({ kind: initialAction });
      })
      .catch(err => { if (!cancelled) setError(err?.message || t('mail_read_error') as string); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, accountId, messageId, folder]);

  const hasBlockedImages = !!message?.bodyHtml?.includes('data-blocked-src=');
  const renderedHtml = message?.bodyHtml && showImages
    ? message.bodyHtml.replace(/data-blocked-src="([^"]*)"/g, (_m, url) => `src="${url}" data-blocked-src="${url}"`)
    : message?.bodyHtml || '';

  const myAddresses = (accounts || []).map(a => a.email || '').filter(Boolean);
  const everyone = message ? replyAllRecipients(message, myAddresses) : { to: '', cc: '' };
  const canReplyAll = !!message && !!everyone.cc;

  const mailRef: MailRef | null = message ? {
    provider,
    accountId,
    externalMessageId: provider === 'infomaniak' ? `${folder || 'INBOX'}:${messageId}` : messageId,
    threadId: message.threadId,
    subject: message.subject,
    from: message.from,
    to: message.to,
    date: message.date,
  } : null;

  // Réponse native d'Outlook : le serveur cite lui-même le message d'origine, on ne le recite pas.
  const outlookNativeReply = provider === 'microsoft';

  const composerProps = (() => {
    if (!composer || !message) return null;
    const text = messageText(message);
    if (composer.kind === 'forward') {
      const initial: MailComposeInitial = {
        to: composer.to || '',
        subject: forwardSubject(message.subject || ''),
        body: composer.draft || '',
        quote: forwardedBody(message, text),
      };
      const forwardAttachments: MailForwardAttachment[] = message.attachments.map(a => ({
        ...a, url: attachmentUrl(provider, accountId, messageId, folder, a),
      }));
      return { replyTo: null as MailReplyContext | null, initial, forwardAttachments, title: t('mail_compose_forward_title') as string };
    }
    const replyAll = composer.kind === 'replyAll';
    const replyTo: MailReplyContext = {
      accountId,
      provider,
      messageId,
      threadId: message.threadId,
      messageIdHeader: message.messageIdHeader,
      subject: message.subject,
      fromAddress: replyAll ? everyone.to || extractEmailAddress(message.from) : extractEmailAddress(message.from),
      replyAll,
    };
    const initial: MailComposeInitial = {
      body: composer.draft || '',
      cc: replyAll ? everyone.cc : undefined,
      quote: outlookNativeReply && !replyAll ? undefined : quotedReply(message, text),
    };
    return { replyTo, initial, forwardAttachments: undefined, title: undefined };
  })();

  const openTask = (draft?: MailTaskDraft) => {
    if (!message) return;
    setTaskDraft(draft || { title: message.subject || '', description: '', projectId: null, assigneeId: null, dueDate: '', priority: 'normal' });
  };

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="rounded-xl shadow-xl w-full max-w-3xl max-h-[85dvh] flex flex-col"
        style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="p-4 space-y-3" style={{ borderBottom: '1px solid var(--tblr-border)' }}>
          <div className="flex justify-between items-start gap-3">
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
            <button onClick={onClose} aria-label={t('btn_close') as string} className="shrink-0" style={{ color: 'var(--tblr-muted)' }}><IconX size={18} /></button>
          </div>

          {message && (
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => setComposer({ kind: 'reply' })} className={ACTION_BUTTON} style={{ border: '1px solid var(--tblr-primary)', color: 'var(--tblr-primary)' }}>
                <IconArrowBackUp size={13} /> {t('mailbox_reply')}
              </button>
              {canReplyAll && (
                <button onClick={() => setComposer({ kind: 'replyAll' })} className={ACTION_BUTTON} style={{ border: '1px solid var(--tblr-primary)', color: 'var(--tblr-primary)' }}>
                  <IconArrowBackUpDouble size={13} /> {t('mail_reply_all')}
                </button>
              )}
              <button onClick={() => setComposer({ kind: 'forward' })} className={ACTION_BUTTON} style={{ border: '1px solid var(--tblr-primary)', color: 'var(--tblr-primary)' }}>
                <IconArrowForwardUp size={13} /> {t('mail_forward')}
              </button>
              <button onClick={() => openTask()} className={ACTION_BUTTON} style={{ border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}>
                <IconChecklist size={13} /> {t('mail_task_button')}
              </button>
              <button
                onClick={() => setAssistOpen(true)}
                disabled={assistOpen}
                className={`${ACTION_BUTTON} disabled:opacity-60`}
                style={{ background: 'var(--tblr-primary)', color: 'white' }}
              >
                <IconSparkles size={13} /> {t('mail_assist_button')}
              </button>
            </div>
          )}
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
          {!loading && !error && message && mailRef && (
            <>
              {assistOpen && (
                <MailAssistPanel
                  mail={mailRef}
                  message={message}
                  onReply={draft => setComposer({ kind: 'reply', draft: draft.body })}
                  onForward={draft => setComposer({ kind: 'forward', draft: draft.body, to: draft.to })}
                  onTask={openTask}
                />
              )}
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
                      href={attachmentUrl(provider, accountId, messageId, folder, a)}
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

    {composerProps && (
      <MailComposeModal
        // Un brouillon IA différent doit repartir d'un composeur neuf (l'état initial n'est lu qu'au montage).
        key={`${composer?.kind}-${composer?.draft?.length ?? 0}-${composer?.to ?? ''}`}
        accounts={accounts || []}
        replyTo={composerProps.replyTo}
        initial={composerProps.initial}
        forwardAttachments={composerProps.forwardAttachments}
        title={composerProps.title}
        onClose={() => setComposer(null)}
      />
    )}

    {taskDraft && mailRef && (
      <MailTaskModal mail={mailRef} initial={taskDraft} onClose={() => setTaskDraft(null)} />
    )}
    </>
  );
}
