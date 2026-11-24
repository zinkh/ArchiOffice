// Espace d'un confrère invité : suivi de chantier (comptes rendus, réserves AOR, réserves GPA, ACT).
// Même présentation que les ateliers du cabinet (chiffres en tête, tableaux, pastilles de statut), limitée
// à ce que le cabinet a accordé. Le serveur revérifie le droit à chaque requête
// (server/routes/projectShareChantier.ts) ; l'écran ne fait que masquer ce qui n'est pas accordé.
// Le DÉTAIL d'un atelier (issue #688 : présences, suivi par lot et pénalités, photos, coordonnées) n'apparaît que si le
// cabinet l'a coché : sans lui le serveur n'envoie rien de tout cela, ces blocs ne s'affichent donc pas.
// Chaque champ s'enregistre à la sortie du champ, jamais à chaque frappe : la réponse du serveur ne doit
// pas écraser la saisie en cours.
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react';
import { apiFetch } from '../lib/api';
import { cn } from '../lib/utils';
import SharedKpis from './shared/SharedKpis';
import SharedPhoto from './shared/SharedPhoto';
import SharedReservePlan from './shared/SharedReservePlan';
import SharedResponsables, { type ResponsableOptions } from './shared/SharedResponsables';
import { parseJsonList } from '../lib/jsonList';
import { RESERVE_STATUSES, isReserveClosed, isReserveForRecord, reserveOverdueDays, reserveStatusKey, statusPillClass } from './pro/reserveShared';

interface SharedAttendee { name: string | null; role: string | null; status: string | null; present: boolean; excused: boolean }
interface SharedPenalty { id: string; type: string; motif: string | null; jours: number; montant_jour: number; montant: number }
interface SharedLotTracking {
  lot_id: string; lot_label: string | null; status: string | null; effectif: number | null; retard_semaine: number | null; retard_cumule: number | null;
  intemperies_jours: number | null; penalites: SharedPenalty[];
}
interface SharedReport {
  id: string; report_number: number; date: string; statut: string | null;
  meteo: string | null; temperature: string | null; meetingNotes: string | null; nextMeeting: string | null;
  /** Avec le détail de l'atelier seulement. */
  attendance?: SharedAttendee[]; lot_tracking?: SharedLotTracking[];
}
interface SharedNote {
  id: string; category: string; note_number: number; responsible_company: string | null;
  issue_date: string | null; due_date: string | null; status: string | null; text: string | null;
  /** Avec le détail de l'atelier seulement : le nombre de photos, jamais leur adresse. */
  photoCount?: number;
}
interface SharedReserve {
  id: string; number: number | null; title: string; batiment: string | null; local: string | null; status: string | null;
  lots: string | null; entreprises: string | null; due_date: string | null; description: string | null; reponse: string | null;
  /** Avec le détail de l'atelier seulement : photos et position sur le plan (x et y en % du plan). */
  photos?: Array<{ id: string; caption: string | null; has_thumb: boolean }>;
  plan_id?: string | null; x?: number | string | null; y?: number | string | null;
}

const PRESENCE_CLASS: Record<string, string> = {
  P: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  R: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  AE: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-700/50 dark:text-zinc-300',
  ANE: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  NC: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
};

/** Statut de présence P / R / AE / ANE / NC en pastille : la couleur porte la donnée, le libellé reste écrit. */
function PresencePill({ status }: { status: string | null }) {
  const { t } = useTranslation();
  if (!status) return null;
  return <span className={cn('inline-block rounded-full px-2 py-0.5 text-[0.6875rem] font-bold', PRESENCE_CLASS[status] ?? PRESENCE_CLASS.NC)} title={t(`shared_presence_${status}`)}>{status}</span>;
}

const jours = (n: number | null) => (n == null ? '' : String(n));

/** Présences d'un compte rendu (nom, fonction, statut). Aucune coordonnée : la fiche de l'intervenant reste au cabinet. */
function AttendanceTable({ attendance }: { attendance: SharedAttendee[] }) {
  const { t } = useTranslation();
  if (attendance.length === 0) return <p className="text-xs text-[var(--tblr-muted)]">{t('shared_attendance_empty')}</p>;
  return (
    <ActTable title={t('shared_attendance_title')} heads={[t('shared_col_name'), t('shared_col_role'), t('shared_col_presence')]}>
      {attendance.map((a, i) => (
        <tr key={`${a.name}-${i}`} style={{ borderTop: '1px solid var(--tblr-border)' }}>
          <td className="px-3 py-2 font-medium text-[var(--tblr-text)]">{a.name}</td>
          <td className="px-3 py-2 text-[var(--tblr-muted)]">{a.role}</td>
          <td className="px-3 py-2"><PresencePill status={a.status} /></td>
        </tr>
      ))}
    </ActTable>
  );
}

/** Suivi par lot d'un compte rendu : présence, effectif, retards, intempéries et pénalités (le cabinet a coché le détail). */
function LotTrackingTable({ tracking }: { tracking: SharedLotTracking[] }) {
  const { t } = useTranslation();
  if (tracking.length === 0) return null;
  const total = tracking.reduce((sum, l) => sum + l.penalites.reduce((s, p) => s + p.montant, 0), 0);
  return (
    <div className="space-y-1">
      <ActTable title={t('shared_tracking_title')} heads={[t('shared_col_lot'), t('shared_col_presence'), t('shared_col_staff'), t('shared_col_delay_week'), t('shared_col_delay_total'), t('shared_col_weather_days'), t('shared_col_penalties')]}>
        {tracking.map(l => (
          <tr key={l.lot_id} style={{ borderTop: '1px solid var(--tblr-border)' }}>
            <td className="px-3 py-2 align-top font-medium text-[var(--tblr-text)]">{l.lot_label ?? l.lot_id}</td>
            <td className="px-3 py-2 align-top"><PresencePill status={l.status} /></td>
            <td className="px-3 py-2 align-top tabular-nums">{jours(l.effectif)}</td>
            <td className="px-3 py-2 align-top tabular-nums">{jours(l.retard_semaine)}</td>
            <td className="px-3 py-2 align-top tabular-nums">{jours(l.retard_cumule)}</td>
            <td className="px-3 py-2 align-top tabular-nums">{jours(l.intemperies_jours)}</td>
            <td className="px-3 py-2 align-top">
              {l.penalites.length === 0 ? <span className="text-[var(--tblr-muted)]">{t('shared_penalty_none')}</span> : (
                <ul className="space-y-0.5">
                  {l.penalites.map(p => (
                    <li key={p.id} className="whitespace-nowrap">
                      <span className="text-[var(--tblr-text)]">{t(`shared_penalty_${p.type}`)}{p.motif ? ` (${p.motif})` : ''}</span>
                      <span className="text-[var(--tblr-muted)]"> · {p.jours} j × {euros(p.montant_jour)} = </span>
                      <span className="font-mono tabular-nums font-semibold text-red-600">{euros(p.montant)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </td>
          </tr>
        ))}
      </ActTable>
      {total > 0 && <p className="text-xs font-semibold text-[var(--tblr-text)]">{t('shared_penalty_total', { amount: euros(total) })}</p>}
    </div>
  );
}

const cardStyle = { background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' };
const fieldClass = 'px-3 py-1.5 text-xs border border-[var(--tblr-border)] rounded-lg bg-white dark:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-60';
const buttonClass = 'px-3 py-1.5 text-xs font-bold rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 disabled:opacity-50';
const thClass = 'px-3 py-2 text-xs font-semibold text-left';
const NOTE_STATUSES = ['open', 'done'] as const;

/** Champ texte enregistré à la sortie du champ, seulement si la valeur a changé. Le libellé reste visible. */
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
  return (
    <label className="block space-y-0.5">
      <span className="text-[0.6875rem] font-semibold" style={{ color: 'var(--tblr-muted)' }}>{label}</span>
      {multiline
        ? <textarea {...common} rows={3} className={`${fieldClass} w-full`} />
        : <input {...common} type={type} className={`${fieldClass} w-full`} />}
    </label>
  );
}

export function SharedReports({ projectId, canWrite, detail = false }: { projectId: string; canWrite: boolean; /** Le cabinet a coché le détail : présences, suivi par lot, pénalités, photos. */ detail?: boolean }) {
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
    <section className="space-y-3">
      <h2 className="text-sm font-bold text-[var(--tblr-text)]">{t('shared_reports_title')}</h2>
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      {reports.length === 0 && <p className="text-xs text-[var(--tblr-muted)]">{t('shared_reports_empty')}</p>}
      {report && (
        <div className="lg:grid lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-4 space-y-3 lg:space-y-0">
          <nav aria-label={t('shared_reports_list')} className="rounded-lg p-2 self-start max-h-[70dvh] overflow-y-auto" style={cardStyle}>
            <ul className="space-y-0.5">
              {reports.map(r => {
                const active = r.id === reportId;
                return (
                  <li key={r.id}>
                    <button type="button" aria-current={active ? 'true' : undefined} onClick={() => setReportId(r.id)}
                      className={cn('w-full text-left px-2 py-1.5 rounded-md text-sm hover:bg-[var(--tblr-surface-2)]', active && 'font-semibold bg-[var(--tblr-surface-2)]')}>
                      <span className="block text-[var(--tblr-text)]">{t('shared_report_label', { number: r.report_number, date: r.date })}</span>
                      {r.statut && <span className="block text-[0.6875rem] uppercase tracking-wider text-[var(--tblr-muted)]">{r.statut}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="rounded-lg p-4 space-y-3 min-w-0" style={cardStyle}>
            <h3 className="text-sm font-bold text-[var(--tblr-text)]">{t('shared_report_label', { number: report.report_number, date: report.date })}</h3>
            {canWrite && report.statut === 'diffuse' && <p className="text-xs text-[var(--tblr-muted)]">{t('shared_report_locked')}</p>}
            <div className="grid gap-2 sm:grid-cols-2">
              <CommitField key={`m-${report.id}-${report.meteo}`} value={report.meteo} label={t('shared_report_meteo')} disabled={!editable} maxLength={60} onCommit={v => patchReport({ meteo: v })} />
              <CommitField key={`t-${report.id}-${report.temperature}`} value={report.temperature} label={t('shared_report_temperature')} disabled={!editable} maxLength={30} onCommit={v => patchReport({ temperature: v })} />
              <CommitField key={`n-${report.id}-${report.nextMeeting}`} value={report.nextMeeting} label={t('shared_report_next')} disabled={!editable} maxLength={200} onCommit={v => patchReport({ nextMeeting: v })} />
            </div>
            <CommitField key={`g-${report.id}-${report.meetingNotes}`} value={report.meetingNotes} label={t('shared_report_notes')} disabled={!editable} multiline maxLength={5000} onCommit={v => patchReport({ meetingNotes: v })} />

            {detail && report.attendance && <AttendanceTable attendance={report.attendance} />}
            {detail && report.lot_tracking && <LotTrackingTable tracking={report.lot_tracking} />}

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
                  {detail && (note.photoCount ?? 0) > 0 && (
                    <div className="flex flex-wrap gap-2 pt-1" role="group" aria-label={t('shared_photos_label')}>
                      {Array.from({ length: note.photoCount ?? 0 }, (_, i) => (
                        <SharedPhoto key={i} route={`${base}/${report.id}/notes/${note.id}/photos/${i}`} alt={`${note.category} ${i + 1}`} />
                      ))}
                    </div>
                  )}
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
          </div>
        </div>
      )}
    </section>
  );
}

type ReserveFilter = 'all' | 'open' | 'late' | 'done';

/** État d'une réserve pour le suivi : levée, en retard, à lever ou pour mémoire (jamais en retard). */
function reserveState(item: SharedReserve) {
  // Une échéance absente vaut '' : `reserveOverdueDays` ne la compte jamais comme un retard.
  const like = { status: (item.status ?? 'A faire') as any, due_date: item.due_date ?? '' };
  return { closed: isReserveClosed(like), forRecord: isReserveForRecord(like), lateDays: reserveOverdueDays(like) };
}

/** Formulaire de création d'une réserve par le confrère : l'intitulé suffit, le reste se précise ensuite dans la fiche. */
function NewReserveForm({ options, onCreate, onCancel }: { options: ResponsableOptions | null; onCreate: (fields: Record<string, string | string[]>) => Promise<void>; onCancel: () => void }) {
  const { t } = useTranslation();
  const [values, setValues] = useState({ title: '', batiment: '', local: '', due_date: '', description: '' });
  const [responsables, setResponsables] = useState({ lots: [] as string[], entreprises: [] as string[] });
  const [saving, setSaving] = useState(false);
  const set = (key: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValues(v => ({ ...v, [key]: e.target.value }));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!values.title.trim() || saving) return;
    setSaving(true);
    try {
      // Un champ vide n'est pas envoyé : le serveur garde ses valeurs par défaut.
      const fields: Record<string, string | string[]> = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim()));
      if (responsables.lots.length) fields.lots = responsables.lots;
      if (responsables.entreprises.length) fields.entreprises = responsables.entreprises;
      await onCreate(fields);
    } catch { /* l'erreur s'affiche déjà au-dessus du tableau */ } finally { setSaving(false); }
  };
  return (
    <form onSubmit={submit} aria-label={t('shared_reserve_new')} className="grid gap-3 sm:grid-cols-2 rounded-lg p-3" style={{ border: '1px solid var(--tblr-border)', background: 'var(--tblr-surface-2)' }}>
      <label className="block space-y-0.5 sm:col-span-2">
        <span className="text-[0.6875rem] font-semibold" style={{ color: 'var(--tblr-muted)' }}>{t('shared_reserve_title')}</span>
        <input required autoFocus value={values.title} onChange={set('title')} maxLength={200} className={`${fieldClass} w-full`} />
      </label>
      <label className="block space-y-0.5">
        <span className="text-[0.6875rem] font-semibold" style={{ color: 'var(--tblr-muted)' }}>{t('shared_reserve_building')}</span>
        <input value={values.batiment} onChange={set('batiment')} maxLength={200} className={`${fieldClass} w-full`} />
      </label>
      <label className="block space-y-0.5">
        <span className="text-[0.6875rem] font-semibold" style={{ color: 'var(--tblr-muted)' }}>{t('shared_reserve_room')}</span>
        <input value={values.local} onChange={set('local')} maxLength={200} className={`${fieldClass} w-full`} />
      </label>
      <label className="block space-y-0.5">
        <span className="text-[0.6875rem] font-semibold" style={{ color: 'var(--tblr-muted)' }}>{t('shared_reserve_due')}</span>
        <input type="date" value={values.due_date} onChange={set('due_date')} className={`${fieldClass} w-full`} />
      </label>
      <div className="sm:col-span-2"><SharedResponsables value={responsables} options={options} disabled={false} onChange={setResponsables} /></div>
      <label className="block space-y-0.5 sm:col-span-2">
        <span className="text-[0.6875rem] font-semibold" style={{ color: 'var(--tblr-muted)' }}>{t('shared_reserve_description')}</span>
        <textarea rows={3} value={values.description} onChange={set('description')} maxLength={5000} className={`${fieldClass} w-full`} />
      </label>
      <div className="flex gap-2 sm:col-span-2">
        <button type="submit" disabled={saving || !values.title.trim()} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 disabled:opacity-50">{t('shared_reserve_create')}</button>
        <button type="button" onClick={onCancel} className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-[var(--tblr-border)]">{t('shared_plan_cancel')}</button>
      </div>
    </form>
  );
}

export function SharedReserves({ projectId, kind, canWrite, detail = false }: { projectId: string; kind: 'reserves' | 'gpa'; canWrite: boolean; /** Le cabinet a coché le détail : photos des réserves. */ detail?: boolean }) {
  const { t } = useTranslation();
  const [items, setItems] = useState<SharedReserve[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ReserveFilter>('all');
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const path = `/api/shared/projects/${projectId}/${kind === 'gpa' ? 'gpa-reserves' : 'reserves'}`;

  useEffect(() => {
    setItems(null); setError(null);
    apiFetch<SharedReserve[]>(path).then(setItems).catch(e => setError(e?.message || t('share_error')));
  }, [path, t]);

  // Lots et entreprises à choisir : lus une fois, seulement pour qui peut écrire (la route est réservée à l'écriture).
  const [options, setOptions] = useState<ResponsableOptions | null>(null);
  useEffect(() => {
    if (!canWrite) return;
    let cancelled = false;
    apiFetch<ResponsableOptions>(`${path}/options`).then(o => { if (!cancelled) setOptions(o); }).catch(() => { /* les choix manquent, le reste fonctionne */ });
    return () => { cancelled = true; };
  }, [path, canWrite]);

  const patch = async (item: SharedReserve, fields: Record<string, string | number | string[] | null>) => {
    try {
      const saved = await apiFetch<SharedReserve>(`${path}/${item.id}`, { method: 'PUT', body: JSON.stringify(fields) });
      // Fusion : la réponse ne porte pas les photos, que la liste garde.
      setItems(list => (list ?? []).map(r => (r.id === saved.id ? { ...r, ...saved } : r)));
      setError(null);
    } catch (e: any) { setError(e?.message || t('share_error')); throw e; }
  };
  const create = async (fields: Record<string, string | string[]>) => {
    try {
      const created = await apiFetch<SharedReserve>(path, { method: 'POST', body: JSON.stringify(fields) });
      setItems(list => [...(list ?? []), { ...created, photos: [] }]);
      setCreating(false); setOpen(created.id); setError(null);
    } catch (e: any) { setError(e?.message || t('share_error')); throw e; }
  };
  // Les saisies de champ n'ont pas à gérer l'échec : l'erreur s'affiche déjà.
  const patchQuiet = (item: SharedReserve, fields: Record<string, string | number | string[] | null>) => { patch(item, fields).catch(() => {}); };

  const counts = useMemo(() => {
    const list = items ?? [];
    const states = list.map(reserveState);
    return {
      total: list.length,
      open: states.filter(s => !s.closed && !s.forRecord).length,
      late: states.filter(s => s.lateDays > 0).length,
      done: states.filter(s => s.closed).length,
    };
  }, [items]);

  if (!items) return error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null;

  const visible = items.filter(item => {
    const s = reserveState(item);
    return filter === 'all' || (filter === 'open' && !s.closed && !s.forRecord) || (filter === 'late' && s.lateDays > 0) || (filter === 'done' && s.closed);
  });
  const filters: Array<[ReserveFilter, string]> = [['all', 'shared_filter_all'], ['open', 'shared_kpi_open'], ['late', 'shared_kpi_late'], ['done', 'shared_kpi_done']];
  const COLS = 7;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-bold text-[var(--tblr-text)]">{t(kind === 'gpa' ? 'shared_gpa_title' : 'shared_reserves_title')}</h2>
        {canWrite && !creating && (
          <button type="button" onClick={() => setCreating(true)} className="ml-auto px-3 py-1 rounded-lg text-xs font-semibold border border-[var(--tblr-border)] hover:bg-[var(--tblr-surface-2)]">{t('shared_reserve_new')}</button>
        )}
      </div>
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      {canWrite && creating && <NewReserveForm options={options} onCreate={create} onCancel={() => setCreating(false)} />}
      {items.length === 0 && <p className="text-xs text-[var(--tblr-muted)]">{t('shared_reserves_empty')}</p>}
      {items.length > 0 && (
        <>
          <SharedKpis items={[
            { label: t('shared_kpi_total'), value: counts.total },
            { label: t('shared_kpi_open'), value: counts.open },
            { label: t('shared_kpi_late'), value: counts.late, tone: counts.late > 0 ? 'danger' : 'neutral' },
            { label: t('shared_kpi_done'), value: counts.done, tone: counts.done > 0 ? 'ok' : 'neutral' },
          ]} />
          <div role="group" aria-label={t('shared_filter_label')} className="flex flex-wrap gap-1.5">
            {filters.map(([id, label]) => (
              <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}
                className={cn('px-3 py-1 rounded-full text-xs font-semibold border', filter === id ? 'bg-zinc-900 text-white border-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:border-zinc-100' : 'border-[var(--tblr-border)] text-[var(--tblr-muted)] hover:text-[var(--tblr-text)]')}>
                {t(label)}
              </button>
            ))}
          </div>
          <div className="overflow-x-auto rounded-lg" style={{ border: '1px solid var(--tblr-border)', background: 'var(--tblr-surface)' }}>
            <table className="w-full text-sm border-collapse" style={{ minWidth: 760 }}>
              <thead>
                <tr style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-muted)' }}>
                  <th scope="col" className={`${thClass} w-16`}>{t('shared_col_numero')}</th>
                  <th scope="col" className={thClass}>{t('shared_col_title')}</th>
                  <th scope="col" className={thClass}>{t('shared_col_where')}</th>
                  <th scope="col" className={thClass}>{t('shared_col_company')}</th>
                  <th scope="col" className={`${thClass} w-36`}>{t('shared_col_due')}</th>
                  <th scope="col" className={`${thClass} w-48`}>{t('shared_col_status')}</th>
                  <th scope="col" className="w-10"><span className="sr-only">{t('shared_row_details')}</span></th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 && <tr><td colSpan={COLS} className="px-3 py-4 text-xs text-[var(--tblr-muted)]">{t('shared_reserves_no_match')}</td></tr>}
                {visible.map(item => {
                  const status = (item.status ?? 'A faire') as any;
                  const { lateDays } = reserveState(item);
                  const expanded = open === item.id;
                  return (
                    <Fragment key={item.id}>
                      <tr style={{ borderTop: '1px solid var(--tblr-border)' }}>
                        <td className="px-3 py-2 align-top font-mono text-xs text-[var(--tblr-muted)]">{item.number ?? ''}</td>
                        <td className="px-3 py-2 align-top font-medium text-[var(--tblr-text)]">
                          {item.title}
                          {detail && (item.photos?.length ?? 0) > 0 && <span className="ml-2 text-xs font-normal text-[var(--tblr-muted)]">{t('shared_photos_count', { count: item.photos!.length })}</span>}
                        </td>
                        <td className="px-3 py-2 align-top text-xs text-[var(--tblr-muted)]">{[item.batiment, item.local].filter(Boolean).join(' · ')}</td>
                        <td className="px-3 py-2 align-top text-xs text-[var(--tblr-muted)]">{[...parseJsonList(item.lots), ...parseJsonList(item.entreprises)].join(' · ')}</td>
                        <td className="px-3 py-2 align-top text-xs whitespace-nowrap">
                          <span className="block text-[var(--tblr-text)]">{item.due_date ?? ''}</span>
                          {lateDays > 0 && <span className="block font-semibold text-red-600">{t('shared_late_days', { count: lateDays })}</span>}
                        </td>
                        <td className="px-3 py-2 align-top">
                          {canWrite ? (
                            <select
                              value={status} aria-label={t('shared_reserve_status')} onChange={e => patch(item, { status: e.target.value })}
                              className={cn('pill-select', statusPillClass(status))}
                            >
                              {RESERVE_STATUSES.map(s => <option key={s} value={s}>{t(reserveStatusKey(s) ?? s)}</option>)}
                            </select>
                          ) : (
                            <span className={cn(statusPillClass(status), 'inline-block cursor-default')}>{t(reserveStatusKey(status) ?? status)}</span>
                          )}
                        </td>
                        <td className="px-1 py-2 align-top">
                          <button type="button" aria-expanded={expanded} aria-label={t('shared_row_details')} title={t('shared_row_details')}
                            onClick={() => setOpen(expanded ? null : item.id)}
                            className="rounded-md p-1 text-[var(--tblr-muted)] hover:bg-[var(--tblr-surface-2)] hover:text-[var(--tblr-text)]">
                            {expanded ? <IconChevronDown size={14} aria-hidden /> : <IconChevronRight size={14} aria-hidden />}
                          </button>
                        </td>
                      </tr>
                      {expanded && (
                        <tr>
                          <td colSpan={COLS} className="px-4 py-3" style={{ background: 'var(--tblr-surface-2)' }}>
                            <div className="grid gap-3 sm:grid-cols-2">
                              <CommitField key={`t-${item.id}-${item.title}`} value={item.title} label={t('shared_reserve_title')} disabled={!canWrite} maxLength={200} onCommit={v => { if (v) patchQuiet(item, { title: v }); }} />
                              <CommitField key={`e-${item.id}-${item.due_date}`} value={item.due_date} label={t('shared_reserve_due')} disabled={!canWrite} type="date" onCommit={v => patchQuiet(item, { due_date: v })} />
                              <CommitField key={`d-${item.id}-${item.description}`} value={item.description} label={t('shared_reserve_description')} disabled={!canWrite} multiline maxLength={5000} onCommit={v => patchQuiet(item, { description: v })} />
                              <CommitField key={`r-${item.id}-${item.reponse}`} value={item.reponse} label={t('shared_reserve_response')} disabled={!canWrite} multiline maxLength={5000} onCommit={v => patchQuiet(item, { reponse: v })} />
                            </div>
                            <div className="mt-3">
                              <SharedResponsables
                                key={`resp-${item.id}-${item.lots}-${item.entreprises}`}
                                value={{ lots: parseJsonList(item.lots), entreprises: parseJsonList(item.entreprises) }}
                                options={options} disabled={!canWrite}
                                onChange={next => patchQuiet(item, { lots: next.lots, entreprises: next.entreprises })}
                              />
                            </div>
                            {detail && <div className="mt-3"><SharedReservePlan path={path} reserve={item} canWrite={canWrite} onSave={position => patch(item, { ...position })} /></div>}
                            {detail && (item.photos?.length ?? 0) > 0 && (
                              <div className="flex flex-wrap gap-2 mt-3" role="group" aria-label={t('shared_photos_label')}>
                                {item.photos!.map(p => (
                                  <SharedPhoto
                                    key={p.id} alt={p.caption || item.title}
                                    route={`${path}/${item.id}/photos/${p.id}${p.has_thumb ? '?thumb=1' : ''}`} fullRoute={`${path}/${item.id}/photos/${p.id}`}
                                  />
                                ))}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

interface SharedActView {
  phase: string | null;
  lots: Array<{ id: string; name: string | null }>;
  documents: Array<{ id: string; nom: string | null; type_doc: string | null }>;
  /** `email` et `emails_supplementaires` avec le détail de l'atelier seulement. */
  entreprises: Array<{ id: string; nom: string | null; lots_ids: string[]; dce_transmis_le: string | null; relance_le: string | null; offre_recue_le: string | null; ne_repond_pas: boolean; email?: string | null; emails_supplementaires?: string | null }>;
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

/** Table de l'ACT : même cadre et mêmes en-têtes que les tableaux du cabinet. */
function ActTable({ title, heads, children }: { title: string; heads: string[]; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <h3 className="text-xs font-bold text-[var(--tblr-text)]">{title}</h3>
      <div className="overflow-x-auto rounded-lg" style={{ border: '1px solid var(--tblr-border)' }}>
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-muted)' }}>
              {heads.map(h => <th key={h} scope="col" className={thClass}>{h}</th>)}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Atelier ACT d'un confrère : consultation, offres, attributions et marchés. La modification est une PROPOSITION :
 * le confrère n'écrit jamais dans la consultation, le cabinet approuve (server/routes/projectShareActProposals.ts).
 */
export function SharedAct({ projectId, canPropose, detail = false }: { projectId: string; canPropose: boolean; /** Le cabinet a coché le détail : adresses e-mail des entreprises consultées. */ detail?: boolean }) {
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
  const pending = proposals.filter(p => p.status === 'pending');
  const pendingOn = (type: string, id: string, field: string) => pending.find(p => p.targetType === type && p.targetId === id && p.field === field);

  // Meilleure offre conforme de chaque lot : un repère de lecture, comme le comparatif du cabinet.
  const best = new Map<string, number>();
  for (const o of view.offres) {
    if (!o.conforme || !o.lot_id || !o.montant_base || o.montant_base <= 0) continue;
    const current = best.get(o.lot_id);
    if (current === undefined || o.montant_base < current) best.set(o.lot_id, o.montant_base);
  }
  const signed = view.marches.filter(m => m.statut_signature === 'signe').length;

  return (
    <section className="space-y-4">
      <h2 className="text-sm font-bold text-[var(--tblr-text)]">{t('shared_act_title')}</h2>
      {!empty && (
        <SharedKpis items={[
          { label: t('shared_act_entreprises'), value: view.entreprises.length },
          { label: t('shared_act_offres'), value: view.offres.length },
          { label: t('shared_act_attributions'), value: view.attributions.length },
          { label: t('shared_act_marches'), value: `${signed} / ${view.marches.length}` },
        ]} />
      )}
      {canPropose && <p className="text-xs text-[var(--tblr-muted)]">{t('shared_act_propose_hint')}</p>}
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      {notice && <p role="status" className="text-xs text-[var(--tblr-muted)]">{notice}</p>}
      {empty && <p className="text-xs text-[var(--tblr-muted)]">{t('shared_act_empty')}</p>}

      {detail && view.entreprises.length > 0 && <p className="text-xs text-[var(--tblr-muted)]">{t('shared_contacts_note')}</p>}
      {view.entreprises.length > 0 && (
        <ActTable title={t('shared_act_entreprises')} heads={[t('shared_col_company'), t('shared_col_lots'), t('shared_col_state'), ...(detail ? [t('shared_col_email')] : []), ...(canPropose ? [t('shared_col_proposal')] : [])]}>
          {view.entreprises.map(e => (
            <tr key={e.id} style={{ borderTop: '1px solid var(--tblr-border)' }}>
              <td className="px-3 py-2 align-top font-medium text-[var(--tblr-text)]">{e.nom}</td>
              <td className="px-3 py-2 align-top text-[var(--tblr-muted)]">{e.lots_ids.map(lotName).join(', ')}</td>
              <td className="px-3 py-2 align-top text-[var(--tblr-muted)]">
                {e.ne_repond_pas ? t('shared_act_no_answer')
                  : e.offre_recue_le ? t('shared_act_offer_received', { date: e.offre_recue_le })
                  : e.dce_transmis_le ? t('shared_act_dce_sent', { date: e.dce_transmis_le }) : ''}
              </td>
              {detail && (
                <td className="px-3 py-2 align-top text-[var(--tblr-muted)]">
                  {[e.email, e.emails_supplementaires].filter(Boolean).join(' ; ')}
                </td>
              )}
              {canPropose && (
                <td className="px-3 py-2 align-top whitespace-nowrap space-y-1">
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
        </ActTable>
      )}

      {view.offres.length > 0 && (
        <ActTable title={t('shared_act_offres')} heads={[t('shared_col_lot'), t('shared_col_company'), t('shared_col_amount'), t('shared_col_conform'), ...(canPropose ? [t('shared_col_proposal')] : [])]}>
          {view.offres.map(o => (
            <tr key={o.id} style={{ borderTop: '1px solid var(--tblr-border)' }}>
              <td className="px-3 py-2 align-top text-[var(--tblr-muted)]">{lotName(o.lot_id)}</td>
              <td className="px-3 py-2 align-top font-medium text-[var(--tblr-text)]">{company(o.entreprise_id)}</td>
              <td className="px-3 py-2 align-top whitespace-nowrap font-mono tabular-nums">
                {euros(o.montant_base)}
                {o.lot_id && o.montant_base != null && best.get(o.lot_id) === o.montant_base && o.conforme && (
                  <span className="ml-2 rounded-full px-2 py-0.5 text-[0.6875rem] font-bold bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">{t('shared_act_best')}</span>
                )}
              </td>
              <td className="px-3 py-2 align-top text-[var(--tblr-muted)]">{o.conforme ? '' : `${t('shared_act_non_conform')}${o.motif_nc ? ` : ${o.motif_nc}` : ''}`}</td>
              {canPropose && (
                <td className="px-3 py-2 align-top whitespace-nowrap space-y-1">
                  <CommitField
                    key={`mb-${o.id}-${o.montant_base}`} value={o.montant_base == null ? '' : String(o.montant_base)} label={t('shared_act_field_montant_base')}
                    disabled={!!pendingOn('offre', o.id, 'montant_base')} onCommit={v => propose('offre', o.id, 'montant_base', v)}
                  />
                  <label className="inline-flex items-center gap-1">
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
        </ActTable>
      )}

      {view.attributions.length > 0 && (
        <ActTable title={t('shared_act_attributions')} heads={[t('shared_col_lot'), t('shared_col_company'), t('shared_col_amount')]}>
          {view.attributions.map(a => (
            <tr key={`${a.lot_id}-${a.entreprise_id}`} style={{ borderTop: '1px solid var(--tblr-border)' }}>
              <td className="px-3 py-2 text-[var(--tblr-muted)]">{lotName(a.lot_id)}</td>
              <td className="px-3 py-2 font-medium text-[var(--tblr-text)]">{company(a.entreprise_id)}</td>
              <td className="px-3 py-2 whitespace-nowrap font-mono tabular-nums">{euros(a.montant)}</td>
            </tr>
          ))}
        </ActTable>
      )}

      {view.marches.length > 0 && (
        <ActTable title={t('shared_act_marches')} heads={[t('shared_col_lot'), t('shared_col_company'), t('shared_col_amount'), t('shared_col_state')]}>
          {view.marches.map(m => (
            <tr key={m.id} style={{ borderTop: '1px solid var(--tblr-border)' }}>
              <td className="px-3 py-2 text-[var(--tblr-muted)]">{[m.lot_numero, m.lot_titre].filter(Boolean).join(' ')}</td>
              <td className="px-3 py-2 font-medium text-[var(--tblr-text)]">{m.entreprise_nom}</td>
              <td className="px-3 py-2 whitespace-nowrap font-mono tabular-nums">{euros(m.montant_ht)}</td>
              <td className="px-3 py-2 text-[var(--tblr-muted)]">{m.statut_signature === 'signe' ? t('shared_act_signed') : ''}</td>
            </tr>
          ))}
        </ActTable>
      )}

      {view.questions.length > 0 && (
        <div className="rounded-lg p-4" style={cardStyle}>
          <h3 className="text-xs font-bold text-[var(--tblr-text)] mb-1">{t('shared_act_questions')}</h3>
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
        <div className="rounded-lg p-4" style={cardStyle}>
          <h3 className="text-xs font-bold text-[var(--tblr-text)] mb-1">{t('shared_act_my_proposals')}</h3>
          <ul className="space-y-1.5 text-xs">
            {proposals.slice(0, 20).map(p => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2" style={{ borderTop: '1px solid var(--tblr-border)', paddingTop: '0.375rem' }}>
                <span className="text-[var(--tblr-text)]">
                  {t(`shared_act_field_${p.field}`)} : {p.baseValue || '·'} → {p.proposedValue || '·'}
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
