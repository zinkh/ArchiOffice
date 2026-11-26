// Propositions de modification d'un confrère sur le CCTP et le DPGF, côté cabinet : la valeur
// actuelle face à la valeur proposée, approuver ou refuser. Approuver est le seul moment où le
// document est écrit (server/routes/projectShareProposals.ts), après un instantané restaurable.
// Réservé aux administrateurs et managers : le serveur répond 403 aux autres.
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../lib/api';
import { metreEnTexte } from '../lib/quantites';
import type { InboxLot } from './ShareCommentsInbox';

interface Proposal {
  id: string; guestEmail: string | null; lotId: string; targetType: 'lot' | 'chapitre' | 'ligne'; targetId: string;
  targetLabel: string | null; field: string; baseValue: string; proposedValue: string; currentValue: string | null;
  status: 'pending' | 'applied' | 'rejected' | 'withdrawn' | 'outdated'; decisionNote: string | null;
  createdAt: string | null; outdated: boolean; drifted: boolean; limitReached: boolean; maxPending: number;
  /** Ce prix chiffrera un article « pour mémoire » : il entrera dans le total du lot. */
  leavesPourMemoire?: boolean;
  /** Code de chaque bâtiment (identifiant vers code), pour lire un métré par bâtiment. */
  batimentCodes?: Record<string, string>;
}

function ValueBox({ label, value, tone }: { label: string; value: string | null; tone?: 'proposed' }) {
  return (
    <div className="min-w-0 rounded-lg px-3 py-2 text-xs" style={{ background: 'var(--tblr-surface-2)', outline: tone === 'proposed' ? '1px solid var(--tblr-border)' : undefined }}>
      <div className="font-semibold text-[var(--tblr-muted)] mb-0.5">{label}</div>
      <pre className="whitespace-pre-wrap break-words font-sans text-[var(--tblr-text)] max-h-48 overflow-auto">{value === null || value === '' ? '—' : value}</pre>
    </div>
  );
}

/** Une valeur proposée telle que le cabinet la lit : un métré (liste JSON) devient des lignes lisibles et un total. */
const lisible = (p: Proposal, value: string | null): string | null =>
  p.field === 'metre' && value !== null ? metreEnTexte(value, '', p.batimentCodes) : value;

function describe(p: Proposal, lots: InboxLot[], t: (k: string, o?: any) => string): string {
  const lot = lots.find(l => l.id === p.lotId);
  return [
    p.guestEmail,
    lot ? [lot.lot_number, lot.lot_title].filter(Boolean).join(' ') : null,
    `${t(`share_target_${p.targetType}`)}${p.targetLabel ? ` ${p.targetLabel}` : ''}`,
    t(`shared_field_${p.field}`),
  ].filter(Boolean).join(' · ');
}

function PendingCard({ projectId, proposal, lots, onDone }: {
  projectId: string; proposal: Proposal; lots: InboxLot[]; onDone: (message?: string) => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');

  const call = async (path: string, body?: unknown) => {
    setBusy(true); setError(null);
    try {
      const res = await apiFetch<{ leftPourMemoire?: boolean }>(`/api/projects/${projectId}/share-proposals/${proposal.id}/${path}`, { method: 'POST', body: JSON.stringify(body ?? {}) });
      onDone(path === 'approve'
        ? `${res?.leftPourMemoire ? `${t('share_proposal_applied_pm')} ` : ''}${t('share_proposal_applied_reload')}`
        : undefined);
    } catch (e: any) {
      // Périmée ou conflit : le serveur n'a rien écrit ; on affiche pourquoi et on rafraîchit la liste.
      setError(e?.message || t('share_error'));
      if (e?.code === 'PROPOSAL_OUTDATED' || e?.code === 'PROPOSAL_CONFLICT') onDone();
    } finally { setBusy(false); }
  };

  return (
    <li className="px-4 py-3 space-y-2" style={{ borderTop: '1px solid var(--tblr-border)' }}>
      <div className="text-xs text-[var(--tblr-muted)]">{describe(proposal, lots, t)}</div>
      <div className="grid gap-2 sm:grid-cols-2">
        <ValueBox label={t('share_proposal_current')} value={lisible(proposal, proposal.currentValue)} />
        <ValueBox label={t('share_proposal_proposed')} value={lisible(proposal, proposal.proposedValue)} tone="proposed" />
      </div>
      {proposal.leavesPourMemoire && (
        <p role="status" className="px-3 py-2 text-xs rounded-lg text-[var(--tblr-text)]" style={{ border: '1px solid var(--tblr-border)' }}>
          {t('share_proposal_leaves_pm')}
        </p>
      )}
      {proposal.outdated && (
        <div className="space-y-2">
          <p role="alert" className="text-xs text-red-600">{t('share_proposal_outdated_badge')}</p>
          <ValueBox label={t('share_proposal_base')} value={lisible(proposal, proposal.baseValue)} />
        </div>
      )}
      {!rejecting ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => call('approve')} disabled={busy || proposal.outdated}
            className="px-3 py-1 text-xs font-bold rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 disabled:opacity-50">
            {t('share_proposal_approve')}
          </button>
          <button type="button" onClick={() => setRejecting(true)} disabled={busy}
            className="px-3 py-1 text-xs font-bold rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-[var(--tblr-text)] disabled:opacity-50">
            {t('share_proposal_reject')}
          </button>
        </div>
      ) : (
        <form onSubmit={e => { e.preventDefault(); void call('reject', { note }); }} className="space-y-1">
          <input value={note} onChange={e => setNote(e.target.value)} maxLength={1000}
            placeholder={t('share_proposal_reject_note')} aria-label={t('share_proposal_reject_note')}
            className="w-full px-3 py-1.5 text-xs border border-[var(--tblr-border)] rounded-lg bg-white dark:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" />
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="px-3 py-1 text-xs font-bold rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 disabled:opacity-50">
              {t('share_proposal_reject_confirm')}
            </button>
            <button type="button" onClick={() => setRejecting(false)} className="px-3 py-1 text-xs font-medium text-[var(--tblr-muted)] underline">{t('shared_proposal_cancel')}</button>
          </div>
        </form>
      )}
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
    </li>
  );
}

export default function ShareProposalsInbox({ projectId, lots }: { projectId: string; lots: InboxLot[] }) {
  const { t } = useTranslation();
  const [items, setItems] = useState<Proposal[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    apiFetch<Proposal[]>(`/api/projects/${projectId}/share-proposals`).then(setItems).catch(() => setItems(null));
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  // Rien à montrer tant qu'aucun confrère n'a proposé : le panneau de partage reste sobre.
  if (!items || items.length === 0) return null;
  const pending = items.filter(p => p.status === 'pending');
  const history = items.filter(p => p.status !== 'pending');
  const atLimit = [...new Map(pending.filter(p => p.limitReached).map(p => [p.guestEmail, p])).values()];

  return (
    <div style={{ borderTop: '1px solid var(--tblr-border)' }}>
      <div className="px-4 py-3 flex items-center justify-between gap-2">
        <span className="text-sm font-bold text-[var(--tblr-text)]">{t('share_proposals_title')}</span>
        {pending.length > 0 && (
          <span className="text-xs font-medium bg-[var(--tblr-surface-2)] text-[var(--tblr-text)] px-2 py-0.5 rounded-full">{pending.length}</span>
        )}
      </div>
      {atLimit.map(p => (
        <p key={p.guestEmail ?? 'limit'} role="alert" className="mx-4 mb-2 px-3 py-2 text-xs rounded-lg text-red-700 dark:text-red-400" style={{ border: '1px solid currentColor' }}>
          {t('share_proposal_limit', { email: p.guestEmail, max: p.maxPending })}
        </p>
      ))}
      {notice && <p role="status" className="mx-4 mb-2 px-3 py-2 text-xs rounded-lg text-[var(--tblr-text)]" style={{ background: 'var(--tblr-surface-2)' }}>{notice}</p>}
      <ul>
        {pending.map(p => (
          <PendingCard key={`${p.id}-${p.outdated}`} projectId={projectId} proposal={p} lots={lots}
            onDone={message => { setNotice(message ?? null); load(); }} />
        ))}
      </ul>
      {history.length > 0 && (
        <details className="px-4 py-3" style={{ borderTop: '1px solid var(--tblr-border)' }}>
          <summary className="text-xs font-medium text-[var(--tblr-muted)] cursor-pointer">{t('share_proposals_history', { count: history.length })}</summary>
          <ul className="mt-2 space-y-2">
            {history.map(p => (
              <li key={p.id} className="text-xs space-y-0.5">
                <div className="text-[var(--tblr-muted)]">{describe(p, lots, t)} · {t(`share_status_${p.status}`)}</div>
                <div className="text-[var(--tblr-text)] break-words whitespace-pre-wrap">« {lisible(p, p.baseValue) || '—'} » → « {lisible(p, p.proposedValue) || '—'} »</div>
                {p.decisionNote && <div className="text-[var(--tblr-muted)]">{t('shared_proposal_note', { note: p.decisionNote })}</div>}
                {p.drifted && <div role="alert" className="text-red-600">{t('share_proposal_drifted', { value: p.proposedValue })}</div>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
