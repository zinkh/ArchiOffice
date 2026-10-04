import type { LotProjet } from './lotsOrder';

/** Only stable project lot IDs identify a shared title. Never match by row index. */
export function appliquerTitresLots<D extends { lots: Array<{ projectLotId?: string; titre: string }> }>(doc: D, lots: LotProjet[]): D {
  const titles = new Map(lots.map(l => [l.id, l.lot_title]));
  return { ...doc, lots: doc.lots.map(l => l.projectLotId && titles.has(l.projectLotId)
    ? { ...l, titre: titles.get(l.projectLotId)! } : l) };
}

export function titresModifies(before: { lots: Array<{ id: string; titre: string; projectLotId?: string }> }, after: typeof before) {
  const previous = new Map(before.lots.map(l => [l.id, l]));
  return after.lots.flatMap(l => {
    const old = previous.get(l.id);
    return old?.projectLotId && old.titre !== l.titre ? [{ id: old.projectLotId, titre: l.titre.trim() }] : [];
  });
}
