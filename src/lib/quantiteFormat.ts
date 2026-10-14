/**
 * Une quantité s'affiche telle qu'elle a été saisie : « 7,355 » ne devient pas
 * « 7,36 ». Deux décimales au moins (colonnes alignées), six au plus (au-delà,
 * ce ne sont plus que des restes de calcul).
 */
export const DECIMALES_QUANTITE = 6;

export const formatQuantite = (n: number): string =>
  new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: DECIMALES_QUANTITE }).format(n);
