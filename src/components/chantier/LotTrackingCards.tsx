import React from 'react';
import { IconPlus } from '@tabler/icons-react';
import { cn } from '../../lib/utils';
import type { PresenceStatus, ProjectLot, SiteReportLotTracking } from '../../types';
import type { Batiment } from '../../types/dpgf';
import { DraftInput, parseDays, TOUCH_TARGET } from './fields';
import {
  basculerBatiment, batimentsDuLot, joursIntemperies, reperBatiment, resumePenalites,
} from '../../lib/siteReportLotSuivi';
import type { LotEventsKind } from './LotEventsDialog';

/**
 * « Présence & suivi des lots » au téléphone : une carte par lot, à la place du
 * tableau. Mêmes champs, mêmes enregistrements ; chaque champ porte son libellé
 * visible (un en-tête de colonne n'existe plus ici).
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

const ACTION_BTN =
  'inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--tblr-border)] px-3 text-sm font-semibold text-[var(--tblr-text)] hover:bg-[var(--tblr-surface-2)]';

export function LotTrackingCards({
  lots, statusLabels, getStatus, onStatus, getTracking, onTrack,
  batiments, retardCumule, defaultHeure, onOpenEvents,
}: {
  lots: ProjectLot[];
  statusLabels: Record<PresenceStatus, string>;
  getStatus: (lot: ProjectLot) => PresenceStatus;
  onStatus: (lot: ProjectLot, status: PresenceStatus) => void;
  getTracking: (lotId: string) => SiteReportLotTracking | undefined;
  onTrack: (lotId: string, patch: Partial<Omit<SiteReportLotTracking, 'lot_id'>>) => void;
  /** Bâtiments du chantier : les cases « W/D » n'existent que s'il y en a plusieurs. */
  batiments: Batiment[];
  /** Somme des retards de la semaine de tous les comptes-rendus jusqu'à celui-ci. */
  retardCumule: (lotId: string) => number;
  /** Heure de convocation commune à tous les lots, que chacun peut remplacer. */
  defaultHeure: string;
  onOpenEvents: (lotId: string, kind: LotEventsKind) => void;
}) {
  return (
    <ul className="space-y-3">
      {lots.map(lot => {
        const t = getTracking(lot.id);
        const company = lot.contact_name?.split(' - ')[0];
        const penalites = resumePenalites(t);
        const intemperies = joursIntemperies(t);
        const coches = new Set(batimentsDuLot(t, batiments));
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

            <div className="grid grid-cols-3 gap-x-2">
              <Labeled label="Effectif">
                <DraftInput
                  type="number" inputMode="numeric" min={0}
                  aria-label={`Effectif, ${lot.lot_title}`}
                  className={CARD_FIELD}
                  value={t?.effectif != null ? String(t.effectif) : ''}
                  onCommit={v => onTrack(lot.id, { effectif: parseDays(v) })}
                />
              </Labeled>
              <Labeled label="Retard sem. (j)">
                <DraftInput
                  type="number" inputMode="numeric" min={0}
                  aria-label={`Retard de la semaine en jours, ${lot.lot_title}`}
                  className={CARD_FIELD}
                  value={t?.retard_semaine != null ? String(t.retard_semaine) : ''}
                  onCommit={v => onTrack(lot.id, { retard_semaine: parseDays(v) })}
                />
              </Labeled>
              <div className="flex flex-col gap-1 min-w-0">
                <span className="text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--tblr-muted)]">Cumulé (j)</span>
                <output
                  aria-label={`Retard cumulé en jours, ${lot.lot_title}, calculé`}
                  title="Somme des retards de la semaine de tous les comptes-rendus"
                  className="flex min-h-11 items-center rounded-md bg-[var(--tblr-surface-2)] px-2.5 text-sm font-semibold text-[var(--tblr-text)]"
                >
                  {retardCumule(lot.id)}
                </output>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="min-w-0">
                <button type="button" className={ACTION_BTN} onClick={() => onOpenEvents(lot.id, 'penalite')}>
                  <IconPlus size={16} /> Pénalité
                </button>
                {penalites && <p className="mt-1 text-xs text-[var(--tblr-muted)] break-words">{penalites}</p>}
              </div>
              <div className="min-w-0">
                <button type="button" className={ACTION_BTN} onClick={() => onOpenEvents(lot.id, 'intemperie')}>
                  <IconPlus size={16} /> Intempérie
                </button>
                {intemperies > 0 && <p className="mt-1 text-xs text-[var(--tblr-muted)]">{intemperies} j d'intempéries</p>}
              </div>
            </div>

            {batiments.length > 1 && (
              <fieldset className="min-w-0">
                <legend className="mb-1 text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--tblr-muted)]">Bâtiments concernés</legend>
                <div className="flex flex-wrap gap-2">
                  {batiments.map(b => (
                    <label key={b.id} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-[var(--tblr-border)] px-3 text-sm text-[var(--tblr-text)]">
                      <input
                        type="checkbox"
                        className="size-5"
                        checked={coches.has(b.id)}
                        onChange={e => onTrack(lot.id, { batiment_ids: basculerBatiment(t, b.id, e.target.checked, batiments), concerned: undefined })}
                      />
                      <span className="font-semibold">{reperBatiment(b)}</span>
                      {b.libelle && <span className="text-[var(--tblr-muted)]">{b.libelle}</span>}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}

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
                  title={defaultHeure ? `Heure par défaut : ${defaultHeure}` : undefined}
                  className={CARD_FIELD}
                  value={t?.heure || defaultHeure || ''}
                  onCommit={v => onTrack(lot.id, { heure: v && v !== defaultHeure ? v : undefined })}
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
