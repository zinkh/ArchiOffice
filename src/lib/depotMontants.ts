// ── Montants probables dans le texte d'une offre déposée (PDF, Word, tableur) ─
// Extraction à base de règles, sans modèle ni coût : on repère les montants en
// euros et on les classe selon les mots de la ligne qui les porte (« Total HT »,
// « Montant TTC »...). Le résultat est une SUGGESTION que l'architecte confirme
// d'un clic : un devis réel mêle totaux, sous-totaux, acomptes et prix unitaires,
// aucune règle ne peut décider seule du prix de base d'une offre.

export type NatureMontant = 'total_ht' | 'ht' | 'total' | 'ttc' | 'autre';

export interface MontantCandidat {
  montant: number;
  nature: NatureMontant;
  /** La ligne du document qui porte le montant, nettoyée et tronquée. */
  contexte: string;
  /** Numéro de ligne (à partir de 1) dans le texte lu. */
  ligne: number;
}

/** Priorité d'affichage : ce qui ressemble le plus au prix de base HT d'abord. */
const ORDRE: Record<NatureMontant, number> = { total_ht: 0, ht: 1, total: 2, ttc: 3, autre: 4 };

const MONTANT_MAX = 1_000_000_000;

/** « 12 345,50 », « 12.345,50 », « 12345.5 », « 1 234 » → nombre ; null si illisible. */
export function parseMontantFr(brut: string): number | null {
  const s = brut.replace(/[\s  ]/g, '');
  if (!/^\d[\d.,]*$/.test(s)) return null;

  const derniereVirgule = s.lastIndexOf(',');
  const dernierPoint = s.lastIndexOf('.');
  let entier = s;
  let decimales = '';
  const sep = Math.max(derniereVirgule, dernierPoint);
  if (sep >= 0) {
    const apres = s.slice(sep + 1);
    // Un séparateur suivi d'exactement trois chiffres, sans autre séparateur
    // décimal, est un séparateur de milliers (« 12.345 »), pas une décimale.
    const milliers = apres.length === 3 && (derniereVirgule < 0 || dernierPoint < 0);
    if (!milliers && apres.length >= 1 && apres.length <= 2) {
      entier = s.slice(0, sep);
      decimales = apres;
    }
  }
  const nombre = Number(entier.replace(/[.,]/g, '') + (decimales ? `.${decimales}` : ''));
  if (!Number.isFinite(nombre) || nombre <= 0 || nombre > MONTANT_MAX) return null;
  return Math.round(nombre * 100) / 100;
}

// Un montant porte « € », « eur » ou « euros » : seul garde-fou fiable contre les
// quantités, dates et références qui jalonnent un devis.
const MONTANT_EURO = /(\d[\d\s  .,]*\d|\d)\s*(?:€|eur(?:os?)?\b)/gi;

function nature(ligne: string): NatureMontant | 'ignore' {
  const l = ligne.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  // La TVA seule n'est jamais un prix d'offre ; « TTC » et « HT » prennent le dessus.
  if (/\btva\b/.test(l) && !/\b(ht|ttc)\b|h\.t\b/.test(l)) return 'ignore';
  if (/total\s+(general\s+)?(h\.?t\.?|hors\s+tax)/.test(l) || /(montant|prix|offre)\s+(total\s+|global\s+)?(h\.?t\.?\b|hors\s+tax)/.test(l)) return 'total_ht';
  if (/\bttc\b|t\.t\.c|toutes\s+taxes/.test(l)) return 'ttc';
  if (/\bh\.?t\.?\b|hors\s+tax/.test(l)) return 'ht';
  if (/\b(total|montant|prix\s+global|forfait)\b/.test(l)) return 'total';
  return 'autre';
}

/**
 * Montants candidats, du plus probable au moins probable. Les mêmes montants
 * rencontrés sur plusieurs lignes ne sont gardés qu'une fois (la mention la plus
 * parlante l'emporte), et la liste est bornée.
 */
export function extraireMontants(texte: string, limite = 12): MontantCandidat[] {
  const trouves: MontantCandidat[] = [];
  const lignes = texte.split(/\r?\n/);
  lignes.forEach((brut, index) => {
    const ligne = brut.replace(/\s+/g, ' ').trim();
    if (!ligne) return;
    const n = nature(ligne);
    if (n === 'ignore') return;
    for (const m of ligne.matchAll(MONTANT_EURO)) {
      const montant = parseMontantFr(m[1]);
      if (montant === null) continue;
      trouves.push({ montant, nature: n, contexte: ligne.slice(0, 160), ligne: index + 1 });
    }
  });

  // Une même valeur : on garde la nature la plus significative.
  const parValeur = new Map<number, MontantCandidat>();
  for (const c of trouves) {
    const deja = parValeur.get(c.montant);
    if (!deja || ORDRE[c.nature] < ORDRE[deja.nature]) parValeur.set(c.montant, c);
  }
  return [...parValeur.values()]
    .sort((a, b) => ORDRE[a.nature] - ORDRE[b.nature] || b.montant - a.montant || a.ligne - b.ligne)
    .slice(0, limite);
}

export const NATURE_LABELS: Record<NatureMontant, string> = {
  total_ht: 'Total HT',
  ht: 'Montant HT',
  total: 'Total',
  ttc: 'TTC',
  autre: 'Autre montant',
};
