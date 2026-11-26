// Signature de repli d'un e-mail : quand la personne n'a pas saisi de signature
// personnelle (Réglages > Mon profil), on compose celle du cabinet à partir de ses
// réglages. Rien n'est écrit en dur : un champ absent des réglages n'apparaît pas,
// et sans aucune identité la signature est vide.

export interface IdentiteSignature {
  /** Nom de la personne qui écrit (réglage « architecte » du cabinet, à défaut son profil). */
  nom?: string | null;
  agencyName?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
}

const net = (v?: string | null): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');

export function signatureParDefaut(identite: IdentiteSignature | null | undefined): string {
  if (!identite) return '';
  const nom = net(identite.nom);
  const agence = net(identite.agencyName);
  const adresse = net(identite.address);
  const contact = [net(identite.phone) && `Tél : ${net(identite.phone)}`, net(identite.email) && `Mail : ${net(identite.email)}`]
    .filter(Boolean).join(' - ');
  // Sans nom ni agence, une adresse ou un téléphone seuls ne signent rien.
  if (!nom && !agence) return '';
  return [nom, agence, adresse, contact].filter(Boolean).join('\n');
}

/**
 * Signature à poser sous le corps : la signature personnelle si elle existe, sinon celle du cabinet.
 * Une signature personnelle faite d'espaces compte comme vide.
 */
export function signatureEffective(personnelle: string | null | undefined, identite: IdentiteSignature | null | undefined): string {
  const perso = typeof personnelle === 'string' ? personnelle.trim() : '';
  return perso || signatureParDefaut(identite);
}
