import type { DPGF, Ligne } from '../types/dpgf';

export function buildingQuantities(ligne: Ligne, inherited?: string): Record<string, number> {
  if (ligne.quantitesBatiments !== undefined) return ligne.quantitesBatiments;
  const id = ligne.batimentId ?? inherited;
  return id ? { [id]: ligne.quantite } : {};
}

export function recomputeBuildings(doc: DPGF): DPGF {
  const walk = (l: Ligne): Ligne => {
    const children = l.children?.map(walk);
    const quantite = l.quantitesBatiments === undefined ? l.quantite : Object.values(l.quantitesBatiments).reduce((s, q) => s + q, 0);
    const prixTotal = children?.length ? children.reduce((s, c) => s + (c.cctpOnly ? 0 : c.prixTotal), 0)
      : l.quantitesBatiments !== undefined ? quantite * l.prixUnitaire : l.prixTotal;
    return { ...l, children, quantite, prixTotal };
  };
  const lots = doc.lots.map(lot => {
    const chapitres = lot.chapitres.map(c => ({ ...c, lignes: c.lignes.map(walk) }));
    const sousTotal = chapitres.reduce((s, c) => s + (c.cctpOnly ? 0 : c.lignes.reduce((n, l) => n + (l.cctpOnly ? 0 : l.prixTotal), 0)), 0);
    return { ...lot, chapitres, sousTotal };
  });
  const totalHT = lots.reduce((s, l) => s + l.sousTotal, 0);
  return { ...doc, lots, totalHT, totalTTC: totalHT * (1 + doc.TVA / 100) };
}

/** Produces an independent export document without changing the saved tree. */
export function forBuilding(doc: DPGF, id: string, cctp = false): DPGF {
  const walk = (l: Ligne, inherited?: string): Ligne | null => {
    if (!cctp && l.cctpOnly) return null;
    const quantities = buildingQuantities(l, inherited);
    const children = l.children?.map(c => walk(c, l.batimentId ?? inherited)).filter((c): c is Ligne => c !== null);
    if (l.children?.length && !children?.length) return null;
    if (!l.children?.length && !Object.prototype.hasOwnProperty.call(quantities, id)) return null;
    const quantite = quantities[id] ?? 0;
    return { ...l, children, quantitesBatiments: undefined, batimentId: id, quantite,
      prixTotal: children?.length ? children.reduce((s, c) => s + c.prixTotal, 0) : quantite * l.prixUnitaire };
  };
  const lots = doc.lots.map(lot => ({ ...lot, chapitres: lot.chapitres
    .filter(c => cctp || !c.cctpOnly)
    .map(c => ({ ...c, lignes: c.lignes.map(l => walk(l, c.batimentId ?? lot.batimentId)).filter((l): l is Ligne => l !== null) }))
    .filter(c => c.lignes.length > 0) })).filter(l => l.chapitres.length > 0);
  return recomputeBuildings({ ...doc, lots });
}
