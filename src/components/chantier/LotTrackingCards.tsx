import React from 'react';
import { IconPlus } from '@tabler/icons-react';
import { cn } from '../../lib/utils';
import type { PresenceStatus, ProjectLot, SiteReportLotTracking } from '../../types';
import type { Batiment } from '../../types/dpgf';
import { DraftInput, parseDays } from './fields';
import {
  basculerBatiment, batimentsDuLot, joursIntemperies, reperBatiment, resumePenalites,
} from '../../lib/siteReportLotSuivi';

/**
 * « Présence & suivi des lots » au téléphone : une carte par lot, à la place du
 * tableau. Mêmes champs, mêmes enregistrements ; chaque champ porte son libellé
 * visible (un en-tête de colonne n'existe plus ici).
 */
export const DEFAULT_LIEU = 'Sur site';

// `justify-between` : un libellé qui passe sur deux lignes (texte agrandi sur le
// téléphone) ne décale plus son champ, les trois champs d'une rangée restent alignés.
function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col justify-between gap-1 min-w-0">
      <span className="text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--tblr-muted)]">{label}</span>
      {children}
    </label>
  );
}

// Champ de carte : toujours encadré (la carte n'existe que sous 768 px), 44 px de haut.
const CARD_FIELD =
  'w-full min-h-11 rounded-md border border-[var(--tblr-border)] bg-[var(--tblr-surface)] px-2.5 py-2 text-sm text-[var(--tblr-text)] focus:border-[var(--tblr-primary)] outline-none';

// Le statut est une donnée : sa pastille porte la couleur d'état, le reste de la carte reste neutre.
const STATUS_DOT: Record<PresenceStatus, string> = {
  P: 'bg-[var(--tblr-success)]',
  R: 'bg-[var(--tblr-warning)]',
  AE: 'bg-[var(--tblr-muted)]',
  ANE: 'bg-[var(--tblr-danger)]',
  NC: 'border-2 border-[var(--tblr-muted)] bg-transparent',
};

const ACTION_BTN =
  'inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--tblr-border)] px-3 text-sm font-semibold text-[var(--tblr-text)] hover:bg-[var(--tblr-surface-2)]';

export function LotTrackingCards({
  lots, statusLabels, getStatus, onStatus, getTracking, onTrack,
  batiments, retardCumule, defaultHeure, onOpenPenalites,
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
  onOpenPenalites: (lotId: string) => void;
}) {
  return (
    <ul className="space-y-3">
      {lots.map(lot => {
        const t = getTracking(lot.id);
        const company = lot.contact_name?.split(' - ')[0];
        const penalites = resumePenalites(t);
        const intemperies = joursIntemperies(t);
        const coches = new Set(batimentsDuLot(t, batiments));
        const status = getStatus(lot);
        return (
          <li key={lot.id} className="rounded-xl border border-[var(--tblr-border)] p-3 space-y-2.5">
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 shrink-0 rounded border border-[var(--tblr-border)] bg-[var(--tblr-surface-2)] px-1.5 py-0.5 font-mono text-xs font-semibold tabular-nums text-[var(--tblr-muted)]">
                {lot.lot_number}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold leading-snug text-[var(--tblr-text)] [overflow-wrap:anywhere] hyphens-auto">{company || lot.lot_title}</p>
                {company && <p className="text-xs text-[var(--tblr-muted)] hyphens-auto">{lot.lot_title}</p>}
              </div>
            </div>

            <div className="relative">
              <span
                aria-hidden
                className={cn('pointer-events-none absolute left-3 top-1/2 size-2.5 -translate-y-1/2 rounded-full', STATUS_DOT[status])}
              />
              <select
                aria-label={`Statut de présence, ${lot.lot_title}`}
                className={cn(CARD_FIELD, 'pl-8 font-semibold')}
                value={status}
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
              <Labeled label="Retard (j)">
                <DraftInput
                  type="number" inputMode="numeric" min={0}
                  aria-label={`Retard de la semaine en jours, ${lot.lot_title}`}
                  className={CARD_FIELD}
                  value={t?.retard_semaine != null ? String(t.retard_semaine) : ''}
                  onCommit={v => onTrack(lot.id, { retard_semaine: parseDays(v) })}
                />
              </Labeled>
              <div className="flex flex-col justify-between gap-1 min-w-0">
                <span className="text-[0.6875rem] font-bold uppercase tracking-wider text-[var(--tblr-muted)]">Cumul (j)</span>
                <output
                  aria-label={`Retard cumulé en jours, ${lot.lot_title}, calculé`}
                  title="Somme des retards de la semaine de tous les comptes-rendus"
                  className="flex min-h-11 items-center rounded-md bg-[var(--tblr-surface-2)] px-2.5 text-sm font-semibold text-[var(--tblr-text)]"
                >
                  {retardCumule(lot.id)}
                </output>
              </div>
            </div>

            <div className="min-w-0">
              <button type="button" className={ACTION_BTN} onClick={() => onOpenPenalites(lot.id)}>
                <IconPlus size={16} /> Pénalité
              </button>
              {(penalites || intemperies > 0) && (
                <p className="mt-1 text-xs text-[var(--tblr-muted)] break-words">
                  {[penalites, intemperies > 0 ? `${intemperies} j d'intempéries` : ''].filter(Boolean).join(' · ')}
                </p>
              )}
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

            <div className="grid grid-cols-2 gap-x-3">
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
