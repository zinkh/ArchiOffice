// ── Dossier « Clauses générales » de la bibliothèque ─────────────────────────
// La bibliothèque (`articles_type`) range des OUVRAGES (désignation, unité, prix,
// description technique). Une clause générale est un texte réutilisable sans
// prix ni unité : prescriptions générales, conditions d'exécution, essais,
// réception... Elle vit dans la même table, sous une catégorie réservée : pas
// de migration, mêmes routes, même recherche. Le dossier se lit par
// `categorie`, jamais par un champ de plus.

export const CATEGORIE_CLAUSES = 'clauses_generales';

export type DossierBibliotheque = 'ouvrages' | 'clauses';

export const estClause = (a: { categorie?: string | null } | null | undefined): boolean =>
  a?.categorie === CATEGORIE_CLAUSES;

export const dossierValide = (v: unknown): v is DossierBibliotheque => v === 'ouvrages' || v === 'clauses';

/** Clé de comparaison de deux intitulés de clauses : casse, accents et espaces ignorés. */
export const cleClause = (designation: string): string =>
  (designation || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Ajoute le texte d'une clause à un texte existant, après une ligne vide. Une
 * clause déjà présente (même texte, mise en forme comprise) n'est jamais
 * ajoutée deux fois.
 */
export function ajouterClause(existant: string, clause: string): { texte: string; ajoute: boolean } {
  const a = (existant ?? '').trimEnd();
  const c = (clause ?? '').trim();
  if (!c) return { texte: existant ?? '', ajoute: false };
  if (a.includes(c)) return { texte: existant ?? '', ajoute: false };
  return { texte: a ? `${a}\n\n${c}` : c, ajoute: true };
}

export interface ExportBibliotheque {
  type: 'ouvrage' | 'clause';
  designation: string;
  unite?: string;
  prix_unitaire?: number;
  description?: string;
}

/** Corps de `POST /api/price-library` pour un export depuis le CCTP. */
export function corpsExport(e: ExportBibliotheque): Record<string, unknown> {
  const designation = e.designation.trim();
  if (e.type === 'clause') {
    return { designation, categorie: CATEGORIE_CLAUSES, unite: '', prix_unitaire: 0, description: e.description ?? '', origine: 'saisie' };
  }
  return {
    designation, unite: (e.unite ?? '').trim(), prix_unitaire: Number(e.prix_unitaire) || 0,
    description: e.description ?? '', origine: 'saisie',
  };
}
