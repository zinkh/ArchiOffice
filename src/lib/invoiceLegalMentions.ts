// Mentions légales exigées sur une facture pour l'acheteur : identité, adresse
// et SIRET (facture entre professionnels). Pur, partagé écran / tests.
export interface BuyerContactLike {
  company_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  address?: string | null;
  address_work_street?: string | null;
  zip?: string | null;
  address_work_zip?: string | null;
  city?: string | null;
  address_work_city?: string | null;
  siret?: string | null;
  email?: string | null;
  email_work?: string | null;
}

export type BuyerMention = 'name' | 'address' | 'siret';

const clean = (v?: string | null) => (v || '').trim();

export function contactEmail(c?: BuyerContactLike | null): string {
  return c ? clean(c.email) || clean(c.email_work) : '';
}

/** Mentions de l'acheteur absentes de la fiche contact (liste vide = complet). */
export function missingBuyerMentions(c?: BuyerContactLike | null): BuyerMention[] {
  if (!c) return ['name', 'address', 'siret'];
  const missing: BuyerMention[] = [];
  const name = clean(c.company_name) || `${clean(c.first_name)} ${clean(c.last_name)}`.trim();
  if (!name) missing.push('name');
  const street = clean(c.address) || clean(c.address_work_street);
  const city = clean(c.city) || clean(c.address_work_city);
  if (!street || !city) missing.push('address');
  // Un SIRET compte 14 chiffres (espaces tolérés).
  if (clean(c.siret).replace(/\s/g, '').length !== 14) missing.push('siret');
  return missing;
}
