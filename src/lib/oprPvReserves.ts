// Réserves d'un PV d'OPR : reprises de la LISTE des réserves, jamais saisies dans le PV.
//
// Un PV d'OPR est établi par lot, donc pour l'entreprise titulaire du marché de ce lot : chaque
// entreprise a son PV, qui reprend les réserves dont elle est en charge. Une réserve appartient au PV
// quand :
//   - l'entreprise du marché figure parmi ses entreprises en charge ; ou
//   - aucune entreprise n'est en charge et son lot est celui du marché ; ou
//   - elle a été rattachée à ce PV avant ce changement (`reception_id`), pour que les PV déjà établis
//     gardent leurs réserves.
// Même règle à l'écran et au serveur (contrôle des réserves ouvertes à la signature).
import { parseJsonList } from './jsonList';

export interface ReserveDuPv {
  id: string;
  number?: number | null;
  status?: string | null;
  reception_id?: string | null;
  lots?: unknown;
  entreprises?: unknown;
}

export interface MarchePourReserves {
  entreprise_nom?: string | null;
  lot_numero?: string | null;
  lot_titre?: string | null;
}

const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
const sansZeros = (s: unknown) => norm(s).replace(/^0+(?=\d)/, '');

/** Le lot d'un marché peut s'écrire « Plâtrerie », « 02 · Plâtrerie » ou « 02 » dans une réserve. */
function lotCorrespond(lot: string, marche: MarchePourReserves): boolean {
  const cle = norm(lot);
  if (!cle) return false;
  const titre = norm(marche.lot_titre);
  if (titre && (cle === titre || cle.endsWith(`· ${titre}`) || cle.endsWith(`- ${titre}`))) return true;
  const numero = sansZeros(marche.lot_numero);
  return !!numero && sansZeros(cle) === numero;
}

export function reserveAppartientAuPv(reserve: ReserveDuPv, marche: MarchePourReserves | null | undefined, pvId?: string | null): boolean {
  if (pvId && reserve.reception_id === pvId) return true;
  if (!marche) return false;
  const entreprises = parseJsonList(reserve.entreprises);
  const nom = norm(marche.entreprise_nom);
  if (nom && entreprises.some(e => norm(e) === nom)) return true;
  if (entreprises.length > 0) return false;
  return parseJsonList(reserve.lots).some(l => lotCorrespond(l, marche));
}

/** Réserves d'un PV, par numéro. */
export function reservesDuPv<T extends ReserveDuPv>(reserves: readonly T[], marche: MarchePourReserves | null | undefined, pvId?: string | null): T[] {
  return reserves.filter(r => reserveAppartientAuPv(r, marche, pvId)).sort((a, b) => (a.number || 0) - (b.number || 0));
}
