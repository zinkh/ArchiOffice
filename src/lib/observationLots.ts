// ── Lots visés par une observation : un lot, plusieurs lots, ou tous (TCE) ────
// Logique pure, partagée par l'écran (sélecteur, regroupement du compte-rendu),
// l'export PDF, la diffusion par e-mail et le serveur.
//
// Une observation vise :
//   - un seul lot : `lot_id` (cas historique, `lot_ids` vide) ;
//   - plusieurs lots : `lot_id` = le premier, `lot_ids` = tous ;
//   - tous les lots (TCE, « Tout corps d'état ») : `tce = true`, `lot_id` nul.
import type { Observation, ProjectLot } from '../types';

export const TCE_LABEL = 'TCE';
export const TCE_FULL_LABEL = "Tout corps d'état";

/** Plafond de lots d'une même observation (un chantier n'en compte pas des centaines). */
export const MAX_OBSERVATION_LOTS = 60;

type LotRef = Pick<ProjectLot, 'id' | 'lot_number' | 'lot_title'> & { contact_name?: string | null; contact_id?: string | null };

export interface LotSelectionFields {
  lot_id: string | null;
  lot_ids: string[];
  tce: boolean;
}

export interface ObservationGroup {
  key: string;
  title: string;
  entreprise: string;
  items: Observation[];
}

/**
 * Champs à enregistrer pour une sélection de lots. Cocher tous les lots revient à TCE :
 * deux écritures de la même intention ne doivent pas donner deux états différents.
 */
export function selectionToFields(selectedIds: readonly string[], lots: readonly Pick<ProjectLot, 'id'>[], tce: boolean): LotSelectionFields {
  const known = new Set(lots.map(l => l.id));
  const valid = [...new Set(selectedIds)].filter(id => known.has(id)).slice(0, MAX_OBSERVATION_LOTS);
  if (tce || (valid.length > 1 && valid.length === known.size)) return { lot_id: null, lot_ids: [], tce: true };
  if (valid.length > 1) return { lot_id: valid[0], lot_ids: valid, tce: false };
  return { lot_id: valid[0] ?? null, lot_ids: [], tce: false };
}

/** Lots cochés d'une observation (pour préremplir le sélecteur) ; vide pour TCE (la case TCE la porte). */
export function observationSelectedLotIds(o: Pick<Observation, 'lot_id' | 'lot_ids' | 'tce'>): string[] {
  if (o.tce) return [];
  if (o.lot_ids && o.lot_ids.length > 0) return o.lot_ids;
  return o.lot_id ? [o.lot_id] : [];
}

/** Vrai si l'observation vise ce lot (directement, parmi plusieurs, ou parce qu'elle est TCE). */
export function observationTargetsLot(o: Pick<Observation, 'lot_id' | 'lot_ids' | 'tce'>, lotId: string): boolean {
  return !!o.tce || o.lot_id === lotId || (o.lot_ids?.includes(lotId) ?? false);
}

const lotNumber = (l: Pick<ProjectLot, 'lot_number'>) => String(l.lot_number ?? '').trim();
const entrepriseName = (l: LotRef) => (l.contact_name || '').split(' - ')[0].trim();

/** « TCE », « Lots 02, 03 », « 03 · Menuiserie » ou « Sans lot » : ce que montre le bouton d'attribution. */
export function observationScopeLabel(o: Observation, lots: readonly LotRef[]): string {
  if (o.tce) return TCE_LABEL;
  const ids = observationSelectedLotIds(o);
  if (ids.length > 1) return `Lots ${ids.map(id => lots.find(l => l.id === id)).filter((l): l is LotRef => !!l).map(lotNumber).join(', ')}`;
  const lot = lots.find(l => l.id === ids[0]) ?? (o.lot ? { ...o.lot } : undefined);
  return lot ? `${lotNumber(lot)} · ${lot.lot_title}`.trim() : 'Sans lot';
}

/**
 * Regroupe les observations pour le compte-rendu : TCE d'abord, puis chaque lot (ou
 * ensemble de lots) dans l'ordre des lots, puis « Sans lot identifié ».
 */
export function groupObservationsByLot(observations: readonly Observation[], lots: readonly LotRef[]): ObservationGroup[] {
  const order = new Map(lots.map((l, i) => [l.id, i]));
  const groups = new Map<string, ObservationGroup & { rank: number }>();
  const add = (key: string, rank: number, title: string, entreprise: string, o: Observation) => {
    const group = groups.get(key) ?? { key, title, entreprise, items: [], rank };
    group.items.push(o);
    groups.set(key, group);
  };
  for (const o of observations) {
    if (o.tce) { add('tce', -1, `${TCE_LABEL} — ${TCE_FULL_LABEL}`, 'Toutes les entreprises', o); continue; }
    const ids = observationSelectedLotIds(o);
    if (ids.length > 1) {
      const found = ids.map(id => lots.find(l => l.id === id)).filter((l): l is LotRef => !!l);
      add(`multi:${ids.join(',')}`, Math.min(...ids.map(id => order.get(id) ?? Number.MAX_SAFE_INTEGER - 1)),
        `Lots ${found.map(lotNumber).join(', ')} — ${found.map(l => l.lot_title).join(', ')}`,
        found.map(entrepriseName).filter(Boolean).join(', '), o);
      continue;
    }
    const known = lots.find(l => l.id === ids[0]);
    const lot: LotRef | undefined = known ?? (o.lot ? { ...o.lot } : undefined);
    if (!lot) { add('sans-lot', Number.MAX_SAFE_INTEGER, 'Sans lot identifié', '', o); continue; }
    add(lot.id, order.get(lot.id) ?? Number.MAX_SAFE_INTEGER - 1, `${lotNumber(lot)} — ${lot.lot_title}`, entrepriseName(lot), o);
  }
  return [...groups.values()].sort((a, b) => a.rank - b.rank).map(({ rank: _rank, ...g }) => g);
}
