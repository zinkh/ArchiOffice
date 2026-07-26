import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconCheck, IconX, IconTrash, IconFileTypePdf, IconFileDownload } from '@tabler/icons-react';
import { apiFetch } from '../lib/api';
import { useUser } from '../UserContext';
import { useSettings } from '../hooks/useSettings';
import { exportLeaveBalancesTablePdf, exportLeaveBalanceFichePdf } from '../lib/hrExport';
import type { LeaveRequest, LeaveBalance, LeaveBalanceAllEntry, LeaveType, TeamMember } from '../types';

export const LEAVE_TYPE_LABELS: Record<LeaveType, string> = {
  conges_payes: 'Congés payés',
  rtt: 'RTT',
  maladie: 'Maladie',
  sans_solde: 'Congé sans solde',
  exceptionnel: 'Congé exceptionnel',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'En attente', approved: 'Approuvé', rejected: 'Refusé', cancelled: 'Annulé',
};
const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  approved: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  cancelled: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
};

// Congés exceptionnels — Convention collective nationale des entreprises d'architecture
// (IDCC 2332, Article VIII-4). Suggested day counts, editable per request.
const MOTIF_OPTIONS: { value: string; label: string; days: number }[] = [
  { value: 'naissance', label: "Naissance / adoption d'un enfant", days: 3 },
  { value: 'mariage_salarie', label: 'Mariage du salarié', days: 6 },
  { value: 'mariage_enfant', label: "Mariage d'un enfant", days: 2 },
  { value: 'journee_citoyen', label: 'Journée du citoyen', days: 1 },
  { value: 'paternite', label: 'Congé paternité', days: 11 },
  { value: 'deces_conjoint_enfant', label: "Décès du conjoint ou d'un enfant", days: 6 },
  { value: 'deces_parent', label: 'Décès du père ou de la mère', days: 3 },
  { value: 'deces_autre_famille', label: 'Décès frère/sœur, beaux-parents, grands-parents', days: 2 },
];

// Article VII-3-1-3 — jours de RTT selon l'horaire hebdomadaire contractuel (référence uniquement).
const RTT_REFERENCE = [
  { hours: 39, days: 23 }, { hours: 38, days: 17 }, { hours: 37, days: 11 }, { hours: 36, days: 6 }, { hours: 35, days: 0 },
];

function businessDaysBetween(startStr: string, endStr: string): number {
  if (!startStr || !endStr) return 0;
  let count = 0;
  let d = new Date(startStr + 'T00:00:00Z');
  const end = new Date(endStr + 'T00:00:00Z');
  if (d > end) return 0;
  while (d <= end) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) count++;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return count;
}

export default function Leave() {
  const { t } = useTranslation();
  const { currentUser } = useUser();
  const { settings } = useSettings();
  const isAdmin = currentUser?.system_role === 'admin';
  const currentYear = new Date().getFullYear();
  const agencySettings = { agencyName: settings?.agencyName, address: settings?.address, phone: settings?.phone, email: settings?.email };

  const [tab, setTab] = useState<'mine' | 'validations' | 'balances'>('mine');
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [myRequests, setMyRequests] = useState<LeaveRequest[]>([]);
  const [teamRequests, setTeamRequests] = useState<LeaveRequest[] | null>(null);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [decisionNotes, setDecisionNotes] = useState<Record<string, string>>({});

  const [form, setForm] = useState<{ leave_type: LeaveType; motif: string; start_date: string; end_date: string; reason: string }>(
    { leave_type: 'conges_payes', motif: '', start_date: '', end_date: '', reason: '' },
  );
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Admin balances panel state: userId -> { conges_payes, rtt }
  const [balanceEdits, setBalanceEdits] = useState<Record<string, { conges_payes?: number; rtt?: number }>>({});
  const [allBalances, setAllBalances] = useState<LeaveBalanceAllEntry[]>([]);

  const refreshMine = () => {
    apiFetch<LeaveBalance[]>(`/api/leave_balances?year=${currentYear}`).then(setBalances).catch(() => {});
    apiFetch<LeaveRequest[]>('/api/leave_requests').then(setMyRequests).catch(() => {});
  };

  useEffect(() => { refreshMine(); }, []);
  useEffect(() => {
    apiFetch<LeaveRequest[]>('/api/leave_requests?scope=team').then(setTeamRequests).catch(() => setTeamRequests(null));
  }, []);
  useEffect(() => {
    if (isAdmin) apiFetch<TeamMember[]>('/api/team').then(setTeamMembers).catch(() => {});
  }, [isAdmin]);
  useEffect(() => {
    if (isAdmin) apiFetch<LeaveBalanceAllEntry[]>(`/api/leave_balances/all?year=${currentYear}`).then(setAllBalances).catch(() => {});
  }, [isAdmin, currentYear]);

  const nameById = useMemo(() => Object.fromEntries(teamMembers.map(m => [m.id, m.name])), [teamMembers]);

  const previewDays = businessDaysBetween(form.start_date, form.end_date);

  const submitRequest = async () => {
    setSubmitError(null);
    if (!form.start_date || !form.end_date) { setSubmitError(t('leave_missing_dates')); return; }
    try {
      await apiFetch('/api/leave_requests', {
        method: 'POST',
        body: JSON.stringify({
          leave_type: form.leave_type,
          motif: form.leave_type === 'exceptionnel' ? form.motif : undefined,
          start_date: form.start_date, end_date: form.end_date, reason: form.reason || undefined,
        }),
      });
      setForm({ leave_type: 'conges_payes', motif: '', start_date: '', end_date: '', reason: '' });
      refreshMine();
    } catch (e: any) { setSubmitError(e.message || t('leave_submit_error')); }
  };

  const cancelRequest = async (id: string) => {
    if (!confirm(t('leave_cancel_confirm'))) return;
    try { await apiFetch(`/api/leave_requests/${id}`, { method: 'DELETE' }); refreshMine(); }
    catch (e: any) { alert(e.message || t('leave_cancel_error')); }
  };

  const decide = async (id: string, status: 'approved' | 'rejected') => {
    try {
      await apiFetch(`/api/leave_requests/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status, decision_note: decisionNotes[id] || undefined }) });
      apiFetch<LeaveRequest[]>('/api/leave_requests?scope=team').then(setTeamRequests).catch(() => {});
    } catch (e: any) { alert(e.message || t('leave_decide_error')); }
  };

  const saveBalance = async (userId: string, leaveType: 'conges_payes' | 'rtt', value: number) => {
    try {
      await apiFetch('/api/leave_balances', { method: 'PUT', body: JSON.stringify({ user_id: userId, year: currentYear, leave_type: leaveType, allocated_days: value }) });
    } catch (e: any) { alert(e.message || t('leave_balance_save_error')); }
  };

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-zinc-900 dark:text-white">{t('leave_title')}</h2>

      <div className="flex gap-2 flex-wrap">
        <button onClick={() => setTab('mine')} className={`px-3 py-1.5 rounded-full text-sm font-medium ${tab === 'mine' ? 'bg-blue-600 text-white' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300'}`}>{t('leave_tab_mine')}</button>
        {teamRequests !== null && (
          <button onClick={() => setTab('validations')} className={`px-3 py-1.5 rounded-full text-sm font-medium ${tab === 'validations' ? 'bg-blue-600 text-white' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300'}`}>{t('leave_tab_validations')}</button>
        )}
        {isAdmin && (
          <button onClick={() => setTab('balances')} className={`px-3 py-1.5 rounded-full text-sm font-medium ${tab === 'balances' ? 'bg-blue-600 text-white' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300'}`}>{t('leave_tab_balances')}</button>
        )}
      </div>

      {tab === 'mine' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {balances.map(b => (
              <div key={b.leave_type} className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
                <h4 className="font-semibold text-sm mb-1">{LEAVE_TYPE_LABELS[b.leave_type]} — {b.year}</h4>
                <div className="flex gap-4 text-sm">
                  <span>{t('leave_allocated')}: <strong>{b.allocated_days}</strong></span>
                  <span>{t('leave_used')}: <strong>{b.used_days}</strong></span>
                  <span className="text-blue-600 dark:text-blue-400">{t('leave_remaining')}: <strong>{b.remaining_days}</strong></span>
                </div>
              </div>
            ))}
          </div>

          <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4 space-y-3">
            <h3 className="font-bold">{t('leave_new_request')}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <select className="p-2 border rounded dark:bg-zinc-900 dark:border-zinc-700" value={form.leave_type} onChange={e => setForm({ ...form, leave_type: e.target.value as LeaveType, motif: '' })}>
                {(Object.keys(LEAVE_TYPE_LABELS) as LeaveType[]).map(lt => <option key={lt} value={lt}>{LEAVE_TYPE_LABELS[lt]}</option>)}
              </select>
              {form.leave_type === 'exceptionnel' && (
                <select className="p-2 border rounded dark:bg-zinc-900 dark:border-zinc-700" value={form.motif} onChange={e => setForm({ ...form, motif: e.target.value })}>
                  <option value="">{t('leave_motif_placeholder')}</option>
                  {MOTIF_OPTIONS.map(m => <option key={m.value} value={m.value}>{m.label} ({m.days}j)</option>)}
                </select>
              )}
              <input type="date" className="p-2 border rounded dark:bg-zinc-900 dark:border-zinc-700" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} />
              <input type="date" className="p-2 border rounded dark:bg-zinc-900 dark:border-zinc-700" value={form.end_date} onChange={e => setForm({ ...form, end_date: e.target.value })} />
              <input className="p-2 border rounded md:col-span-2 dark:bg-zinc-900 dark:border-zinc-700" placeholder={t('leave_reason_placeholder')} value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} />
            </div>
            {form.start_date && form.end_date && (
              <p className="text-sm text-zinc-500">{t('leave_business_days_preview', { count: previewDays })}</p>
            )}
            <p className="text-xs text-zinc-400">{t('leave_counting_note')}</p>
            {submitError && <p className="text-red-600 text-sm">{submitError}</p>}
            <button onClick={submitRequest} className="px-4 py-2 rounded bg-blue-600 text-white font-medium">{t('leave_submit')}</button>
          </div>

          <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 dark:bg-zinc-900">
                <tr>
                  <th className="text-left p-3">{t('leave_col_type')}</th>
                  <th className="text-left p-3">{t('leave_col_dates')}</th>
                  <th className="text-left p-3">{t('leave_col_days')}</th>
                  <th className="text-left p-3">{t('leave_col_status')}</th>
                  <th className="text-left p-3"></th>
                </tr>
              </thead>
              <tbody>
                {myRequests.map(r => (
                  <tr key={r.id} className="border-t border-zinc-100 dark:border-zinc-700">
                    <td className="p-3">{LEAVE_TYPE_LABELS[r.leave_type]}{r.motif && ` (${MOTIF_OPTIONS.find(m => m.value === r.motif)?.label || r.motif})`}</td>
                    <td className="p-3">{r.start_date} → {r.end_date}</td>
                    <td className="p-3">{r.business_days}</td>
                    <td className="p-3"><span className={`px-2 py-0.5 rounded-full text-xs ${STATUS_COLORS[r.status]}`}>{STATUS_LABELS[r.status]}</span></td>
                    <td className="p-3">
                      {r.status === 'pending' && (
                        <button onClick={() => cancelRequest(r.id)} className="text-zinc-400 hover:text-red-600"><IconTrash size={15} /></button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'validations' && teamRequests !== null && (
        <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 dark:bg-zinc-900">
              <tr>
                <th className="text-left p-3">{t('leave_col_employee')}</th>
                <th className="text-left p-3">{t('leave_col_type')}</th>
                <th className="text-left p-3">{t('leave_col_dates')}</th>
                <th className="text-left p-3">{t('leave_col_days')}</th>
                <th className="text-left p-3">{t('leave_col_status')}</th>
                <th className="text-left p-3">{t('leave_col_actions')}</th>
              </tr>
            </thead>
            <tbody>
              {teamRequests.map(r => (
                <tr key={r.id} className="border-t border-zinc-100 dark:border-zinc-700">
                  <td className="p-3">{nameById[r.user_id] || r.user_id}</td>
                  <td className="p-3">{LEAVE_TYPE_LABELS[r.leave_type]}</td>
                  <td className="p-3">{r.start_date} → {r.end_date}</td>
                  <td className="p-3">{r.business_days}</td>
                  <td className="p-3"><span className={`px-2 py-0.5 rounded-full text-xs ${STATUS_COLORS[r.status]}`}>{STATUS_LABELS[r.status]}</span></td>
                  <td className="p-3">
                    {r.status === 'pending' && (
                      <div className="flex items-center gap-2">
                        <input placeholder={t('leave_decision_note_placeholder')} className="p-1 border rounded text-xs w-32 dark:bg-zinc-900 dark:border-zinc-700"
                          value={decisionNotes[r.id] || ''} onChange={e => setDecisionNotes({ ...decisionNotes, [r.id]: e.target.value })} />
                        <button onClick={() => decide(r.id, 'approved')} className="text-green-600 hover:text-green-800"><IconCheck size={16} /></button>
                        <button onClick={() => decide(r.id, 'rejected')} className="text-red-600 hover:text-red-800"><IconX size={16} /></button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'balances' && isAdmin && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4 text-xs text-zinc-500">
            <p className="font-semibold mb-1">{t('leave_rtt_reference_title')}</p>
            <p>{RTT_REFERENCE.map(r => `${r.hours}h → ${r.days}j`).join('  ·  ')}</p>
          </div>
          <div className="flex justify-between items-center flex-wrap gap-2">
            <h3 className="font-bold">{t('leave_balances_table_title', { year: currentYear })}</h3>
            <button
              disabled={allBalances.length === 0}
              onClick={() => exportLeaveBalancesTablePdf(String(currentYear), allBalances, agencySettings)}
              className="flex items-center gap-1 text-sm px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              <IconFileTypePdf size={15} /> {t('leave_export_table_pdf')}
            </button>
          </div>
          <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 dark:bg-zinc-900">
                <tr>
                  <th className="text-left p-3">{t('leave_col_employee')}</th>
                  <th className="text-left p-3">{t('leave_type_conges_payes')}</th>
                  <th className="text-left p-3">{t('leave_type_rtt')}</th>
                  <th className="text-left p-3"></th>
                </tr>
              </thead>
              <tbody>
                {teamMembers.map(m => (
                  <tr key={m.id} className="border-t border-zinc-100 dark:border-zinc-700">
                    <td className="p-3">{m.name}</td>
                    <td className="p-3">
                      <input type="number" className="w-20 p-1 border rounded dark:bg-zinc-900 dark:border-zinc-700"
                        value={balanceEdits[m.id]?.conges_payes ?? ''}
                        placeholder="—"
                        onChange={e => setBalanceEdits({ ...balanceEdits, [m.id]: { ...balanceEdits[m.id], conges_payes: parseFloat(e.target.value) } })}
                        onBlur={e => e.target.value && saveBalance(m.id, 'conges_payes', parseFloat(e.target.value))} />
                    </td>
                    <td className="p-3">
                      <input type="number" className="w-20 p-1 border rounded dark:bg-zinc-900 dark:border-zinc-700"
                        value={balanceEdits[m.id]?.rtt ?? ''}
                        placeholder="—"
                        onChange={e => setBalanceEdits({ ...balanceEdits, [m.id]: { ...balanceEdits[m.id], rtt: parseFloat(e.target.value) } })}
                        onBlur={e => e.target.value && saveBalance(m.id, 'rtt', parseFloat(e.target.value))} />
                    </td>
                    <td className="p-3">
                      {allBalances.find(b => b.user_id === m.id) && (
                        <button
                          onClick={() => exportLeaveBalanceFichePdf(allBalances.find(b => b.user_id === m.id)!, agencySettings)}
                          title={t('leave_export_fiche_pdf')}
                          className="text-zinc-400 hover:text-blue-600"
                        >
                          <IconFileDownload size={16} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-zinc-400">{t('leave_balances_hint')}</p>
        </div>
      )}
    </div>
  );
}
