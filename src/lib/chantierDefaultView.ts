/**
 * Vue par défaut des listes de chantier (CR de chantier, AOR, GPA), réglée une
 * fois pour le cabinet dans Paramètres :
 * - `reserves` : les réserves seulement ;
 * - `open` : les observations ouvertes (non levées) ;
 * - `all` : toutes les observations (comportement historique).
 */
export type ChantierDefaultView = 'reserves' | 'open' | 'all';

export const CHANTIER_DEFAULT_VIEWS: readonly ChantierDefaultView[] = ['reserves', 'open', 'all'];

export function normalizeChantierDefaultView(value: unknown): ChantierDefaultView {
  return CHANTIER_DEFAULT_VIEWS.includes(value as ChantierDefaultView) ? (value as ChantierDefaultView) : 'all';
}

/** Filtres initiaux du tableau d'observations (CR de chantier). */
export function observationsInitialFilters(view: ChantierDefaultView): { openOnly: boolean; type: string } {
  return { openOnly: view === 'open', type: view === 'reserves' ? 'reserve' : '' };
}

/**
 * Filtre initial du suivi des réserves (AOR, GPA). Toutes les lignes y sont déjà
 * des réserves : seul « ouvertes » change la liste, les deux autres affichent tout.
 */
export function reservesInitialFilter(view: ChantierDefaultView): 'ouvertes' | 'toutes' {
  return view === 'open' ? 'ouvertes' : 'toutes';
}
