import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconEdit, IconPlus, IconTrash } from '@tabler/icons-react';
import { cn } from '../../lib/utils';
import { useConfirmDialog } from '../ui/ConfirmDialog';
import { budgetDelta, isBudgetOverrun, PHASE_NOTE_KINDS, type PhaseNote, type PhaseNoteKind } from '../../lib/phaseJournal';
import type { PhaseNotesApi } from '../../hooks/usePhaseNotes';

interface PhaseJournalProps {
  api: PhaseNotesApi;
  /** Phases de la mission (contrat), dans l'ordre du stepper. */
  phases: string[];
  /** Phase choisie dans le stepper : le journal la montre par défaut. */
  viewedPhase: string;
  phaseLabel: (phase: string) => string;
  /** Estimation des travaux de la fiche, proposée comme montant « avant ». */
  defaultBudget?: number | null;
}

interface FormState {
  id?: string;
  phase: string;
  kind: PhaseNoteKind;
  body: string;
  occurred_on: string;
  budget_before: string;
  budget_after: string;
}

const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const pctFmt = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1, signDisplay: 'always' });
const today = () => new Date().toISOString().slice(0, 10);

function parseAmount(value: string): number | null {
  const n = Number(value.replace(/\s/g, '').replace(',', '.'));
  return value.trim() && Number.isFinite(n) ? n : null;
}

/** Couleur du repère d'un type : la couleur ne porte que ce qui demande l'attention. */
function kindColor(note: Pick<PhaseNote, 'kind' | 'budget_before' | 'budget_after'>): string {
  if (note.kind === 'budget') return isBudgetOverrun(note) ? 'var(--tblr-danger)' : 'var(--tblr-warning)';
  if (note.kind === 'attention') return 'var(--tblr-warning)';
  if (note.kind === 'programme' || note.kind === 'decision_moa') return 'var(--tblr-primary)';
  return 'var(--tblr-muted)';
}

const fieldCls = 'w-full border rounded-lg px-2.5 py-2 text-[0.8125rem] outline-none focus-visible:ring-2 focus-visible:ring-blue-500';
const fieldStyle = { borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)', background: 'var(--tblr-surface)' };
const labelCls = 'block text-[0.6875rem] font-semibold mb-1';

/**
 * Journal de l'opération : les notes datées de chaque phase de la mission
 * (changement de programme, dépassement de budget, décision du maître
 * d'ouvrage...). Remplace les deux champs d'observations partagés par toutes
 * les phases, où une note d'APS était écrasée par celle de l'APD.
 */
export function PhaseJournal({ api, phases, viewedPhase, phaseLabel, defaultBudget }: PhaseJournalProps) {
  const { t } = useTranslation();
  const formId = useId();
  const { confirm, dialog } = useConfirmDialog();
  const [showAll, setShowAll] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Choisir une phase dans le stepper ramène le journal sur cette phase.
  useEffect(() => { setShowAll(false); }, [viewedPhase]);

  const visible = showAll ? api.notes : api.notes.filter(n => n.phase === viewedPhase);

  const openNew = () => {
    setFormError(null);
    setForm({
      phase: viewedPhase, kind: 'observation', body: '', occurred_on: today(),
      budget_before: defaultBudget ? String(Math.round(defaultBudget)) : '', budget_after: '',
    });
  };
  const openEdit = (note: PhaseNote) => {
    setFormError(null);
    setForm({
      id: note.id, phase: note.phase, kind: note.kind, body: note.body, occurred_on: note.occurred_on,
      budget_before: note.budget_before != null ? String(note.budget_before) : '',
      budget_after: note.budget_after != null ? String(note.budget_after) : '',
    });
  };

  const submit = async () => {
    if (!form || saving) return;
    if (!form.body.trim()) { setFormError(t('phase_journal_error_empty')); return; }
    setSaving(true);
    setFormError(null);
    const input = {
      phase: form.phase, kind: form.kind, body: form.body.trim(), occurred_on: form.occurred_on || today(),
      budget_before: form.kind === 'budget' ? parseAmount(form.budget_before) : null,
      budget_after: form.kind === 'budget' ? parseAmount(form.budget_after) : null,
    };
    const result = form.id ? await api.update(form.id, input) : await api.create(input);
    setSaving(false);
    if (result.ok) {
      // Une note ajoutée sur une autre phase reste visible : on bascule sur
      // « toutes les phases » plutôt que de la faire disparaître de la vue.
      if (input.phase !== viewedPhase) setShowAll(true);
      setForm(null);
    } else {
      setFormError(result.error);
    }
  };

  const remove = async (note: PhaseNote) => {
    const ok = await confirm({
      title: t('phase_journal_delete_title'),
      message: t('phase_journal_delete_message'),
      confirmLabel: t('projectdetail_dialog_delete'),
      cancelLabel: t('projectdetail_dialog_cancel'),
      tone: 'danger',
    });
    if (ok && !(await api.remove(note.id))) setFormError(t('projectdetail_delete_failed'));
  };

  const preview = form?.kind === 'budget'
    ? budgetDelta({ budget_before: parseAmount(form.budget_before), budget_after: parseAmount(form.budget_after) })
    : null;

  return (
    <section aria-labelledby={`${formId}-title`} className="mb-6">
      {dialog}
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 id={`${formId}-title`} className="font-bold text-base" style={{ color: 'var(--tblr-text)' }}>
          {t('phase_journal_title')}
        </h2>
        {!form && (
          <button
            type="button"
            onClick={openNew}
            className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg border text-[0.8125rem] font-semibold transition-colors hover:bg-[var(--tblr-surface-2)] outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-primary)' }}
          >
            <IconPlus size={15} aria-hidden /> {t('phase_journal_add')}
          </button>
        )}
      </div>

      <div role="group" aria-label={t('phase_journal_filter')} className="inline-flex rounded-lg p-0.5 mb-3 text-[0.8125rem]" style={{ background: 'var(--tblr-surface-2)' }}>
        {[
          { all: false, label: t('phase_journal_this_phase', { phase: viewedPhase }) },
          { all: true, label: t('phase_journal_all_phases') },
        ].map(option => (
          <button
            key={String(option.all)}
            type="button"
            aria-pressed={showAll === option.all}
            onClick={() => setShowAll(option.all)}
            className={cn('px-3 py-1 rounded-md transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-500', showAll === option.all ? 'font-semibold' : 'font-medium')}
            style={showAll === option.all
              ? { background: 'var(--tblr-surface)', color: 'var(--tblr-text)', boxShadow: 'var(--tblr-shadow)' }
              : { color: 'var(--tblr-muted)' }}
          >
            {option.label}
          </button>
        ))}
      </div>

      {form && (
        <form
          onSubmit={e => { e.preventDefault(); void submit(); }}
          className="mb-4 p-3 rounded-lg border space-y-3"
          style={{ borderColor: 'var(--tblr-border)', background: 'var(--tblr-surface-2)' }}
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label htmlFor={`${formId}-kind`} className={labelCls} style={{ color: 'var(--tblr-muted)' }}>{t('phase_journal_field_kind')}</label>
              <select id={`${formId}-kind`} className={fieldCls} style={fieldStyle} value={form.kind}
                onChange={e => setForm({ ...form, kind: e.target.value as PhaseNoteKind })}>
                {PHASE_NOTE_KINDS.map(kind => <option key={kind} value={kind}>{t(`phase_journal_kind_${kind}`)}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor={`${formId}-phase`} className={labelCls} style={{ color: 'var(--tblr-muted)' }}>{t('phase_journal_field_phase')}</label>
              <select id={`${formId}-phase`} className={fieldCls} style={fieldStyle} value={form.phase}
                onChange={e => setForm({ ...form, phase: e.target.value })}>
                {phases.map(phase => <option key={phase} value={phase}>{phase} · {phaseLabel(phase)}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor={`${formId}-date`} className={labelCls} style={{ color: 'var(--tblr-muted)' }}>{t('phase_journal_field_date')}</label>
              <input id={`${formId}-date`} type="date" className={fieldCls} style={fieldStyle} value={form.occurred_on}
                onChange={e => setForm({ ...form, occurred_on: e.target.value })} />
            </div>
          </div>

          {form.kind === 'budget' && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
              <div>
                <label htmlFor={`${formId}-before`} className={labelCls} style={{ color: 'var(--tblr-muted)' }}>{t('phase_journal_field_before')}</label>
                <input id={`${formId}-before`} inputMode="decimal" className={cn(fieldCls, 'tabular-nums')} style={fieldStyle} value={form.budget_before}
                  onChange={e => setForm({ ...form, budget_before: e.target.value })} placeholder="0" />
              </div>
              <div>
                <label htmlFor={`${formId}-after`} className={labelCls} style={{ color: 'var(--tblr-muted)' }}>{t('phase_journal_field_after')}</label>
                <input id={`${formId}-after`} inputMode="decimal" className={cn(fieldCls, 'tabular-nums')} style={fieldStyle} value={form.budget_after}
                  onChange={e => setForm({ ...form, budget_after: e.target.value })} placeholder="0" />
              </div>
              <p className="text-[0.8125rem] tabular-nums pb-2" aria-live="polite"
                style={{ color: preview && preview.amount > 0 ? 'var(--tblr-danger)' : 'var(--tblr-muted)' }}>
                {preview ? formatDelta(preview) : t('phase_journal_delta_pending')}
              </p>
            </div>
          )}

          <div>
            <label htmlFor={`${formId}-body`} className={labelCls} style={{ color: 'var(--tblr-muted)' }}>{t('phase_journal_field_body')}</label>
            <textarea id={`${formId}-body`} rows={3} className={cn(fieldCls, 'leading-relaxed resize-y')} style={fieldStyle}
              value={form.body} onChange={e => setForm({ ...form, body: e.target.value })}
              placeholder={t(`phase_journal_placeholder_${form.kind}`)} autoFocus />
          </div>

          {formError && <p role="alert" className="text-[0.8125rem]" style={{ color: 'var(--tblr-danger)' }}>{formError}</p>}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setForm(null)}
              className="h-8 px-3 rounded-lg text-[0.8125rem] font-medium border hover:bg-[var(--tblr-surface)] outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              style={{ borderColor: 'var(--tblr-border)', color: 'var(--tblr-text)' }}>
              {t('projectdetail_dialog_cancel')}
            </button>
            <button type="submit" disabled={saving} aria-busy={saving}
              className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-[0.8125rem] font-semibold text-white disabled:opacity-60 outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-500"
              style={{ background: 'var(--tblr-primary)' }}>
              {saving && <span aria-hidden className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              {form.id ? t('phase_journal_save_edit') : t('phase_journal_save_new')}
            </button>
          </div>
        </form>
      )}

      {!api.loading && visible.length === 0 && !form && (
        <p className="text-[0.8125rem] leading-relaxed py-3" style={{ color: 'var(--tblr-muted)' }}>
          {showAll ? t('phase_journal_empty_all') : t('phase_journal_empty_phase', { phase: viewedPhase })}
        </p>
      )}

      <ol className="divide-y" style={{ borderColor: 'var(--tblr-border)' }}>
        {visible.map(note => {
          const delta = note.kind === 'budget' ? budgetDelta(note) : null;
          return (
            <li key={note.id} className="group py-3 flex gap-3" style={{ borderColor: 'var(--tblr-border)' }}>
              <span aria-hidden className="mt-1.5 w-2 h-2 rounded-full shrink-0" style={{ background: kindColor(note) }} />
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[0.6875rem]" style={{ color: 'var(--tblr-muted)' }}>
                  <span className="font-semibold" style={{ color: 'var(--tblr-text)' }}>{t(`phase_journal_kind_${note.kind}`)}</span>
                  {showAll && <span className="font-mono">{note.phase}</span>}
                  <time dateTime={note.occurred_on}>{new Date(`${note.occurred_on}T00:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}</time>
                  {note.author_name && <span>{note.author_name}</span>}
                </div>
                <p className="mt-1 text-[0.875rem] leading-relaxed whitespace-pre-wrap break-words" style={{ color: 'var(--tblr-text)' }}>{note.body}</p>
                {note.kind === 'budget' && (note.budget_before != null || note.budget_after != null) && (
                  <p className="mt-1 text-[0.8125rem] tabular-nums" style={{ color: 'var(--tblr-text)' }}>
                    {note.budget_before != null ? eur.format(Number(note.budget_before)) : '?'}
                    {' → '}
                    {note.budget_after != null ? eur.format(Number(note.budget_after)) : '?'}
                    {delta && (
                      <span className="ml-2 font-semibold" style={{ color: delta.amount > 0 ? 'var(--tblr-danger)' : 'var(--tblr-muted)' }}>
                        {formatDelta(delta)}
                      </span>
                    )}
                  </p>
                )}
              </div>
              <div className="flex items-start gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100 transition-opacity">
                <button type="button" onClick={() => openEdit(note)} title={t('phase_journal_edit')} aria-label={t('phase_journal_edit')}
                  className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-[var(--tblr-muted)] hover:text-[var(--tblr-primary)] hover:bg-[var(--tblr-surface-2)] outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
                  <IconEdit size={15} />
                </button>
                <button type="button" onClick={() => void remove(note)} title={t('phase_journal_delete_title')} aria-label={t('phase_journal_delete_title')}
                  className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-[var(--tblr-muted)] hover:text-[var(--tblr-danger)] hover:bg-[var(--tblr-surface-2)] outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
                  <IconTrash size={15} />
                </button>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function formatDelta(delta: { amount: number; pct: number | null }): string {
  const sign = delta.amount > 0 ? '+' : delta.amount < 0 ? '−' : '';
  const amount = `${sign}${eur.format(Math.abs(delta.amount))}`;
  return delta.pct == null ? amount : `${amount} (${pctFmt.format(delta.pct)} %)`;
}
