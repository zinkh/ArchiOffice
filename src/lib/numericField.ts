/** Plafond des montants saisis à la main (1 000 milliards) : au-delà, c'est une faute de frappe. */
export const MAX_AMOUNT = 1e12;
/** Plafond d'une surface en m² (100 km²). */
export const MAX_SURFACE = 1e8;

interface NumericOptions {
  min?: number;
  max?: number;
  integer?: boolean;
}

/**
 * Lit une saisie numérique d'un champ de formulaire.
 * Une saisie vide, illisible ou infinie retombe sur 0 (ou sur `min`) ; une valeur hors bornes
 * est ramenée à la borne la plus proche, jamais NaN. La virgule décimale française est acceptée.
 */
export function parseNumericInput(raw: unknown, { min = 0, max = MAX_AMOUNT, integer = false }: NumericOptions = {}): number {
  const text = typeof raw === 'string' ? raw.trim().replace(',', '.') : raw;
  const n = typeof text === 'number' ? text : Number(text);
  if (text === '' || !Number.isFinite(n)) return Math.min(Math.max(0, min), max);
  const bounded = Math.min(Math.max(n, min), max);
  return integer ? Math.round(bounded) : bounded;
}

/** Vrai quand l'échéance précède le début : deux dates remplies, l'ordre inversé. */
export function isDateRangeInverted(start?: string | null, end?: string | null): boolean {
  return !!start && !!end && end < start;
}

export const COVER_IMAGE_MAX_BYTES = 15 * 1024 * 1024;

/** Contrôle d'un fichier choisi comme image de couverture, avant tout traitement. */
export function coverImageProblem(file: { type: string; size: number }): 'type' | 'size' | null {
  if (!file.type.startsWith('image/')) return 'type';
  if (file.size > COVER_IMAGE_MAX_BYTES) return 'size';
  return null;
}
