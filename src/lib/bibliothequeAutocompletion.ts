// Auto-complétion des articles du CCTP et du DPGF à partir de la bibliothèque d'ouvrages :
// pendant la saisie du titre, les ouvrages qui le contiennent sont proposés ; en choisir un
// reprend son unité, son prix et sa description technique, sans jamais écraser ce que la ligne a déjà.
import type { Ligne } from '../types/dpgf';
import type { ArticleBibliotheque } from '../types/library';

/** Nombre de caractères tapés avant de chercher (en dessous, tout correspondrait). */
export const MIN_CARACTERES_RECHERCHE = 2;
export const MAX_PROPOSITIONS_ARTICLES = 8;

/** Ouvrages de la bibliothèque (jamais les clauses générales) dont la désignation ou le code contient `q`. */
export async function chercherArticles(q: string): Promise<ArticleBibliotheque[]> {
  // Chargé à la demande : ce module est tiré par la cellule d'édition, que des tests et des écrans purs importent
  // sans environnement Supabase (`lib/api` tire le client).
  const { fetchJson } = await import('./api');
  const params = new URLSearchParams({ dossier: 'ouvrages', limit: String(MAX_PROPOSITIONS_ARTICLES), q: q.trim() });
  return fetchJson<ArticleBibliotheque[]>(`/api/price-library?${params}`);
}

/** Une ligne neuve porte `u` ou rien : ce n'est pas une unité choisie. */
const uniteVide = (unite: string | undefined): boolean => !unite || unite.trim() === '' || unite.trim().toLowerCase() === 'u';

/**
 * Ce que choisir `article` change sur `ligne`. La désignation et le lien avec la bibliothèque (`articleTypeId`, qui
 * ramène les prix des offres) sont toujours posés ; l'unité, le prix et la description ne le sont que s'ils sont
 * VIDES sur la ligne, pour qu'un choix ne défasse jamais une saisie. Un article qui porte des sous-articles n'a pas
 * de prix propre, un article réservé au CCTP non plus : ils ne reçoivent que le titre, le lien et la description.
 */
export function patchDepuisArticle(ligne: Ligne, article: ArticleBibliotheque): Partial<Ligne> {
  const patch: Partial<Ligne> = { designation: article.designation, articleTypeId: article.id };
  if (!ligne.cctpDescription?.trim() && article.description?.trim()) patch.cctpDescription = article.description;
  if (ligne.children?.length || ligne.cctpOnly) return patch;
  if (uniteVide(ligne.unite) && article.unite?.trim()) patch.unite = article.unite.trim();
  const prix = Number(article.prix_unitaire) || 0;
  if (!ligne.prixUnitaire && prix > 0) {
    patch.prixUnitaire = prix;
    // Un article « pour mémoire » chiffré quitte cet état, comme au DPGF quand on saisit un prix.
    patch.prixTotal = ligne.pourMemoire ? 0 : (Number(ligne.quantite) || 0) * prix;
  }
  return patch;
}

/** Une ligne choisie compte comme un usage de l'article (tri par usage de la bibliothèque), au mieux. */
export function marquerUtilise(articleId: string): void {
  void import('./api').then(({ apiFetch }) => apiFetch(`/api/price-library/${articleId}/used`, { method: 'POST' })).catch(() => {});
}
