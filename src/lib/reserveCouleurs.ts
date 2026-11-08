// Couleur d'une réserve selon l'entreprise (à défaut le lot) qui en est responsable.
// Logique pure : la liste, la fiche et la légende lisent la même table.
import { parseJsonList } from './jsonList';

export interface ResponsableReserve {
  /** Clé stable : `e:<entreprise>` ou `l:<lot>`. */
  cle: string;
  nom: string;
  kind: 'entreprise' | 'lot';
}

/** Douze teintes bien séparées, lisibles en thème clair et sombre. */
export const RESERVE_PALETTE = [
  '#2563eb', '#dc2626', '#16a34a', '#d97706', '#9333ea', '#0891b2',
  '#db2777', '#65a30d', '#ea580c', '#4f46e5', '#0d9488', '#a16207',
] as const;

/** Couleur de repli : réserve sans entreprise ni lot. */
export const RESERVE_COULEUR_NEUTRE = '#71717a';

const norm = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');

type AvecResponsable = { entreprises?: unknown; lots?: unknown };

/** Le responsable affiché : la première entreprise, sinon le premier lot. */
export function responsableDe(r: AvecResponsable): ResponsableReserve | null {
  const entreprise = parseJsonList(r.entreprises).find(n => n.trim());
  if (entreprise) return { cle: `e:${norm(entreprise)}`, nom: entreprise.trim(), kind: 'entreprise' };
  const lot = parseJsonList(r.lots).find(n => n.trim());
  if (lot) return { cle: `l:${norm(lot)}`, nom: lot.trim(), kind: 'lot' };
  return null;
}

export interface LegendeCouleur extends ResponsableReserve {
  couleur: string;
  total: number;
}

/**
 * Attribue une couleur à chaque responsable présent, dans l'ordre alphabétique des clés : deux
 * responsables ont des couleurs distinctes tant qu'il y en a moins de douze (puis la palette boucle).
 */
export function construireLegende(reserves: AvecResponsable[]): LegendeCouleur[] {
  const trouves = new Map<string, ResponsableReserve & { total: number }>();
  for (const r of reserves) {
    const resp = responsableDe(r);
    if (!resp) continue;
    const deja = trouves.get(resp.cle);
    if (deja) deja.total += 1;
    else trouves.set(resp.cle, { ...resp, total: 1 });
  }
  return [...trouves.values()]
    .sort((a, b) => a.cle.localeCompare(b.cle, 'fr'))
    .map((x, i) => ({ ...x, couleur: RESERVE_PALETTE[i % RESERVE_PALETTE.length] }));
}

export function couleursParCle(legende: LegendeCouleur[]): Map<string, string> {
  return new Map(legende.map(l => [l.cle, l.couleur]));
}

export function couleurDe(r: AvecResponsable, table: Map<string, string>): string {
  const resp = responsableDe(r);
  return (resp && table.get(resp.cle)) || RESERVE_COULEUR_NEUTRE;
}
