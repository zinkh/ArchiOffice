// Espace d'un confrère invité : suivi de chantier (comptes rendus, réserves AOR, réserves GPA).
// Le serveur revérifie le droit à chaque requête (server/routes/projectShareChantier.ts) ; l'écran
// ne fait que masquer ce qui n'est pas accordé. Chaque champ s'enregistre à la sortie du champ,
// jamais à chaque frappe : la réponse du serveur ne doit pas écraser la saisie en cours.
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../lib/api';
import { RESERVE_STATUSES, reserveStatusKey } from './pro/reserveShared';

interface SharedReport {
  id: string; report_number: number; date: string; statut: string | null;
  meteo: string | null; temperature: string | null; meetingNotes: string | null; nextMeeting: string | null;
}
interface SharedNote {
  id: string; category: string; note_number: number; responsible_company: string | null;
  issue_date: string | null; due_date: string | null; status: string | null; text: string | null;
}
interface SharedReserve {
  id: string; number: number | null; title: string; batiment: string | null; local: string | null; status: string | null;
  lots: string | null; entreprises: string | null; due_date: string | null; description: string | null; reponse: string | null;
}

const cardStyle = { background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' };
const fieldClass = 'px-3 py-1.5 text-xs border border-[var(--tblr-border)] rounded-lg bg-white dark:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-60';
const buttonClass = 'px-3 py-1.5 text-xs font-bold rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 disabled:opacity-50';
const NOTE_STATUSES = ['open', 'done'] as const;

/** Champ texte enregistré à la sortie du champ, seulement si la valeur a changé. */
function CommitField({ value, label, disabled, multiline, type = 'text', maxLength, onCommit }: {
  value: string | null; label: string; disabled: boolean; multiline?: boolean; type?: 'text' | 'date'; maxLength?: number;
  onCommit: (next: string) => void;
}) {
  const common = {
    defaultValue: value ?? '', disabled, 'aria-label': label, placeholder: label, maxLength,
    onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const next = e.target.value.trim();
      if (next !== (value ?? '').trim()) onCommit(next);
    },
  };
  return multiline
    ? <textarea {...common} rows={3} className={`${fieldClass} w-full`} />
    : <input {...common} type={type} className={`${fieldClass} w-full`} />;
}

export function SharedReports({ projectId, canWrite }: { projectId: string; canWrite: boolean }) {
  const { t } = useTranslation();
  const [reports, setReports] = useState<SharedReport[] | null>(null);
  const [reportId, setReportId] = useState('');
  const [notes, setNotes] = useState<SharedNote[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState('');
  const [text, setText] = useState('');

  const base = `/api/shared/projects/${projectId}/reports`;
  const fail = (e: any) => setError(e?.message || t('share_error'));

  const loadReports = useCallback(async () => {
    try {
      const list = await apiFetch<SharedReport[]>(base);
      setReports(list);
      setReportId(current => (list.some(r => r.id === current) ? current : list[0]?.id ?? ''));
    } catch (e: any) { setError(e?.message || t('share_error')); }
  }, [base, t]);

  useEffect(() => { void loadReports(); }, [loadReports]);

  const loadNotes = useCallback(async (id: string) => {
    if (!id) { setNotes([]); return; }
    try { setNotes(await apiFetch<SharedNote[]>(`${base}/${id}/notes`)); } catch (e: any) { setError(e?.message || t('share_error')); }
  }, [base, t]);

  useEffect(() => { void loadNotes(reportId); }, [reportId, loadNotes]);

  const report = reports?.find(r => r.id === reportId) ?? null;
  // Un compte rendu diffusé est parti chez les entreprises : le serveur le refuse, l'écran le grise.
  const editable = canWrite && !!report && report.statut !== 'diffuse';

  const patchReport = async (fields: Record<string, string>) => {
    if (!report) return;
    try {
      const saved = await apiFetch<SharedReport>(`${base}/${report.id}`, { method: 'PUT', body: JSON.stringify(fields) });
      setReports(list => (list ?? []).map(r => (r.id === saved.id ? { ...r, ...saved } : r)));
      setError(null);
    } catch (e: any) { fail(e); }
  };

  const patchNote = async (note: SharedNote, fields: Record<string, string>) => {
    if (!report) return;
    try {
      const saved = await apiFetch<SharedNote>(`${base}/${report.id}/notes/${note.id}`, { method: 'PUT', body: JSON.stringify(fields) });
      setNotes(list => list.map(n => (n.id === saved.id ? saved : n)));
      setError(null);
    } catch (e: any) { fail(e); }
  };

  const addNote = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!report) return;
    try {
      const created = await apiFetch<SharedNote>(`${base}/${report.id}/notes`, { method: 'POST', body: JSON.stringify({ category, text }) });
      setNotes(list => [...list, created]);
      setCategory(''); setText(''); setError(null);
    } catch (e: any) { fail(e); }
  };

  if (!reports) return error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null;

  return (
    <section className="rounded-lg p-4 space-y-3" style={cardStyle}>
      <h2 className="text-sm font-bold text-[var(--tblr-text)]">{t('shared_reports_title')}</h2>
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      {reports.length === 0 && <p className="text-xs text-[var(--tblr-muted)]">{t('shared_reports_empty')}</p>}
      {report && (
        <>
          <select value={reportId} onChange={e => setReportId(e.target.value)} aria-label={t('shared_reports_title')} className={fieldClass}>
            {reports.map(r => <option key={r.id} value={r.id}>{t('shared_report_label', { number: r.report_number, date: r.date })}</option>)}
          </select>
          {canWrite && report.statut === 'diffuse' && <p className="text-xs text-[var(--tblr-muted)]">{t('shared_report_locked')}</p>}
          <div className="grid gap-2 sm:grid-cols-2">
            <CommitField key={`m-${report.id}-${report.meteo}`} value={report.meteo} label={t('shared_report_meteo')} disabled={!editable} maxLength={60} onCommit={v => patchReport({ meteo: v })} />
            <CommitField key={`t-${report.id}-${report.temperature}`} value={report.temperature} label={t('shared_report_temperature')} disabled={!editable} maxLength={30} onCommit={v => patchReport({ temperature: v })} />
            <CommitField key={`n-${report.id}-${report.nextMeeting}`} value={report.nextMeeting} label={t('shared_report_next')} disabled={!editable} maxLength={200} onCommit={v => patchReport({ nextMeeting: v })} />
          </div>
          <CommitField key={`g-${report.id}-${report.meetingNotes}`} value={report.meetingNotes} label={t('shared_report_notes')} disabled={!editable} multiline maxLength={5000} onCommit={v => patchReport({ meetingNotes: v })} />

          <ul className="space-y-3">
            {notes.length === 0 && <li className="text-xs text-[var(--tblr-muted)]">{t('shared_notes_empty')}</li>}
            {notes.map(note => (
              <li key={`${note.id}-${note.status}-${note.due_date}-${note.text}`} className="space-y-1.5 pt-2" style={{ borderTop: '1px solid var(--tblr-border)' }}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-bold text-[var(--tblr-text)]">
                    {note.note_number}. {note.category}{note.responsible_company ? ` · ${note.responsible_company}` : ''}
                  </span>
                  <select
                    value={note.status ?? 'open'} disabled={!editable} aria-label={t('shared_note_status')}
                    onChange={e => patchNote(note, { status: e.target.value })} className={fieldClass}
                  >
                    {NOTE_STATUSES.map(s => <option key={s} value={s}>{t(`shared_note_status_${s}`)}</option>)}
                    {note.status && !(NOTE_STATUSES as readonly string[]).includes(note.status) && <option value={note.status}>{note.status}</option>}
                  </select>
                </div>
                <CommitField value={note.text} label={t('shared_note_text')} disabled={!editable} multiline maxLength={5000} onCommit={v => patchNote(note, { text: v })} />
                <CommitField value={note.due_date} label={t('shared_note_due')} disabled={!editable} type="date" onCommit={v => patchNote(note, { due_date: v })} />
              </li>
            ))}
          </ul>

          {editable && (
            <form onSubmit={addNote} className="flex flex-wrap items-end gap-2 pt-2" style={{ borderTop: '1px solid var(--tblr-border)' }}>
              <input required value={category} onChange={e => setCategory(e.target.value)} maxLength={120} placeholder={t('shared_note_category')} aria-label={t('shared_note_category')} className={`${fieldClass} min-w-40`} />
              <input value={text} onChange={e => setText(e.target.value)} maxLength={5000} placeholder={t('shared_note_text')} aria-label={t('shared_note_text')} className={`${fieldClass} flex-1 min-w-40`} />
              <button type="submit" className={buttonClass}>{t('shared_note_add')}</button>
            </form>
          )}
        </>
      )}
    </section>
  );
}

export function SharedReserves({ projectId, kind, canWrite }: { projectId: string; kind: 'reserves' | 'gpa'; canWrite: boolean }) {
  const { t } = useTranslation();
  const [items, setItems] = useState<SharedReserve[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const path = `/api/shared/projects/${projectId}/${kind === 'gpa' ? 'gpa-reserves' : 'reserves'}`;

  useEffect(() => {
    setItems(null); setError(null);
    apiFetch<SharedReserve[]>(path).then(setItems).catch(e => setError(e?.message || t('share_error')));
  }, [path, t]);

  const patch = async (item: SharedReserve, fields: Record<string, string>) => {
    try {
      const saved = await apiFetch<SharedReserve>(`${path}/${item.id}`, { method: 'PUT', body: JSON.stringify(fields) });
      setItems(list => (list ?? []).map(r => (r.id === saved.id ? saved : r)));
      setError(null);
    } catch (e: any) { setError(e?.message || t('share_error')); }
  };

  if (!items) return error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null;

  return (
    <section className="rounded-lg p-4 space-y-3" style={cardStyle}>
      <h2 className="text-sm font-bold text-[var(--tblr-text)]">{t(kind === 'gpa' ? 'shared_gpa_title' : 'shared_reserves_title')}</h2>
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      {items.length === 0 && <p className="text-xs text-[var(--tblr-muted)]">{t('shared_reserves_empty')}</p>}
      <ul className="space-y-3">
        {items.map(item => (
          <li key={`${item.id}-${item.status}-${item.due_date}-${item.reponse}-${item.description}`} className="space-y-1.5 pt-2" style={{ borderTop: '1px solid var(--tblr-border)' }}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium text-[var(--tblr-text)]">{item.number ? `N° ${item.number} · ` : ''}{item.title}</span>
              <select
                value={item.status ?? 'A faire'} disabled={!canWrite} aria-label={t('shared_reserve_status')}
                onChange={e => patch(item, { status: e.target.value })} className={fieldClass}
              >
                {RESERVE_STATUSES.map(s => <option key={s} value={s}>{t(reserveStatusKey(s) ?? s)}</option>)}
              </select>
            </div>
            <div className="text-xs text-[var(--tblr-muted)]">
              {[item.batiment, item.local, item.lots, item.entreprises].filter(Boolean).join(' · ')}
            </div>
            <CommitField value={item.description} label={t('shared_reserve_description')} disabled={!canWrite} multiline maxLength={5000} onCommit={v => patch(item, { description: v })} />
            <CommitField value={item.reponse} label={t('shared_reserve_response')} disabled={!canWrite} multiline maxLength={5000} onCommit={v => patch(item, { reponse: v })} />
            <CommitField value={item.due_date} label={t('shared_reserve_due')} disabled={!canWrite} type="date" onCommit={v => patch(item, { due_date: v })} />
          </li>
        ))}
      </ul>
    </section>
  );
}

interface SharedActView {
  phase: string | null;
  lots: Array<{ id: string; name: string | null }>;
  documents: Array<{ id: string; nom: string | null; type_doc: string | null }>;
  entreprises: Array<{ id: string; nom: string | null; lots_ids: string[]; dce_transmis_le: string | null; relance_le: string | null; offre_recue_le: string | null; ne_repond_pas: boolean }>;
  offres: Array<{ id: string; lot_id: string | null; entreprise_id: string | null; montant_base: number | null; note_technique: number | null; conforme: boolean; motif_nc: string | null }>;
  attributions: Array<{ lot_id: string | null; entreprise_id: string | null; montant: number | null; directe: boolean }>;
  questions: Array<{ id: string; question: string | null; reponse: string | null; date_question: string | null }>;
  marches: Array<{ id: string; entreprise_nom: string | null; lot_numero: string | null; lot_titre: string | null; montant_ht: number | null; statut: string | null; statut_signature: string | null }>;
}

interface ActProposal {
  id: string; targetType: 'offre' | 'entreprise'; targetId: string; field: string;
  baseValue: string; proposedValue: string; status: 'pending' | 'applied' | 'rejected' | 'withdrawn' | 'outdated'; decisionNote: string | null;
}

const euros = (v: number | null) => (v == null ? '' : new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(v));

/**
 * Atelier ACT d'un confrère : consultation, offres, attributions et marchés. La modification est une PROPOSITION :
 * le confrère n'écrit jamais dans la consultation, le cabinet approuve (server/routes/projectShareActProposals.ts).
 */
export function SharedAct({ projectId, canPropose }: { projectId: string; canPropose: boolean }) {
  const { t } = useTranslation();
  const [view, setView] = useState<SharedActView | null>(null);
  const [proposals, setProposals] = useState<ActProposal[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const base = `/api/shared/projects/${projectId}/act-proposals`;

  const loadProposals = useCallback(async () => {
    try { setProposals(await apiFetch<ActProposal[]>(base)); } catch { setProposals([]); }
  }, [base]);

  useEffect(() => {
    setView(null); setError(null);
    apiFetch<SharedActView>(`/api/shared/projects/${projectId}/act`).then(setView).catch(e => setError(e?.message || t('share_error')));
    void loadProposals();
  }, [projectId, t, loadProposals]);

  const propose = async (targetType: 'offre' | 'entreprise', targetId: string, field: string, value: string | boolean) => {
    try {
      await apiFetch(base, { method: 'POST', body: JSON.stringify({ targetType, targetId, field, value }) });
      setError(null); setNotice(t('shared_act_proposed'));
      await loadProposals();
    } catch (e: any) { setNotice(null); setError(e?.message || t('share_error')); }
  };

  const withdraw = async (id: string) => {
    try { await apiFetch(`${base}/${id}`, { method: 'DELETE' }); await loadProposals(); } catch (e: any) { setError(e?.message || t('share_error')); }
  };

  if (!view) return error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null;

  const lotName = (id: string | null) => view.lots.find(l => l.id === id)?.name ?? id ?? '';
  const company = (id: string | null) => view.entreprises.find(e => e.id === id)?.nom ?? id ?? '';
  const empty = !view.entreprises.length && !view.offres.length && !view.marches.length;
  const heading = 'text-xs font-bold text-[var(--tblr-text)] mb-1';
  const pending = proposals.filter(p => p.status === 'pending');
  const pendingOn = (type: string, id: string, field: string) => pending.find(p => p.targetType === type && p.targetId === id && p.field === field);

  return (
    <section className="rounded-lg p-4 space-y-4" style={cardStyle}>
      <h2 className="text-sm font-bold text-[var(--tblr-text)]">{t('shared_act_title')}</h2>
      {canPropose && <p className="text-xs text-[var(--tblr-muted)]">{t('shared_act_propose_hint')}</p>}
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      {notice && <p role="status" className="text-xs text-[var(--tblr-muted)]">{notice}</p>}
      {empty && <p className="text-xs text-[var(--tblr-muted)]">{t('shared_act_empty')}</p>}

      {view.entreprises.length > 0 && (
        <div className="overflow-x-auto">
          <h3 className={heading}>{t('shared_act_entreprises')}</h3>
          <table className="w-full text-left text-xs">
            <tbody>
              {view.entreprises.map(e => (
                <tr key={e.id} style={{ borderTop: '1px solid var(--tblr-border)' }}>
                  <td className="py-1.5 pr-3 font-medium text-[var(--tblr-text)]">{e.nom}</td>
                  <td className="py-1.5 pr-3 text-[var(--tblr-muted)]">{e.lots_ids.map(lotName).join(', ')}</td>
                  <td className="py-1.5 pr-3 text-[var(--tblr-muted)]">
                    {e.ne_repond_pas ? t('shared_act_no_answer')
                      : e.offre_recue_le ? t('shared_act_offer_received', { date: e.offre_recue_le })
                      : e.dce_transmis_le ? t('shared_act_dce_sent', { date: e.dce_transmis_le }) : ''}
                  </td>
                  {canPropose && (
                    <td className="py-1.5 whitespace-nowrap">
                      <label className="inline-flex items-center gap-1 mr-3">
                        <input
                          key={`nr-${e.id}-${e.ne_repond_pas}`} type="checkbox" defaultChecked={e.ne_repond_pas}
                          onChange={ev => propose('entreprise', e.id, 'ne_repond_pas', ev.target.checked)} aria-label={t('shared_act_no_answer')}
                        />
                        {t('shared_act_no_answer')}
                      </label>
                      <CommitField
                        key={`rl-${e.id}-${e.relance_le}`} value={e.relance_le} label={t('shared_act_relance')} disabled={!!pendingOn('entreprise', e.id, 'relance_le')}
                        type="date" onCommit={v => propose('entreprise', e.id, 'relance_le', v)}
                      />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view.offres.length > 0 && (
        <div className="overflow-x-auto">
          <h3 className={heading}>{t('shared_act_offres')}</h3>
          <table className="w-full text-left text-xs">
            <tbody>
              {view.offres.map(o => (
                <tr key={o.id} style={{ borderTop: '1px solid var(--tblr-border)' }}>
                  <td className="py-1.5 pr-3 text-[var(--tblr-muted)]">{lotName(o.lot_id)}</td>
                  <td className="py-1.5 pr-3 font-medium text-[var(--tblr-text)]">{company(o.entreprise_id)}</td>
                  <td className="py-1.5 pr-3 whitespace-nowrap">{euros(o.montant_base)}</td>
                  <td className="py-1.5 pr-3 text-[var(--tblr-muted)]">{o.conforme ? '' : `${t('shared_act_non_conform')}${o.motif_nc ? ` : ${o.motif_nc}` : ''}`}</td>
                  {canPropose && (
                    <td className="py-1.5 whitespace-nowrap">
                      <CommitField
                        key={`mb-${o.id}-${o.montant_base}`} value={o.montant_base == null ? '' : String(o.montant_base)} label={t('shared_act_field_montant_base')}
                        disabled={!!pendingOn('offre', o.id, 'montant_base')} onCommit={v => propose('offre', o.id, 'montant_base', v)}
                      />
                      <label className="inline-flex items-center gap-1 mt-1">
                        <input
                          key={`cf-${o.id}-${o.conforme}`} type="checkbox" defaultChecked={o.conforme}
                          onChange={ev => propose('offre', o.id, 'conforme', ev.target.checked)} aria-label={t('shared_act_field_conforme')}
                        />
                        {t('shared_act_field_conforme')}
                      </label>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view.attributions.length > 0 && (
        <div className="overflow-x-auto">
          <h3 className={heading}>{t('shared_act_attributions')}</h3>
          <table className="w-full text-left text-xs">
            <tbody>
              {view.attributions.map(a => (
                <tr key={`${a.lot_id}-${a.entreprise_id}`} style={{ borderTop: '1px solid var(--tblr-border)' }}>
                  <td className="py-1.5 pr-3 text-[var(--tblr-muted)]">{lotName(a.lot_id)}</td>
                  <td className="py-1.5 pr-3 font-medium text-[var(--tblr-text)]">{company(a.entreprise_id)}</td>
                  <td className="py-1.5 whitespace-nowrap">{euros(a.montant)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view.marches.length > 0 && (
        <div className="overflow-x-auto">
          <h3 className={heading}>{t('shared_act_marches')}</h3>
          <table className="w-full text-left text-xs">
            <tbody>
              {view.marches.map(m => (
                <tr key={m.id} style={{ borderTop: '1px solid var(--tblr-border)' }}>
                  <td className="py-1.5 pr-3 text-[var(--tblr-muted)]">{[m.lot_numero, m.lot_titre].filter(Boolean).join(' ')}</td>
                  <td className="py-1.5 pr-3 font-medium text-[var(--tblr-text)]">{m.entreprise_nom}</td>
                  <td className="py-1.5 pr-3 whitespace-nowrap">{euros(m.montant_ht)}</td>
                  <td className="py-1.5 text-[var(--tblr-muted)]">{m.statut_signature === 'signe' ? t('shared_act_signed') : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view.questions.length > 0 && (
        <div>
          <h3 className={heading}>{t('shared_act_questions')}</h3>
          <ul className="space-y-1.5 text-xs">
            {view.questions.map(q => (
              <li key={q.id}>
                <span className="text-[var(--tblr-text)]">{q.question}</span>
                {q.reponse && <span className="block text-[var(--tblr-muted)]">{q.reponse}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {proposals.length > 0 && (
        <div>
          <h3 className={heading}>{t('shared_act_my_proposals')}</h3>
          <ul className="space-y-1.5 text-xs">
            {proposals.slice(0, 20).map(p => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2" style={{ borderTop: '1px solid var(--tblr-border)', paddingTop: '0.375rem' }}>
                <span className="text-[var(--tblr-text)]">
                  {t(`shared_act_field_${p.field}`)} : {p.baseValue || '—'} → {p.proposedValue || '—'}
                  <span className="text-[var(--tblr-muted)]"> · {t(`share_status_${p.status}`)}{p.decisionNote ? ` · ${p.decisionNote}` : ''}</span>
                </span>
                {p.status === 'pending' && canPropose && (
                  <button type="button" onClick={() => withdraw(p.id)} className="px-2 py-1 font-bold rounded-lg bg-zinc-100 dark:bg-zinc-800 text-[var(--tblr-text)]">{t('shared_act_withdraw')}</button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
