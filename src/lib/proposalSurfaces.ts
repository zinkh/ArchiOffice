// Surfaces d'une proposition selon la nature de l'opération :
//   neuf            : une surface de plancher ;
//   réhabilitation  : surface existante, surface réhabilitée, surface d'extension.
// La nature se déduit pour les propositions antérieures (qui n'en portaient pas), de
// façon à relire leurs chiffres exactement comme avant. Logique pure, testée dans
// `__tests__/proposalSurfaces.test.ts`.

export type OperationNature = 'neuf' | 'rehabilitation';

export interface SurfaceFields {
  operation_nature?: string | null;
  type_projet?: string | null;
  surface_plancher?: string | null;
  surface_plancher_ext?: string | null;
  surface_existante?: string | null;
  surface_rehabilitee?: string | null;
  ratio_rehab?: number | null;
  ratio_extension?: number | null;
}

/** Lit une surface saisie à la française (« 1 126,5 ») ; vide ou illisible : 0. */
export function toSurface(value: string | number | null | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const n = parseFloat(String(value ?? '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

const filled = (v: string | null | undefined): boolean => !!v && v.trim() !== '';

const isExplicit = (n: string | null | undefined): n is OperationNature => n === 'neuf' || n === 'rehabilitation';

/**
 * Nature de l'opération : le choix enregistré l'emporte ; sinon on la déduit du type de
 * projet (« Construction neuve », « Réhabilitation », « Extension »), puis des chiffres déjà saisis
 * (une extension ou un ratio de réhabilitation indiquent une réhabilitation), à défaut du neuf.
 */
export function operationNature(p: SurfaceFields): OperationNature {
  if (isExplicit(p.operation_nature)) return p.operation_nature;
  const type = (p.type_projet ?? '').toLowerCase();
  if (/r[ée]habilit|extension|sur[ée]l[ée]v|transformation|restructur/.test(type)) return 'rehabilitation';
  if (/neuve|neuf/.test(type)) return 'neuf';
  if (toSurface(p.surface_plancher_ext) > 0 || (p.ratio_rehab ?? 0) > 0) return 'rehabilitation';
  return 'neuf';
}

/**
 * Surface existante. Une proposition antérieure (sans nature enregistrée) la portait dans
 * `surface_plancher` : on la relit de là tant que rien n'a été saisi à son nom.
 */
export function surfaceExistante(p: SurfaceFields): string {
  if (filled(p.surface_existante)) return p.surface_existante as string;
  if (!isExplicit(p.operation_nature) && operationNature(p) === 'rehabilitation') return p.surface_plancher ?? '';
  return '';
}

/** Surface réellement réhabilitée ; à défaut de saisie, tout l'existant l'est. */
export function surfaceRehabilitee(p: SurfaceFields): number {
  return filled(p.surface_rehabilitee) ? toSurface(p.surface_rehabilitee) : toSurface(surfaceExistante(p));
}

/** Surface de plancher de l'opération après travaux : celle saisie en neuf, existante + extension en réhabilitation. */
export function surfaceDePlancher(p: SurfaceFields): number {
  if (operationNature(p) === 'neuf') return toSurface(p.surface_plancher);
  return toSurface(surfaceExistante(p)) + toSurface(p.surface_plancher_ext);
}

/**
 * Montant des travaux par ratios (€/m²) :
 *   neuf           = surface de plancher x ratio de construction neuve (`ratio_extension`) ;
 *   réhabilitation = surface réhabilitée x ratio de réhabilitation + extension x ratio d'extension.
 */
export function coutTravauxParRatios(p: SurfaceFields): number {
  const ratioRehab = p.ratio_rehab ?? 0;
  const ratioExt = p.ratio_extension ?? 0;
  if (operationNature(p) === 'neuf') return toSurface(p.surface_plancher) * ratioExt;
  return surfaceRehabilitee(p) * ratioRehab + toSurface(p.surface_plancher_ext) * ratioExt;
}

/**
 * Champs à écrire quand la personne modifie les surfaces d'une réhabilitation : la surface de
 * plancher (utilisée par la MAF et les exports) suit existante + extension.
 */
export function surfacesApresSaisieRehabilitation(p: SurfaceFields): { surface_plancher: string } {
  const total = surfaceDePlancher({ ...p, operation_nature: 'rehabilitation' });
  return { surface_plancher: total > 0 ? String(Math.round(total * 100) / 100) : '' };
}
