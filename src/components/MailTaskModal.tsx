// Création d'une tâche à partir du message ouvert. La tâche reprend l'objet, le
// contexte du message et, sur case cochée (par défaut), garde un lien vers lui
// (email_links, local_type « task ») pour le retrouver depuis la tâche.
// Les valeurs de départ viennent soit du message seul, soit de la proposition
// de l'IA (affaire, responsable, échéance, priorité) : elles restent modifiables.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { IconX, IconLoader2, IconCheck } from '@tabler/icons-react';
import { apiFetch } from '../lib/api';
import { isoDateInDays, MAIL_TASK_PRIORITIES, type MailTaskPriority } from '../lib/mailAssist';
import type { MailProvider } from '../hooks/useMailAccounts';

/** Le message ouvert, tel que les routes de rattachement et de tâche le désignent. */
export interface MailRef {
  provider: MailProvider;
  accountId: string;
  /** Identifiant stable du message (IMAP : « dossier:uid », comme dans la liste de la messagerie). */
  externalMessageId: string;
  threadId: string | null;
  subject: string;
  from: string;
  to: string;
  date: string | null;
}

export interface MailTaskDraft {
  title: string;
  description: string;
  projectId: string | null;
  assigneeId: string | null;
  /** AAAA-MM-JJ ou vide. */
  dueDate: string;
  priority: MailTaskPriority;
}

interface MailTaskModalProps {
  mail: MailRef;
  initial: MailTaskDraft;
  onClose: () => void;
}

interface ProjectOption { id: string; name: string; project_code?: string }
interface TeamOption { id: string; name: string }

const FIELD_STYLE = { background: 'var(--tblr-bg)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' } as const;

export default function MailTaskModal({ mail, initial, onClose }: MailTaskModalProps) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const [projectId, setProjectId] = useState(initial.projectId || '');
  const [assigneeId, setAssigneeId] = useState(initial.assigneeId || '');
  const [dueDate, setDueDate] = useState(initial.dueDate);
  const [priority, setPriority] = useState<MailTaskPriority>(initial.priority);
  const [linkMail, setLinkMail] = useState(true);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [team, setTeam] = useState<TeamOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState(false);

  useEffect(() => {
    apiFetch<ProjectOption[]>('/api/projects').then(rows => setProjects(Array.isArray(rows) ? rows : [])).catch(() => {});
    apiFetch<TeamOption[]>('/api/team').then(rows => setTeam(Array.isArray(rows) ? rows : [])).catch(() => {});
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const today = isoDateInDays(0);
      const context = `Message : « ${mail.subject || '(Sans objet)'} » de ${mail.from}${mail.date ? `, reçu le ${new Date(mail.date).toLocaleDateString('fr-FR')}` : ''}.`;
      const task = await apiFetch<{ id: string }>('/api/tasks', {
        method: 'POST',
        body: JSON.stringify({
          title: title.trim(),
          description: [description.trim(), context].filter(Boolean).join('\n\n'),
          project_id: projectId || null,
          assignee_id: assigneeId || null,
          start_date: today,
          end_date: dueDate && dueDate >= today ? dueDate : today,
          due_date: dueDate || null,
          priority,
          status: 'todo',
        }),
      });
      if (linkMail) {
        // Meilleur effort : la tâche existe déjà, un lien manquant ne doit pas la faire échouer.
        await apiFetch('/api/mail/links', {
          method: 'POST',
          body: JSON.stringify({
            provider: mail.provider,
            connection_id: mail.accountId,
            local_type: 'task',
            local_id: task.id,
            external_message_id: mail.externalMessageId,
            external_thread_id: mail.threadId,
            subject: mail.subject,
            from_address: mail.from,
            to_addresses: mail.to,
            message_date: mail.date ? new Date(mail.date).toISOString() : null,
            file_in_mailbox: false,
          }),
        }).catch(() => {});
      }
      setCreated(true);
    } catch (err: any) {
      setError(err?.message || t('mail_action_error') as string);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <form
        onSubmit={submit}
        role="dialog"
        aria-label={t('mail_task_modal_title') as string}
        className="rounded-xl shadow-xl w-full max-w-lg max-h-[85dvh] flex flex-col"
        style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="p-4 flex justify-between items-center" style={{ borderBottom: '1px solid var(--tblr-border)' }}>
          <h3 className="text-base font-bold" style={{ color: 'var(--tblr-text)' }}>{t('mail_task_modal_title')}</h3>
          <button type="button" onClick={onClose} aria-label={t('btn_close') as string} style={{ color: 'var(--tblr-muted)' }}><IconX size={18} /></button>
        </div>

        {created ? (
          <div className="p-6 flex flex-col items-center gap-3 text-center">
            <IconCheck size={28} style={{ color: 'var(--tblr-success, #2fb344)' }} />
            <p className="text-sm font-medium" style={{ color: 'var(--tblr-text)' }}>{t('mail_task_created')}</p>
            <div className="flex gap-2">
              <Link to="/gantt" className="px-3 py-1.5 rounded-lg text-sm font-medium" style={{ border: '1px solid var(--tblr-primary)', color: 'var(--tblr-primary)' }}>{t('mail_task_open')}</Link>
              <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-lg text-sm font-medium" style={{ background: 'var(--tblr-primary)', color: 'white' }}>{t('btn_close')}</button>
            </div>
          </div>
        ) : (
          <>
            <div className="p-4 space-y-3 flex-1 overflow-y-auto">
              <label className="block text-xs font-medium space-y-1" style={{ color: 'var(--tblr-muted)' }}>
                {t('mail_task_field_title')}
                <input required value={title} onChange={e => setTitle(e.target.value)} className="w-full p-2 rounded-lg text-sm" style={FIELD_STYLE} />
              </label>
              <label className="block text-xs font-medium space-y-1" style={{ color: 'var(--tblr-muted)' }}>
                {t('mail_task_field_description')}
                <textarea rows={4} value={description} onChange={e => setDescription(e.target.value)} className="w-full p-2 rounded-lg text-sm resize-none" style={FIELD_STYLE} />
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block text-xs font-medium space-y-1" style={{ color: 'var(--tblr-muted)' }}>
                  {t('mail_task_field_project')}
                  <select value={projectId} onChange={e => setProjectId(e.target.value)} className="w-full p-2 rounded-lg text-sm" style={FIELD_STYLE}>
                    <option value="">{t('mail_task_no_project')}</option>
                    {projects.map(p => <option key={p.id} value={p.id}>{[p.project_code, p.name].filter(Boolean).join(' ')}</option>)}
                  </select>
                </label>
                <label className="block text-xs font-medium space-y-1" style={{ color: 'var(--tblr-muted)' }}>
                  {t('mail_task_field_assignee')}
                  <select value={assigneeId} onChange={e => setAssigneeId(e.target.value)} className="w-full p-2 rounded-lg text-sm" style={FIELD_STYLE}>
                    <option value="">{t('mail_task_no_assignee')}</option>
                    {team.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </label>
                <label className="block text-xs font-medium space-y-1" style={{ color: 'var(--tblr-muted)' }}>
                  {t('mail_task_field_due')}
                  <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="w-full p-2 rounded-lg text-sm" style={FIELD_STYLE} />
                </label>
                <label className="block text-xs font-medium space-y-1" style={{ color: 'var(--tblr-muted)' }}>
                  {t('mail_task_field_priority')}
                  <select value={priority} onChange={e => setPriority(e.target.value as MailTaskPriority)} className="w-full p-2 rounded-lg text-sm" style={FIELD_STYLE}>
                    {MAIL_TASK_PRIORITIES.map(p => <option key={p} value={p}>{t(`mail_task_priority_${p}`)}</option>)}
                  </select>
                </label>
              </div>
              <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--tblr-text)' }}>
                <input type="checkbox" checked={linkMail} onChange={e => setLinkMail(e.target.checked)} />
                {t('mail_task_link_mail')}
              </label>
              {error && (
                <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-900/20 dark:border-red-700 px-3 py-2 text-xs text-red-700 dark:text-red-400">{error}</div>
              )}
            </div>
            <div className="p-4 flex justify-end" style={{ borderTop: '1px solid var(--tblr-border)' }}>
              <button type="submit" disabled={saving} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-60" style={{ background: 'var(--tblr-primary)', color: 'white' }}>
                {saving && <IconLoader2 size={14} className="animate-spin" />} {t('mail_task_save')}
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
