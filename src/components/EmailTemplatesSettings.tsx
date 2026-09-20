// Réglages > Communication > Modèles de mails. Un modèle par genre de mail
// réellement envoyé par l'application (voir EMAIL_TEMPLATE_KIND_INFO), avec
// des balises {{clé}} que l'app remplace automatiquement par les informations
// calculées (numéro de facture, montants, spécialité sollicitée...) au moment
// de l'envoi — le reste du texte reste celui saisi ici.
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconDeviceFloppy, IconRefresh, IconLoader2, IconCircleCheck, IconMailbox } from '@tabler/icons-react';
import { apiFetch } from '../lib/api';
import { fetchEmailTemplates, EMAIL_TEMPLATE_KIND_INFO } from '../lib/emailTemplates';
import type { EmailTemplate } from '../types';

interface Draft { subject: string; body: string; }
interface CardStatus { saving?: boolean; success?: boolean; error?: string | null; }

function EmailTemplateCard({
  template, draft, status, onChange, onSave, onReset,
}: {
  template: EmailTemplate;
  draft: Draft;
  status: CardStatus;
  onChange: (field: 'subject' | 'body', value: string) => void;
  onSave: () => void;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  const info = EMAIL_TEMPLATE_KIND_INFO.find(i => i.kind === template.kind);
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [activeField, setActiveField] = useState<'subject' | 'body'>('body');

  const insertPlaceholder = (key: string) => {
    const ref = activeField === 'subject' ? subjectRef.current : bodyRef.current;
    const value = draft[activeField] || '';
    const token = `{{${key}}}`;
    const start = ref?.selectionStart ?? value.length;
    const end = ref?.selectionEnd ?? value.length;
    const next = value.slice(0, start) + token + value.slice(end);
    onChange(activeField, next);
    requestAnimationFrame(() => {
      ref?.focus();
      ref?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const handleReset = () => {
    if (window.confirm(t('email_templates_reset_confirm'))) onReset();
  };

  return (
    <div className="rounded-xl p-5 space-y-3" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
      <div>
        <h3 className="text-sm font-bold" style={{ color: 'var(--tblr-text)' }}>{info?.label || template.kind}</h3>
        {info?.description && <p className="text-xs mt-0.5" style={{ color: 'var(--tblr-muted)' }}>{info.description}</p>}
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-semibold" style={{ color: 'var(--tblr-muted)' }}>{t('email_templates_subject_label')}</label>
        <input
          ref={subjectRef}
          className="w-full p-2 rounded-lg text-sm"
          style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
          value={draft.subject}
          onFocus={() => setActiveField('subject')}
          onChange={e => onChange('subject', e.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-semibold" style={{ color: 'var(--tblr-muted)' }}>{t('email_templates_body_label')}</label>
        <textarea
          ref={bodyRef}
          className="w-full p-2 rounded-lg h-40 text-sm font-mono"
          style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
          value={draft.body}
          onFocus={() => setActiveField('body')}
          onChange={e => onChange('body', e.target.value)}
        />
      </div>

      {info && info.placeholders.length > 0 && (
        <div className="space-y-1.5">
          <span className="text-xs font-semibold" style={{ color: 'var(--tblr-muted)' }}>{t('email_templates_placeholders_label')}</span>
          <div className="flex flex-wrap gap-1.5">
            {info.placeholders.map(p => (
              <button
                key={p.key}
                type="button"
                title={p.label}
                onClick={() => insertPlaceholder(p.key)}
                className="px-2 py-1 rounded-md text-xs font-mono transition-colors"
                style={{ background: 'var(--tblr-surface-2)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }}
              >
                {`{{${p.key}}}`}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap pt-1">
        <button type="button" disabled={status.saving} onClick={onSave}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors disabled:opacity-60"
          style={status.success ? { background: 'var(--tblr-success)', color: '#fff' } : { background: 'var(--tblr-primary)', color: '#fff' }}>
          {status.saving ? <IconLoader2 size={13} className="animate-spin" /> : status.success ? <IconCircleCheck size={13} /> : <IconDeviceFloppy size={13} />}
          {status.saving ? t('email_templates_saving') : status.success ? t('email_templates_saved') : t('email_templates_save')}
        </button>
        <button type="button" onClick={handleReset}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
          style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-text)', border: '1px solid var(--tblr-border)' }}>
          <IconRefresh size={13} />
          {t('email_templates_reset')}
        </button>
        {status.error && <span className="text-xs font-medium" style={{ color: 'var(--tblr-danger)' }}>{status.error}</span>}
      </div>
    </div>
  );
}

export default function EmailTemplatesSettings() {
  const { t } = useTranslation();
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [status, setStatus] = useState<Record<string, CardStatus>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await fetchEmailTemplates();
        setTemplates(data);
        setDrafts(Object.fromEntries(data.map(tpl => [tpl.id, { subject: tpl.subject, body: tpl.body }])));
      } catch (e: any) {
        console.error(e);
        setLoadError(e?.message || t('email_templates_load_error'));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const setDraftField = (id: string, field: 'subject' | 'body', value: string) => {
    setDrafts(prev => ({ ...prev, [id]: { ...(prev[id] || { subject: '', body: '' }), [field]: value } }));
  };

  const save = async (tpl: EmailTemplate) => {
    const draft = drafts[tpl.id];
    if (!draft) return;
    setStatus(prev => ({ ...prev, [tpl.id]: { saving: true, error: null } }));
    try {
      await apiFetch(`/api/email_templates/${tpl.id}`, { method: 'PUT', body: JSON.stringify(draft) });
      setTemplates(prev => prev.map(x => x.id === tpl.id ? { ...x, ...draft } : x));
      setStatus(prev => ({ ...prev, [tpl.id]: { saving: false, success: true } }));
      setTimeout(() => setStatus(prev => ({ ...prev, [tpl.id]: { ...prev[tpl.id], success: false } })), 3000);
    } catch (e: any) {
      setStatus(prev => ({ ...prev, [tpl.id]: { saving: false, error: e?.message || t('email_templates_save_error') } }));
    }
  };

  const reset = async (tpl: EmailTemplate) => {
    setStatus(prev => ({ ...prev, [tpl.id]: { saving: true, error: null } }));
    try {
      const result = await apiFetch<{ subject: string; body: string }>(`/api/email_templates/${tpl.id}/reset`, { method: 'POST' });
      setTemplates(prev => prev.map(x => x.id === tpl.id ? { ...x, subject: result.subject, body: result.body } : x));
      setDrafts(prev => ({ ...prev, [tpl.id]: { subject: result.subject, body: result.body } }));
      setStatus(prev => ({ ...prev, [tpl.id]: { saving: false, success: true } }));
      setTimeout(() => setStatus(prev => ({ ...prev, [tpl.id]: { ...prev[tpl.id], success: false } })), 3000);
    } catch (e: any) {
      setStatus(prev => ({ ...prev, [tpl.id]: { saving: false, error: e?.message || t('email_templates_reset_error') } }));
    }
  };

  return (
    <div className="rounded-xl p-5 space-y-4" style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}>
      <div className="flex items-center gap-2">
        <IconMailbox size={16} style={{ color: 'var(--tblr-muted)' }} />
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{t('email_templates_title')}</h2>
          <p className="text-xs mt-1" style={{ color: 'var(--tblr-muted)' }}>{t('email_templates_subtitle')}</p>
        </div>
      </div>

      {loading && <div className="text-sm" style={{ color: 'var(--tblr-muted)' }}>{t('loading')}</div>}
      {loadError && <div className="text-sm font-medium" style={{ color: 'var(--tblr-danger)' }}>{loadError}</div>}

      {!loading && !loadError && (
        <div className="space-y-4">
          {templates.map(tpl => (
            <EmailTemplateCard
              key={tpl.id}
              template={tpl}
              draft={drafts[tpl.id] || { subject: tpl.subject, body: tpl.body }}
              status={status[tpl.id] || {}}
              onChange={(field, value) => setDraftField(tpl.id, field, value)}
              onSave={() => save(tpl)}
              onReset={() => reset(tpl)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
