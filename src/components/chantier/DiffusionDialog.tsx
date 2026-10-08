import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { IconSend, IconAlertTriangle, IconCheck } from '@tabler/icons-react';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import type { DiffusionRecipient } from '../../lib/crDiffusion';

export interface DiffusionResult {
  sent: { contact_id: string; name: string; email: string; observations: number }[];
  failed: { contact_id: string; name: string; email: string; error: string }[];
  skipped: { contact_id: string; name: string }[];
}

interface Props {
  open: boolean;
  reportNumber: number | string;
  alreadyDiffused: boolean;
  recipients: DiffusionRecipient[];
  busy: boolean;
  result: DiffusionResult | null;
  /** Message d'une erreur qui a empêché tout envoi. */
  error: string | null;
  onSend: (contactIds: string[]) => void;
  onClose: () => void;
}

/**
 * Diffusion d'un compte-rendu par e-mail. L'architecte voit qui va recevoir quoi
 * AVANT l'envoi (un envoi ne se rattrape pas) : chaque destinataire, son adresse,
 * le nombre d'observations qui lui sont adressées. Ceux sans adresse sont
 * signalés et ne peuvent pas être cochés.
 */
export function DiffusionDialog({ open, reportNumber, alreadyDiffused, recipients, busy, result, error, onSend, onClose }: Props) {
  const titleId = useId();
  const descId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const sendRef = useRef<HTMLButtonElement>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // À l'ouverture : tous ceux qu'on peut joindre sont cochés (« tous les intervenants »).
  useEffect(() => {
    if (open) setSelected(new Set(recipients.filter(r => r.email).map(r => r.contactId)));
  }, [open, recipients]);

  useEscapeKey(open && !busy, onClose);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    (result ? closeRef.current : sendRef.current ?? closeRef.current)?.focus();
    return () => { previous?.focus?.(); };
  }, [open, result]);

  const joignables = useMemo(() => recipients.filter(r => r.email), [recipients]);
  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allSelected = joignables.length > 0 && joignables.every(r => selected.has(r.contactId));

  if (!open) return null;

  const trapFocus = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const first = closeRef.current;
    const last = sendRef.current ?? closeRef.current;
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  const count = selected.size;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50" onClick={() => { if (!busy) onClose(); }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        onKeyDown={trapFocus}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-2xl max-h-[90dvh] flex flex-col rounded-xl overflow-hidden"
        style={{ background: 'var(--tblr-surface)', border: '1px solid var(--tblr-border)', boxShadow: 'var(--tblr-shadow)' }}
      >
        <div className="px-5 pt-5 pb-3">
          <h3 id={titleId} className="text-lg font-bold text-[var(--tblr-text)]">
            {result ? 'Bilan de la diffusion' : alreadyDiffused ? `Rediffuser le compte-rendu n° ${reportNumber}` : `Diffuser le compte-rendu n° ${reportNumber}`}
          </h3>
          <p id={descId} className="text-sm text-[var(--tblr-muted)] mt-1">
            {result
              ? 'Chaque destinataire a reçu un message distinct.'
              : "Chaque destinataire reçoit le PDF en pièce jointe et, dans le corps du message, les seules observations qui le concernent. Les adresses des autres destinataires ne sont pas visibles."}
          </p>
        </div>

        <div className="px-5 pb-3 overflow-y-auto flex-1 min-h-0">
          {error && (
            <div role="alert" className="mb-3 flex items-start gap-2 rounded-lg px-3 py-2 text-sm bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300">
              <IconAlertTriangle size={16} className="mt-0.5 shrink-0" /> <span>{error}</span>
            </div>
          )}

          {result ? (
            <div className="space-y-3 text-sm">
              {result.sent.length > 0 && (
                <div>
                  <p className="font-semibold text-[var(--tblr-text)] flex items-center gap-1.5"><IconCheck size={16} /> Envoyé à {result.sent.length} destinataire{result.sent.length > 1 ? 's' : ''}</p>
                  <ul className="mt-1 space-y-0.5 text-[var(--tblr-muted)]">
                    {result.sent.map(s => (
                      <li key={s.contact_id}>{s.name} ({s.email}), {s.observations} observation{s.observations > 1 ? 's' : ''}</li>
                    ))}
                  </ul>
                </div>
              )}
              {result.failed.length > 0 && (
                <div>
                  <p className="font-semibold text-red-700 dark:text-red-300 flex items-center gap-1.5"><IconAlertTriangle size={16} /> Non envoyé à {result.failed.length} destinataire{result.failed.length > 1 ? 's' : ''}</p>
                  <ul className="mt-1 space-y-0.5 text-[var(--tblr-muted)]">
                    {result.failed.map(f => <li key={f.contact_id}>{f.name} ({f.email}) : {f.error}</li>)}
                  </ul>
                  <p className="mt-1 text-[var(--tblr-muted)]">Utilisez « Rediffuser » pour réessayer ces destinataires.</p>
                </div>
              )}
              {result.skipped.length > 0 && (
                <div>
                  <p className="font-semibold text-[var(--tblr-text)]">Sans adresse e-mail, non contactés</p>
                  <ul className="mt-1 space-y-0.5 text-[var(--tblr-muted)]">{result.skipped.map(s => <li key={s.contact_id}>{s.name}</li>)}</ul>
                </div>
              )}
            </div>
          ) : recipients.length === 0 ? (
            <p className="text-sm text-[var(--tblr-muted)]">
              Aucun destinataire : associez une fiche contact aux lots et aux intervenants de l'opération pour pouvoir diffuser le compte-rendu.
            </p>
          ) : (
            <>
              <label className="flex items-center gap-2 min-h-11 text-sm font-semibold text-[var(--tblr-text)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={allSelected}
                  disabled={busy || joignables.length === 0}
                  onChange={() => setSelected(allSelected ? new Set() : new Set(joignables.map(r => r.contactId)))}
                  className="rounded size-4"
                />
                Tous les destinataires joignables ({joignables.length})
              </label>
              <ul className="divide-y divide-[var(--tblr-border)] border-y border-[var(--tblr-border)]">
                {recipients.map(r => (
                  <li key={r.contactId}>
                    <label className={`flex items-start gap-3 py-2.5 min-h-11 ${r.email ? 'cursor-pointer' : 'opacity-60'}`}>
                      <input
                        type="checkbox"
                        checked={selected.has(r.contactId)}
                        disabled={busy || !r.email}
                        onChange={() => toggle(r.contactId)}
                        className="rounded size-4 mt-1"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-[var(--tblr-text)] truncate">{r.name}</span>
                        <span className="block text-xs text-[var(--tblr-muted)]">{r.roles.join(' · ')}</span>
                        <span className="block text-xs text-[var(--tblr-muted)]">
                          {r.email || "Pas d'adresse e-mail sur la fiche contact : ne recevra rien"}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: 'var(--tblr-surface-2)', color: 'var(--tblr-muted)' }}>
                        {r.observations.length} observation{r.observations.length > 1 ? 's' : ''}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div className="px-5 py-3 flex flex-wrap items-center justify-end gap-2" style={{ borderTop: '1px solid var(--tblr-border)' }}>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            disabled={busy}
            className="min-h-11 px-4 py-2 rounded-lg text-sm font-semibold text-[var(--tblr-text)] hover:bg-[var(--tblr-surface-2)] disabled:opacity-50 transition"
          >
            {result ? 'Fermer' : 'Annuler'}
          </button>
          {!result && recipients.length > 0 && (
            <button
              ref={sendRef}
              type="button"
              onClick={() => onSend(recipients.filter(r => selected.has(r.contactId)).map(r => r.contactId))}
              disabled={busy || count === 0}
              className="min-h-11 flex items-center gap-1.5 px-4 py-2 bg-[var(--tblr-primary)] hover:brightness-90 disabled:opacity-50 text-white rounded-lg text-sm font-bold transition"
            >
              <IconSend size={16} />
              {busy ? 'Envoi en cours…' : `Envoyer à ${count} destinataire${count > 1 ? 's' : ''}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
