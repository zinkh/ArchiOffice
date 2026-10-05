/** Types d'établissements recevant du public (règlement de sécurité, article GN 1). */
export const ERP_TYPES: ReadonlyArray<{ code: string; nature: string }> = [
  { code: 'J', nature: 'Structures d\'accueil pour personnes âgées ou handicapées' },
  { code: 'L', nature: 'Salles d\'audition, de conférence, de réunion, de spectacle, de projection' },
  { code: 'M', nature: 'Magasins de vente, centres commerciaux' },
  { code: 'N', nature: 'Restaurants et débits de boisson' },
  { code: 'O', nature: 'Hôtels, pensions de famille, résidences de tourisme' },
  { code: 'P', nature: 'Salles de danse et salles de jeux' },
  { code: 'R', nature: 'Enseignement, formation, crèches, haltes-garderies, MAM, centres de loisirs' },
  { code: 'S', nature: 'Bibliothèques, centres de documentation' },
  { code: 'T', nature: 'Salles d\'exposition' },
  { code: 'U', nature: 'Établissements de santé, cure thermale' },
  { code: 'V', nature: 'Lieux de culte' },
  { code: 'W', nature: 'Administrations, banques, bureaux' },
  { code: 'X', nature: 'Établissements sportifs clos et couverts' },
  { code: 'Y', nature: 'Musées' },
  { code: 'PA', nature: 'Établissements de plein air' },
  { code: 'SG', nature: 'Structures gonflables' },
  { code: 'PS', nature: 'Parcs de stationnement couverts' },
  { code: 'GA', nature: 'Gares' },
  { code: 'OA', nature: 'Hôtels-restaurants d\'altitude' },
  { code: 'REF', nature: 'Refuges de montagne' },
  { code: 'CTS', nature: 'Chapiteaux, tentes et structures' },
  { code: 'EF', nature: 'Établissements flottants' },
];

/** Catégories d'ERP et effectif admissible (public + personnel). */
export const ERP_CATEGORIES: ReadonlyArray<{ value: number; label: string; effectif: string }> = [
  { value: 1, label: '1re catégorie', effectif: 'au-dessus de 1 500 personnes' },
  { value: 2, label: '2e catégorie', effectif: 'de 701 à 1 500 personnes' },
  { value: 3, label: '3e catégorie', effectif: 'de 301 à 700 personnes' },
  { value: 4, label: '4e catégorie', effectif: '300 personnes et moins, au-dessus du seuil de la 5e' },
  { value: 5, label: '5e catégorie', effectif: 'sous le seuil fixé pour chaque type d\'exploitation' },
];

export interface ErpSelection { code: string; categorie: number | null; nature?: string }

/** `type_et_cat` est stocké en texte : « N - 4e catégorie », ou « L (cabaret) - 5e catégorie ». */
export function formatTypeEtCat({ code, categorie, nature }: ErpSelection): string {
  const cat = ERP_CATEGORIES.find(c => c.value === categorie)?.label;
  const head = code && nature ? `${code} (${nature})` : code;
  return [head, cat].filter(Boolean).join(' - ');
}

export function parseTypeEtCat(raw: string | undefined | null): ErpSelection {
  const text = (raw ?? '').trim();
  const code = ERP_TYPES.map(t => t.code).sort((a, b) => b.length - a.length)
    .find(c => new RegExp(`^${c}(\\b|\\s|-|,|\\(|$)`, 'i').test(text)) ?? '';
  const cat = text.match(/([1-5])\s*(?:re|e|ère|ème|er)?\s*cat/i);
  const nature = text.match(/^[A-Za-z]+\s*\(([^)]*)\)/)?.[1];
  return { code, categorie: cat ? Number(cat[1]) : null, ...(nature ? { nature } : {}) };
}

/** Catégorie certaine d'après l'effectif total ; en dessous de 301 elle dépend du seuil du type (4e ou 5e). */
export function categorieFromEffectif(effectifTotal: number): number | null {
  if (!Number.isFinite(effectifTotal) || effectifTotal <= 0) return null;
  if (effectifTotal > 1500) return 1;
  if (effectifTotal > 700) return 2;
  if (effectifTotal > 300) return 3;
  return null;
}
