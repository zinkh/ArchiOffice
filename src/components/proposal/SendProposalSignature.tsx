import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ModalShell } from '../ui/ModalShell';
export function SendProposalSignature({ file, proposalId, email, name, onSent, onClose }: {
  file: File; proposalId: string; email: string; name: string; onSent: () => void; onClose: () => void;
}) {
  const { t } = useTranslation(); const [recipientEmail, setEmail] = useState(email); const [recipientName, setName] = useState(name);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [provider, setProvider] = useState<string | null>(null);
  useEffect(() => { void fetch('/api/signatures/status').then(async r => { const s = await r.json(); if (!r.ok) throw new Error(s.error); setProvider(s.provider); }).catch(e => setError(e.message)); }, []);
  const send = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const form = new FormData(); form.append('file', file); form.append('recipient_email', recipientEmail.trim()); form.append('recipient_name', recipientName.trim());
      const response = await fetch('/api/proposals/' + encodeURIComponent(proposalId) + '/signature', { method: 'POST', body: form });
      const body = await response.json(); if (!response.ok) throw new Error(body.error); onSent(); onClose();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  return <ModalShell title={t('proposal_sign_send')} onClose={onClose} busy={busy} size="md">
    <form onSubmit={send} className="space-y-4">
      <p className="text-sm">{t('signature_provider_current')} <strong>{provider || t('signature_provider_none')}</strong></p>
      <p className="text-sm" style={{ color: 'var(--tblr-muted)' }}>{t('proposal_sign_explanation')}</p>
      {error && <p role="alert" style={{ color: 'var(--tblr-danger)' }}>{error}</p>}
      <label className="block text-sm" htmlFor="proposal-signer-name">{t('proposal_sign_name')}</label>
      <input id="proposal-signer-name" className="form-control w-full" required maxLength={200} value={recipientName} onChange={e => setName(e.target.value)} />
      <label className="block text-sm" htmlFor="proposal-signer-email">{t('proposal_sign_email')}</label>
      <input id="proposal-signer-email" className="form-control w-full" type="email" required maxLength={254} value={recipientEmail} onChange={e => setEmail(e.target.value)} />
      <button type="submit" className="btn btn-primary" disabled={busy || !provider}>{busy ? t('proposal_sign_sending') : t('proposal_sign_confirm')}</button>
    </form>
  </ModalShell>;
}
