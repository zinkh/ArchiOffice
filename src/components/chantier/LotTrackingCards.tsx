import React from 'react';
import { cn } from '../../lib/utils';
import type { PresenceStatus, ProjectLot, SiteReportLotTracking } from '../../types';
import { DraftInput, parseDays, TOUCH_TARGET } from './fields';
import { CONCERNED_OPTIONS } from '../../lib/siteReportPresence';

/**
 * « Présence & suivi des lots » au téléphone : une carte par lot, à la place du
 * tableau de dix colonnes. Mêmes champs, mêmes enregistrements ; chaque champ
 * porte son libellé visible (un en-tête de colonne n'existe plus ici).
 */
export const DEFAULT_LIEU = 'Sur site';

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 min-w-0">
      <span className="text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--tblr-muted)]">{label}</span>
      {children}
    </label>
  );
}

// Champ de carte : toujours encadré (la carte n'existe que sous 768 px), 44 px de haut.
const CARD_FIELD =
  'w-full min-h-11 rounded-md border border-[var(--tblr-border)] bg-[var(--tblr-surface)] px-2.5 py-2 text-sm text-[var(--tblr-text)] focus:border-[var(--tblr-primary)] outline-none';

export function LotTrackingCards({ lots, statusLabels, getStatus, onStatus, getTracking, onTrack }: {
  lots: ProjectLot[];
  statusLabels: Record<PresenceStatus, string>;
  getStatus: (lot: ProjectLot) => PresenceStatus;
  onStatus: (lot: ProjectLot, status: PresenceStatus) => void;
  getTracking: (lotId: string) => SiteReportLotTracking | undefined;
  onTrack: (lotId: string, patch: Partial<Omit<SiteReportLotTracking, 'lot_id'>>) => void;
}) {
  const days = (lotId: string, field: 'retard_semaine' | 'retard_cumule' | 'retard_docs_jours' | 'intemperies_jours', label: string, ariaLabel: string, lotTitle: string) => {
    const v = getTracking(lotId)?.[field];
    return (
      <Labeled label={label}>
        <DraftInput
          type="number" inputMode="numeric" min={0}
          aria-label={`${ariaLabel}, ${lotTitle}`}
          className={CARD_FIELD}
          value={v != null ? String(v) : ''}
          onCommit={val => onTrack(lotId, { [field]: parseDays(val) })}
        />
      </Labeled>
    );
  };

  return (
    <ul className="space-y-3">
      {lots.map(lot => {
        const t = getTracking(lot.id);
        const company = lot.contact_name?.split(' - ')[0];
        return (
          <li key={lot.id} className="rounded-xl border border-[var(--tblr-border)] p-3 space-y-2.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold text-[var(--tblr-text)] leading-snug break-words">{company || lot.lot_title}</p>
                <p className="text-xs text-[var(--tblr-muted)]">{lot.lot_number} · {lot.lot_title}</p>
              </div>
              <select
                aria-label={`Statut de présence, ${lot.lot_title}`}
                className={cn('shrink-0 rounded-lg border border-[var(--tblr-border)] bg-transparent px-2 py-1.5 text-sm', TOUCH_TARGET)}
                value={getStatus(lot)}
                onChange={e => onStatus(lot, e.target.value as PresenceStatus)}
              >
                {(Object.keys(statusLabels) as PresenceStatus[]).map(v => <option key={v} value={v}>{statusLabels[v]}</option>)}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-x-3">
              <Labeled label="Effectif">
                <DraftInput
                  type="number" inputMode="numeric" min={0}
                  aria-label={`Effectif, ${lot.lot_title}`}
                  className={CARD_FIELD}
                  value={t?.effectif != null ? String(t.effectif) : ''}
                  onCommit={v => onTrack(lot.id, { effectif: parseDays(v) })}
                />
              </Labeled>
              {days(lot.id, 'intemperies_jours', 'Intempéries (j)', 'Jours d\'intempéries', lot.lot_title)}
            </div>

            <fieldset className="min-w-0">
              <legend className="mb-1 text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--tblr-muted)]">Retard (j)</legend>
              <div className="grid grid-cols-3 gap-x-2">
                {days(lot.id, 'retard_semaine', 'Semaine', 'Retard de la semaine en jours', lot.lot_title)}
                {days(lot.id, 'retard_cumule', 'Cumulé', 'Retard cumulé en jours', lot.lot_title)}
                {days(lot.id, 'retard_docs_jours', 'Docs', 'Retard de remise des documents en jours', lot.lot_title)}
              </div>
            </fieldset>

            <Labeled label="Travaux / documents">
              <select
                aria-label={`Travaux ou documents, ${lot.lot_title}`}
                className={CARD_FIELD}
                value={t?.concerned || ''}
                onChange={e => onTrack(lot.id, { concerned: (e.target.value || undefined) as SiteReportLotTracking['concerned'] })}
              >
                {CONCERNED_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.long}</option>)}
              </select>
            </Labeled>

            <div className="grid grid-cols-[1fr_8.5rem] gap-x-3">
              <Labeled label="Lieu">
                <DraftInput
                  aria-label={`Lieu de la réunion, ${lot.lot_title}`}
                  className={CARD_FIELD}
                  value={t?.lieu ?? DEFAULT_LIEU}
                  onCommit={v => onTrack(lot.id, { lieu: v.trim() || DEFAULT_LIEU })}
                />
              </Labeled>
              <Labeled label="Heure">
                <DraftInput
                  type="time"
                  aria-label={`Heure de convocation, ${lot.lot_title}`}
                  className={CARD_FIELD}
                  value={t?.heure || ''}
                  onCommit={v => onTrack(lot.id, { heure: v || undefined })}
                />
              </Labeled>
            </div>

            <label className="flex items-center gap-3 min-h-11 text-sm text-[var(--tblr-text)]">
              <input
                type="checkbox"
                className="size-5"
                checked={!!t?.convoque_reunion_suivante}
                onChange={e => onTrack(lot.id, { convoque_reunion_suivante: e.target.checked })}
              />
              Convoqué à la prochaine réunion
            </label>
          </li>
        );
      })}
    </ul>
  );
}
