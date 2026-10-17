import { useId, useState, type FormEvent } from 'react';
import { motion } from 'motion/react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconX, IconAlertTriangle, IconLoader2, IconTrash, IconChecklist, IconExternalLink, IconPhoneCall } from '@tabler/icons-react';
import { launchOriginRef } from '../../lib/launchOrigin';
import { ContactAutocomplete } from '../ContactAutocomplete';
import { PHONE_CALL_DIRECTIONS, PHONE_CALL_STATUSES, PHONE_CALL_PRIORITIES } from '../../schemas/phoneCall.schema';
import { fromLocalInputValue, telHref, toLocalInputValue } from '../../lib/phoneCalls';
import type { Contact, PhoneCall, Project, TeamMember } from '../../types';

export interface PhoneCallFormModalProps {
  /** Les valeurs connues à l'ouverture. Sans `id`, le formulaire crée ; avec, il modifie. */
  initial: Partial<PhoneCall>;
  projects: Project[];
  team: TeamMember[];
  contacts: Contact[];
  onClose: () => void;
  /** Reçoit le corps à enregistrer. Rejette avec un message en cas de refus du serveur. */
  onSave: (body: Partial<PhoneCall>) => Promise<void>;
  onDelete?: () => Promise<void>;
  /** Crée la tâche de suivi (réseau obligatoire). Absent = bouton masqué. */
  onCreateTask?: () => Promise<void>;
}

const inputCls = 'w-full text-sm rounded border px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500';
const inputStyle = { background: 'var(--tblr-surface-2)', borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' };
const labelCls = 'block text-xs font-medium mb-1';
const labelStyle = { color: 'var(--tblr-muted)' };
const dateStyle = { ...inputStyle, colorScheme: 'light dark', minWidth: 0, maxWidth: '100%', height: '2.5rem' } as const;

function nullIfBlank(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function PhoneCallFormModal({ initial, projects, team, contacts, onClose, onSave, onDelete, onCreateTask }: PhoneCallFormModalProps) {
  const { t } = useTranslation();
  const uid = useId();
  const isEdit = !!initial.id;

  const [direction, setDirection] = useState(initial.direction || 'entrant');
  const [calledAt, setCalledAt] = useState(toLocalInputValue(initial.called_at));
  const [duration, setDuration] = useState(initial.duration_minutes != null ? String(initial.duration_minutes) : '');
  const [callerName, setCallerName] = useState(initial.caller_name || '');
  const [callerCompany, setCallerCompany] = useState(initial.caller_company || '');
  const [callerPhone, setCallerPhone] = useState(initial.caller_phone || '');
  const [callerEmail, setCallerEmail] = useState(initial.caller_email || '');
  const [contactId, setContactId] = useState(initial.contact_id || '');
  const [projectId, setProjectId] = useState(initial.project_id || '');
  const [subject, setSubject] = useState(initial.subject || '');
  const [notes, setNotes] = useState(initial.notes || '');
  const [assigneeId, setAssigneeId] = useState(initial.assignee_id || '');
  const [status, setStatus] = useState(initial.status || 'a_traiter');
  const [priority, setPriority] = useState(initial.priority || 'normal');
  const [callbackDue, setCallbackDue] = useState(initial.callback_due ? String(initial.callback_due).slice(0, 10) : '');
  const [busy, setBusy] = useState<'save' | 'delete' | 'task' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const id = (name: string) => `${uid}-${name}`;
  const online = typeof navigator === 'undefined' || navigator.onLine;
  const dialHref = telHref(callerPhone);

  // Choisir une fiche contact préremplit l'identité de l'interlocuteur, sans
  // jamais écraser ce que la personne vient de saisir.
  function pickContact(contactIdValue: string) {
    setContactId(contactIdValue);
    const contact = contacts.find(c => c.id === contactIdValue);
    if (!contact) return;
    if (!callerName.trim()) setCallerName([contact.first_name, contact.last_name].filter(Boolean).join(' '));
    if (!callerCompany.trim() && contact.company_name) setCallerCompany(contact.company_name);
    if (!callerPhone.trim()) setCallerPhone(contact.phone_mobile || contact.phone || contact.phone_work || '');
    if (!callerEmail.trim()) setCallerEmail(contact.email || contact.email_work || '');
  }

  // « save » et « delete » ferment le formulaire à la réussite (l'appelant le
  // démonte) ; « task » le laisse ouvert, d'où la remise à zéro de l'attente.
  async function run(kind: 'save' | 'delete' | 'task', action: () => Promise<void>, fallbackKey: string) {
    setError(null);
    setBusy(kind);
    try {
      await action();
      if (kind === 'task') setBusy(null);
    } catch (err: any) {
      setError(err?.message || (t(fallbackKey) as string));
      setBusy(null);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const minutes = duration.trim() === '' ? null : Number(duration);
    run('save', () => onSave({
      direction,
      called_at: calledAt ? fromLocalInputValue(calledAt) : new Date().toISOString(),
      duration_minutes: minutes != null && Number.isFinite(minutes) ? Math.max(0, Math.round(minutes)) : null,
      caller_name: nullIfBlank(callerName),
      caller_company: nullIfBlank(callerCompany),
      caller_phone: nullIfBlank(callerPhone),
      caller_email: nullIfBlank(callerEmail),
      contact_id: contactId || null,
      project_id: projectId || null,
      subject: subject.trim(),
      notes: nullIfBlank(notes),
      assignee_id: assigneeId || null,
      status,
      priority,
      callback_due: callbackDue || null,
    }), 'phonecalls_save_error');
  }

  const taskHref = initial.project_id ? `/projects/${initial.project_id}?tab=TACHES` : '/kanban';

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <motion.div
        ref={launchOriginRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id('title')}
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        className="w-full max-w-xl rounded-xl shadow-2xl overflow-hidden max-h-[90dvh] flex flex-col"
        style={{ background: 'var(--tblr-surface)' }}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--tblr-border)' }}>
          <h2 id={id('title')} className="font-semibold text-base truncate" style={{ color: 'var(--tblr-text)' }}>
            {isEdit ? t('phonecalls_edit_title') : t('phonecalls_new')}
          </h2>
          <button type="button" onClick={onClose} aria-label={t('btn_cancel') as string} className="rounded p-2 hover:bg-[var(--tblr-surface-2)] transition-colors shrink-0">
            <IconX size={18} style={{ color: 'var(--tblr-muted)' }} />
          </button>
        </div>

        {error && (
          <div role="alert" className="mx-5 mt-4 px-3 py-2 rounded-lg border text-xs flex items-center gap-2" style={{ background: '#fff5f5', borderColor: '#ffc9c9', color: '#c92a2a' }}>
            <IconAlertTriangle size={14} className="shrink-0" />
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="overflow-y-auto p-5 space-y-4">
          <div>
            <label htmlFor={id('subject')} className={labelCls} style={labelStyle}>{t('phonecalls_field_subject')} *</label>
            <input id={id('subject')} required autoFocus={!isEdit} value={subject} onChange={e => setSubject(e.target.value)} className={inputCls} style={inputStyle} />
          </div>

          <div className="grid grid-cols-2 gap-4 [&>div]:min-w-0">
            <div>
              <label htmlFor={id('direction')} className={labelCls} style={labelStyle}>{t('phonecalls_field_direction')}</label>
              <select id={id('direction')} value={direction} onChange={e => setDirection(e.target.value as PhoneCall['direction'])} className={inputCls} style={inputStyle}>
                {PHONE_CALL_DIRECTIONS.map(d => <option key={d} value={d}>{t(`phonecalls_direction_${d}`)}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor={id('duration')} className={labelCls} style={labelStyle}>{t('phonecalls_field_duration')}</label>
              <input id={id('duration')} type="number" inputMode="numeric" min="0" max="1440" value={duration} onChange={e => setDuration(e.target.value)} className={inputCls} style={{ ...inputStyle, height: '2.5rem' }} />
            </div>
          </div>

          <div>
            <label htmlFor={id('called-at')} className={labelCls} style={labelStyle}>{t('phonecalls_field_called_at')}</label>
            <input id={id('called-at')} type="datetime-local" value={calledAt} onChange={e => setCalledAt(e.target.value)} className={inputCls} style={dateStyle} />
          </div>

          <div>
            <span className={labelCls} style={labelStyle}>{t('phonecalls_field_contact')}</span>
            <ContactAutocomplete contacts={contacts} value={contactId} onChange={pickContact} placeholder={t('phonecalls_contact_none') as string} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 [&>div]:min-w-0">
            <div>
              <label htmlFor={id('caller-name')} className={labelCls} style={labelStyle}>{t('phonecalls_field_caller_name')}</label>
              <input id={id('caller-name')} value={callerName} onChange={e => setCallerName(e.target.value)} className={inputCls} style={inputStyle} />
            </div>
            <div>
              <label htmlFor={id('caller-company')} className={labelCls} style={labelStyle}>{t('phonecalls_field_caller_company')}</label>
              <input id={id('caller-company')} value={callerCompany} onChange={e => setCallerCompany(e.target.value)} className={inputCls} style={inputStyle} />
            </div>
            <div>
              <label htmlFor={id('caller-phone')} className={labelCls} style={labelStyle}>{t('phonecalls_field_caller_phone')}</label>
              <div className="flex items-center gap-2">
                <input id={id('caller-phone')} type="tel" value={callerPhone} onChange={e => setCallerPhone(e.target.value)} className={inputCls} style={inputStyle} />
                {dialHref && (
                  // Lance le composeur du téléphone ; masqué dès 768 px, où un lien tel: n'ouvre rien d'utile.
                  <a
                    href={dialHref}
                    aria-label={t('phonecalls_dial', { phone: callerPhone }) as string}
                    className="md:hidden shrink-0 flex items-center justify-center w-11 h-11 rounded-full border transition-colors active:bg-[var(--tblr-surface-2)]"
                    style={{ borderColor: 'var(--tblr-success)', color: 'var(--tblr-success)', background: '#ebfbee' }}
                  >
                    <IconPhoneCall size={20} />
                  </a>
                )}
              </div>
            </div>
            <div>
              <label htmlFor={id('caller-email')} className={labelCls} style={labelStyle}>{t('phonecalls_field_caller_email')}</label>
              <input id={id('caller-email')} type="email" value={callerEmail} onChange={e => setCallerEmail(e.target.value)} className={inputCls} style={inputStyle} />
            </div>
          </div>

          <div>
            <label htmlFor={id('project')} className={labelCls} style={labelStyle}>{t('phonecalls_field_project')}</label>
            <select id={id('project')} value={projectId} onChange={e => setProjectId(e.target.value)} className={inputCls} style={inputStyle}>
              <option value="">{t('task_no_project')}</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          <div>
            <label htmlFor={id('notes')} className={labelCls} style={labelStyle}>{t('phonecalls_field_notes')}</label>
            <textarea id={id('notes')} rows={4} value={notes} onChange={e => setNotes(e.target.value)} className={inputCls} style={inputStyle} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 [&>div]:min-w-0">
            <div>
              <label htmlFor={id('assignee')} className={labelCls} style={labelStyle}>{t('phonecalls_field_assignee')}</label>
              <select id={id('assignee')} value={assigneeId} onChange={e => setAssigneeId(e.target.value)} className={inputCls} style={inputStyle}>
                <option value="">{t('phonecalls_unassigned')}</option>
                {team.map(m => <option key={m.id} value={m.id}>{m.name || m.email}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor={id('callback')} className={labelCls} style={labelStyle}>{t('phonecalls_field_callback')}</label>
              <input id={id('callback')} type="date" value={callbackDue} onChange={e => setCallbackDue(e.target.value)} className={inputCls} style={dateStyle} />
            </div>
            <div>
              <label htmlFor={id('status')} className={labelCls} style={labelStyle}>{t('phonecalls_field_status')}</label>
              <select id={id('status')} value={status} onChange={e => setStatus(e.target.value as PhoneCall['status'])} className={inputCls} style={inputStyle}>
                {PHONE_CALL_STATUSES.map(s => <option key={s} value={s}>{t(`phonecalls_status_${s}`)}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor={id('priority')} className={labelCls} style={labelStyle}>{t('phonecalls_field_priority')}</label>
              <select id={id('priority')} value={priority} onChange={e => setPriority(e.target.value as PhoneCall['priority'])} className={inputCls} style={inputStyle}>
                {PHONE_CALL_PRIORITIES.map(p => <option key={p} value={p}>{t(`task_priority_${p}`)}</option>)}
              </select>
            </div>
          </div>

          {isEdit && onCreateTask && (
            <div className="rounded-lg border px-3 py-2.5 flex items-center justify-between gap-3" style={{ borderColor: 'var(--tblr-border)', background: 'var(--tblr-surface-2)' }}>
              <span className="text-xs" style={{ color: 'var(--tblr-muted)' }}>
                {initial.task_id
                  ? (initial.pendingSync ? t('phonecalls_task_pending') : t('phonecalls_task_created'))
                  : online ? t('phonecalls_create_task') : t('phonecalls_task_offline_hint')}
              </span>
              {initial.task_id && initial.pendingSync ? (
                <span className="text-xs font-medium" style={{ color: '#e67700' }}>{t('phonecalls_pending')}</span>
              ) : initial.task_id ? (
                <Link to={taskHref} className="flex items-center gap-1.5 text-xs font-medium hover:underline" style={{ color: 'var(--tblr-primary)' }}>
                  <IconExternalLink size={14} /> {t('phonecalls_open_task')}
                </Link>
              ) : (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => run('task', onCreateTask, 'phonecalls_task_error')}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs rounded border font-medium transition-colors hover:bg-[var(--tblr-surface)] disabled:opacity-50"
                  style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' }}
                >
                  {busy === 'task' ? <IconLoader2 size={14} className="animate-spin" /> : <IconChecklist size={14} />}
                  {t('phonecalls_create_task')}
                </button>
              )}
            </div>
          )}

          <div className="flex items-center justify-between gap-3 pt-2">
            {isEdit && onDelete ? (
              <button
                type="button"
                onClick={() => { if (confirm(t('phonecalls_delete_confirm') as string)) run('delete', onDelete, 'phonecalls_delete_error'); }}
                disabled={busy !== null}
                className="flex items-center gap-1.5 px-3 py-2 text-xs rounded border transition-colors hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-60"
                style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-danger)' }}
              >
                {busy === 'delete' ? <IconLoader2 size={13} className="animate-spin" /> : <IconTrash size={13} />}
                {t('delete')}
              </button>
            ) : <span />}
            <div className="flex gap-3">
              <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded border transition-colors hover:bg-[var(--tblr-surface-2)]" style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-muted)' }}>
                {t('btn_cancel')}
              </button>
              <button type="submit" disabled={busy !== null || !subject.trim()} className="flex items-center gap-2 px-4 py-2 text-sm rounded font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 transition-colors">
                {busy === 'save' && <IconLoader2 size={14} className="animate-spin" />}
                {t('save')}
              </button>
            </div>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

export default PhoneCallFormModal;
