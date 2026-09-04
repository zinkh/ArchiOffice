// ── Montants en toutes lettres ───────────────────────────────────────────────
// Certains règlements de consultation exigent que le bordereau porte les prix
// unitaires en chiffres ET en lettres. Personne ne saisira trois cents montants
// à la main : ils sont dérivés du nombre, avec surcharge manuelle possible.
//
// Orthographe rectifiée de 1990 : trait d'union entre tous les éléments d'un
// nombre composé, ce qui lève l'ambiguïté que l'ancienne graphie laissait
// (« quatre-vingt-un-millions » contre « quatre-vingts millions »).

const UNITES = [
  'zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf',
  'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize',
];

const DIZAINES: Record<number, string> = {
  2: 'vingt', 3: 'trente', 4: 'quarante', 5: 'cinquante', 6: 'soixante',
};

/** 0 à 99. */
function souscent(n: number): string {
  if (n < 17) return UNITES[n];
  if (n < 20) return `dix-${UNITES[n - 10]}`;

  const d = Math.floor(n / 10);
  const u = n % 10;

  // 70-79 et 90-99 se comptent par vingtaines : soixante-dix, quatre-vingt-dix.
  if (d === 7 || d === 9) {
    const base = d === 7 ? 'soixante' : 'quatre-vingt';
    const reste = n - (d === 7 ? 60 : 80);
    // « soixante et onze » garde le « et », « quatre-vingt-onze » ne l'a jamais.
    if (reste === 11 && d === 7) return 'soixante-et-onze';
    return `${base}-${souscent(reste)}`;
  }

  if (d === 8) {
    // « quatre-vingts » ne prend son s que sans rien après lui.
    return u === 0 ? 'quatre-vingts' : `quatre-vingt-${UNITES[u]}`;
  }

  if (u === 0) return DIZAINES[d];
  // « vingt et un » … mais jamais « quatre-vingt et un ».
  if (u === 1) return `${DIZAINES[d]}-et-un`;
  return `${DIZAINES[d]}-${UNITES[u]}`;
}

/** 0 à 999. */
function souscentmille(n: number): string {
  if (n < 100) return souscent(n);
  const c = Math.floor(n / 100);
  const reste = n % 100;
  // « cent » prend son s au pluriel, sauf s'il est suivi d'autre chose.
  const tete = c === 1 ? 'cent' : reste === 0 ? `${UNITES[c]}-cents` : `${UNITES[c]}-cent`;
  return reste === 0 ? tete : `${tete}-${souscent(reste)}`;
}

const ECHELLES: { valeur: number; singulier: string; pluriel: string }[] = [
  { valeur: 1_000_000_000, singulier: 'milliard', pluriel: 'milliards' },
  { valeur: 1_000_000, singulier: 'million', pluriel: 'millions' },
];

/** Partie entière, sans unité monétaire. */
export function entierEnLettres(n: number): string {
  if (!isFinite(n) || n < 0) return '';
  const entier = Math.floor(n);
  if (entier === 0) return 'zéro';

  const parts: string[] = [];
  let reste = entier;

  for (const { valeur, singulier, pluriel } of ECHELLES) {
    const q = Math.floor(reste / valeur);
    if (q > 0) {
      // million et milliard sont des noms : ils s'accordent.
      parts.push(`${souscentmille(q)} ${q > 1 ? pluriel : singulier}`);
      reste %= valeur;
    }
  }

  const milliers = Math.floor(reste / 1000);
  if (milliers > 0) {
    // « mille » est invariable, et « un mille » ne se dit pas.
    parts.push(milliers === 1 ? 'mille' : `${souscentmille(milliers)} mille`);
    reste %= 1000;
  }

  if (reste > 0) parts.push(souscentmille(reste));

  return parts.join(' ');
}

/**
 * Montant complet destiné au bordereau, par exemple :
 * « mille deux-cent-trente-quatre euros et cinquante-six centimes ».
 * Les centimes sont arrondis au plus proche, comme le montant en chiffres.
 */
export function montantEnLettres(montant: number, devise = 'euro'): string {
  if (!isFinite(montant)) return '';
  const negatif = montant < 0;
  const arrondi = Math.round(Math.abs(montant) * 100);
  const entier = Math.floor(arrondi / 100);
  const centimes = arrondi % 100;

  const pluriel = (n: number, mot: string) => (n > 1 ? `${mot}s` : mot);
  let texte = `${entierEnLettres(entier)} ${pluriel(entier, devise)}`;
  if (centimes > 0) {
    texte += ` et ${entierEnLettres(centimes)} ${pluriel(centimes, 'centime')}`;
  }
  return negatif ? `moins ${texte}` : texte;
}
