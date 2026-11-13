/**
 * Logique pure de la matrice du DCE (pièces x lots) de l'onglet Consultation ACT.
 * Même donnée qu'avant (`tous_lots`, `lots_ids`) : aucune migration.
 */

export interface PieceMatrice {
  tous_lots: boolean;
  lots_ids: string[];
}

/** Une pièce atteint un lot si elle vaut pour tous les lots ou le nomme. */
export function pieceAtteintLot(p: PieceMatrice, lotId: string): boolean {
  return p.tous_lots || p.lots_ids.includes(lotId);
}

/** Nombre de lots (parmi `lotIds`) qui reçoivent la pièce. */
export function lotsDeLaPiece(p: PieceMatrice, lotIds: string[]): number {
  return lotIds.filter(id => pieceAtteintLot(p, id)).length;
}

/** Nombre de pièces reçues par un lot. */
export function piecesDuLot(pieces: PieceMatrice[], lotId: string): number {
  return pieces.filter(p => pieceAtteintLot(p, lotId)).length;
}

/** Une liste explicite qui couvre tous les lots redevient « Tous les lots » ; les lots disparus sont écartés. */
function normaliser<T extends PieceMatrice>(p: T, lotIds: string[]): T {
  const connus = p.lots_ids.filter(id => lotIds.includes(id));
  if (lotIds.length > 0 && connus.length === lotIds.length) return { ...p, tous_lots: true, lots_ids: [] };
  return { ...p, tous_lots: false, lots_ids: connus };
}

/** Coche ou décoche un lot pour une pièce. Décocher sur « Tous les lots » liste les autres lots. */
export function basculerCase<T extends PieceMatrice>(p: T, lotId: string, lotIds: string[]): T {
  if (p.tous_lots) return { ...p, tous_lots: false, lots_ids: lotIds.filter(id => id !== lotId) };
  const lots_ids = p.lots_ids.includes(lotId) ? p.lots_ids.filter(id => id !== lotId) : [...p.lots_ids, lotId];
  return normaliser({ ...p, lots_ids }, lotIds);
}

/** « Tous les lots » : active ou vide la liste explicite. */
export function basculerTous<T extends PieceMatrice>(p: T): T {
  return p.tous_lots ? { ...p, tous_lots: false, lots_ids: [] } : { ...p, tous_lots: true, lots_ids: [] };
}

/** Colonne entière : si toutes les pièces atteignent déjà le lot, on les retire toutes, sinon on les donne toutes. */
export function basculerColonne<T extends PieceMatrice>(pieces: T[], lotId: string, lotIds: string[]): T[] {
  const toutes = pieces.length > 0 && pieces.every(p => pieceAtteintLot(p, lotId));
  return pieces.map(p => (pieceAtteintLot(p, lotId) === toutes ? basculerCase(p, lotId, lotIds) : p));
}

/** Lots qui ne reçoivent pas encore toutes les pièces (filtre « Lots à compléter »). */
export function lotsACompleter(pieces: PieceMatrice[], lotIds: string[]): string[] {
  return lotIds.filter(id => piecesDuLot(pieces, id) < pieces.length);
}
