import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconAlertTriangle } from '@tabler/icons-react';
import { ModalShell } from './ui/ModalShell';
import { fetchJson } from '../lib/api';
import type { Contact, Project } from '../types';
import {
  buildMergePlan, contactName, isMergeConfirmed, MERGE_CONFIRM_WORD, MERGE_LIST_JSON_FIELDS, MERGE_LIST_TEXT_FIELDS,
  resolveMergePatch, suggestPrimary, type MergeContact,
} from '../lib/contactMerge';

interface Props {
  /** Les fiches à regrouper (2 au moins), telles que la liste les affiche. */
  contacts: Contact[];
  projects: Pick<Project, 'id' | 'client_id'>[];
  onClose: () => void;
  onMerged: (result: { primary_id: string; merged_ids: string[] }) => void;
}

type Step = 1 | 2 | 3;

const IMAGE_FIELDS = new Set(['logo', 'electronic_signature']);

function FieldValue({ field, value }: { field: string; value: string }) {
  if (IMAGE_FIELDS.has(field) && value.startsWith('data:image')) {
    return <img src={value} alt="" className="max-h-10 max-w-[7rem] object-contain" />;
  }
  return <span className="break-words">{value.length > 140 ? `${value.slice(0, 140)}…` : value}</span>;
}

/**
 * Assistant de fusion : choisir la fiche conservée et les valeurs en cas de conflit,
 * vérifier le résultat, puis confirmer en tapant FUSIONNER. Le serveur recalcule
 * lui-même les valeurs depuis la base à partir de ces seuls choix.
 */
export function ContactMergeDialog({ contacts, projects, onClose, onMerged }: Props) {
  const { t } = useTranslation();
  const mergeContacts = contacts as unknown as MergeContact[];
  const [step, setStep] = useState<Step>(1);
  const [primaryId, setPrimaryId] = useState(() => suggestPrimary(mergeContacts));
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [invoiceCount, setInvoiceCount] = useState<number | null>(null);

  const plan = useMemo(() => buildMergePlan(mergeContacts, primaryId), [mergeContacts, primaryId]);
  const conflicts = plan.filter(p => p.conflict);
  const calm = plan.filter(p => !p.conflict);
  const patch = useMemo(() => resolveMergePatch(mergeContacts, primaryId, picks), [mergeContacts, primaryId, picks]);
  const result = useMemo(() => ({ ...contacts.find(c => c.id === primaryId), ...patch }) as Record<string, any>, [contacts, primaryId, patch]);
  const duplicates = contacts.filter(c => c.id !== primaryId);
  const duplicateIds = duplicates.map(c => c.id);

  const projectCount = projects.filter(p => p.client_id && duplicateIds.includes(p.client_id)).length;

  // Factures rattachées aux fiches supprimées : meilleur effort, l'aperçu s'en passe.
  useEffect(() => {
    if (step !== 2) return;
    let cancelled = false;
    fetchJson<{ client_id?: string | null; billing_contact_id?: string | null }[]>('/api/invoices')
      .then(list => {
        if (cancelled) return;
        setInvoiceCount(list.filter(i => (i.client_id && duplicateIds.includes(i.client_id)) || (i.billing_contact_id && duplicateIds.includes(i.billing_contact_id))).length);
      })
      .catch(() => { if (!cancelled) setInvoiceCount(null); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, primaryId]);

  const label = (key: string) => t(`contacts_merge_field_${key}`);
  const pickedFor = (key: string, fallback: string | null) => picks[key] && contacts.some(c => c.id === picks[key]) ? picks[key] : fallback;

  const submit = async () => {
    if (!isMergeConfirmed(typed) || busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetchJson<{ primary_id: string; merged_ids: string[] }>('/api/contacts/merge', {
        method: 'POST',
        body: JSON.stringify({ primary_id: primaryId, duplicate_ids: duplicateIds, picks, confirm: typed.trim() }),
      });
      onMerged(res);
    } catch (e: any) {
      setError(e?.message || t('contacts_merge_failed'));
      setBusy(false);
    }
  };

  const stepLabels = [t('contacts_merge_step_choose'), t('contacts_merge_step_check'), t('contacts_merge_step_confirm')];

  const summaryLines: { key: string; text: string }[] = [
    { key: 'projects', text: t('contacts_merge_count_projects', { count: projectCount }) },
    { key: 'invoices', text: invoiceCount === null ? t('contacts_merge_count_invoices_unknown') : t('contacts_merge_count_invoices', { count: invoiceCount }) },
  ];

  const footer = (
    <>
      <button type="button" className="btn btn-secondary" onClick={step === 1 ? onClose : () => setStep((step - 1) as Step)} disabled={busy}>
        {step === 1 ? t('btn_cancel') : t('contacts_merge_back')}
      </button>
      {step < 3 ? (
        <button type="button" className="btn btn-primary" onClick={() => setStep((step + 1) as Step)}>{t('contacts_merge_continue')}</button>
      ) : (
        <button type="button" className="btn btn-danger disabled:opacity-40 disabled:cursor-not-allowed" disabled={!isMergeConfirmed(typed) || busy} onClick={submit}>
          {busy ? t('contacts_merge_merging') : t('contacts_merge_confirm_button')}
        </button>
      )}
    </>
  );

  return (
    <ModalShell
      key="contact-merge-dialog"
      size="xl"
      title={t('contacts_merge_title', { count: contacts.length })}
      subtitle={
        <ol className="flex flex-wrap gap-1.5 mt-1" aria-label={t('contacts_merge_steps_label')}>
          {stepLabels.map((s, i) => (
            <li key={s} aria-current={step === i + 1 ? 'step' : undefined}
              className="px-2.5 py-0.5 rounded-full text-xs font-semibold"
              style={step === i + 1 ? { background: 'var(--tblr-primary)', color: '#fff' } : { background: 'var(--tblr-surface-2)', color: 'var(--tblr-muted)' }}>
              {i + 1}. {s}
            </li>
          ))}
        </ol>
      }
      busy={busy}
      onClose={onClose}
      footer={footer}
      bodyClassName="p-4 sm:p-6 space-y-5"
    >
      {step === 1 && (
        <>
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold mb-1" style={{ color: 'var(--tblr-text)' }}>{t('contacts_merge_primary_legend')}</legend>
            <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('contacts_merge_primary_help')}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {contacts.map(c => (
                <label key={c.id} className="flex items-start gap-2 p-3 rounded-lg cursor-pointer border"
                  style={{ borderColor: c.id === primaryId ? 'var(--tblr-primary)' : 'var(--tblr-border)', background: c.id === primaryId ? 'var(--tblr-primary-lt)' : 'var(--tblr-surface)' }}>
                  <input type="radio" name="merge-primary" className="mt-1" checked={c.id === primaryId} onChange={() => { setPrimaryId(c.id); setPicks({}); }} />
                  <span className="min-w-0 text-sm" style={{ color: 'var(--tblr-text)' }}>
                    <b className="block truncate">{contactName(c)}</b>
                    <span className="block text-xs truncate" style={{ color: 'var(--tblr-muted)' }}>{[c.email, c.phone, c.city].filter(Boolean).join(' · ') || '---'}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <section aria-labelledby="merge-conflicts">
            <h4 id="merge-conflicts" className="text-sm font-semibold mb-2" style={{ color: 'var(--tblr-text)' }}>
              {conflicts.length > 0 ? t('contacts_merge_conflicts_title', { count: conflicts.length }) : t('contacts_merge_no_conflict')}
            </h4>
            {conflicts.length > 0 && (
              <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--tblr-border)' }}>
                <table className="min-w-[36rem] w-full text-sm">
                  <thead style={{ background: 'var(--tblr-surface-2)' }}>
                    <tr>
                      <th className="text-left px-3 py-2 font-medium w-40" style={{ color: 'var(--tblr-muted)' }}>{t('contacts_merge_field')}</th>
                      {contacts.map(c => <th key={c.id} className="text-left px-3 py-2 font-medium truncate max-w-[14rem]" style={{ color: 'var(--tblr-muted)' }}>{contactName(c)}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {conflicts.map(p => {
                      const selected = pickedFor(p.key, p.pick);
                      return (
                        <tr key={p.key} style={{ borderTop: '1px solid var(--tblr-border)' }}>
                          <th scope="row" className="text-left px-3 py-2 align-top font-medium" style={{ color: 'var(--tblr-muted)' }}>{label(p.key)}</th>
                          {p.values.map(v => {
                            const owner = contacts.find(c => c.id === v.id)!;
                            return (
                              <td key={v.id} className="px-2 py-1.5 align-top">
                                <label className={`flex items-start gap-2 px-2 py-1.5 rounded-md ${v.value ? 'cursor-pointer' : 'opacity-60'}`}
                                  style={selected === v.id && v.value ? { background: 'var(--tblr-primary-lt)', outline: '1px solid var(--tblr-primary)' } : undefined}>
                                  <input type="radio" name={`merge-${p.key}`} className="mt-1" disabled={!v.value} checked={selected === v.id}
                                    aria-label={`${label(p.key)} : ${contactName(owner)}`}
                                    onChange={() => setPicks(prev => ({ ...prev, [p.key]: v.id }))} />
                                  <span style={{ color: v.value ? 'var(--tblr-text)' : 'var(--tblr-muted)' }}>
                                    {v.value ? <FieldValue field={p.key} value={v.value} /> : <i>{t('contacts_merge_empty')}</i>}
                                  </span>
                                </label>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {calm.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer font-medium" style={{ color: 'var(--tblr-muted)' }}>{t('contacts_merge_calm_summary', { count: calm.length })}</summary>
              <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-[12rem_minmax(0,1fr)]">
                {calm.map(p => (
                  <div key={p.key} className="contents">
                    <dt style={{ color: 'var(--tblr-muted)' }}>{label(p.key)}</dt>
                    <dd style={{ color: 'var(--tblr-text)' }}><FieldValue field={p.key} value={p.values.find(v => v.value)!.value} /></dd>
                  </div>
                ))}
              </dl>
            </details>
          )}
          <p className="text-xs" style={{ color: 'var(--tblr-muted)' }}>{t('contacts_merge_lists_note')}</p>
        </>
      )}

      {step === 2 && (
        <>
          <section className="rounded-lg p-4" style={{ background: 'var(--tblr-surface-2)' }} aria-labelledby="merge-result">
            <h4 id="merge-result" className="text-sm font-semibold mb-3" style={{ color: 'var(--tblr-text)' }}>{t('contacts_merge_result_title', { name: contactName(result as any) })}</h4>
            <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[12rem_minmax(0,1fr)]">
              {plan.map(p => {
                const source = contacts.find(c => c.id === pickedFor(p.key, p.pick));
                const value = String((result as any)[p.key] ?? '').trim() || (source ? String((source as any)[p.key] ?? '') : '');
                return value ? (
                  <div key={p.key} className="contents">
                    <dt style={{ color: 'var(--tblr-muted)' }}>{label(p.key)}</dt>
                    <dd style={{ color: 'var(--tblr-text)' }}><FieldValue field={p.key} value={value} /></dd>
                  </div>
                ) : null;
              })}
              {[...MERGE_LIST_TEXT_FIELDS, ...MERGE_LIST_JSON_FIELDS, 'notes'].map(key => {
                const raw = (result as any)[key];
                const value = Array.isArray(raw) ? raw.join(', ') : String(raw ?? '').trim();
                return value ? (
                  <div key={key} className="contents">
                    <dt style={{ color: 'var(--tblr-muted)' }}>{t(`contacts_merge_field_${key}`)}</dt>
                    <dd className="whitespace-pre-line" style={{ color: 'var(--tblr-text)' }}>{value}</dd>
                  </div>
                ) : null;
              })}
            </dl>
          </section>
          <section aria-labelledby="merge-moved">
            <h4 id="merge-moved" className="text-sm font-semibold mb-2" style={{ color: 'var(--tblr-text)' }}>{t('contacts_merge_moved_title')}</h4>
            <ul className="text-sm list-disc pl-5 space-y-1" style={{ color: 'var(--tblr-text)' }}>
              {summaryLines.map(l => <li key={l.key}>{l.text}</li>)}
              <li>{t('contacts_merge_moved_other')}</li>
            </ul>
          </section>
        </>
      )}

      {step === 3 && (
        <>
          <div role="alert" className="flex gap-3 rounded-lg p-4 text-sm" style={{ background: 'color-mix(in srgb, var(--tblr-danger) 12%, transparent)', color: 'var(--tblr-danger)' }}>
            <IconAlertTriangle size={20} className="shrink-0 mt-0.5" aria-hidden />
            <div>
              <b>{t('contacts_merge_final_title')}</b>
              <ul className="list-disc pl-5 mt-1 space-y-1">
                <li>{t('contacts_merge_final_deleted', { count: duplicates.length, names: duplicates.map(contactName).join(', ') })}</li>
                <li>{t('contacts_merge_final_kept', { name: contactName(contacts.find(c => c.id === primaryId) as any) })}</li>
              </ul>
            </div>
          </div>
          <div>
            <label htmlFor="merge-confirm" className="block text-sm mb-2" style={{ color: 'var(--tblr-text)' }}>
              {t('contacts_merge_confirm_instruction', { word: MERGE_CONFIRM_WORD })}
            </label>
            <input id="merge-confirm" autoFocus autoComplete="off" value={typed} onChange={e => setTyped(e.target.value)}
              placeholder={MERGE_CONFIRM_WORD} onKeyDown={e => { if (e.key === 'Enter') void submit(); }}
              className="w-full max-w-xs px-3 py-2 rounded-lg outline-none focus:ring-2 focus:ring-red-500 tracking-wider"
              style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', color: 'var(--tblr-text)' }} />
          </div>
          {error && <p role="alert" className="text-sm" style={{ color: 'var(--tblr-danger)' }}>{error}</p>}
        </>
      )}
    </ModalShell>
  );
}
