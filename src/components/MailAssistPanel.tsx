// Panneau « Proposition IA » du message ouvert : résumé, actions attendues,
// classement (affaire, lot, catégorie, urgence), brouillons de réponse et de
// transfert, tâche suggérée. L'IA PROPOSE : chaque geste (classer, répondre,
// transférer, créer la tâche) passe par un bouton, et les brouillons s'ouvrent
// dans le composeur pour relecture avant tout envoi.
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconSparkles, IconLoader2, IconRefresh, IconArrowBackUp, IconArrowForwardUp, IconChecklist, IconFolderCheck } from '@tabler/icons-react';
import { apiFetch } from '../lib/api';
import {
  isoDateInDays, messageText,
  type MailAssistSuggestion, type MailUrgency,
} from '../lib/mailAssist';
import type { MailRef, MailTaskDraft } from './MailTaskModal';

interface AssistMessage {
  subject: string;
  from: string;
  to: string;
  cc: string;
  date: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  attachments: { filename: string }[];
}

interface MailAssistPanelProps {
  mail: MailRef;
  message: AssistMessage;
  onReply: (draft: { subject: string; body: string }) => void;
  onForward: (draft: { body: string; to: string }) => void;
  onTask: (draft: MailTaskDraft) => void;
}

const URGENCY_STYLE: Record<MailUrgency, { background: string; color: string }> = {
  haute: { background: 'rgba(214, 57, 57, 0.12)', color: '#b42318' },
  normale: { background: 'var(--tblr-bg)', color: 'var(--tblr-text)' },
  faible: { background: 'var(--tblr-bg)', color: 'var(--tblr-muted)' },
};

export default function MailAssistPanel({ mail, message, onReply, onForward, onTask }: MailAssistPanelProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<MailAssistSuggestion | null>(null);
  const [filing, setFiling] = useState<'idle' | 'busy' | 'done'>('idle');
  const [filingNote, setFilingNote] = useState<string | null>(null);
  const started = useRef(false);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ suggestion: MailAssistSuggestion }>('/api/mail/ai/assist', {
        method: 'POST',
        body: JSON.stringify({
          subject: message.subject,
          from: message.from,
          to: message.to,
          cc: message.cc,
          date: message.date,
          body: messageText(message),
          attachments: message.attachments.map(a => a.filename),
        }),
      });
      setSuggestion(res.suggestion);
    } catch (err: any) {
      setError(err?.message || t('mail_action_error') as string);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fileInProject = async () => {
    if (!suggestion?.project) return;
    setFiling('busy');
    setFilingNote(null);
    try {
      const res = await apiFetch<{ filing?: { status: string; error?: string } }>('/api/mail/links', {
        method: 'POST',
        body: JSON.stringify({
          provider: mail.provider,
          connection_id: mail.accountId,
          local_type: 'project',
          local_id: suggestion.project.id,
          external_message_id: mail.externalMessageId,
          external_thread_id: mail.threadId,
          subject: mail.subject,
          from_address: mail.from,
          to_addresses: mail.to,
          message_date: mail.date ? new Date(mail.date).toISOString() : null,
        }),
      });
      setFiling('done');
      if (res.filing?.status === 'failed') setFilingNote(res.filing.error || null);
    } catch (err: any) {
      setFiling('idle');
      setFilingNote(err?.message || t('mail_action_error') as string);
    }
  };

  const openTask = () => {
    if (!suggestion) return;
    onTask({
      title: suggestion.task.title || message.subject,
      description: suggestion.task.description || suggestion.summary,
      projectId: suggestion.project?.id || null,
      assigneeId: suggestion.task.assigneeId,
      dueDate: suggestion.task.dueInDays !== null ? isoDateInDays(suggestion.task.dueInDays) : '',
      priority: suggestion.task.priority,
    });
  };

  return (
    <section
      aria-label={t('mail_assist_title') as string}
      className="mb-4 rounded-lg p-3 space-y-3"
      style={{ border: '1px solid var(--tblr-primary)', background: 'var(--tblr-primary-lt)' }}
    >
      <div className="flex items-center justify-between gap-2">
        <h4 className="flex items-center gap-1.5 text-sm font-bold" style={{ color: 'var(--tblr-primary)' }}>
          <IconSparkles size={15} /> {t('mail_assist_title')}
        </h4>
        {!loading && (
          <button type="button" onClick={run} className="flex items-center gap-1 text-xs font-medium" style={{ color: 'var(--tblr-primary)' }}>
            <IconRefresh size={12} /> {t('mail_assist_retry')}
          </button>
        )}
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--tblr-muted)' }} role="status">
          <IconLoader2 size={15} className="animate-spin" /> {t('mail_assist_loading')}
        </div>
      )}

      {error && !loading && (
        <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-900/20 dark:border-red-700 px-3 py-2 text-xs text-red-700 dark:text-red-400" role="alert">{error}</div>
      )}

      {suggestion && !loading && (
        <div className="space-y-3" style={{ color: 'var(--tblr-text)' }}>
          {suggestion.summary && (
            <div>
              <h5 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--tblr-muted)' }}>{t('mail_assist_summary')}</h5>
              <p className="text-sm mt-0.5">{suggestion.summary}</p>
            </div>
          )}

          {suggestion.actions.length > 0 && (
            <div>
              <h5 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--tblr-muted)' }}>{t('mail_assist_actions')}</h5>
              <ul className="list-disc pl-5 text-sm mt-0.5 space-y-0.5">
                {suggestion.actions.map((a, i) => <li key={i}>{a}</li>)}
              </ul>
            </div>
          )}

          <div>
            <h5 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--tblr-muted)' }}>{t('mail_assist_filing')}</h5>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
              <span className="px-2 py-1 rounded-lg" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}>
                {t('mail_assist_project')} : {suggestion.project ? `${suggestion.project.code} ${suggestion.project.name}`.trim() : t('mail_assist_no_project')}
              </span>
              {suggestion.lot && (
                <span className="px-2 py-1 rounded-lg" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}>
                  {t('mail_assist_lot')} : {suggestion.lot.label}
                </span>
              )}
              <span className="px-2 py-1 rounded-lg" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}>
                {t('mail_assist_category')} : {t(`mail_assist_category_${suggestion.category}`)}
              </span>
              <span className="px-2 py-1 rounded-lg font-medium" style={{ ...URGENCY_STYLE[suggestion.urgency], border: '1px solid var(--tblr-border)' }}>
                {t('mail_assist_urgency')} : {t(`mail_assist_urgency_${suggestion.urgency}`)}
              </span>
            </div>
            {suggestion.reasoning && <p className="text-xs mt-1" style={{ color: 'var(--tblr-muted)' }}>{suggestion.reasoning}</p>}
            {suggestion.project && (
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={fileInProject}
                  disabled={filing !== 'idle'}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium disabled:opacity-60"
                  style={{ border: '1px solid var(--tblr-primary)', color: 'var(--tblr-primary)', background: 'var(--tblr-surface)' }}
                >
                  {filing === 'busy' ? <IconLoader2 size={13} className="animate-spin" /> : <IconFolderCheck size={13} />} {t('mail_assist_file')}
                </button>
                {filing === 'done' && <span className="text-xs" role="status">{t('mail_assist_filed')}</span>}
              </div>
            )}
            {filingNote && <p className="text-xs mt-1 text-red-700 dark:text-red-400" role="alert">{filingNote}</p>}
          </div>

          <div className="space-y-2">
            {suggestion.reply.body && (
              <details className="rounded-lg p-2" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}>
                <summary className="text-xs font-medium cursor-pointer">{suggestion.reply.subject || message.subject}</summary>
                <pre className="whitespace-pre-wrap text-sm font-sans mt-2">{suggestion.reply.body}</pre>
              </details>
            )}
            <div className="flex flex-wrap gap-2">
              {suggestion.reply.body && (
                <button
                  type="button"
                  onClick={() => onReply({ subject: suggestion.reply.subject, body: suggestion.reply.body })}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium"
                  style={{ background: 'var(--tblr-primary)', color: 'white' }}
                >
                  <IconArrowBackUp size={13} /> {t('mail_assist_use_reply')}
                </button>
              )}
              <button
                type="button"
                onClick={() => onForward({ body: suggestion.forward.body, to: suggestion.forward.recipients.map(r => r.email).join(', ') })}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium"
                style={{ border: '1px solid var(--tblr-primary)', color: 'var(--tblr-primary)', background: 'var(--tblr-surface)' }}
              >
                <IconArrowForwardUp size={13} /> {t('mail_assist_use_forward')}
              </button>
              {suggestion.task.title && (
                <button
                  type="button"
                  onClick={openTask}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium"
                  style={{ border: '1px solid var(--tblr-primary)', color: 'var(--tblr-primary)', background: 'var(--tblr-surface)' }}
                >
                  <IconChecklist size={13} /> {t('mail_assist_create_task')}
                </button>
              )}
            </div>
            {suggestion.forward.recipients.length > 0 && (
              <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>
                {t('mail_assist_forward_to')} : {suggestion.forward.recipients.map(r => r.name).join(', ')}
              </p>
            )}
          </div>

          <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('mail_assist_disclaimer')}</p>
        </div>
      )}
    </section>
  );
}
