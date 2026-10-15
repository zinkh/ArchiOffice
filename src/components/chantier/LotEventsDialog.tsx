import React, { useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconPlus, IconTrash, IconX } from '@tabler/icons-react';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import type { PenaliteLot, SiteReportLotTracking } from '../../types';
import { PENALITE_TYPES, formatEuros, libellePenalite, montantPenalite, totalPenalites } from '../../lib/siteReportLotSuivi';

/**
 * Pénalités d'un lot, saisies par un bouton « Ajouter » plutôt que par une colonne de chiffres :
 * une feuille au bas de l'écran sur téléphone et tablette, une fenêtre centrée au bureau. Chaque
 * ajout ou retrait est enregistré tout de suite (`onChange`). Les intempéries, qui touchent
 * plusieurs entreprises, ont leur propre fenêtre (IntemperiesDialog).
 */
export const DIALOG_FIELD =
  'w-full min-h-11 rounded-md border border-[var(--tblr-border)] bg-[var(--tblr-surface)] px-2.5 py-2 text-sm text-[var(--tblr-text)] focus:border-[var(--tblr-primary)] outline-none';

export const nouvelId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

/** Nombre saisi au clavier : la virgule française est admise ; vide ou illisible = absent. */
export const lireNombre = (v: string): number | undefined => {
  const n = parseFloat(v.replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

export function Champ({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <label htmlFor={htmlFor} className="text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--tblr-muted)]">{label}</label>
      {children}
    </div>
  );
}

/** Cadre commun des deux fenêtres : feuille au doigt, fenêtre centrée au bureau, Échap et voile ferment. */
export function DialogShell({ titre, sousTitre, onClose, children }: { titre: string; sousTitre?: string; onClose: () => void; children: React.ReactNode }) {
  useEscapeKey(true, onClose);
  const titleId = useId();
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end md:items-center md:justify-center bg-black/50" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={e => e.stopPropagation()}
        className="w-full md:max-w-lg max-h-[90dvh] overflow-y-auto rounded-t-2xl md:rounded-2xl border shadow-xl"
        style={{ background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)', paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 px-4 pt-4 pb-3 border-b" style={{ background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)' }}>
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-bold text-[var(--tblr-text)]">{titre}</h2>
            {sousTitre && <p className="text-xs text-[var(--tblr-muted)] break-words">{sousTitre}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer" className="shrink-0 inline-flex h-11 w-11 items-center justify-center rounded-lg text-[var(--tblr-muted)] hover:text-[var(--tblr-text)]">
            <IconX size={18} />
          </button>
        </div>
        <div className="p-4 space-y-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export function LotEventsDialog({ lotLabel, tracking, onChange, onClose }: {
  lotLabel: string;
  tracking?: SiteReportLotTracking;
  onChange: (patch: Partial<Omit<SiteReportLotTracking, 'lot_id'>>) => void;
  onClose: () => void;
}) {
  const uid = useId();
  const id = (name: string) => `${uid}-${name}`;

  const [pType, setPType] = useState<PenaliteLot['type']>('retard_execution');
  const [pMotif, setPMotif] = useState('');
  const [pJours, setPJours] = useState('1');
  const [pMontant, setPMontant] = useState('');

  const penalites = tracking?.penalites ?? [];
  const pJoursNb = lireNombre(pJours);
  const pMontantNb = lireNombre(pMontant);
  const pTotal = pJoursNb != null && pMontantNb != null ? montantPenalite({ jours: pJoursNb, montant_jour: pMontantNb }) : null;
  const penaliteValide = pJoursNb != null && pJoursNb > 0 && pMontantNb != null && (pType !== 'autre' || pMotif.trim() !== '');

  const ajouterPenalite = () => {
    if (!penaliteValide || pJoursNb == null || pMontantNb == null) return;
    const nouvelle: PenaliteLot = {
      id: nouvelId(), type: pType, jours: pJoursNb, montant_jour: pMontantNb,
      ...(pType === 'autre' ? { motif: pMotif.trim() } : {}),
    };
    onChange({ penalites: [...penalites, nouvelle] });
    setPMotif(''); setPJours('1');
  };
  const retirerPenalite = (pid: string) => {
    const reste = penalites.filter(p => p.id !== pid);
    onChange({ penalites: reste.length ? reste : undefined });
  };

  return (
    <DialogShell titre="Pénalités" sousTitre={lotLabel} onClose={onClose}>
      {penalites.length > 0 && (
        <ul className="divide-y divide-[var(--tblr-border)] rounded-lg border border-[var(--tblr-border)]">
          {penalites.map(p => (
            <li key={p.id} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-[var(--tblr-text)] break-words">{libellePenalite(p)}</p>
                <p className="text-xs text-[var(--tblr-muted)]">{p.jours} j × {formatEuros(p.montant_jour)} = <strong>{formatEuros(montantPenalite(p))}</strong></p>
              </div>
              <button type="button" onClick={() => retirerPenalite(p.id)} aria-label={`Retirer la pénalité ${libellePenalite(p)}`}
                className="shrink-0 inline-flex h-11 w-11 items-center justify-center rounded-lg text-[var(--tblr-muted)] hover:text-red-600">
                <IconTrash size={18} />
              </button>
            </li>
          ))}
          <li className="flex items-center justify-between px-3 py-2 text-sm font-bold text-[var(--tblr-text)]">
            <span>Total</span><span>{formatEuros(totalPenalites(tracking).montant)}</span>
          </li>
        </ul>
      )}

      <fieldset className="space-y-3">
        <legend className="mb-1 text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--tblr-muted)]">Ajouter une pénalité</legend>
        <Champ label="Type de pénalité" htmlFor={id('ptype')}>
          <select id={id('ptype')} className={DIALOG_FIELD} value={pType} onChange={e => setPType(e.target.value as PenaliteLot['type'])}>
            {PENALITE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </Champ>
        {pType === 'autre' && (
          <Champ label="Motif" htmlFor={id('pmotif')}>
            <input id={id('pmotif')} className={DIALOG_FIELD} value={pMotif} maxLength={120} onChange={e => setPMotif(e.target.value)} />
          </Champ>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Champ label="Nombre de jours" htmlFor={id('pjours')}>
            <input id={id('pjours')} className={DIALOG_FIELD} type="number" inputMode="decimal" min={0} step="any" value={pJours} onChange={e => setPJours(e.target.value)} />
          </Champ>
          <Champ label="Montant par jour (€)" htmlFor={id('pmontant')}>
            <input id={id('pmontant')} className={DIALOG_FIELD} type="number" inputMode="decimal" min={0} step="any" value={pMontant} onChange={e => setPMontant(e.target.value)} />
          </Champ>
        </div>
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-[var(--tblr-muted)]">Montant : <strong className="text-[var(--tblr-text)]">{pTotal != null ? formatEuros(pTotal) : '—'}</strong></p>
          <button type="button" onClick={ajouterPenalite} disabled={!penaliteValide}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-[var(--tblr-primary)] px-4 text-sm font-bold text-white transition hover:brightness-90 disabled:opacity-40">
            <IconPlus size={16} /> Ajouter
          </button>
        </div>
      </fieldset>
    </DialogShell>
  );
}
