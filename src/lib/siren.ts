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

export interface CompanyDirector {
  /** Identifiant stable dans la liste, pour la clé React. */
  id: string;
  firstName: string;
  lastName: string;
  /** Libellé affiché : « Prénom NOM » ou la dénomination d'une personne morale. */
  label: string;
  /** Qualité déclarée au greffe : Président, Gérant, Directeur général... */
  role: string;
  /** Un dirigeant peut être une société : on ne remplit alors pas une identité. */
  isCompany: boolean;
}

/** « KHALDOUN » -> « Khaldoun », en respectant les composés « JEAN-PIERRE » et « O'BRIEN ». */
function toTitleCase(value: string): string {
  return value
    .toLocaleLowerCase('fr')
    .replace(/(^|[\s\-'’])([\p{L}])/gu, (_m, sep: string, letter: string) => sep + letter.toLocaleUpperCase('fr'));
}

/**
 * Normalise la liste `dirigeants` renvoyée par l'API Recherche d'entreprises.
 * Le schéma varie selon la source du greffe (prénoms au pluriel ou au
 * singulier, nom complet en un seul champ, personne morale sans nom), d'où une
 * lecture tolérante plutôt qu'un accès direct aux champs attendus.
 */
export function parseDirectors(raw: unknown): CompanyDirector[] {
  if (!Array.isArray(raw)) return [];
  const directors: CompanyDirector[] = [];
  raw.forEach((entry: any, index: number) => {
    if (!entry || typeof entry !== 'object') return;
    const role = String(entry.qualite || entry.fonction || '').trim();
    const denomination = String(entry.denomination || entry.sigle || '').trim();
    const isCompany = String(entry.type_dirigeant || '').toLowerCase().includes('morale') || (!entry.nom && !!denomination);

    if (isCompany) {
      if (!denomination) return;
      directors.push({ id: `d${index}`, firstName: '', lastName: '', label: denomination, role, isCompany: true });
      return;
    }

    const rawFirst = String(entry.prenoms || entry.prenom || '').trim();
    const rawLast = String(entry.nom || entry.nom_usage || entry.nom_naissance || '').trim();
    let firstName = rawFirst ? toTitleCase(rawFirst.split(/[\s,]+/)[0]) : '';
    let lastName = rawLast;
    if (!firstName && !lastName) {
      // Certaines fiches ne portent qu'un « nom_complet » : le dernier mot y
      // fait office de patronyme, le reste de prénoms.
      const full = String(entry.nom_complet || '').trim();
      if (!full) return;
      const parts = full.split(/\s+/);
      lastName = parts.length > 1 ? parts[parts.length - 1] : full;
      firstName = parts.length > 1 ? toTitleCase(parts.slice(0, -1).join(' ')) : '';
    }
    const label = [firstName, lastName].filter(Boolean).join(' ');
    if (!label) return;
    directors.push({ id: `d${index}`, firstName, lastName, label, role, isCompany: false });
  });
  return directors;
}
