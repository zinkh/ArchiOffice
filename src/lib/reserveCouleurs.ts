// Couleur d'une réserve selon l'entreprise (à défaut le lot) qui en est responsable.
// Logique pure : la liste, la fiche et la légende lisent la même table.
import { parseJsonList } from './jsonList';

export interface ResponsableReserve {
  /** Clé stable : `e:<entreprise>` ou `l:<lot>`. */
  cle: string;
  nom: string;
  kind: 'entreprise' | 'lot';
}

/**
 * Trente teintes : douze franches, puis leurs versions sombres et claires et quelques neutres.
 * L'ordre des douze premières ne change jamais (les documents déjà émis restent lisibles).
 */
export const RESERVE_PALETTE = [
  '#2563eb', '#dc2626', '#16a34a', '#d97706', '#9333ea', '#0891b2',
  '#db2777', '#65a30d', '#ea580c', '#4f46e5', '#0d9488', '#a16207',
  '#1e3a8a', '#7f1d1d', '#14532d', '#f59e0b', '#581c87', '#164e63',
  '#9d174d', '#84cc16', '#c2410c', '#312e81', '#134e4a', '#78350f',
  '#38bdf8', '#f87171', '#4ade80', '#c084fc', '#f472b6', '#475569',
] as const;

/** `#rrggbb` en composantes 0 à 255 (jsPDF). Une valeur illisible rend le gris neutre. */
export function hexVersRgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  const n = parseInt(m ? m[1] : RESERVE_COULEUR_NEUTRE.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

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
 * responsables ont des couleurs distinctes tant qu'il y en a moins de trente (puis la palette boucle).
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
