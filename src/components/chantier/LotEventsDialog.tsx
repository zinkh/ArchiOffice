import React, { useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconPlus, IconTrash, IconX } from '@tabler/icons-react';
import { useEscapeKey } from '../../hooks/useEscapeKey';
import type { IntemperieLot, PenaliteLot, SiteReportLotTracking } from '../../types';
import {
  INTEMPERIE_TYPES, PENALITE_TYPES, formatEuros, joursIntemperies, libelleIntemperie, libellePenalite,
  montantPenalite, totalPenalites,
} from '../../lib/siteReportLotSuivi';

/**
 * Pénalités et intempéries d'un lot, saisies par un bouton « Ajouter » plutôt que par une
 * colonne de chiffres : une feuille au bas de l'écran sur téléphone et tablette, une fenêtre
 * centrée au bureau. Chaque ajout ou retrait est enregistré tout de suite (`onChange`).
 */
export type LotEventsKind = 'penalite' | 'intemperie';

const FIELD =
  'w-full min-h-11 rounded-md border border-[var(--tblr-border)] bg-[var(--tblr-surface)] px-2.5 py-2 text-sm text-[var(--tblr-text)] focus:border-[var(--tblr-primary)] outline-none';

const nouvelId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

/** Nombre saisi au clavier : la virgule française est admise ; vide ou illisible = absent. */
const lireNombre = (v: string): number | undefined => {
  const n = parseFloat(v.replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

function Champ({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <label htmlFor={htmlFor} className="text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--tblr-muted)]">{label}</label>
      {children}
    </div>
  );
}

export function LotEventsDialog({ kind, lotLabel, tracking, reportDate, onChange, onClose }: {
  kind: LotEventsKind;
  lotLabel: string;
  tracking?: SiteReportLotTracking;
  /** Date du compte-rendu : jour proposé pour une intempérie. */
  reportDate?: string;
  onChange: (patch: Partial<Omit<SiteReportLotTracking, 'lot_id'>>) => void;
  onClose: () => void;
}) {
  useEscapeKey(true, onClose);
  const uid = useId();
  const id = (name: string) => `${uid}-${name}`;

  // Formulaire de pénalité
  const [pType, setPType] = useState<PenaliteLot['type']>('retard_execution');
  const [pMotif, setPMotif] = useState('');
  const [pJours, setPJours] = useState('1');
  const [pMontant, setPMontant] = useState('');
  // Formulaire d'intempérie
  const [iType, setIType] = useState<IntemperieLot['type']>('pluie');
  const [iDate, setIDate] = useState(reportDate || '');
  const [iJours, setIJours] = useState('1');

  const penalites = tracking?.penalites ?? [];
  const intemperies = tracking?.intemperies_list ?? [];
  const ancienJours = Number(tracking?.intemperies_jours) || 0;

  const pJoursNb = lireNombre(pJours);
  const pMontantNb = lireNombre(pMontant);
  const pTotal = pJoursNb != null && pMontantNb != null ? montantPenalite({ jours: pJoursNb, montant_jour: pMontantNb }) : null;
  const penaliteValide = pJoursNb != null && pJoursNb > 0 && pMontantNb != null && (pType !== 'autre' || pMotif.trim() !== '');
  const iJoursNb = lireNombre(iJours);
  const intemperieValide = iJoursNb != null && iJoursNb > 0;

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
  const ajouterIntemperie = () => {
    if (!intemperieValide || iJoursNb == null) return;
    const nouvelle: IntemperieLot = { id: nouvelId(), type: iType, jours: iJoursNb, ...(iDate ? { date: iDate } : {}) };
    onChange({ intemperies_list: [...intemperies, nouvelle] });
    setIJours('1');
  };
  const retirerIntemperie = (iid: string) => {
    const reste = intemperies.filter(i => i.id !== iid);
    onChange({ intemperies_list: reste.length ? reste : undefined });
  };

  const total = totalPenalites(tracking);
  const titre = kind === 'penalite' ? 'Pénalités' : 'Intempéries';

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end md:items-center md:justify-center bg-black/50" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={id('titre')}
        onClick={e => e.stopPropagation()}
        className="w-full md:max-w-lg max-h-[90dvh] overflow-y-auto rounded-t-2xl md:rounded-2xl border shadow-xl"
        style={{ background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)', paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 px-4 pt-4 pb-3 border-b" style={{ background: 'var(--tblr-surface)', borderColor: 'var(--tblr-border)' }}>
          <div className="min-w-0">
            <h2 id={id('titre')} className="text-base font-bold text-[var(--tblr-text)]">{titre}</h2>
            <p className="text-xs text-[var(--tblr-muted)] break-words">{lotLabel}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer" className="shrink-0 inline-flex h-11 w-11 items-center justify-center rounded-lg text-[var(--tblr-muted)] hover:text-[var(--tblr-text)]">
            <IconX size={18} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {kind === 'penalite' ? (
            <>
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
                    <span>Total</span><span>{formatEuros(total.montant)}</span>
                  </li>
                </ul>
              )}

              <fieldset className="space-y-3">
                <legend className="mb-1 text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--tblr-muted)]">Ajouter une pénalité</legend>
                <Champ label="Type de pénalité" htmlFor={id('ptype')}>
                  <select id={id('ptype')} className={FIELD} value={pType} onChange={e => setPType(e.target.value as PenaliteLot['type'])}>
                    {PENALITE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </Champ>
                {pType === 'autre' && (
                  <Champ label="Motif" htmlFor={id('pmotif')}>
                    <input id={id('pmotif')} className={FIELD} value={pMotif} maxLength={120} onChange={e => setPMotif(e.target.value)} />
                  </Champ>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <Champ label="Nombre de jours" htmlFor={id('pjours')}>
                    <input id={id('pjours')} className={FIELD} type="number" inputMode="decimal" min={0} step="any" value={pJours} onChange={e => setPJours(e.target.value)} />
                  </Champ>
                  <Champ label="Montant par jour (€)" htmlFor={id('pmontant')}>
                    <input id={id('pmontant')} className={FIELD} type="number" inputMode="decimal" min={0} step="any" value={pMontant} onChange={e => setPMontant(e.target.value)} />
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
            </>
          ) : (
            <>
              {(intemperies.length > 0 || ancienJours > 0) && (
                <ul className="divide-y divide-[var(--tblr-border)] rounded-lg border border-[var(--tblr-border)]">
                  {intemperies.map(i => (
                    <li key={i.id} className="flex items-center gap-3 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-[var(--tblr-text)]">{libelleIntemperie(i.type)}</p>
                        <p className="text-xs text-[var(--tblr-muted)]">{i.date ? `${new Date(i.date).toLocaleDateString('fr-FR')} · ` : ''}{i.jours} j</p>
                      </div>
                      <button type="button" onClick={() => retirerIntemperie(i.id)} aria-label={`Retirer l'intempérie ${libelleIntemperie(i.type)}`}
                        className="shrink-0 inline-flex h-11 w-11 items-center justify-center rounded-lg text-[var(--tblr-muted)] hover:text-red-600">
                        <IconTrash size={18} />
                      </button>
                    </li>
                  ))}
                  {ancienJours > 0 && (
                    <li className="flex items-center gap-3 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-[var(--tblr-text)]">Saisie antérieure</p>
                        <p className="text-xs text-[var(--tblr-muted)]">{ancienJours} j, enregistrés avant les épisodes détaillés</p>
                      </div>
                      <button type="button" onClick={() => onChange({ intemperies_jours: undefined, intemperies: undefined })} aria-label="Retirer la saisie antérieure d'intempéries"
                        className="shrink-0 inline-flex h-11 w-11 items-center justify-center rounded-lg text-[var(--tblr-muted)] hover:text-red-600">
                        <IconTrash size={18} />
                      </button>
                    </li>
                  )}
                  <li className="flex items-center justify-between px-3 py-2 text-sm font-bold text-[var(--tblr-text)]">
                    <span>Total</span><span>{joursIntemperies(tracking)} j</span>
                  </li>
                </ul>
              )}

              <fieldset className="space-y-3">
                <legend className="mb-1 text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--tblr-muted)]">Ajouter une intempérie</legend>
                <Champ label="Type" htmlFor={id('itype')}>
                  <select id={id('itype')} className={FIELD} value={iType} onChange={e => setIType(e.target.value as IntemperieLot['type'])}>
                    {INTEMPERIE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </Champ>
                <div className="grid grid-cols-2 gap-3">
                  <Champ label="Jour" htmlFor={id('idate')}>
                    <input id={id('idate')} className={FIELD} type="date" value={iDate} onChange={e => setIDate(e.target.value)} />
                  </Champ>
                  <Champ label="Jours perdus" htmlFor={id('ijours')}>
                    <input id={id('ijours')} className={FIELD} type="number" inputMode="decimal" min={0} step={0.5} value={iJours} onChange={e => setIJours(e.target.value)} />
                  </Champ>
                </div>
                <div className="flex justify-end">
                  <button type="button" onClick={ajouterIntemperie} disabled={!intemperieValide}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-[var(--tblr-primary)] px-4 text-sm font-bold text-white transition hover:brightness-90 disabled:opacity-40">
                    <IconPlus size={16} /> Ajouter
                  </button>
                </div>
              </fieldset>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
