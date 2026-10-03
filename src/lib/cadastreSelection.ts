// Sélection de plusieurs parcelles sur la carte cadastrale : un terrain
// d'opération couvre souvent deux ou trois parcelles, et la fiche doit alors
// porter toutes leurs références et leur contenance cumulée, pas seulement
// celle de la dernière parcelle cliquée.

export interface SelectableParcel {
  id: string;
  section: string;
  numero: string;
  prefixe: string;
  contenance?: number;
  geometry?: GeoJSON.Geometry;
}

/** Ajoute la parcelle si elle n'est pas sélectionnée, la retire sinon. */
export function toggleParcel<T extends SelectableParcel>(selection: T[], parcel: T): T[] {
  return selection.some((p) => p.id === parcel.id)
    ? selection.filter((p) => p.id !== parcel.id)
    : [...selection, parcel];
}

/** « AB 123 », préfixe compris seulement s'il est significatif (≠ 000). */
export function parcelReference(parcel: SelectableParcel): string {
  return [
    parcel.prefixe && parcel.prefixe !== '000' ? parcel.prefixe : '',
    parcel.section,
    parcel.numero,
  ].filter(Boolean).join(' ');
}

/**
 * Références jointes par une virgule et contenance totale en m². La surface
 * vaut `null` dès qu'une parcelle n'a pas de contenance connue : afficher un
 * total partiel ferait passer une somme incomplète pour la surface du terrain.
 */
export function summarizeParcels(selection: SelectableParcel[]): { reference: string; surface: number | null } {
  const reference = selection.map(parcelReference).filter(Boolean).join(', ');
  const surface = selection.length > 0 && selection.every((p) => typeof p.contenance === 'number')
    ? selection.reduce((sum, p) => sum + (p.contenance as number), 0)
    : null;
  return { reference, surface };
}

/** Géométrie unique (MultiPolygon) couvrant toute la sélection, pour les requêtes d'urbanisme. */
export function selectionGeometry(selection: SelectableParcel[]): GeoJSON.Geometry | null {
  const polygons: GeoJSON.Position[][][] = [];
  for (const p of selection) {
    if (p.geometry?.type === 'Polygon') polygons.push(p.geometry.coordinates);
    else if (p.geometry?.type === 'MultiPolygon') polygons.push(...p.geometry.coordinates);
  }
  if (polygons.length === 0) return null;
  if (polygons.length === 1) return { type: 'Polygon', coordinates: polygons[0] };
  return { type: 'MultiPolygon', coordinates: polygons };
}

/** Format français des surfaces (espace normale comme séparateur de milliers). */
export function formatSurface(m2: number): string {
  return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(m2).replace(/[  ]/g, ' ')} m²`;
}
