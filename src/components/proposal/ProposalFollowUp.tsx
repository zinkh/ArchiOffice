import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Proposal } from '../../types';
import { ModalShell } from '../ui/ModalShell';
import { useMailAccounts } from '../../hooks/useMailAccounts';
import MailComposeModal from '../MailComposeModal';
import { awaitingProposalReply, canArchiveProposal } from '../../lib/proposalFollowUp';
export async function updateProposalFollowUp(id: string, action: string, date?: string): Promise<Proposal> {
  const response = await fetch('/api/proposals/' + encodeURIComponent(id) + '/follow-up', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, date }),
  });
  const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Suivi indisponible'); return body;
}
export function ProposalFollowUp({ proposal: p, email, onChange, onClose, onSign }: {
  proposal: Proposal; email: string; onChange: (p: Proposal) => void; onClose: () => void; onSign: () => void;
}) {
  const { t, i18n } = useTranslation(); const { accounts, loading } = useMailAccounts();
  const [date, setDate] = useState((p.next_follow_up_at || '').slice(0, 10));
  useEffect(() => setDate((p.next_follow_up_at || '').slice(0, 10)), [p.next_follow_up_at]);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [compose, setCompose] = useState(false);
  const format = (v?: string | null) => v ? new Date(v).toLocaleDateString(i18n.language) : t('proposal_fu_not_recorded');
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
  return <>
    <ModalShell title={t('proposal_fu_title')} subtitle={[p.reference, p.title].filter(Boolean).join(' · ')} onClose={onClose} busy={busy} size="md">
      <div className="space-y-5">
        {error && <p role="alert" style={{ color: 'var(--tblr-danger)' }}>{error}</p>}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt>{t('proposal_fu_sent')}</dt><dd>{format(p.sent_at)}</dd>
          <dt>{t('proposal_fu_last_reminder')}</dt><dd>{format(p.last_reminder_at)} ({p.reminder_count || 0})</dd>
          <dt>{t('proposal_fu_response')}</dt><dd>{format(p.last_response_at)}</dd>
          <dt>{t('proposal_fu_archive_date')}</dt><dd>{format(p.archived_at)}</dd>
        </dl>
        {awaitingProposalReply(p) && <div className="space-y-3">
          <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>{t('proposal_fu_rule')}</p>
          <label className="block text-sm" htmlFor="proposal-follow-up-date">{t('proposal_fu_next')}</label>
          <div className="flex flex-wrap gap-2">
            <input id="proposal-follow-up-date" type="date" className="form-control flex-1 min-w-0" value={date} onChange={e => setDate(e.target.value)} />
            <button className="btn btn-secondary" disabled={busy || !date} onClick={() => action('schedule')}>{t('proposal_fu_schedule')}</button>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-primary" disabled={busy || loading} onClick={() => setCompose(true)}>{t('proposal_fu_remind')}</button>
            <button className="btn btn-secondary" disabled={busy} onClick={() => action('responded')}>{t('proposal_fu_mark_response')}</button>
          </div>
        </div>}
        <section className="space-y-3 border-t pt-4" style={{ borderColor: 'var(--tblr-border)' }}>
          <h3 className="font-semibold">{t('proposal_sign_title')}</h3>
          {p.signature_provider && <p className="text-sm">{t('signature_provider_current')} {p.signature_provider}</p>}
          {p.signature_status ? <>
            <p className="text-sm">{t('proposal_sign_state_' + p.signature_status, { defaultValue: p.signature_status })}</p>
            <p className="text-sm break-words" style={{ color: 'var(--tblr-muted)' }}>{p.signature_recipient_name} · {p.signature_recipient_email}</p>
            {['draft', 'unknown', 'creating'].includes(p.signature_status) && <p className="text-sm">{t('proposal_sign_uncertain')}</p>}
            <div className="flex flex-wrap gap-2">
              {p.signature_request_id && <button className="btn btn-secondary" disabled={busy} onClick={sync}>{t('proposal_sign_sync')}</button>}
              {p.signature_status === 'completed' && <button className="btn btn-primary" disabled={busy} onClick={download}>{t('proposal_sign_download')}</button>}
            </div>
          </> : !p.archived_at && ['Draft', 'Sent'].includes(p.status) && <button className="btn btn-secondary" onClick={onSign}>{t('proposal_sign_send')}</button>}
        </section>
        <div className="border-t pt-4" style={{ borderColor: 'var(--tblr-border)' }}>
          {p.archived_at ? <button className="btn btn-secondary" disabled={busy} onClick={() => action('restore')}>{t('proposal_fu_restore')}</button>
            : canArchiveProposal(p) && <button className="btn btn-secondary" disabled={busy} onClick={() => action('archive')}>{t('proposal_fu_archive')}</button>}
        </div>
      </div>
    </ModalShell>
    {compose && <MailComposeModal accounts={accounts} title={t('proposal_fu_remind')} initial={{ to: email,
      subject: t('proposal_fu_mail_subject', { reference: p.reference, title: p.title }), body: t('proposal_fu_mail_body', { reference: p.reference, title: p.title }),
    }} onClose={() => setCompose(false)} onSent={() => { setCompose(false); void action('reminded'); }} />}
  </>;
}
