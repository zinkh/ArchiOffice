// Postes associés d'un article de la bibliothèque : à l'insertion de « fenêtre », on suggère « volet roulant ».
// Fonctions pures, partagées par le serveur (nettoyage à l'écriture) et l'écran (suggestion, saisie).
import { COEFFICIENT_MAX } from './quantitesLiees';

export interface PosteAssocie {
  articleId: string;
  /** Rapport de quantité conseillé entre l'article et son associé (1 par défaut). */
  coefficient?: number;
}

export const MAX_ASSOCIES = 20;

/** Nettoie une valeur venue d'un client ou de la base : forme, bornes, doublons, article lui-même. */
export function nettoyerAssocies(brut: unknown, articleId?: string): PosteAssocie[] {
  if (!Array.isArray(brut)) return [];
  const vus = new Set<string>();
  const out: PosteAssocie[] = [];
  for (const e of brut) {
    const id = typeof e?.articleId === 'string' ? e.articleId.trim() : '';
    if (!id || id === articleId || vus.has(id)) continue;
    vus.add(id);
    const c = Number(e.coefficient);
    out.push(Number.isFinite(c) && c > 0 && c <= COEFFICIENT_MAX && c !== 1 ? { articleId: id, coefficient: c } : { articleId: id });
    if (out.length >= MAX_ASSOCIES) break;
  }
  return out;
}

/**
 * Ids des associés à proposer pour les articles choisis : sans ceux déjà choisis, sans doublon, dans l'ordre
 * des articles. Une référence à un article disparu est écartée par l'appelant (il ne trouve pas la fiche).
 */
export function idsAssocies(choisis: ReadonlyArray<{ id: string; associes?: unknown }>): string[] {
  const deja = new Set(choisis.map(a => a.id));
  const out: string[] = [];
  for (const a of choisis) {
    for (const p of nettoyerAssocies(a.associes, a.id)) {
      if (deja.has(p.articleId)) continue;
      deja.add(p.articleId);
      out.push(p.articleId);
    }
  }
  return out;
}
