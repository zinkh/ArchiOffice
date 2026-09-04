// Utilitaires autour de la base SIRENE (API publique recherche-entreprises),
// utilisés pour pré-remplir une fiche contact à partir de l'organisme.

/**
 * Numéro de TVA intracommunautaire français, déduit du SIREN :
 * FR + clé sur deux chiffres + SIREN, la clé valant (12 + 3 x (SIREN mod 97)) mod 97.
 * Renvoie une chaîne vide si le SIREN n'est pas exploitable.
 */
export function frenchVatNumber(siren?: string | null): string {
  const digits = (siren || '').replace(/\D/g, '').slice(0, 9);
  if (digits.length !== 9) return '';
  const key = (12 + 3 * (Number(digits) % 97)) % 97;
  return `FR${String(key).padStart(2, '0')}${digits}`;
}

/**
 * Les adresses de la base SIRENE comme les libellés de la Base Adresse
 * Nationale contiennent le code postal et la commune à la fin
 * ("7 Chem. d'Alba 54210 Saint-Nicolas-de-Port"). Le champ « rue » du contact
 * ne garde que la voie, le reste ayant ses propres colonnes.
 */
export function streetWithoutCity(full?: string | null, zip?: string | null, city?: string | null): string {
  let street = (full || '').trim();
  if (!street) return '';
  const suffixes = [`${zip || ''} ${city || ''}`, city || '', zip || ''];
  for (const suffix of suffixes) {
    const clean = suffix.trim();
    if (!clean) continue;
    if (street.toLowerCase().endsWith(clean.toLowerCase())) {
      street = street.slice(0, street.length - clean.length).trim().replace(/[,;]$/, '').trim();
    }
  }
  return street;
}
