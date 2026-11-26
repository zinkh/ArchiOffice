import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { IconPhoneCall, IconArchive } from '@tabler/icons-react';
import type { Proposal } from '../../types';
import { ModalShell } from '../ui/ModalShell';
import { useMailAccounts } from '../../hooks/useMailAccounts';
import MailComposeModal from '../MailComposeModal';
import { awaitingProposalReply, canArchiveProposal, proposalCallbackDue } from '../../lib/proposalFollowUp';
export async function updateProposalFollowUp(id: string, action: string, date?: string): Promise<Proposal> {
  const response = await fetch('/api/proposals/' + encodeURIComponent(id) + '/follow-up', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, date }),
  });
  const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Suivi indisponible'); return body;
}

const DAY_MS = 86400000;

/** Section de la fenêtre : titre en petites capitales grises, filet au-dessus (charte : noir, blanc et gris). */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 pt-5 first:pt-0 border-t first:border-t-0" style={{ borderColor: 'var(--tblr-border)' }}>
      <h3 className="text-[0.6875rem] font-bold uppercase tracking-wider" style={{ color: 'var(--tblr-muted)' }}>{title}</h3>
      {children}
    </section>
  );
}

export function ProposalFollowUp({ proposal: p, email, onChange, onClose, onSign }: {
  proposal: Proposal; email: string; onChange: (p: Proposal) => void; onClose: () => void; onSign: () => void;
}) {
  const { t, i18n } = useTranslation(); const { accounts, loading } = useMailAccounts(); const navigate = useNavigate();
  const [date, setDate] = useState((p.next_follow_up_at || '').slice(0, 10));
  useEffect(() => setDate((p.next_follow_up_at || '').slice(0, 10)), [p.next_follow_up_at]);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [compose, setCompose] = useState(false);
  const format = (v?: string | null) => v ? new Date(v).toLocaleDateString(i18n.language) : null;
  const days = p.sent_at ? Math.floor((Date.now() - Date.parse(p.sent_at)) / DAY_MS) : 0;
  const waiting = awaitingProposalReply(p);
  const action = async (kind: string) => {
    setBusy(true); setError('');
    try { onChange(await updateProposalFollowUp(p.id, kind, date)); }
    catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const sync = async () => {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/proposals/' + encodeURIComponent(p.id) + '/signature/sync', { method: 'POST' });
      const body = await response.json(); if (!response.ok) throw new Error(body.error); onChange(body);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const download = async () => {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/proposals/' + encodeURIComponent(p.id) + '/signature/pdf');
      if (!response.ok) throw new Error((await response.json()).error);
      if (response.headers.get('content-type')?.includes('application/json')) {
        const target = new URL((await response.json()).url);
        if (target.protocol !== 'https:') throw new Error(t('proposal_sign_connect_error'));
        window.location.assign(target.toString()); return;
      }
      const url = URL.createObjectURL(await response.blob()); const a = document.createElement('a');
      a.href = url; a.download = 'proposition-signee.pdf'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const history: Array<[string, string | null, string?]> = [
    [t('proposal_fu_sent'), format(p.sent_at)],
    [t('proposal_fu_last_reminder'), format(p.last_reminder_at), p.reminder_count ? `${p.reminder_count}` : undefined],
    [t('proposal_fu_response'), format(p.last_response_at)],
    [t('proposal_fu_archive_date'), format(p.archived_at), p.archive_reason === 'converted' ? t('proposal_fu_converted_tag') : undefined],
  ];
  const callbackDue = proposalCallbackDue(p);
  return <>
    <ModalShell title={t('proposal_fu_title')} subtitle={[p.reference, p.title].filter(Boolean).join(' · ')} onClose={onClose} busy={busy} size="md" bodyClassName="p-4 sm:p-6">
      <div className="space-y-5">
        {error && <p role="alert" className="text-sm" style={{ color: 'var(--tblr-danger)' }}>{error}</p>}
        {p.archive_reason === 'converted' && p.archived_at && (
          <p className="text-sm rounded-lg px-3 py-2" style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-text)', border: '1px solid var(--tblr-border)' }}>{t('proposal_fu_converted')}</p>
        )}
        {(callbackDue || p.callback_call_id) && (
          <div role={callbackDue ? 'alert' : undefined} className="flex items-start gap-3 rounded-lg px-3 py-3 text-sm"
            style={{ border: '1px solid var(--tblr-border)', borderLeft: '3px solid var(--tblr-warning)', background: 'var(--tblr-surface)' }}>
            <IconPhoneCall size={18} className="shrink-0 mt-0.5" style={{ color: 'var(--tblr-warning)' }} aria-hidden="true" />
            <div className="min-w-0 space-y-1">
              <p className="font-semibold" style={{ color: 'var(--tblr-text)' }}>{t('proposal_fu_callback_due', { days })}</p>
              <p style={{ color: 'var(--tblr-muted)' }}>
                {p.callback_call_id ? t('proposal_fu_callback_created', { date: format(p.callback_created_at) || '' }) : t('proposal_fu_callback_pending')}
              </p>
              {p.callback_call_id && <button type="button" className="btn btn-secondary mt-1" onClick={() => navigate('/appels?open=' + encodeURIComponent(p.callback_call_id!))}>{t('proposal_fu_callback_open')}</button>}
            </div>
          </div>
        )}
        <Section title={t('proposal_fu_history')}>
          <dl className="text-sm divide-y" style={{ borderColor: 'var(--tblr-border)' }}>
            {history.map(([label, value, extra]) => (
              <div key={label} className="flex items-baseline justify-between gap-4 py-2 first:pt-0 last:pb-0" style={{ borderColor: 'var(--tblr-border)' }}>
                <dt style={{ color: 'var(--tblr-muted)' }}>{label}</dt>
                <dd className="text-right tabular-nums" style={{ color: value ? 'var(--tblr-text)' : 'var(--tblr-muted)' }}>
                  {value || t('proposal_fu_not_recorded')}{extra ? <span className="ml-2" style={{ color: 'var(--tblr-muted)' }}>({extra})</span> : null}
                </dd>
              </div>
            ))}
          </dl>
        </Section>
        {waiting && <Section title={t('proposal_fu_reminder_title')}>
          <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>{t('proposal_fu_rule')}</p>
          <div className="space-y-1.5">
            <label className="block text-sm font-medium" htmlFor="proposal-follow-up-date">{t('proposal_fu_next')}</label>
            <div className="flex gap-2">
              <input id="proposal-follow-up-date" type="date" className="form-control flex-1 min-w-0" value={date} onChange={e => setDate(e.target.value)} />
              <button className="btn btn-secondary shrink-0" disabled={busy || !date} onClick={() => action('schedule')}>{t('proposal_fu_schedule')}</button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-primary" disabled={busy || loading} onClick={() => setCompose(true)}>{t('proposal_fu_remind')}</button>
            <button className="btn btn-secondary" disabled={busy} onClick={() => action('responded')}>{t('proposal_fu_mark_response')}</button>
          </div>
        </Section>}
        <Section title={t('proposal_sign_title')}>
          {p.signature_provider && <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>{t('signature_provider_current')} {p.signature_provider}</p>}
          {p.signature_status ? <>
            <p className="text-sm font-medium">{t('proposal_sign_state_' + p.signature_status, { defaultValue: p.signature_status })}</p>
            <p className="text-sm break-words" style={{ color: 'var(--tblr-muted)' }}>{p.signature_recipient_name} · {p.signature_recipient_email}</p>
            {['draft', 'unknown', 'creating'].includes(p.signature_status) && <p className="text-sm">{t('proposal_sign_uncertain')}</p>}
            <div className="flex flex-wrap gap-2">
              {p.signature_request_id && <button className="btn btn-secondary" disabled={busy} onClick={sync}>{t('proposal_sign_sync')}</button>}
              {p.signature_status === 'completed' && <button className="btn btn-primary" disabled={busy} onClick={download}>{t('proposal_sign_download')}</button>}
            </div>
          </> : !p.archived_at && ['Draft', 'Sent'].includes(p.status)
            ? <div><button className="btn btn-secondary" onClick={onSign}>{t('proposal_sign_send')}</button></div>
            : <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>{t('proposal_fu_not_recorded')}</p>}
        </Section>
        {(p.archived_at || canArchiveProposal(p)) && <Section title={t('proposal_fu_archive_title')}>
          {p.archived_at
            ? <button className="btn btn-secondary" disabled={busy} onClick={() => action('restore')}>{t('proposal_fu_restore')}</button>
            : <button className="btn btn-secondary inline-flex items-center gap-2" disabled={busy} onClick={() => action('archive')}><IconArchive size={16} aria-hidden="true" />{t('proposal_fu_archive')}</button>}
        </Section>}
      </div>
    </ModalShell>
    {compose && <MailComposeModal accounts={accounts} title={t('proposal_fu_remind')} initial={{ to: email,
      subject: t('proposal_fu_mail_subject', { reference: p.reference, title: p.title }), body: t('proposal_fu_mail_body', { reference: p.reference, title: p.title }),
    }} onClose={() => setCompose(false)} onSent={() => { setCompose(false); void action('reminded'); }} />}
  </>;
}
