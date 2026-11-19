// Adresse du site de chantier d'un appel d'offres, reprise du « lieu d'exécution » de
// l'annonce quand il s'y prête. Partagé par l'écran (carte du site, suggestion) et le
// serveur (conversion d'une annonce, note méthodologique). Pur et testé.

const MAX_ADDRESS_CHARS = 300;

// Valeurs que les connecteurs écrivent à défaut d'un vrai lieu : « Dépt. 57, 54 » (BOAMP)
// et « NUTS FRF31 » (TED). Elles ne se géocodent pas en adresse.
const NOT_AN_ADDRESS = [
  /^nuts\b/i,
  /^d[ée]pt\.?\s/i,
  /^d[ée]partements?\b/i,
  /^[A-Z]{2}[A-Z0-9]{1,5}$/, // code NUTS isolé : FRF31
  /^[\d\s,;.-]+$/, // numéros de département ou codes seuls
];

/**
 * Texte de lieu d'exécution propre à servir d'adresse, ou null. Retire un éventuel libellé
 * de tête (« Lieu d'exécution : »), réduit les espaces et écarte ce qui n'est pas un lieu.
 */
export function usableSiteAddress(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw
    .replace(/^\s*(lieu d['’]ex[ée]cution(?: des travaux)?|commune d['’]ex[ée]cution|ville d['’]ex[ée]cution)\s*:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_ADDRESS_CHARS);
  if (text.length < 3) return null;
  return NOT_AN_ADDRESS.some(re => re.test(text)) ? null : text;
}

export interface TenderSiteFields {
  adresse_terrain?: string | null;
  ville_execution?: string | null;
}

/** Adresse du site à citer (note méthodologique, agents) : celle de la fiche, à défaut le lieu d'exécution exploitable. */
export function siteAddressOf(tender: TenderSiteFields): string | null {
  const own = (tender.adresse_terrain || '').trim();
  return own || usableSiteAddress(tender.ville_execution);
}

/** Comparaison tolérante (casse, accents, ponctuation) entre deux adresses. */
export function sameSiteAddress(a: string | null | undefined, b: string | null | undefined): boolean {
  const norm = (v: string | null | undefined) => (v || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const x = norm(a);
  return x !== '' && x === norm(b);
}
